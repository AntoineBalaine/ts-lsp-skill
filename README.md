# TypeScript LSP Refactoring Skill

This skill enables Claude Code to perform safe, semantic-aware TypeScript refactorings using the TypeScript Language Server Protocol (LSP).

## Features

- **Rename Symbols**: Safely rename variables, functions, classes, etc. across your entire codebase
- **Extract Functions**: Extract selected code into reusable functions or methods
- **Find All References**: Locate all usages of a symbol across the project
- **Code Actions/Quick Fixes**: Apply TypeScript quick fixes for errors and warnings
- **Other Refactorings**: Access additional TypeScript refactorings as available

## Installation

The skill is automatically available when placed in `.claude/skills/ts-lsp-refactor/`. No additional installation is required, but you need:

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
# Check if a file is valid TypeScript
node .claude/skills/ts-lsp-refactor/lsp-client.js check \
  --file src/index.ts

# Preview rename locations (doesn't modify files)
node .claude/skills/ts-lsp-refactor/lsp-client.js rename \
  --file src/index.ts \
  --line 10 \
  --column 5 \
  --new-name "newFunctionName"

# Apply rename immediately (modifies files)
node .claude/skills/ts-lsp-refactor/lsp-client.js rename \
  --file src/index.ts \
  --line 10 \
  --column 5 \
  --new-name "newFunctionName" \
  --apply

# Get available refactorings for a code range
node .claude/skills/ts-lsp-refactor/lsp-client.js refactor \
  --file src/index.ts \
  --start-line 15 \
  --start-column 0 \
  --end-line 20 \
  --end-column 0

# Preview a specific refactoring (doesn't modify files)
node .claude/skills/ts-lsp-refactor/lsp-client.js refactor \
  --file src/index.ts \
  --start-line 15 \
  --start-column 0 \
  --end-line 20 \
  --end-column 0 \
  --refactor-name "Extract Symbol" \
  --action-name "function_scope_0"

# Apply a specific refactoring immediately (modifies files)
node .claude/skills/ts-lsp-refactor/lsp-client.js refactor \
  --file src/index.ts \
  --start-line 15 \
  --start-column 0 \
  --end-line 20 \
  --end-column 0 \
  --refactor-name "Extract Symbol" \
  --action-name "function_scope_0" \
  --apply

# Find all references to a symbol
node .claude/skills/ts-lsp-refactor/lsp-client.js references \
  --file src/index.ts \
  --line 10 \
  --column 5

# Get available code actions/quick fixes
node .claude/skills/ts-lsp-refactor/lsp-client.js code-actions \
  --file src/index.ts \
  --line 10 \
  --column 5

# Apply a specific code action/quick fix
node .claude/skills/ts-lsp-refactor/lsp-client.js code-actions \
  --file src/index.ts \
  --line 10 \
  --column 5 \
  --fix-id "fixMissingImport" \
  --apply
```

## How It Works

1. **TypeScript Server**: The skill starts a TypeScript language server process (tsserver)
2. **LSP Protocol**: Communicates with tsserver using its JSON protocol
3. **Semantic Analysis**: TypeScript analyzes your code to understand symbols and their relationships
4. **Safe Refactoring**: Returns all locations where changes need to be made
5. **Application**: Claude applies the changes using the Edit tool

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
│  lsp-client.js  │  ← Node.js LSP client
└────────┬────────┘
         │
         │ (JSON protocol via stdio)
         ▼
┌─────────────────┐
│    tsserver     │  ← TypeScript language server
└─────────────────┘
```

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
