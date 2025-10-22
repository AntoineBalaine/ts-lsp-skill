#!/usr/bin/env node

/**
 * TypeScript Language Server Client for Refactoring
 *
 * This script manages communication with the TypeScript language server (tsserver)
 * to perform code refactorings like rename and extract function.
 *
 * Usage:
 *   node lsp-client.js rename --file <path> --line <n> --column <n> --new-name <name>
 *   node lsp-client.js refactor --file <path> --start-line <n> --start-column <n> --end-line <n> --end-column <n> --refactor-type <type>
 *   node lsp-client.js check --file <path> --line <n> --column <n>
 */

import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TypeScriptLSPClient {
	constructor() {
		this.server = null;
		this.seq = 0;
		this.callbacks = new Map();
		this.buffer = "";
	}

	/**
	 * Find the TypeScript server executable
	 */
	findTsServer() {
		// Try local node_modules first
		const localTsServer = path.join(
			process.cwd(),
			"node_modules",
			"typescript",
			"lib",
			"tsserver.js",
		);
		if (fs.existsSync(localTsServer)) {
			return localTsServer;
		}

		// Try global installation
		try {
			const npmRoot = execSync("npm root -g", { encoding: "utf-8" }).trim();
			const globalTsServer = path.join(npmRoot, "typescript", "lib", "tsserver.js");
			if (fs.existsSync(globalTsServer)) {
				return globalTsServer;
			}
		} catch (e) {
			// Fall through
		}

		throw new Error("TypeScript not found. Please run: npm install typescript");
	}

	/**
	 * Start the TypeScript language server
	 */
	async start() {
		const tsServerPath = this.findTsServer();
		console.error(`Starting TypeScript server: ${tsServerPath}`);

		this.server = spawn("node", [tsServerPath], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.server.stdout.on("data", (data) => {
			this.handleServerOutput(data);
		});

		this.server.stderr.on("data", (data) => {
			console.error(`tsserver stderr: ${data}`);
		});

		this.server.on("close", (code) => {
			console.error(`tsserver exited with code ${code}`);
		});

		// Wait a bit for server to start
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	/**
	 * Handle output from the TypeScript server
	 */
	handleServerOutput(data) {
		this.buffer += data.toString();

		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() || ""; // Keep incomplete line in buffer

		for (const line of lines) {
			if (line.trim().startsWith("{")) {
				try {
					const response = JSON.parse(line);
					this.handleResponse(response);
				} catch (e) {
					console.error(`Failed to parse response: ${line}`);
				}
			}
		}
	}

	/**
	 * Handle a parsed response from the server
	 */
	handleResponse(response) {
		if (response.type === "response" && response.request_seq !== undefined) {
			const callback = this.callbacks.get(response.request_seq);
			if (callback) {
				this.callbacks.delete(response.request_seq);
				callback(response);
			}
		}
	}

	/**
	 * Send a request to the TypeScript server
	 */
	async sendRequest(command, arguments_) {
		const seq = ++this.seq;
		const request = {
			seq,
			type: "request",
			command,
			arguments: arguments_,
		};

		const promise = new Promise((resolve) => {
			this.callbacks.set(seq, resolve);
		});

		this.server.stdin.write(JSON.stringify(request) + "\n");

		// Add timeout
		const timeout = new Promise((_, reject) =>
			setTimeout(() => reject(new Error("Request timeout")), 30000),
		);

		return Promise.race([promise, timeout]);
	}

	/**
	 * Open a file in the TypeScript project
	 */
	async openFile(file) {
		const absolutePath = path.resolve(file);
		const content = fs.readFileSync(absolutePath, "utf-8");

		await this.sendRequest("open", {
			file: absolutePath,
			fileContent: content,
		});

		return absolutePath;
	}

	/**
	 * Get rename locations for a symbol
	 */
	async rename(file, line, column, newName) {
		const absolutePath = await this.openFile(file);

		// First, check if rename is possible
		const renameInfo = await this.sendRequest("rename", {
			file: absolutePath,
			line,
			offset: column + 1, // tsserver uses 1-based offset
		});

		if (!renameInfo.body || !renameInfo.body.info.canRename) {
			throw new Error(
				`Cannot rename: ${renameInfo.body?.info.localizedErrorMessage || "Unknown error"}`,
			);
		}

		// Get all rename locations
		const locations = renameInfo.body.locs || [];

		// Format output
		const changes = [];
		for (const loc of locations) {
			for (const span of loc.locs) {
				changes.push({
					file: loc.file,
					line: span.start.line,
					column: span.start.offset - 1,
					endLine: span.end.line,
					endColumn: span.end.offset - 1,
					oldText: span.text,
					newText: newName,
				});
			}
		}

		return {
			success: true,
			displayName: renameInfo.body.info.displayName,
			fullDisplayName: renameInfo.body.info.fullDisplayName,
			kind: renameInfo.body.info.kind,
			changes,
		};
	}

	/**
	 * Get available refactorings at a position
	 */
	async getRefactorings(file, startLine, startColumn, endLine, endColumn) {
		const absolutePath = await this.openFile(file);

		const response = await this.sendRequest("getApplicableRefactors", {
			file: absolutePath,
			startLine,
			startOffset: startColumn + 1,
			endLine,
			endOffset: endColumn + 1,
		});

		return response.body || [];
	}

	/**
	 * Get edits for a specific refactoring
	 */
	async getRefactoringEdits(
		file,
		startLine,
		startColumn,
		endLine,
		endColumn,
		refactorName,
		actionName,
	) {
		const absolutePath = await this.openFile(file);

		const response = await this.sendRequest("getEditsForRefactor", {
			file: absolutePath,
			startLine,
			startOffset: startColumn + 1,
			endLine,
			endOffset: endColumn + 1,
			refactor: refactorName,
			action: actionName,
		});

		if (!response.body) {
			throw new Error("No refactoring edits available");
		}

		// Format output
		const changes = [];
		for (const edit of response.body.edits) {
			for (const change of edit.textChanges) {
				changes.push({
					file: edit.fileName,
					line: change.start.line,
					column: change.start.offset - 1,
					endLine: change.end.line,
					endColumn: change.end.offset - 1,
					newText: change.newText,
				});
			}
		}

		return {
			success: true,
			changes,
		};
	}

	/**
	 * Get code actions (quick fixes and refactorings) at a position
	 */
	async getCodeActions(file, startLine, startColumn, endLine, endColumn) {
		const absolutePath = await this.openFile(file);

		// Get syntax/semantic errors for code fixes
		const errorsResponse = await this.sendRequest("semanticDiagnosticsSync", {
			file: absolutePath,
		});

		const errorCodes = (errorsResponse.body || []).map((diag) => diag.code);

		// Get code fixes for any errors
		const fixesResponse = await this.sendRequest("getCodeFixes", {
			file: absolutePath,
			startLine,
			startOffset: startColumn + 1,
			endLine,
			endOffset: endColumn + 1,
			errorCodes,
		});

		return fixesResponse.body || [];
	}

	/**
	 * Get edits for a specific code action
	 */
	async getCodeActionEdits(file, startLine, startColumn, endLine, endColumn, fixId) {
		const absolutePath = await this.openFile(file);

		const response = await this.sendRequest("getCombinedCodeFix", {
			scope: {
				type: "file",
				args: { file: absolutePath },
			},
			fixId,
		});

		if (!response.body) {
			throw new Error("No code action edits available");
		}

		// Format output
		const changes = [];
		for (const change of response.body.changes) {
			for (const textChange of change.textChanges) {
				changes.push({
					file: change.fileName,
					line: textChange.start.line,
					column: textChange.start.offset - 1,
					endLine: textChange.end.line,
					endColumn: textChange.end.offset - 1,
					newText: textChange.newText,
				});
			}
		}

		return {
			success: true,
			changes,
		};
	}

	/**
	 * Find all references to a symbol
	 */
	async findReferences(file, line, column) {
		const absolutePath = await this.openFile(file);

		const response = await this.sendRequest("references", {
			file: absolutePath,
			line,
			offset: column + 1,
		});

		if (!response.body) {
			return {
				success: true,
				references: [],
			};
		}

		// Format output
		const references = response.body.refs.map((ref) => ({
			file: ref.file,
			line: ref.start.line,
			column: ref.start.offset - 1,
			endLine: ref.end.line,
			endColumn: ref.end.offset - 1,
			lineText: ref.lineText,
			isDefinition: ref.isDefinition || false,
			isWriteAccess: ref.isWriteAccess || false,
		}));

		return {
			success: true,
			symbolName: response.body.symbolName,
			symbolStartOffset: response.body.symbolStartOffset,
			symbolDisplayString: response.body.symbolDisplayString,
			references,
		};
	}

	/**
	 * Stop the TypeScript server gracefully
	 */
	async stop() {
		if (this.server) {
			// Create a promise that resolves when the server actually closes
			const closePromise = new Promise((resolve) => {
				this.server.once('close', resolve);
			});

			try {
				// Try to send exit command first for graceful shutdown
				// Note: Don't await this - tsserver exits without sending a response
				if (!this.server.killed) {
					const exitRequest = {
						seq: ++this.seq,
						type: "request",
						command: "exit",
						arguments: {},
					};
					this.server.stdin.write(JSON.stringify(exitRequest) + "\n");
				}
			} catch (error) {
				// Server might already be gone, that's ok
			}

			// Close stdin to signal we're done sending commands
			if (this.server.stdin && !this.server.stdin.destroyed) {
				this.server.stdin.end();
			}

			// Wait a moment for graceful shutdown
			await new Promise(resolve => setTimeout(resolve, 100));

			// If still running, force kill
			if (!this.server.killed) {
				this.server.kill();
			}

			// Wait for the server to actually close
			await closePromise;

			// Clean up event listeners
			this.server.removeAllListeners();
			this.server = null;
		}
	}
}

/**
 * Parse command line arguments
 */
function parseArgs(args) {
	const result = { command: args[0], flags: {} };
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--")) {
			const key = arg.replace(/^--/, "");
			// Check if next arg exists and doesn't start with --
			if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
				result[key] = args[i + 1];
				i++; // Skip next arg since we consumed it
			} else {
				// It's a flag without a value
				result.flags[key] = true;
			}
		}
	}
	return result;
}

