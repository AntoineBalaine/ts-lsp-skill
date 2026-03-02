---
name: ts-lsp
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
5. **Move to File**: Move a function, class, or other symbol to a different file, automatically updating all imports
6. **List Symbols**: List all top-level symbols (functions, classes, interfaces, variables, etc.) in a file with their locations
7. **Other Refactorings**: Access additional LSP-powered refactorings as available

## Prerequisites

- Node.js installed
- TypeScript project with `tsconfig.json`
- `typescript` package installed (either globally or in project)
- Commands must be run from the project root directory where `node_modules/typescript` exists (for monorepos, this is typically the workspace root, not individual package directories)

## Workflow

### How the LSP System Works

This skill uses a **daemon-based architecture** for optimal performance:

- **First call**: Automatically starts a background daemon that manages `tsserver` (~2-3 seconds)
- **Subsequent calls**: Connect to the running daemon for near-instant responses (~40-50ms)
- **Auto-cleanup**: The daemon automatically shuts down after 2 minutes of inactivity
- **Per-project**: Each project gets its own daemon (based on working directory)

**You don't need to manually start or stop anything** - just use the commands and the daemon handles itself!

**Working Directory Requirement**: The daemon looks for `tsserver` in `node_modules/typescript/lib/tsserver.js` relative to the current working directory. For monorepos where dependencies are hoisted to the workspace root, you must `cd` to the workspace root before running commands, then use relative paths to files in subdirectories (e.g., `--file "packages/mylib/src/file.ts"`).

### Rename Symbol Refactoring

When the user wants to rename a symbol:

1. **Identify the symbol location**:
   - Ask the user which symbol to rename if not specified
   - Use Grep to find the symbol definition
   - **ALWAYS use Read tool** to see the exact file content at that line
   - Count column position carefully (tabs = 1 character, not 4 spaces!)
   - Determine the file path and line/column position

