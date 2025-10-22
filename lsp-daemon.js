#!/usr/bin/env node

/**
 * TypeScript LSP Daemon Server
 *
 * A background daemon that keeps tsserver running and handles requests via Unix socket.
 * Automatically shuts down after 2 minutes of inactivity.
 */

import { execSync, spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import net from "net";
import path from "path";
import process from "process";

const INACTIVITY_TIMEOUT = 2 * 60 * 1000; // 2 minutes

class TypeScriptLSPDaemon {
	constructor(projectRoot) {
		this.projectRoot = projectRoot;
		this.server = null;
		this.seq = 0;
		this.callbacks = new Map();
		this.buffer = "";
		this.inactivityTimer = null;
		this.socketPath = this.getSocketPath();
		this.unixServer = null;
	}

	/**
	 * Get the socket path for this project
	 */
	getSocketPath() {
		const hash = crypto.createHash('md5').update(this.projectRoot).digest('hex').substring(0, 8);
		return `/tmp/ts-lsp-daemon-${hash}.sock`;
	}

	/**
	 * Find the TypeScript server executable
	 */
	findTsServer() {
		// Try local node_modules first
		const localTsServer = path.join(
			this.projectRoot,
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
	 * Reset the inactivity timer
	 */
	resetInactivityTimer() {
		if (this.inactivityTimer) {
			clearTimeout(this.inactivityTimer);
		}
		this.inactivityTimer = setTimeout(() => {
			console.error('[DAEMON] Shutting down due to inactivity');
			this.shutdown();
		}, INACTIVITY_TIMEOUT);
	}

	/**
	 * Start the TypeScript language server
	 */
	async startTsServer() {
		const tsServerPath = this.findTsServer();
		console.error(`[DAEMON] Starting TypeScript server: ${tsServerPath}`);

		this.server = spawn("node", [tsServerPath], {
			stdio: ["pipe", "pipe", "pipe"],
			cwd: this.projectRoot,
		});

		this.server.stdout.on("data", (data) => {
			this.handleServerOutput(data);
		});

		this.server.stderr.on("data", (data) => {
			console.error(`[DAEMON] tsserver stderr: ${data}`);
		});

		this.server.on("close", (code) => {
			console.error(`[DAEMON] tsserver exited with code ${code}`);
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
		this.buffer = lines.pop() || "";

		for (const line of lines) {
			if (line.trim().startsWith("{")) {
				try {
					const response = JSON.parse(line);
					this.handleResponse(response);
				} catch (e) {
					console.error(`[DAEMON] Failed to parse response: ${line}`);
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
	 * Handle a client request
	 */
	async handleRequest(request) {
		this.resetInactivityTimer();

		try {
			let result;

			switch (request.command) {
				case "rename":
					result = await this.handleRename(request);
					break;
				case "refactor":
					result = await this.handleRefactor(request);
					break;
				case "references":
					result = await this.handleReferences(request);
					break;
				case "code-actions":
					result = await this.handleCodeActions(request);
					break;
				default:
					throw new Error(`Unknown command: ${request.command}`);
			}

			return { success: true, ...result };
		} catch (error) {
			return { success: false, error: error.message };
		}
	}

	/**
	 * Handle rename request
	 */
	async handleRename(request) {
		const { file, line, column, newName } = request;
		const absolutePath = await this.openFile(file);

		const renameInfo = await this.sendRequest("rename", {
			file: absolutePath,
			line,
			offset: column + 1,
		});

		if (!renameInfo.body || !renameInfo.body.info.canRename) {
			throw new Error(
				`Cannot rename: ${renameInfo.body?.info.localizedErrorMessage || "Unknown error"}`,
			);
		}

		const locations = renameInfo.body.locs || [];
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
			displayName: renameInfo.body.info.displayName,
			fullDisplayName: renameInfo.body.info.fullDisplayName,
			kind: renameInfo.body.info.kind,
			changes,
		};
	}

	/**
	 * Handle refactor request
	 */
	async handleRefactor(request) {
		const { file, startLine, startColumn, endLine, endColumn, refactorName, actionName } = request;
		const absolutePath = await this.openFile(file);

		// If no specific refactor type, return available refactorings
		if (!refactorName || !actionName) {
			const response = await this.sendRequest("getApplicableRefactors", {
				file: absolutePath,
				startLine,
				startOffset: startColumn + 1,
				endLine,
				endOffset: endColumn + 1,
			});
			return { available: response.body || [] };
		}

		// Get edits for specific refactoring
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

		return { changes };
	}

	/**
	 * Handle references request
	 */
	async handleReferences(request) {
		const { file, line, column } = request;
		const absolutePath = await this.openFile(file);

		const response = await this.sendRequest("references", {
			file: absolutePath,
			line,
			offset: column + 1,
		});

		if (!response.body) {
			return { references: [] };
		}

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
			symbolName: response.body.symbolName,
			symbolStartOffset: response.body.symbolStartOffset,
			symbolDisplayString: response.body.symbolDisplayString,
			references,
		};
	}

	/**
	 * Handle code actions request
	 */
	async handleCodeActions(request) {
		const { file, line, column, endLine, endColumn, fixId } = request;
		const absolutePath = await this.openFile(file);

		// If no specific fix-id, return available code actions
		if (!fixId) {
			const errorsResponse = await this.sendRequest("semanticDiagnosticsSync", {
				file: absolutePath,
			});

			const errorCodes = (errorsResponse.body || []).map((diag) => diag.code);

			const fixesResponse = await this.sendRequest("getCodeFixes", {
				file: absolutePath,
				startLine: line,
				startOffset: column + 1,
				endLine,
				endOffset: endColumn + 1,
				errorCodes,
			});

			return { available: fixesResponse.body || [] };
		}

		// Get edits for specific code action
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

		return { changes };
	}

	/**
	 * Start the Unix socket server
	 */
	async startSocketServer() {
		// Remove existing socket if it exists
		if (fs.existsSync(this.socketPath)) {
			fs.unlinkSync(this.socketPath);
		}

		this.unixServer = net.createServer((socket) => {
			console.error('[DAEMON] Client connected');

			let buffer = '';

			socket.on('data', async (data) => {
				buffer += data.toString();

				// Check if we have a complete message (ends with newline)
				if (buffer.includes('\n')) {
					const lines = buffer.split('\n');
					buffer = lines.pop() || ''; // Keep incomplete line

					for (const line of lines) {
						if (line.trim()) {
							try {
								const request = JSON.parse(line);
								const response = await this.handleRequest(request);
								socket.write(JSON.stringify(response) + '\n');
							} catch (error) {
								socket.write(JSON.stringify({
									success: false,
									error: error.message
								}) + '\n');
							}
						}
					}
				}
			});

			socket.on('end', () => {
				console.error('[DAEMON] Client disconnected');
			});

			socket.on('error', (error) => {
				console.error('[DAEMON] Socket error:', error.message);
			});
		});

		return new Promise((resolve, reject) => {
			this.unixServer.listen(this.socketPath, () => {
				console.error(`[DAEMON] Listening on ${this.socketPath}`);
				resolve();
			});

			this.unixServer.on('error', reject);
		});
	}

	/**
	 * Start the daemon
	 */
	async start() {
		console.error('[DAEMON] Starting daemon...');
		await this.startTsServer();
		await this.startSocketServer();
		this.resetInactivityTimer();
		console.error('[DAEMON] Daemon ready');
	}

	/**
	 * Shutdown the daemon
	 */
	async shutdown() {
		console.error('[DAEMON] Shutting down...');

		if (this.inactivityTimer) {
			clearTimeout(this.inactivityTimer);
		}

		if (this.unixServer) {
			this.unixServer.close();
		}

		if (this.server) {
			const closePromise = new Promise((resolve) => {
				this.server.once('close', resolve);
			});

			try {
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
				// Server might already be gone
			}

			if (this.server.stdin && !this.server.stdin.destroyed) {
				this.server.stdin.end();
			}

			await new Promise(resolve => setTimeout(resolve, 100));

			if (!this.server.killed) {
				this.server.kill();
			}

			await closePromise;
			this.server.removeAllListeners();
			this.server = null;
		}

		if (fs.existsSync(this.socketPath)) {
			fs.unlinkSync(this.socketPath);
		}

		console.error('[DAEMON] Shutdown complete');
		process.exit(0);
	}
}

/**
 * Main execution
 */
async function main() {
	const projectRoot = process.argv[2] || process.cwd();
	const daemon = new TypeScriptLSPDaemon(projectRoot);

	// Handle signals
	process.on('SIGINT', () => daemon.shutdown());
	process.on('SIGTERM', () => daemon.shutdown());

	try {
		await daemon.start();
	} catch (error) {
		console.error('[DAEMON] Failed to start:', error.message);
		process.exit(1);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}

export { TypeScriptLSPDaemon };
