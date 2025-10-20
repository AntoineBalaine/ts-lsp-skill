---
name: TypeScript LSP Refactoring
description: Use TypeScript Language Server Protocol to perform safe, accurate code refactoring operations including renaming symbols, extracting functions/methods, finding all references, and applying quick fixes. Invoke this skill when the user asks to rename TypeScript variables/functions/classes, extract code into functions, find where a symbol is used, fix TypeScript errors, or perform other TypeScript refactoring tasks.
allowed-tools:
  - Read
  - Edit
  - Bash
  - Glob
  - Grep
---

# TypeScript LSP Refactoring Skill

This skill provides interactive TypeScript code refactoring capabilities using the TypeScript Language Server Protocol (LSP). It ensures safe, accurate refactorings by leveraging TypeScript's semantic understanding of the code.

## Capabilities

1. **Rename Symbols**: Safely rename variables, functions, classes, interfaces, and other symbols across all files
2. **Extract Functions/Methods**: Extract selected code into reusable functions or methods
3. **Find All References**: Locate all usages of a symbol across the codebase
4. **Code Actions/Quick Fixes**: Apply TypeScript quick fixes for errors and warnings
5. **Other Refactorings**: Access additional LSP-powered refactorings as available

## Prerequisites

- Node.js installed
- TypeScript project with `tsconfig.json`
- `typescript` package installed (either globally or in project)

## Workflow

### Starting the LSP Server

Before performing any refactoring, start the TypeScript LSP server:

```bash
# Navigate to the project root
cd /path/to/project

# Start the TypeScript language server using the helper script
node .claude/skills/ts-lsp-refactor/lsp-client.js
```

The helper script will:
1. Locate the TypeScript installation
2. Start the `tsserver` process
3. Initialize the server with the current project
4. Keep a persistent connection for refactoring operations

### Rename Symbol Refactoring

When the user wants to rename a symbol:

1. **Identify the symbol location**:
   - Ask the user which symbol to rename if not specified
   - Use Grep to find the symbol definition
   - Determine the file path and line/column position

2. **Use the LSP rename operation**:
   ```bash
   # Preview changes (returns JSON without modifying files)
   node .claude/skills/ts-lsp-refactor/lsp-client.js rename \
     --file "/path/to/file.ts" \
     --line 10 \
     --column 5 \
     --new-name "newSymbolName"

   # Apply changes immediately (modifies files directly)
   node .claude/skills/ts-lsp-refactor/lsp-client.js rename \
     --file "/path/to/file.ts" \
     --line 10 \
     --column 5 \
     --new-name "newSymbolName" \
     --apply
   ```

3. **Review changes**:
   - Without `--apply`: The LSP returns JSON with all locations to be renamed
   - With `--apply`: Files are modified immediately and a summary is returned
   - Show the user a summary of affected files and locations
   - For large refactorings (10+ files), preview first without --apply

4. **Recommended approach**:
   - Use `--apply` flag to apply changes directly
   - This is safer and more atomic than using Edit tool manually
   - The LSP ensures all related symbols are renamed consistently

### Extract Function/Method Refactoring

When the user wants to extract code:

1. **Identify the code range**:
   - Ask the user to specify the file and line range
   - Or use context from recent edits/reads

2. **Get available refactorings**:
   ```bash
   # First, see what refactorings are available
   node .claude/skills/ts-lsp-refactor/lsp-client.js refactor \
     --file "/path/to/file.ts" \
     --start-line 15 \
     --start-column 0 \
     --end-line 20 \
     --end-column 0
   ```
   This returns available refactorings like "Extract Symbol" with action names.

