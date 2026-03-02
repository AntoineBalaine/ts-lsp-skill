#!/usr/bin/env node

/**
 * TypeScript Language Server Client (Daemon-based)
 *
 * Communicates with a background daemon that keeps tsserver running for fast responses.
 * The daemon auto-shuts down after 2 minutes of inactivity.
 *
 * Usage:
 *   node lsp-client.js rename --file <path> --line <n> --column <n> --new-name <name>
 *   node lsp-client.js refactor --file <path> --start-line <n> --start-column <n> --end-line <n> --end-column <n> --refactor-type <type>
 *   node lsp-client.js references --file <path> --line <n> --column <n>
 *   node lsp-client.js code-actions --file <path> --line <n> --column <n>
 *   node lsp-client.js move-to-file --file <path> --line <n> --column <n> --target-file <path>
 *   node lsp-client.js symbols --file <path> [--top-level-only]
 */

import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import net from "net";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the socket path for the current project
 */
function getSocketPath() {
	const projectRoot = process.cwd();
	const hash = crypto.createHash('md5').update(projectRoot).digest('hex').substring(0, 8);
	return `/tmp/ts-lsp-daemon-${hash}.sock`;
}

/**
 * Check if daemon is running and responsive
 */
async function isDaemonRunning() {
	const socketPath = getSocketPath();

	if (!fs.existsSync(socketPath)) {
		return false;
	}

	// Try to connect
	return new Promise((resolve) => {
		const socket = net.connect(socketPath);

		socket.on('connect', () => {
			socket.end();
			resolve(true);
		});

		socket.on('error', () => {
			resolve(false);
		});

		// Timeout after 500ms
		setTimeout(() => {
			socket.destroy();
			resolve(false);
		}, 500);
	});
}

/**
 * Start the daemon in the background
 */
async function startDaemon() {
	const daemonPath = path.join(__dirname, 'lsp-daemon.js');
	const projectRoot = process.cwd();

	console.error('Starting TypeScript LSP daemon...');

	// Spawn daemon as detached background process
	const daemon = spawn('node', [daemonPath, projectRoot], {
		detached: true,
		stdio: 'ignore',
	});

	// Detach from parent
	daemon.unref();

	// Wait for daemon to be ready
	for (let i = 0; i < 20; i++) {
		await new Promise(resolve => setTimeout(resolve, 100));
		if (await isDaemonRunning()) {
			console.error('Daemon started successfully');
			return;
		}
	}

	throw new Error('Daemon failed to start within timeout');
}

/**
 * Send request to daemon and get response
 */