2. **Use the LSP rename operation**:
   ```bash
   # Preview changes (returns JSON without modifying files)
   node .claude/skills/ts-lsp/lsp-client.js rename \
     --file "/path/to/file.ts" \
     --line 10 \
     --column 5 \
     --new-name "newSymbolName"

   # Apply changes immediately (modifies files directly)
   node .claude/skills/ts-lsp/lsp-client.js rename \
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

### ⚠️ CRITICAL: Handling Tabs and Character Offsets

**Tab characters cause offset calculation issues!** The LSP expects character offsets (where tab = 1 character), but when counting visually, tabs may appear as 4 or 8 spaces.

**IMPORTANT RULES**:

1. **Use Read tool output for column positions**: When you read a file with the Read tool, the line numbers and content are shown. Count characters EXACTLY as they appear in the file, where:
   - Tab character = 1 character (not 4 spaces)
   - Each regular character = 1 character

2. **Never guess column positions**: Always use Read tool to see the exact file content, then count characters carefully:
   ```
   Example from Read tool output:
   45→	async function getData(param: string) {

   To rename "getData":
   - Line: 45
   - Column: Count from start: [tab]=1, [a]=2, [s]=3, [y]=4, [n]=5, [c]=6, [space]=7,
             [f]=8, [u]=9, [n]=10, [c]=11, [t]=12, [i]=13, [o]=14, [n]=15, [space]=16, [g]=17
   - Column for 'g' in 'getData' = 17 (0-indexed: 16)
   ```

3. **When in doubt about tabs**:
   - Read the file with Read tool
   - Look at the actual characters between the start of line and your target symbol
   - Count each tab as exactly 1 character
   - Use 0-based indexing for column (first character is column 0)

4. **If LSP fails with "Cannot rename"**:
   - The column offset is likely wrong due to tabs
   - Re-read the file carefully
   - Try column positions around the expected location (±1 or ±2)
   - Or ask the user to confirm the exact position

**Example of correct counting with tabs**:
```typescript
// Line has one tab at start:
	function test() {
//  ↑ column 0 is the tab
//   ↑ column 1 is 'f'
//          ↑ column 9 is 't' in 'test'
```

### Extract Function/Method Refactoring

When the user wants to extract code:

1. **Identify the code range**:
   - Ask the user to specify the file and line range
   - **Use Read tool** to see the exact file content and count column positions (tabs = 1 char!)
   - Or use context from recent edits/reads

2. **Get available refactorings**:
   ```bash
   # First, see what refactorings are available
   node .claude/skills/ts-lsp/lsp-client.js refactor \
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
   node .claude/skills/ts-lsp/lsp-client.js refactor \
     --file "/path/to/file.ts" \
     --start-line 15 \
     --start-column 0 \
     --end-line 20 \
     --end-column 0 \
     --refactor-name "Extract Symbol" \
     --action-name "function_scope_1"

   # Apply changes immediately (modifies files directly)
   node .claude/skills/ts-lsp/lsp-client.js refactor \
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
   - **Use Read tool** to verify exact position (mind the tabs = 1 character!)
   - Determine the file, line, and column position

2. **Use the LSP references operation**:
   ```bash
   node .claude/skills/ts-lsp/lsp-client.js references \
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
   - **Use Read tool** to verify exact position (count tabs as 1 character!)
   - Note the file, line, and column

2. **Get available quick fixes**:
   ```bash
   # See what quick fixes are available
   node .claude/skills/ts-lsp/lsp-client.js code-actions \
     --file "/path/to/file.ts" \
     --line 10 \
     --column 5
   ```

3. **Apply a specific fix**:
   ```bash
   # Apply a specific fix with --apply flag
   node .claude/skills/ts-lsp/lsp-client.js code-actions \
     --file "/path/to/file.ts" \
     --line 10 \
     --column 5 \
     --fix-id "fixMissingImport" \
     --apply
   ```

4. **Note**: Code actions only appear when there are actual TypeScript errors/warnings at the specified location

### Move to File

When the user wants to move a function, class, or other symbol to a different file:

1. **Identify the symbol location**:
   - Ask the user which symbol to move if not specified
   - Use Grep to find the symbol definition
   - **Use Read tool** to verify exact position (count tabs as 1 character!)
   - Determine the file, line, and column position

2. **Determine the target file**:
   - Ask the user where they want to move the symbol
   - The target file can be an existing file or a new file path
   - Use absolute paths for the target file

3. **Use the LSP move-to-file operation**:
   ```bash
   # Preview changes (returns JSON without modifying files)
   node .claude/skills/ts-lsp/lsp-client.js move-to-file \
     --file "/path/to/source.ts" \
     --line 10 \
     --column 5 \
     --target-file "/path/to/destination.ts"

   # Apply changes immediately (modifies files directly)
   node .claude/skills/ts-lsp/lsp-client.js move-to-file \
     --file "/path/to/source.ts" \
     --line 10 \
     --column 5 \
     --target-file "/path/to/destination.ts" \
     --apply
   ```

4. **What happens when you move a symbol**:
   - The symbol (function, class, interface, etc.) is removed from the source file
   - The symbol is added to the target file (created if it doesn't exist)
   - All imports across the codebase are automatically updated
   - Export statements are added/modified as needed

5. **Recommended approach**:
   - Position the cursor on the symbol name (function name, class name, etc.)
   - Preview the changes first without `--apply` for large refactorings
   - Use `--apply` flag to apply changes atomically

6. **Limitations**:
   - The symbol must be at the top level (not nested inside another function/class)
   - The "Move to file" refactoring must be available at the cursor position
   - If the refactoring is not available, the command will return the list of available refactorings

### List Symbols

When the user wants to see all functions, classes, or other declarations in a file:

1. **Use the LSP symbols operation**:
   ```bash
   # List all symbols with nested children (e.g., class methods)
   node .claude/skills/ts-lsp/lsp-client.js symbols \
     --file "/path/to/file.ts"

   # List only top-level symbols (no nested children)
   node .claude/skills/ts-lsp/lsp-client.js symbols \
     --file "/path/to/file.ts" \
     --top-level-only
   ```

2. **Response format**:
   The command returns a JSON object with a `symbols` array. Each symbol includes:
   - `name`: The symbol's name
   - `kind`: The type of symbol (function, class, interface, const, alias, etc.)
   - `kindModifiers`: Modifiers like "export", "async", etc.
   - `line`, `column`: Start position (0-based column)
   - `endLine`, `endColumn`: End position
   - `children`: Nested symbols (only if `--top-level-only` is not set)

3. **Use cases**:
   - Getting an overview of a module's API
   - Finding all exported functions in a file
   - Locating class methods and properties
   - Understanding file structure before refactoring

## Error Handling

- If TypeScript is not installed, inform the user and suggest: `npm install typescript`
- If `tsconfig.json` is missing, suggest creating one or running in a TypeScript project
- If the LSP server crashes, restart it automatically
- If a refactoring is not available at the given location, explain why and suggest alternatives
- **If "Cannot rename" or similar errors occur**: Most likely the column position is wrong due to tabs. Re-read the file with Read tool and recount characters where tab = 1 character

## Best Practices

1. **⚠️ ALWAYS use Read tool for accurate column positions**: Tab characters count as 1 character in LSP offsets, not 4 spaces. Never guess positions - always read the file and count characters exactly, where tab = 1 character.
2. **Always confirm before large refactorings**: If a rename affects 10+ files, show a summary and ask for confirmation
3. **Validate TypeScript compilation**: After refactoring, run `tsc --noEmit` to ensure no type errors were introduced
4. **Use LSP for accuracy**: Always prefer LSP operations over manual find-replace to avoid breaking code
5. **Show context**: When presenting refactoring options, show the relevant code snippet so the user understands the change

## Example Interactions

**User**: "Rename the `getData` function to `fetchUserData`"

**Skill Response**:
1. Use Grep to find `getData` function definition
2. **Read the file with Read tool** to see the exact line and count column position (accounting for tabs!)
3. Count characters carefully: If line is `[tab]function getData()` then:
   - Position 0 = tab
   - Position 1-8 = "function"
   - Position 9 = space
   - Position 10 = 'g' (start of getData)
   - So use column=10 for the LSP command
4. Use LSP rename with --apply flag
5. Show: "Renamed `getData` to `fetchUserData` in 5 files (12 references). Files modified:
   - src/api/data.ts (1 change)
   - src/services/user.ts (3 changes)
   - src/utils/fetch.ts (8 changes)"
6. Confirm: "Run `npm run check-types` to verify."

**User**: "Extract lines 45-60 in src/utils.ts into a helper function"

**Skill Response**:
1. Read the specified lines from src/utils.ts
2. Query available refactorings
3. Show available options: "Extract to inner function" or "Extract to module scope"
4. Use the appropriate refactoring with --apply flag
5. Confirm: "Extracted to new function. The original code now calls this function. Files modified:
   - src/utils.ts (1 change)"

**User**: "Move the `processData` function from src/utils.ts to src/data/processor.ts"

**Skill Response**:
1. Use Grep to find `processData` function definition in src/utils.ts
2. **Read the file with Read tool** to verify the exact line and count column position (accounting for tabs!)
3. Count characters to find the start of `processData` identifier
4. Use LSP move-to-file with --apply flag:
   ```bash
   node .claude/skills/ts-lsp/lsp-client.js move-to-file \
     --file "src/utils.ts" \
     --line 25 \
     --column 16 \
     --target-file "src/data/processor.ts" \
     --apply
   ```
5. Show: "Moved `processData` to src/data/processor.ts. Files modified:
   - src/utils.ts (function removed, export updated)
   - src/data/processor.ts (function added)
   - src/services/handler.ts (import updated)
   - src/api/endpoint.ts (import updated)"
6. Confirm: "Run `npm run check-types` to verify all imports are correct."

**User**: "What functions are exported from src/api/handler.ts?"

**Skill Response**:
1. Use LSP symbols command:
   ```bash
   node .claude/skills/ts-lsp/lsp-client.js symbols \
     --file "src/api/handler.ts" \
     --top-level-only
   ```
2. Filter the results for symbols with `kindModifiers` containing "export" and `kind` equal to "function"
3. Present: "The following functions are exported from src/api/handler.ts:
   - `handleRequest` (line 15)
   - `validateInput` (line 45)
   - `formatResponse` (line 78)"

## Notes

- This skill focuses on **safe, semantic-aware** refactoring using the TypeScript compiler's understanding
- For simple text replacements, regular Edit tool is faster
- Always use Read tool to verify the code before refactoring
- The LSP server maintains a session, so multiple refactorings can be done efficiently
