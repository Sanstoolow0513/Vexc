# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vexc is a desktop code editor built with Tauri + React + TypeScript, inspired by VSCode. The project aims to provide a lightweight, fast, and secure local-first coding experience.

**Current Status**: Foundation phase (M0) - building workbench layout, editor engine, and backend file commands.

## Development Commands

### Core Development
- `pnpm tauri dev` - Start development server with hot reload
- `pnpm build` - Build frontend for production
- `pnpm tauri build` - Build complete desktop application

### Package Management
- Uses `pnpm` as package manager
- `pnpm install` - Install dependencies

### Platform-Specific
- Desktop: Works on Windows, macOS, Linux
- Android: `pnpm tauri android init` then `pnpm tauri android dev`

## Architecture

### Frontend Structure (React + TypeScript)

**Entry Point**: `src/main.tsx` → `src/App.tsx`

**Core Modules**:
- `src/api.ts` - Tauri command wrappers (invoke backend commands)
- `src/types.ts` - Shared TypeScript types (mirrored in Rust)
- `src/utils.ts` - Helper functions (language detection, path handling, arg parsing)
- `src/hints.ts` - Keyword-based code suggestion system

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
- Handles keyboard shortcuts (Ctrl+S for save, Tab for hints, Escape to close hints)

### Backend Structure (Rust + Tauri)

**Entry Point**: `src-tauri/src/lib.rs` - `run()` function registers all commands

**State**: `AppState` struct with:
- `workspace_root: Mutex<Option<PathBuf>>` - Current workspace directory
- `terminals: Mutex<HashMap<String, TerminalState>>` - Terminal sessions
- `terminal_counter: AtomicU64` - Session ID generator

**Security Model**:
- All file operations must stay within workspace boundary
- `ensure_inside_workspace()` validates paths before read/write
- Binary file detection via null byte scanning
- Hidden file filtering (configurable via `includeHidden` parameter)

**Tauri Commands** (invoked from frontend):
- `set_workspace`, `get_workspace` - Workspace management
- `list_directory`, `read_file`, `write_file` - File operations
- `search_workspace` - Recursive text search (max 200 hits default)
- `terminal_create`, `terminal_list`, `terminal_write`, `terminal_close` - Terminal session management
- `ai_provider_suggestions`, `ai_run` - AI CLI integration

**Data Flow**:
1. Frontend calls function in `src/api.ts`
2. API function uses `invoke<Type>("command_name", { args })`
3. Tauri bridges to Rust command handler in `lib.rs`
4. Rust returns `Result<Type, String>` (error message as String)
5. Frontend receives Promise<Type>

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

**Key UI Patterns**:
- Lazy-loaded directory tree (fetches children on expand)
- Tab-based editing with dirty state tracking (`content !== savedContent`)
- Virtual terminal sessions (line-based, not PTY)
- Keyword hint panel that appears on content change
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

### Important Constraints

1. **Workspace Boundary**: All file I/O must validate paths are within workspace root
2. **Binary File Protection**: Detect and prevent opening binary files (>2MB limit for search)
3. **Terminal Session Isolation**: Each terminal maintains its own CWD and line buffer,
   with scrollback limited to 20,000 lines to prevent memory issues
4. **State Synchronization**: Use refs (`tabsRef`, `activeTabIdRef`, etc.) to avoid stale closures in async operations
5. **Error Messages**: All Rust errors return as `String`, displayed in status bar

### Development Workflow

1. Backend changes: Edit `src-tauri/src/lib.rs`, restart `pnpm tauri dev`
2. Frontend changes: Hot reload via Vite
3. Type changes: Update both `src/types.ts` and corresponding Rust structs
4. Testing: Manual testing in dev mode (no automated tests yet - M3 milestone)

### Windows-Specific Notes

- Default terminal: `powershell.exe`
- Path handling: Normalized to forward slashes in frontend, uses OS-native paths in backend
- Build target: Works on Windows 11 IoT Enterprise LTSC (dev environment)

### Key Functions Reference

**Frontend - `src/api.ts`**:
- `setWorkspace(path)` → Initialize workspace
- `listDirectory(path?, includeHidden?)` → Get file nodes
- `readFile(path)` → Load file content
- `writeFile(path, content)` → Save file
- `searchWorkspace(query, maxResults?, includeHidden?)` → Text search
- `terminalCreate(shell?)` → Start new terminal session
- `terminalWrite(sessionId, input)` → Execute command in terminal

**Frontend - `src/utils.ts`**:
- `detectLanguage(path)` → Map file extension to Monaco language
- `fileNameFromPath(path)` → Extract filename from full path
- `splitArgs(input)` → Parse shell-like argument string (handles quotes)

**Backend - Security Helpers**:
- `ensure_inside_workspace(candidate, workspace_root)` → Path boundary validation
- `is_probably_binary(bytes)` → Detect binary files via null bytes
- `canonicalize_dir_path(path)` → Resolve and validate directory path

### Milestones Tracking

Current phase aims to complete M0 (Foundation):
- Workbench layout ✅
- Editor engine integration ✅
- Backend file commands ✅
- Terminal session management ✅
- AI CLI integration ✅

Next: M1 (Core Editing) - Enhance file operations, dirty state handling, workspace search.