async function sendToDaemon(request) {
	const socketPath = getSocketPath();

	return new Promise((resolve, reject) => {
		const socket = net.connect(socketPath);
		let buffer = '';

		socket.on('connect', () => {
			socket.write(JSON.stringify(request) + '\n');
		});

		socket.on('data', (data) => {
			buffer += data.toString();

			// Check if we have a complete response (ends with newline)
			if (buffer.includes('\n')) {
				try {
					const response = JSON.parse(buffer.trim());
					socket.end();
					resolve(response);
				} catch (error) {
					reject(new Error(`Failed to parse response: ${error.message}`));
				}
			}
		});

		socket.on('error', (error) => {
			reject(error);
		});

		socket.on('timeout', () => {
			socket.destroy();
			reject(new Error('Request timeout'));
		});

		// Set timeout to 30 seconds
		socket.setTimeout(30000);
	});
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
 * Print a diff preview of changes before applying them
 */
function printDiffPreview(changes, operationType = 'Changes') {
	if (!changes || changes.length === 0) return;

	// Group changes by file
	const fileChanges = new Map();
	for (const change of changes) {
		if (!fileChanges.has(change.file)) {
			fileChanges.set(change.file, []);
		}
		fileChanges.get(change.file).push(change);
	}

	const totalFiles = fileChanges.size;
	const totalChanges = changes.length;

	// Print header
	console.error('═══════════════════════════════════════════════════════════════');
	console.error(`${operationType} (${totalChanges} change${totalChanges !== 1 ? 's' : ''} in ${totalFiles} file${totalFiles !== 1 ? 's' : ''})`);
	console.error('═══════════════════════════════════════════════════════════════');
	console.error('');

	// Print changes for each file
	for (const [filePath, fileChangeList] of fileChanges) {
		// Read file to get original content
		const content = fs.readFileSync(filePath, "utf-8");
		const lines = content.split("\n");

		// Sort changes by line number for display
		const sortedChanges = fileChangeList.sort((a, b) => a.line - b.line);

		console.error(`📄 ${filePath}`);
		console.error('───────────────────────────────────────────────────────────────');

		for (const change of sortedChanges) {
			const lineIndex = change.line - 1;

			if (change.endLine === change.line) {
				// Single-line change
				const originalLine = lines[lineIndex];
				const before = originalLine.substring(0, change.column);
				const oldText = originalLine.substring(change.column, change.endColumn);
				const after = originalLine.substring(change.endColumn);
				const newLine = before + change.newText + after;

				// Print diff
				console.error(`  ${String(change.line).padStart(4)} │ - ${originalLine}`);
				console.error(`       │ + ${newLine}`);
			} else {
				// Multi-line change
				const firstLine = lines[change.line - 1];
				const lastLine = lines[change.endLine - 1];
				const before = firstLine.substring(0, change.column);
				const after = lastLine.substring(change.endColumn);

				// Show original span
				console.error(`  ${String(change.line).padStart(4)} │ - ${firstLine}`);
				for (let i = change.line; i < change.endLine - 1; i++) {
					console.error(`  ${String(i + 1).padStart(4)} │ - ${lines[i]}`);
				}
				console.error(`  ${String(change.endLine).padStart(4)} │ - ${lastLine}`);

				// Show new content
				const newContent = before + change.newText + after;
				console.error(`  ${String(change.line).padStart(4)} │ + ${newContent}`);
			}
			console.error('');
		}
	}

	// Print footer
	console.error('═══════════════════════════════════════════════════════════════');
	console.error(`✅ Applying ${totalChanges} change${totalChanges !== 1 ? 's' : ''} across ${totalFiles} file${totalFiles !== 1 ? 's' : ''}...`);
	console.error('═══════════════════════════════════════════════════════════════');
	console.error('');
}

/**
 * Apply text changes to files
 */
function applyChanges(changes) {
	// Print diff preview before applying
	printDiffPreview(changes);

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
		console.error("Commands: rename, refactor, code-actions, references, move-to-file, symbols");
		process.exit(1);
	}

	try {
		// Ensure daemon is running
		if (!await isDaemonRunning()) {
			await startDaemon();
		}

		// Build request based on command
		let request;

		switch (args.command) {
			case "rename": {
				if (!args.file || !args.line || !args.column || !args["new-name"]) {
					throw new Error("Missing required arguments: --file --line --column --new-name");
				}

				request = {
					command: "rename",
					file: args.file,
					line: parseInt(args.line),
					column: parseInt(args.column),
					newName: args["new-name"],
				};
				break;
			}

			case "refactor": {
				if (!args.file || !args["start-line"] || !args["start-column"]) {
					throw new Error("Missing required arguments: --file --start-line --start-column");
				}

				request = {
					command: "refactor",
					file: args.file,
					startLine: parseInt(args["start-line"]),
					startColumn: parseInt(args["start-column"]),
					endLine: parseInt(args["end-line"] || args["start-line"]),
					endColumn: parseInt(args["end-column"] || args["start-column"]),
					refactorName: args["refactor-name"],
					actionName: args["action-name"],
				};
				break;
			}

			case "references": {
				if (!args.file || !args.line || !args.column) {
					throw new Error("Missing required arguments: --file --line --column");
				}

				request = {
					command: "references",
					file: args.file,
					line: parseInt(args.line),
					column: parseInt(args.column),
				};
				break;
			}

			case "code-actions": {
				if (!args.file || !args.line || !args.column) {
					throw new Error("Missing required arguments: --file --line --column");
				}

				const line = parseInt(args.line);
				const column = parseInt(args.column);

				request = {
					command: "code-actions",
					file: args.file,
					line,
					column,
					endLine: parseInt(args["end-line"] || line),
					endColumn: parseInt(args["end-column"] || column),
					fixId: args["fix-id"],
				};
				break;
			}

			case "move-to-file": {
				if (!args.file || !args.line || !args.column || !args["target-file"]) {
					throw new Error("Missing required arguments: --file --line --column --target-file");
				}

				request = {
					command: "move-to-file",
					file: args.file,
					line: parseInt(args.line),
					column: parseInt(args.column),
					endLine: parseInt(args["end-line"] || args.line),
					endColumn: parseInt(args["end-column"] || args.column),
					targetFile: args["target-file"],
				};
				break;
			}

			case "symbols": {
				if (!args.file) {
					throw new Error("Missing required arguments: --file");
				}

				request = {
					command: "symbols",
					file: args.file,
					topLevelOnly: args.flags["top-level-only"] || false,
				};
				break;
			}

			default:
				throw new Error(`Unknown command: ${args.command}`);
		}

		// Send request to daemon
		const response = await sendToDaemon(request);

		if (!response.success) {
			throw new Error(response.error);
		}

		// Apply changes if --apply flag is present and changes exist
		if (args.flags.apply && response.changes) {
			const appliedFiles = applyChanges(response.changes);
			console.log(
				JSON.stringify(
					{
						...response,
						applied: true,
						filesModified: appliedFiles,
					},
					null,
					2,
				),
			);
		} else {
			console.log(JSON.stringify(response, null, 2));
		}

	} catch (error) {
		console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
		process.exit(1);
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

export { sendToDaemon, isDaemonRunning, startDaemon };
