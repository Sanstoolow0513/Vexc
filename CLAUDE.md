# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vexc is a desktop code editor built with Tauri 2 + React 19 + TypeScript, inspired by VSCode. The project aims to provide a lightweight, fast, and secure local-first coding experience.

**Tech Stack**: Tauri 2, React 19.1.0, Monaco Editor, xterm.js, portable-pty 0.9

**Current Status**: Foundation phase (M0) - workbench layout, editor engine, backend file commands, Git integration, LSP support, and UI/UX features (drag-and-drop file tree, context menus, custom window frame, signals panel, toast notifications).

## Development Commands

### Core Development
- `pnpm tauri dev` - Start full development environment (frontend + backend) with hot reload (Vite on port 1420)
- `pnpm dev` - Start frontend development server only (for UI-only changes, faster iteration)
- `pnpm build` - Build frontend for production (runs `tsc && vite build`, outputs to `dist/`)
- `pnpm tauri build` - Build complete desktop application (outputs to `src-tauri/target/release/bundle/`)
- `pnpm preview` - Preview production frontend build

### Package Management
- Uses `pnpm@10.30.0` as package manager
- `pnpm install` - Install dependencies

### Testing
- Frontend: No test framework currently configured (planned for M3 milestone)
- Rust: `cargo test` in `src-tauri/` directory
- Single Rust test: `cargo test <test_name>`
- Rust test with output: `cargo test <test_name> -- --nocapture`

### Lint and Type Check
- TypeScript: Enforced via `tsconfig.json` strict mode, validated during `pnpm build`
- Rust format: `cargo fmt --check` in `src-tauri/` (recommended)
- Rust lint: `cargo clippy --all-targets --all-features` in `src-tauri/` (recommended)

### Development URLs
- Frontend dev server: `http://localhost:1420`
- Tauri automatically updates `tauri.conf.json` devUrl when using `pnpm tauri dev`
- Vite config: `strictPort: true` (fails if port 1420 unavailable), `clearScreen: false` (preserves Rust error output)
- Vite ignores `src-tauri/` to prevent interference with Rust builds

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
- `src/hints.ts` - Keyword-based code suggestion system

**Editor System** (`src/editor/`):
- `src/editor/monacoSetup.ts` - Monaco Editor initialization and theming
- `src/editor/languageRegistry.ts` - Language definition registry with LSP server mappings
- `src/editor/lsp/rustLspClient.ts` - Rust LSP client implementation
- `src/editor/outputStore.ts` - Output panel and signals state management

**Feature Modules** (`src/features/`):
- `src/features/explorer/useTreeDragDrop.ts` - File tree drag-and-drop hook with pointer event handling, drop validation, and click suppression

**UI Components** (`src/components/`):
- `src/components/HeaderSignals.tsx` - Header signals display (problems, output indicators)
- `src/components/SignalsPanel.tsx` - Problems and output panel
- `src/components/StatusBar.tsx` - Status bar with file and terminal info
- `src/components/ToastViewport.tsx` - Toast notification system

**UI Dependencies**:
- `@monaco-editor/react` - Monaco Editor React wrapper
- `@xterm/xterm` + `@xterm/addon-fit` - Terminal emulation with auto-sizing
- `lucide-react` - Icon library for UI elements