/**
 * Apply text changes to files
 */
function applyChanges(changes) {
	// Group changes by file
	const fileChanges = new Map();
	for (const change of changes) {
		if (!fileChanges.has(change.file)) {
			fileChanges.set(change.file, []);
		}
		fileChanges.get(change.file).push(change);
	}

	const appliedFiles = [];

	// Apply changes to each file
	for (const [filePath, fileChangeList] of fileChanges) {
		// Read file content
		const content = fs.readFileSync(filePath, "utf-8");
		const lines = content.split("\n");

		// Sort changes in reverse order (bottom to top) to preserve positions
		const sortedChanges = fileChangeList.sort((a, b) => {
			if (a.line !== b.line) return b.line - a.line;
			return b.column - a.column;
		});

		// Apply each change
		for (const change of sortedChanges) {
			const lineIndex = change.line - 1; // Convert to 0-based
			const line = lines[lineIndex];

			if (change.endLine === change.line) {
				// Single-line change
				const before = line.substring(0, change.column);
				const after = line.substring(change.endColumn);
				lines[lineIndex] = before + change.newText + after;
			} else {
				// Multi-line change
				const firstLine = lines[change.line - 1];
				const lastLine = lines[change.endLine - 1];

				const before = firstLine.substring(0, change.column);
				const after = lastLine.substring(change.endColumn);
				const newContent = before + change.newText + after;

				// Remove all lines in the range and replace with new content
				lines.splice(change.line - 1, change.endLine - change.line + 1, newContent);
			}
		}

		// Write back to file
		fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
		appliedFiles.push({
			file: filePath,
			changesApplied: fileChangeList.length,
		});
	}

	return appliedFiles;
}

