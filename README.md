# TypeScript LSP Refactoring Skill

This skill enables Claude Code to perform safe, semantic-aware TypeScript refactorings using the TypeScript Language Server Protocol (LSP).

## Features

- **Rename Symbols**: Safely rename variables, functions, classes, etc. across your entire codebase
- **Extract Functions**: Extract selected code into reusable functions or methods
- **Find All References**: Locate all usages of a symbol across the project
- **Code Actions/Quick Fixes**: Apply TypeScript quick fixes for errors and warnings
- **Other Refactorings**: Access additional TypeScript refactorings as available

## Installation

The skill is automatically available when placed in `.claude/skills/ts-lsp/`. No additional installation is required, but you need:

- Node.js installed
- TypeScript in your project (`npm install typescript`) or globally (`npm install -g typescript`)
- A TypeScript project with `tsconfig.json`

## Usage

### Automatic Invocation

Claude Code will automatically use this skill when you request TypeScript refactorings:

- "Rename the `fetchData` function to `getUserData`"
- "Extract lines 45-60 into a helper function"
- "Find all references to the `User` interface"
- "Show me where `calculateTotal` is used"
- "Fix the TypeScript error on line 42"

### Manual Testing

You can test the LSP client directly:

```bash
# Preview rename locations (doesn't modify files)
node .claude/skills/ts-lsp/lsp-client.js rename \
  --file src/index.ts \
  --line 10 \
  --column 5 \
  --new-name "newFunctionName"

# Apply rename immediately (modifies files)
node .claude/skills/ts-lsp/lsp-client.js rename \
  --file src/index.ts \
  --line 10 \
  --column 5 \
  --new-name "newFunctionName" \
  --apply

# Get available refactorings for a code range
node .claude/skills/ts-lsp/lsp-client.js refactor \
  --file src/index.ts \
  --start-line 15 \
  --start-column 0 \
  --end-line 20 \
  --end-column 0

# Preview a specific refactoring (doesn't modify files)
node .claude/skills/ts-lsp  /lsp-client.js refactor \
  --file src/index.ts \
  --start-line 15 \
  --start-column 0 \
  --end-line 20 \
  --end-column 0 \
  --refactor-name "Extract Symbol" \
  --action-name "function_scope_0"

# Apply a specific refactoring immediately (modifies files)
node .claude/skills/ts-lsp/lsp-client.js refactor \
  --file src/index.ts \
  --start-line 15 \
  --start-column 0 \
  --end-line 20 \
  --end-column 0 \
  --refactor-name "Extract Symbol" \
  --action-name "function_scope_0" \
  --apply

# Find all references to a symbol
node .claude/skills/ts-lsp/lsp-client.js references \
  --file src/index.ts \
  --line 10 \
  --column 5

# Get available code actions/quick fixes
node .claude/skills/ts-lsp/lsp-client.js code-actions \
  --file src/index.ts \
  --line 10 \
  --column 5

# Apply a specific code action/quick fix
node .claude/skills/ts-lsp/lsp-client.js code-actions \
  --file src/index.ts \
  --line 10 \
  --column 5 \
  --fix-id "fixMissingImport" \
  --apply
```

## How It Works

This skill uses a **daemon-based architecture** for optimal performance:

1. **First Call**: Automatically starts a background daemon that manages `tsserver` (~2-3 seconds)
2. **Daemon Process**: Runs in the background, handling multiple requests efficiently
3. **Subsequent Calls**: Connect to the running daemon for near-instant responses (~40-50ms)
4. **Auto-Cleanup**: The daemon automatically shuts down after 2 minutes of inactivity
5. **Per-Project**: Each project gets its own daemon (based on working directory hash)

**Performance**:
- First refactoring: ~2-3 seconds (daemon startup + tsserver initialization)
- Subsequent refactorings: ~40-50ms (just socket communication)
- No manual management needed - the daemon handles itself!

**Technical Flow**:
1. Client checks if daemon is running (via Unix socket)
2. If not running, spawns daemon as detached background process
3. Sends refactoring request via JSON over socket
4. Daemon uses TypeScript's LSP to analyze code semantically
5. Returns changes to client, which applies them if `--apply` is used

## Output Format

All commands return JSON output:

### Rename Output
```json
{
  "success": true,
  "displayName": "fetchData",
  "fullDisplayName": "fetchData",
  "kind": "function",
  "changes": [
    {
      "file": "/path/to/file.ts",
      "line": 10,
      "column": 5,
      "endLine": 10,
      "endColumn": 14,
      "oldText": "fetchData",
      "newText": "getUserData"
    }
  ]
}
```

### Refactor Output
```json
{
  "available": [
    {
      "name": "Extract Symbol",
      "description": "Extract function",
      "actions": [
        {
          "name": "function_scope_0",
          "description": "Extract to function in module scope"
        }
      ]
    }
  ]
}
```

## Troubleshooting

### "TypeScript not found"
Install TypeScript: `npm install typescript` (local) or `npm install -g typescript` (global)

### "Cannot rename: [error]"
The symbol at the specified location cannot be renamed. This can happen if:
- The location is not a valid symbol
- The symbol is read-only (e.g., from a library)
- The coordinates are incorrect

### "No refactoring edits available"
The refactoring cannot be applied at the specified location. Try:
- Selecting a different code range
- Using `refactor` without `--refactor-name` to see available refactorings

## Architecture

```
┌─────────────────┐
│  Claude Code    │
└────────┬────────┘
         │
         │ (invokes skill)
         ▼
┌─────────────────┐
│   SKILL.md      │  ← Instructions for Claude
└────────┬────────┘
         │
         │ (runs)
         ▼
┌─────────────────┐
│  lsp-client.js  │  ← Lightweight client
└────────┬────────┘
         │
         │ (JSON via Unix socket)
         ▼
┌─────────────────┐
│  lsp-daemon.js  │  ← Background daemon (auto-starts, auto-stops)
└────────┬────────┘
         │
         │ (JSON protocol via stdio)
         ▼
┌─────────────────┐
│    tsserver     │  ← TypeScript language server (kept warm)
└─────────────────┘
```

**Key Components**:
- **lsp-client.js**: Fast client that connects to daemon via Unix socket
- **lsp-daemon.js**: Background process managing tsserver with 2-min inactivity timeout
- **Unix socket**: `/tmp/ts-lsp-daemon-{hash}.sock` for IPC
- **tsserver**: Kept running between requests for speed

## Examples

### Rename a Function

**Request**: "Rename `calculateTotal` to `computeSum`"

**What happens**:
1. Claude searches for `calculateTotal` in the codebase
2. Uses LSP to find all references
3. Shows preview: "Will rename in 3 files (8 references)"
4. Applies changes with Edit tool
5. Confirms success

### Extract Function

**Request**: "Extract lines 50-65 in src/utils.ts into a helper function"

**What happens**:
1. Claude reads the specified lines
2. Queries LSP for available extract refactorings
3. Shows options: "Extract to function", "Extract to method", etc.
4. Asks for function name
5. Applies the extraction
6. Confirms the new function signature

## Best Practices

- **Always verify**: Run type checking after refactorings (`npm run check-types`)
- **Commit first**: Ensure clean git state before large refactorings
- **Review changes**: For multi-file renames, review the change list
- **Use LSP**: Prefer this skill over find/replace for semantic accuracy

## Contributing

To improve this skill:
1. Edit `SKILL.md` to add new refactoring patterns
2. Extend `lsp-client.js` to support additional LSP operations
3. Test with various TypeScript codebases
4. Submit improvements via git

## License

Part of the Databot project. See project root for license information.
