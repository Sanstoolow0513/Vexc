# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vexc is a desktop code editor built with Tauri 2 + React 19 + TypeScript, inspired by VSCode. The project aims to provide a lightweight, fast, and secure local-first coding experience.

**Tech Stack**: Tauri 2, React 19.1.0, Monaco Editor, xterm.js, portable-pty 0.9

**Current Status**: Foundation phase (M0) - workbench layout, editor engine, backend file commands, and UI/UX features (drag-and-drop file tree, context menus, custom window frame).

## Development Commands

### Core Development
- `pnpm tauri dev` - Start full development environment (frontend + backend) with hot reload (Vite on port 1420)
- `pnpm dev` - Start frontend development server only (for UI-only changes, faster iteration)
- `pnpm build` - Build frontend for production (outputs to `dist/`)
- `pnpm tauri build` - Build complete desktop application (outputs to `src-tauri/target/release/bundle/`)
- `pnpm preview` - Preview production frontend build

### Package Management
- Uses `pnpm` as package manager
- `pnpm install` - Install dependencies

### Testing
- No JavaScript test framework currently configured (planned for M3 milestone)
- Rust tests: Run `cargo test` in `src-tauri/` directory when backend tests are added

### Development URLs
- Frontend dev server: `http://localhost:1420`
- Tauri automatically updates `tauri.conf.json` devUrl when using `pnpm tauri dev`
- Vite config: `strictPort: true` (fails if port 1420 unavailable), `clearScreen: false` (preserves Rust error output)

### Platform-Specific
- Desktop: Works on Windows, macOS, Linux
- Android: `pnpm tauri android init` then `pnpm tauri android dev`
- **Primary Development Platform**: Windows 11 IoT Enterprise LTSC 2024

## Architecture

### Frontend Structure (React + TypeScript)

**Entry Point**: `src/main.tsx` → `src/App.tsx`

**Core Modules**:
- `src/api.ts` - Tauri command wrappers (invoke backend commands)
- `src/types.ts` - Shared TypeScript types (mirrored in Rust)
- `src/utils.ts` - Helper functions (language detection, path handling, arg parsing)
- `src/hints.ts` - Keyword-based code suggestion system (defined but not yet integrated in UI)

**Feature Modules** (`src/features/`):
- `src/features/explorer/useTreeDragDrop.ts` - File tree drag-and-drop hook with pointer event handling, drop validation, and click suppression

**UI Dependencies**:
- `@monaco-editor/react` - Monaco Editor React wrapper
- `@xterm/xterm` + `@xterm/addon-fit` - Terminal emulation with auto-sizing
- `lucide-react` - Icon library for UI elements

**Window Management**:
- Custom window frame (`decorations: false` in tauri.conf.json)
- Custom title bar with drag region (`data-tauri-drag-region`)
- Window controls (minimize, maximize/close) implemented manually
- Window APIs from `@tauri-apps/api/window`: `getCurrentWindow()`
- Window operations: minimize, maximize, unmaximize, close

**State Management Pattern**:
- Centralized in `App.tsx` using React hooks (useState, useEffect, useMemo)
- No external state library - uses refs for stale closure prevention
- Local state stored in `localStorage` for workspace persistence
- **Refs Sync Pattern**: Critical state values have corresponding refs synchronized via useEffect:
  ```typescript
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const tabsRef = useRef<EditorTab[]>([]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  ```
  This ensures async callbacks always access the latest state without stale closures.

**Editor**: Monaco Editor (`@monaco-editor/react`)
- Mounted in `App.tsx`, ref stored for programmatic control
- Custom One Dark Pro theme defined in `handleEditorMount` (orange variant)
- Handles keyboard shortcuts (Ctrl+S for save, Tab for hints, Escape to close hints)
- Editor options: word wrap on, minimap disabled, 13px font, 2-space tabs
- Font size adjustable via Ctrl+Scroll (persists to localStorage)
- Theme token colors defined inline:
  - Keywords: `#c678dd` (purple)
  - Strings: `#98c379` (green)
  - Functions: `#61afef` (blue)
  - Variables: `#e5c07b` (yellow)
  - Types: `#e5c07b` (yellow)
  - Comments: `#5c6370` (gray)
  - Numbers: `#d19a66` (orange)