3. **Apply the refactoring**:
   ```bash
   # Preview changes (returns JSON without modifying files)
   node .claude/skills/ts-lsp-refactor/lsp-client.js refactor \
     --file "/path/to/file.ts" \
     --start-line 15 \
     --start-column 0 \
     --end-line 20 \
     --end-column 0 \
     --refactor-name "Extract Symbol" \
     --action-name "function_scope_1"

   # Apply changes immediately (modifies files directly)
   node .claude/skills/ts-lsp-refactor/lsp-client.js refactor \
     --file "/path/to/file.ts" \
     --start-line 15 \
     --start-column 0 \
     --end-line 20 \
     --end-column 0 \
     --refactor-name "Extract Symbol" \
     --action-name "function_scope_1" \
     --apply
   ```

4. **Recommended approach**:
   - First query available refactorings without refactor-name/action-name
   - Choose the appropriate action from the returned options
   - Use `--apply` flag to apply changes directly for atomic refactoring

### Find All References

When the user wants to see where a symbol is used:

1. **Identify the symbol**:
   - Find the symbol definition using Grep or ask the user
   - Determine the file, line, and column position

2. **Use the LSP references operation**:
   ```bash
   node .claude/skills/ts-lsp-refactor/lsp-client.js references \
     --file "/path/to/file.ts" \
     --line 10 \
     --column 5
   ```

3. **Present results**:
   - Show all references including the definition
   - Group by file for clarity
   - Indicate which references are definitions vs usages
   - Show which are read vs write accesses

### Code Actions (Quick Fixes)

When there are TypeScript errors that need fixing:

1. **Identify the error location**:
   - Use TypeScript diagnostics or user-reported error location
   - Note the file, line, and column

2. **Get available quick fixes**:
   ```bash
   # See what quick fixes are available
   node .claude/skills/ts-lsp-refactor/lsp-client.js code-actions \
     --file "/path/to/file.ts" \
     --line 10 \
     --column 5
   ```

3. **Apply a specific fix**:
   ```bash
   # Apply a specific fix with --apply flag
   node .claude/skills/ts-lsp-refactor/lsp-client.js code-actions \
     --file "/path/to/file.ts" \
     --line 10 \
     --column 5 \
     --fix-id "fixMissingImport" \
     --apply
   ```

4. **Note**: Code actions only appear when there are actual TypeScript errors/warnings at the specified location

## Error Handling

- If TypeScript is not installed, inform the user and suggest: `npm install typescript`
- If `tsconfig.json` is missing, suggest creating one or running in a TypeScript project
- If the LSP server crashes, restart it automatically
- If a refactoring is not available at the given location, explain why and suggest alternatives

## Best Practices

1. **Always confirm before large refactorings**: If a rename affects 10+ files, show a summary and ask for confirmation
2. **Validate TypeScript compilation**: After refactoring, run `tsc --noEmit` to ensure no type errors were introduced
3. **Use LSP for accuracy**: Always prefer LSP operations over manual find-replace to avoid breaking code
4. **Show context**: When presenting refactoring options, show the relevant code snippet so the user understands the change

## Example Interactions

**User**: "Rename the `getData` function to `fetchUserData`"

**Skill Response**:
1. Search for `getData` function definition
2. Use LSP rename with --apply flag
3. Show: "Renamed `getData` to `fetchUserData` in 5 files (12 references). Files modified:
   - src/api/data.ts (1 change)
   - src/services/user.ts (3 changes)
   - src/utils/fetch.ts (8 changes)"
4. Confirm: "Run `npm run check-types` to verify."

**User**: "Extract lines 45-60 in src/utils.ts into a helper function"

**Skill Response**:
1. Read the specified lines from src/utils.ts
2. Query available refactorings
3. Show available options: "Extract to inner function" or "Extract to module scope"
4. Use the appropriate refactoring with --apply flag
5. Confirm: "Extracted to new function. The original code now calls this function. Files modified:
   - src/utils.ts (1 change)"

## Notes

- This skill focuses on **safe, semantic-aware** refactoring using the TypeScript compiler's understanding
- For simple text replacements, regular Edit tool is faster
- Always use Read tool to verify the code before refactoring
- The LSP server maintains a session, so multiple refactorings can be done efficiently