**Window Management**:
- Custom window frame (`decorations: false` in tauri.conf.json)
- Custom title bar with drag region (`data-tauri-drag-region`)
- Window controls (minimize, maximize/close) implemented manually
- Window APIs from `@tauri-apps/api/window`: `getCurrentWindow()`

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
- Custom One Dark Pro theme defined in `monacoSetup.ts` (orange variant)
- Theme name: `MONACO_THEME_NAME = "vexc-one-dark-pro-orange"`
- Token colors: keywords (#c678dd), strings (#98c379), functions (#61afef), variables (#e06c75), types (#e5c07b), comments (#5c6370 italic), numbers (#d19a66)
- Background: #0a0c10, selection: #2c313a
- Font size adjustable via Ctrl+Scroll (persists to localStorage)
- Language detection via `detectLanguage()` from utils

**Language System**:
- `LanguageId` type supports: plaintext, typescript, javascript, json, css, html, markdown, rust
- `languageRegistry.ts` maps file extensions to language IDs and Monaco language IDs
- LSP server commands configurable per language (rust-analyzer for Rust)

**LSP Integration**:
- `rustLspClient.ts` implements JSON-RPC LSP protocol
- Features: auto-restart, diagnostics publishing, document sync
- State: session tracking, workspace root, opened documents set
- Error handling: dead session detection, automatic reconnection
- Output channel integration for LSP messages

**Terminal Integration** (xterm.js + portable-pty):
- Backend uses `portable-pty 0.9` for cross-platform PTY support
- Single visible terminal instance switched between sessions via `redrawTerminal()`
- Real-time output via Tauri 2 event system (`terminal://output`)
- PowerShell spawns with `-NoLogo -NoProfile` arguments on Windows
- Terminal write queue serializes input to prevent race conditions

**Git Integration**:
- Commands: status, changes, stage, unstage, discard, commit, branches, checkout, pull, push, diff
- Types: `GitRepoStatus`, `GitChange`, `GitBranchInfo`, `GitCommitResult`, `GitDiffResult`
- File status codes: M (modified), A (added), D (deleted), R (renamed), C (copied), T (type changed), U (unmerged), ? (untracked), ! (ignored)
- Ahead/behind tracking for branch status

**Signals and Output System**:
- Output channels: system, lsp, terminal, workspace
- Output levels: error, warning, info, debug
- Signals panel tabs: problems, output
- Diagnostic types: error, warning, info, hint
- Toast notifications with dedupe keys and duration by level

### Backend Structure (Rust + Tauri)

**Entry Point**: `src-tauri/src/lib.rs` - `run()` function registers all commands (2338 lines)

**Backend Dependencies** (from `src-tauri/Cargo.toml`):
- `tauri 2` - Core framework
- `portable-pty 0.9` - Cross-platform PTY support for terminal sessions
- `serde` + `serde_json` - Serialization
- `tauri-plugin-dialog 2.6.0` - Native file dialogs

**State**: `AppState` struct with:
- `workspace_root: Mutex<Option<PathBuf>>` - Current workspace directory
- `terminals: Mutex<HashMap<String, Arc<Mutex<TerminalState>>>>` - Terminal sessions
- `terminal_counter: AtomicU64` - Session ID generator
- `lsp_sessions: Mutex<HashMap<String, Arc<Mutex<LspSessionState>>>>` - LSP sessions
- `lsp_counter: AtomicU64` - LSP session ID generator

**Terminal State** (`TerminalState`):
- id, title, shell, cwd, status, cols, rows
- buffer: String (limited to MAX_TERMINAL_BUFFER_BYTES)
- master: Box<dyn MasterPty + Send>
- writer: Box<dyn Write + Send>
- process: Box<dyn portable_pty::Child + Send>

**LSP State** (`LspSessionState`):
- id, server, root_path, status
- writer: ChildStdin
- process: Child

**Security Model**:
- All file operations must stay within workspace boundary
- `ensure_inside_workspace()` validates paths before read/write
- Binary file detection via null byte scanning (first 1KB)
- Hidden file filtering (configurable via `includeHidden` parameter)
- Ignored directories: `node_modules`, `dist`, `target`

**Tauri Commands** (invoked from frontend):

*Workspace & File Operations*:
- `set_workspace`, `get_workspace` - Workspace management
- `list_directory`, `read_file`, `write_file` - File operations
- `create_file`, `create_directory`, `rename_path`, `delete_path`, `move_path` - File/directory management
- `search_workspace` - Recursive text search (max 200 hits default)

*Terminal Commands*:
- `terminal_create`, `terminal_list`, `terminal_snapshot`, `terminal_write`, `terminal_resize`, `terminal_clear`, `terminal_close`

*Git Commands*:
- `git_repo_status`, `git_changes`, `git_stage`, `git_unstage`, `git_discard`
- `git_commit`, `git_branches`, `git_checkout`, `git_pull`, `git_push`, `git_diff`

*LSP Commands*:
- `lsp_start`, `lsp_send`, `lsp_stop`

*AI Commands*:
- `ai_provider_suggestions`, `ai_run`

**Data Flow**:
1. Frontend calls function in `src/api.ts`
2. API function uses `invoke<Type>("command_name", { args })`
3. Tauri bridges to Rust command handler in `lib.rs`
4. Rust returns `Result<Type, String>` (error message as String)
5. Frontend receives Promise<Type>

**Event System** (Rust → Frontend):
- `terminal://output` events with `TerminalOutputEvent` payload
- `lsp://output` events with `LspMessageEvent` payload
- Frontend listens via `listen<T>("event_name", handler)`
- Enables real-time streaming without polling

### Type Synchronization

TypeScript types in `src/types.ts` must match Rust structs in `lib.rs`:
- Use `#[serde(rename_all = "camelCase")]` on Rust structs
- `Option<T>` in Rust maps to `T | null` in TypeScript
- `Vec<T>` maps to `T[]`
- All commands return `Result<T, String>`

### UI Layout

**Workbench Grid** (CSS in `src/App.css`):
- **Top bar**: Workspace controls + header signals + window controls
- **Left sidebar**: File tree explorer (resizable, min 180px default 270px)
- **Center**: Tab strip + Monaco editor surface
- **Bottom panel**: Signals panel (problems/output) + Terminal
- **Status bar**: File info + terminal info + git status

**Theme System**:
- One Dark Pro color scheme as CSS custom properties
- Core variables: `--bg-canvas-top`, `--surface-0/1/2`, `--accent`, `--text`
- Interactive states: `--interactive-hover`, `--interactive-active`
- Color-coded file tree icons with semantic tones

**Key UI Patterns**:
- Lazy-loaded directory tree (fetches children on expand)
- File tree drag-and-drop with pointer events and threshold detection
- Tab-based editing with dirty state tracking
- Toast notifications with auto-dismiss and dedupe keys
- Signals panel with problems (diagnostics) and output (logs)

## Important Constraints

1. **Workspace Boundary**: All file I/O must validate paths are within workspace root
2. **Binary File Protection**: Detect and prevent opening binary files (>2MB search, 1MB editor)
3. **Terminal Session Isolation**: Each terminal maintains its own CWD and line buffer (1,800 lines max)
4. **LSP Session Isolation**: Each LSP server maintains session state and document tracking
5. **State Synchronization**: Use refs to avoid stale closures in async operations
6. **Error Messages**: All Rust errors return as `String`, displayed in status bar or toast
7. **Ignored Directories**: `node_modules`, `dist`, `target` automatically excluded
8. **⚠️ Security Policy**: CSP is `null` in `tauri.conf.json` - MUST configure before production

### Key Constants

**Backend** (`src-tauri/src/lib.rs`):
- `MAX_EDITOR_FILE_BYTES = 1,048,576` (1MB)
- `MAX_TERMINAL_BUFFER_BYTES = 1,048,576` (1MB)
- `MAX_LSP_PAYLOAD_BYTES = 16,777,216` (16MB)
- `DEFAULT_TERMINAL_COLS = 120`
- `DEFAULT_TERMINAL_ROWS = 30`
- Search file limit: 2MB per file
- Search results default limit: 200 hits

**Frontend** (`src/App.tsx`):
- `WORKSPACE_STORAGE_KEY = "vexc.workspacePath"`
- `FONT_SIZE_STORAGE_KEY = "vexc.fontSize"`
- `DEFAULT_FONT_SIZE = 13` (min 10, max 24)
- `CODE_FONT_FAMILY = '"JetBrains Mono", "Cascadia Code", Consolas, monospace'`
- `MAX_TERMINAL_BUFFER_CHARS = 1,048,576`
- `EXPLORER_DEFAULT_WIDTH = 270` (min 180)
- `TREE_POINTER_DRAG_THRESHOLD_PX = 6`
- `MAX_VISIBLE_TOASTS = 4`
- `DEFAULT_TOAST_DURATION_MS = 3400`

## Development Workflow

1. **Frontend changes** (`src/`): Hot reload via Vite (most changes apply immediately)
2. **Backend changes** (`src-tauri/src/`): Restart `pnpm tauri dev` (Rust requires recompilation)
3. **Type changes**: Update both `src/types.ts` and Rust structs with `#[serde(rename_all = "camelCase")]`
4. **Testing**: Manual testing in dev mode (no automated frontend tests yet)

## Code Style & Naming Conventions

**Frontend (TypeScript/TSX)**:
- 2-space indentation, double quotes
- `PascalCase` for React components and types
- `camelCase` for variables, functions, hooks
- Explicit return types for exported functions
- Avoid `any`; use interfaces, unions, narrow types

**Backend (Rust)**:
- 4-space indentation (rustfmt default)
- `snake_case` for functions, variables, modules
- `#[serde(rename_all = "camelCase")]` on structs exposed to frontend
- Return `Result<T, String>` from command handlers

**Import Organization**:
1. Framework/core packages
2. Third-party libraries
3. Local modules
4. Side-effect imports (CSS)
- Use `import type` for type-only imports
- Prefer named imports over wildcards

## Git Commit Convention

Use Conventional Commit format:
- `feat(ui): ...` - New features
- `fix(tauri): ...` - Bug fixes
- `chore: ...` - Maintenance tasks
- Keep commits scoped to one concern (frontend, Rust backend, or config)

## Windows-Specific Notes

- Default terminal: `powershell.exe` with `-NoLogo -NoProfile`
- Path handling: Normalized to forward slashes in frontend, OS-native in backend
- Terminal output: `\r\n` and `\r` converted to `\n`

## Adding New Features

### New Tauri Commands
1. Define function in `src-tauri/src/lib.rs` with `#[tauri::command]`
2. Add `state: tauri::State<AppState>` parameter if needed
3. Use `Result<T, String>` for error handling
4. Register in `invoke_handler!` macro
5. Add wrapper in `src/api.ts` using `invoke<T>("command_name", { args })`
6. Add TypeScript types to `src/types.ts`

### New Languages
1. Add `LanguageId` to `src/types.ts`
2. Add definition to `LANGUAGE_DEFINITIONS` in `src/editor/languageRegistry.ts`
3. Map extensions in `detectLanguage()` or registry

### LSP Integration
1. Implement client in `src/editor/lsp/` following `rustLspClient.ts` pattern
2. Handle JSON-RPC protocol, session management, diagnostics
3. Integrate with output store for error messages

## Debugging Tips

**Frontend**:
- Press F12 during `pnpm tauri dev` for DevTools
- Use `pnpm dev` for UI-only changes (faster iteration)

**Backend**:
- Check terminal where `pnpm tauri dev` is running
- Use `eprintln!()` for debug output
- All errors displayed in status bar or toast

**Common Issues**:
- "Command not found": Ensure command registered in `invoke_handler!`
- "Path not found": Check workspace boundary validation
- Terminal not responding: Verify PTY spawn command for platform
- Hot reload: Frontend auto-reloads; backend needs restart

---

**Last Updated**: 2026-02-20