**Terminal Integration** (xterm.js + portable-pty):
- Uses `@xterm/xterm` with `@xterm/addon-fit` for auto-sizing
- Backend uses `portable-pty` 0.9 for cross-platform PTY support
- Single visible terminal instance switched between sessions via `redrawTerminal()`
- Real-time output via Tauri 2 event system (`terminal://output`)
- PowerShell spawns with `-NoLogo -NoProfile` arguments on Windows

### Backend Structure (Rust + Tauri)

**Entry Point**: `src-tauri/src/lib.rs` - `run()` function registers all commands

**Backend Dependencies** (from `src-tauri/Cargo.toml`):
- `tauri 2` - Core framework (Tauri 2 with updated API)
- `portable-pty 0.9` - Cross-platform PTY support for terminal sessions
- `serde` + `serde_json` - Serialization for type-safe frontend-backend communication
- `tauri-plugin-dialog 2.6.0` - Native file dialogs

**State**: `AppState` struct with:
- `workspace_root: Mutex<Option<PathBuf>>` - Current workspace directory
- `terminals: Mutex<HashMap<String, Arc<Mutex<TerminalState>>>>` - Terminal sessions
- `terminal_counter: AtomicU64` - Session ID generator

**Security Model**:
- All file operations must stay within workspace boundary
- `ensure_inside_workspace()` validates paths before read/write
- Binary file detection via null byte scanning
- Hidden file filtering (configurable via `includeHidden` parameter)

**Tauri Commands** (invoked from frontend):
- `set_workspace`, `get_workspace` - Workspace management
- `list_directory`, `read_file`, `write_file` - File operations
- `create_file`, `create_directory`, `rename_path`, `delete_path`, `move_path` - File/directory management
- `search_workspace` - Recursive text search (max 200 hits default)
- `terminal_create`, `terminal_list`, `terminal_snapshot`, `terminal_write`, `terminal_resize`, `terminal_clear`, `terminal_close` - Terminal session management
- `ai_provider_suggestions`, `ai_run` - AI CLI integration

**Data Flow**:
1. Frontend calls function in `src/api.ts`
2. API function uses `invoke<Type>("command_name", { args })`
3. Tauri bridges to Rust command handler in `lib.rs`
4. Rust returns `Result<Type, String>` (error message as String)
5. Frontend receives Promise<Type>

**Event System** (Rust → Frontend):
- Backend emits `terminal://output` events with `TerminalOutputEvent` payload
- Frontend listens via `listen<TerminalOutputEvent>("terminal://output", handler)`
- Enables real-time terminal output streaming without polling
- Events automatically sync to visible terminal session via `activeTerminalIdRef`

### Type Synchronization

TypeScript types in `src/types.ts` must match Rust structs in `lib.rs`:
- Use `#[serde(rename_all = "camelCase")]` on Rust structs for TypeScript compatibility
- `Option<T>` in Rust maps to `T | null` in TypeScript
- `Vec<T>` maps to `T[]`
- All commands return `Result<T, String>` for error handling

### UI Layout

**Workbench Grid** (CSS in `src/App.css`):
- **Top bar**: Workspace controls + view toggle + actions
- **Left sidebar**: File tree explorer + search panel
- **Center**: Tab strip + Monaco editor surface
- **Bottom panel**: Terminal / AI assistant (toggleable)
- **Status bar**: Feedback messages

**Theme System**:
- One Dark Pro color scheme implemented as CSS custom properties (variables)
- Core variables: `--bg-canvas-top`, `--surface-0/1/2`, `--accent`, `--text`, etc.
- Theme variables defined in `:root` selector in `App.css`
- Consistent theming across UI components via CSS variable references
- Color-coded file tree icons with semantic tones (code, data, doc, media, archive, script, secure)

**Key UI Patterns**:
- Lazy-loaded directory tree (fetches children on expand)
- **File Tree Drag-and-Drop**: Uses `useTreeDragDrop` hook for file/directory moves:
  - Pointer-based drag with threshold detection (prevents accidental drags)
  - Real-time drop validation (same-path, target-inside-source checks)
  - Visual feedback for valid/invalid drop targets
  - Click suppression after drag to prevent unintended selections