/**
 * Main execution
 */
async function main() {
	const args = parseArgs(process.argv.slice(2));

	if (!args.command) {
		console.error("Usage: node lsp-client.js <command> [options]");
		console.error("Commands: rename, refactor, code-actions, references, check");
		process.exit(1);
	}

	const client = new TypeScriptLSPClient();

	// Ensure cleanup on signal interrupts
	const cleanup = async () => {
		await client.stop();
		process.exit(0);
	};

	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);

	try {
		await client.start();

		switch (args.command) {
			case "rename": {
				if (!args.file || !args.line || !args.column || !args["new-name"]) {
					throw new Error("Missing required arguments: --file --line --column --new-name");
				}

				const result = await client.rename(
					args.file,
					parseInt(args.line),
					parseInt(args.column),
					args["new-name"],
				);

				// Apply changes if --apply flag is present
				if (args.flags.apply) {
					const appliedFiles = applyChanges(result.changes);
					console.log(
						JSON.stringify(
							{
								...result,
								applied: true,
								filesModified: appliedFiles,
							},
							null,
							2,
						),
					);
				} else {
					console.log(JSON.stringify(result, null, 2));
				}
				break;
			}

			case "refactor": {
				if (!args.file || !args["start-line"] || !args["start-column"]) {
					throw new Error("Missing required arguments: --file --start-line --start-column");
				}

				const startLine = parseInt(args["start-line"]);
				const startColumn = parseInt(args["start-column"]);
				const endLine = parseInt(args["end-line"] || startLine);
				const endColumn = parseInt(args["end-column"] || startColumn);

				// If no specific refactor type, show available refactorings
				if (!args["refactor-name"] || !args["action-name"]) {
					const refactorings = await client.getRefactorings(
						args.file,
						startLine,
						startColumn,
						endLine,
						endColumn,
					);
					console.log(JSON.stringify({ available: refactorings }, null, 2));
				} else {
					const result = await client.getRefactoringEdits(
						args.file,
						startLine,
						startColumn,
						endLine,
						endColumn,
						args["refactor-name"],
						args["action-name"],
					);

					// Apply changes if --apply flag is present
					if (args.flags.apply) {
						const appliedFiles = applyChanges(result.changes);
						console.log(
							JSON.stringify(
								{
									...result,
									applied: true,
									filesModified: appliedFiles,
								},
								null,
								2,
							),
						);
					} else {
						console.log(JSON.stringify(result, null, 2));
					}
				}
				break;
			}

			case "check": {
				// Just check if a file is valid TypeScript
				if (!args.file) {
					throw new Error("Missing required argument: --file");
				}
				await client.openFile(args.file);
				console.log(
					JSON.stringify({ success: true, message: "File opened successfully" }, null, 2),
				);
				break;
			}

			case "code-actions": {
				if (!args.file || !args.line || !args.column) {
					throw new Error("Missing required arguments: --file --line --column");
				}

				const line = parseInt(args.line);
				const column = parseInt(args.column);
				const endLine = parseInt(args["end-line"] || line);
				const endColumn = parseInt(args["end-column"] || column);

				// If no specific fix-id, show available code actions
				if (!args["fix-id"]) {
					const actions = await client.getCodeActions(args.file, line, column, endLine, endColumn);
					console.log(JSON.stringify({ available: actions }, null, 2));
				} else {
					const result = await client.getCodeActionEdits(
						args.file,
						line,
						column,
						endLine,
						endColumn,
						args["fix-id"],
					);

					// Apply changes if --apply flag is present
					if (args.flags.apply) {
						const appliedFiles = applyChanges(result.changes);
						console.log(
							JSON.stringify(
								{
									...result,
									applied: true,
									filesModified: appliedFiles,
								},
								null,
								2,
							),
						);
					} else {
						console.log(JSON.stringify(result, null, 2));
					}
				}
				break;
			}

			case "references": {
				if (!args.file || !args.line || !args.column) {
					throw new Error("Missing required arguments: --file --line --column");
				}

				const result = await client.findReferences(
					args.file,
					parseInt(args.line),
					parseInt(args.column),
				);

				console.log(JSON.stringify(result, null, 2));
				break;
			}

			default:
				throw new Error(`Unknown command: ${args.command}`);
		}
	} catch (error) {
		console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
		process.exit(1);
	} finally {
		await client.stop();
	}
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main()
		.then(() => {
			process.exit(0);
		})
		.catch((error) => {
			console.error(error);
			process.exit(1);
		});
}

export { TypeScriptLSPClient };