- Tab-based editing with dirty state tracking (`content !== savedContent`)
- Terminal sessions using portable-pty for cross-platform PTY support
- **Monaco Editor Theming**: Custom One Dark Pro theme defined in `handleEditorMount`:
  - Token colors: keywords (#c678dd), strings (#98c379), functions (#61afef), etc.
  - Custom background (#0a0c10) and selection colors
- **Terminal Write Queue**: Uses Promise chain to serialize terminal input:
  ```typescript
  terminalWriteQueueRef.current = terminalWriteQueueRef.current
    .then(() => terminalWrite(sessionId, data))
  ```
  Prevents race conditions from rapid terminal input.
- **Keyboard Shortcuts (Dual Layer)**: Ctrl+S handled both in Monaco editor
  (`editor.addCommand`) and globally (`window.addEventListener`) for reliability
- **Browser Close Protection**: `beforeunload` event prevents accidental window
  closure when dirty tabs exist (`hasDirtyTabs` check)

### AI CLI Integration

**Placeholder System**:
- AI commands support template variables: `{prompt}`, `{workspace}`
- Example template: `["{prompt}"]` or `["--workspace", "{workspace}", "{prompt}"]`
- Runtime replacement in `ai_run` Rust command
- Built-in providers: `codex`, `claude`, `gemini` (configurable via `aiProviderSuggestions`)
- Working directory defaults to workspace root, custom CWD validated against workspace boundary

### File Tree Features

**Drag-and-Drop**:
- Full pointer-based drag-and-drop for files and directories
- Visual feedback with drop target highlighting and invalid target indication
- Validation rules:
  - Cannot drag root workspace folder
  - Cannot drop parent into its own child
  - Cannot drop item onto itself or into same parent
  - Target directory cannot already contain an item with the same name
- Uses `data-tree-drop-path` attribute to identify drop targets
- Grace period for valid targets during rapid mouse movement
- Automatic click suppression after drag operations

**Context Actions**:
- Right-click context menu for file/directory operations
- File operations: Create, Rename, Delete, Move
- Directory operations: Create nested files/folders, Expand/Collapse

### Phase 1 Scope (from PROJECT_PLAN.md)

**Included**:
- Open folder/workspace
- File tree navigation
- Multi-tab editing with unsaved state indicators
- Global workspace search
- Integrated terminal (Windows priority - PowerShell default)
- Basic Git visibility (planned)
- Command palette (planned)

**Excluded**:
- Full extension marketplace
- Debug adapter ecosystem
- Cloud sync/collaboration
- Full VSCode settings ecosystem

### Pull Request Guidelines

When contributing changes:
- Include a clear summary of changes
- Reference linked issue/ticket if applicable
- Provide test evidence (manual or automated)
- Include screenshots or screen recordings for UI changes
- Keep commits scoped to one concern (frontend, Rust backend, or config)

### Important Constraints

1. **Workspace Boundary**: All file I/O must validate paths are within workspace root
2. **Binary File Protection**: Detect and prevent opening binary files via null byte scanning (>2MB limit for search, 1MB limit for editor)
3. **Terminal Session Isolation**: Each terminal maintains its own CWD and line buffer,
   with scrollback limited to 1,800 lines to prevent memory issues
4. **State Synchronization**: Use refs (`tabsRef`, `activeTabIdRef`, etc.) to avoid stale closures in async operations
5. **Error Messages**: All Rust errors return as `String`, displayed in status bar
6. **Ignored Directories**: `node_modules`, `dist`, `target` are automatically excluded from file tree and search
7. **⚠️ Security Policy**: CSP is currently set to `null` in `tauri.conf.json` - **MUST be configured before production builds** to prevent XSS attacks
8. **Drag-and-Drop Safety**: File moves must validate target is not inside source, source is not workspace root, and target path doesn't exist

### Key Constants

**Backend (`src-tauri/src/lib.rs`)**:
- `MAX_EDITOR_FILE_BYTES = 1,048,576` (1MB) - Maximum file size for editor
- Search file limit: 2MB per file
- Terminal scrollback limit: 1,800 lines
- Search results default limit: 200 hits

**Frontend (`src/App.tsx`)**:
- `WORKSPACE_STORAGE_KEY = "vexc.workspacePath"` - localStorage key for workspace persistence
- `FONT_SIZE_STORAGE_KEY = "vexc.fontSize"` - localStorage key for editor font size
- `DEFAULT_FONT_SIZE = 13` - Default editor font size in pixels
- `MIN_FONT_SIZE = 10` - Minimum editor font size
- `MAX_FONT_SIZE = 24` - Maximum editor font size
- `CODE_FONT_FAMILY = '"JetBrains Mono", "Cascadia Code", Consolas, monospace'`
- `CODE_FONT_SIZE = 13`
- `CODE_LINE_HEIGHT = 18`

**Drag-and-Drop (`src/features/explorer/useTreeDragDrop.ts`)**:
- `CLICK_SUPPRESSION_TIMEOUT_MS = 0` - Click suppression delay after drag
- `DROP_TARGET_GRACE_MS = 80` - Grace period for valid drop targets during rapid movement

### Development Workflow

1. **Frontend changes** (`src/`): Hot reload via Vite (most changes apply immediately)
2. **Backend changes** (`src-tauri/src/`): Restart `pnpm tauri dev` (Rust requires recompilation)
3. **Type changes**: Update both `src/types.ts` and corresponding Rust structs with `#[serde(rename_all = "camelCase")]`
4. **Testing**: Manual testing in dev mode (no automated tests yet - M3 milestone)
5. **Vite ignored paths**: `src-tauri/` is excluded from Vite's watch to prevent interference with Rust builds

### Adding New Tauri Commands

1. **Backend**: Define function in `src-tauri/src/lib.rs` with `#[tauri::command]` attribute
2. **State Access**: Add `state: tauri::State<AppState>` parameter if needed
3. **Return Type**: Use `Result<T, String>` for error handling (error message as `String`)
4. **Register**: Add command name to `invoke_handler!` macro in `run()` function
5. **Frontend API**: Add wrapper function in `src/api.ts` using `invoke<T>("command_name", { args })`
6. **Types**: Add TypeScript types to `src/types.ts` matching Rust structs
7. **Serialization**: Use `#[serde(rename_all = "camelCase")]` on Rust structs for TypeScript compatibility

### Styling and Theme System

**CSS Variables** (`src/App.css:root`):
- All theme colors defined as CSS custom properties
- Core palette: `--bg-canvas-top`, `--surface-0/1/2`, `--accent`, `--text`
- Interactive states: `--interactive-hover`, `--interactive-active`
- Use `var(--variable-name)` in component styles
- Consistent semantic color naming across the codebase

**Icon System**:
- Uses `lucide-react` for consistent iconography
- File type icons mapped from `FileKind` enum
- Semantic icon categories: code, data, doc, media, archive, script, secure
- Import patterns: `import { IconName } from "lucide-react"`

### Debugging Tips

**Frontend Issues**:
- Browser DevTools: Press F12 during `pnpm tauri dev` to open DevTools
- Console logs: Use `console.log()` for debugging; check browser console
- React DevTools: Install browser extension for component inspection
- Network tab: Monitor Tauri command invocation and response times
- **UI-only development**: Use `pnpm dev` for faster iteration when only modifying frontend code (no backend changes)

**Backend Issues**:
- Rust errors: Check terminal where `pnpm tauri dev` is running
- Logging: Use `eprintln!()` for debug output to terminal
- Command errors: All errors return as `String` to frontend, displayed in status bar
- File operations: Verify workspace boundary validation in `ensure_inside_workspace()`

**Common Issues**:
- "Command not found": Ensure command is registered in `invoke_handler!` macro
- "Path not found": Check workspace boundary validation and path normalization
- Terminal not responding: Verify PTY spawn command for platform (Windows uses PowerShell)
- Hot reload not working: Frontend changes reload automatically; backend changes require restart

### TypeScript Configuration

**`tsconfig.json`**:
- Strict mode enabled (`strict: true`)
- Unused locals/parameters checks enabled
- `target: ES2020`, `module: ESNext`
- `jsx: react-jsx` (new JSX transform)
- `moduleResolution: bundler` for Vite compatibility

### Code Style & Naming Conventions

**Frontend (TypeScript/TSX)**:
- 2-space indentation, double quotes for strings
- `PascalCase` for React components
- `camelCase` for variables, functions, and hooks
- Tauri commands should be explicit and small
- **Drag-and-Drop**: Use pointer events (not drag events) for custom DnD:
  - `pointerdown` to start tracking, `pointermove` for drag, `pointerup` for drop
  - Implement drag threshold to distinguish click vs drag
  - Suppress click events after successful drag operations

**Backend (Rust)**:
- 4-space indentation (rustfmt default)
- `snake_case` for function names and variables
- Use `#[serde(rename_all = "camelCase")]` on structs exposed to frontend

### Git Commit Convention

Use Conventional Commit format:
- `feat(ui): ...` - New features
- `fix(tauri): ...` - Bug fixes
- `chore: ...` - Maintenance tasks
- Keep commits scoped to one concern (frontend, Rust backend, or config)

### Windows-Specific Notes

- Default terminal: `powershell.exe` with `-NoLogo -NoProfile` arguments
- Path handling: Normalized to forward slashes in frontend, uses OS-native paths in backend
- Build target: Works on Windows 11 IoT Enterprise LTSC (dev environment)
- Terminal output normalization: `\r\n` and `\r` converted to `\n` for consistent line handling

### Key Functions Reference

**Frontend - `src/api.ts`**:
- `setWorkspace(path)` → Initialize workspace
- `getWorkspace()` → Retrieve current workspace info
- `listDirectory(path?, includeHidden?)` → Get file nodes
- `readFile(path)` → Load file content
- `writeFile(path, content)` → Save file
- `createFile(path)` → Create new file
- `createDirectory(path)` → Create new directory
- `renamePath(path, newName)` → Rename file or directory
- `deletePath(path)` → Delete file or directory
- `movePath(sourcePath, targetDirectoryPath)` → Move file or directory
- `searchWorkspace(query, maxResults?, includeHidden?)` → Text search
- `terminalCreate(shell?)` → Start new terminal session
- `terminalList()` → List all terminal sessions
- `terminalSnapshot(sessionId)` → Get terminal buffer snapshot
- `terminalWrite(sessionId, input)` → Execute command in terminal
- `terminalResize(sessionId, cols, rows)` → Resize terminal session
- `terminalClear(sessionId)` → Clear terminal buffer
- `terminalClose(sessionId)` → Close terminal session
- `aiProviderSuggestions()` → Get available AI CLI providers
- `aiRun(request)` → Execute AI command with workspace context

**Frontend - `src/utils.ts`**:
- `detectLanguage(path)` → Map file extension to Monaco language
- `fileNameFromPath(path)` → Extract filename from full path
- `splitArgs(input)` → Parse shell-like argument string (handles quotes)

**Frontend - `src/features/explorer/useTreeDragDrop.ts`**:
- `useTreeDragDrop(options)` → File tree drag-and-drop hook
  - `dragThresholdPx`: Minimum drag distance before drag starts
  - `isSamePath(left, right)`: Path equality check (respect OS case sensitivity)
  - `validateDrop(source, targetDirectoryPath)`: Drop validation logic
  - `onDrop(source, targetDirectoryPath)`: Drop action handler
  - Returns: `{ dndState, consumeClickSuppression, clearTreeDragDropState, handleTreePointerDown }`

**Backend - Security Helpers**:
- `ensure_inside_workspace(candidate, workspace_root)` → Path boundary validation
- `is_probably_binary(bytes)` → Detect binary files via null bytes (first 1KB scanned)
- `canonicalize_dir_path(path)` → Resolve and validate directory path
- `build_terminal_spawn_command(shell, cwd)` → Build platform-specific shell command
  - PowerShell/pwsh: Adds `-NoLogo -NoProfile` flags
  - Other shells: Uses default command behavior

### Milestones Tracking

Current phase aims to complete M0 (Foundation):
- Workbench layout ✅
- Editor engine integration ✅
- Backend file commands ✅
- Terminal session management ✅
- AI CLI integration ✅
- File tree drag-and-drop ✅
- Context menu system ✅
- Custom window frame ✅

Next: M1 (Core Editing) - Enhance file operations, dirty state handling, workspace search.

## Code Organization Patterns

### Feature-Based Structure
New features should be organized under `src/features/<feature-name>/`:
- Custom hooks for complex logic (e.g., `useTreeDragDrop.ts`)
- Feature-specific types and utilities
- This keeps the main `App.tsx` focused on composition

### State Management Refs Pattern
When adding new state that needs to be accessed in async callbacks:
1. Create state: `const [items, setItems] = useState<T[]>([])`
2. Create matching ref: `const itemsRef = useRef<T[]>([])`
3. Sync with useEffect: `useEffect(() => { itemsRef.current = items }, [items])`
4. Use ref in async callbacks to avoid stale closures

### Adding Drag-and-Drop to New Components
For new draggable components, follow the `useTreeDragDrop` pattern:
1. Add `data-tree-drop-path={path}` attribute to drop target elements
2. Implement `isSamePath` for proper path comparison (OS-aware)
3. Implement `validateDrop` with specific business rules
4. Handle drop rejection UI feedback via `onDropRejected`

---

**Last Updated**: 2026-02-19
