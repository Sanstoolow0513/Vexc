# Vexc Project Plan (Draft)

## 1. Project Goal
Build a desktop coding editor inspired by VSCode, based on Tauri + React + TypeScript, with a practical first target:
- reliable code editing
- workspace navigation
- terminal usage
- basic Git visibility

The first release goal is "VSCode-like workflow", not "full VSCode feature parity".

## 2. Product Positioning
- Local-first desktop editor for daily coding tasks
- Fast startup and low memory usage
- Secure file access boundaries
- Extensible architecture for future LSP/debug/plugin additions

## 3. Scope Definition
### In Scope (Phase 1)
- Open folder / workspace
- File tree + file open/save
- Multi-tab editing with unsaved state
- Global search in workspace
- Command palette and core shortcuts
- Integrated terminal (Windows priority)
- Basic Git status panel (modified/added/deleted)

### Out of Scope (Phase 1)
- Full extension marketplace
- Full debug adapter ecosystem
- Cloud sync and collaboration editing
- Full VSCode-level settings ecosystem

## 4. Milestones
### M0: Foundation (Week 1)
- Build workbench layout (sidebar, editor area, bottom panel)
- Add editor engine and state model
- Implement safe backend file commands

### M1: Core Editing (Week 2)
- File tree + open/save + tab lifecycle
- Dirty state, close guard, restore recent workspace
- Workspace search and result navigation

### M2: Developer Workflow (Week 3)
- Terminal panel with session management
- Basic Git status integration
- Keyboard shortcut baseline and command palette

### M3: Hardening (Week 4)
- Security baseline (CSP tightening, command boundaries)
- Error handling and reliability cleanup
- Basic automated tests + release candidate build

## 5. Success Criteria (Phase 1)
- User can complete a normal coding loop inside the app:
  open project -> edit files -> run commands -> inspect Git status
- Startup time remains acceptable on medium projects
- No critical data-loss bug in save/close flows
- Build output is installable on target desktop environment

## 6. Initial Architecture Direction
- Frontend: React + modular feature folders + centralized state store
- Editor: Monaco (default candidate) or CodeMirror (to confirm)
- Backend: Tauri commands for file I/O, search, terminal bridge, Git queries
- Persistence: local store for recent workspaces and UI layout
- Security: least-privilege command design and workspace path validation

## 7. Key Risks
- Editor engine integration complexity (workers, bundling, performance)
- Terminal PTY behavior differences on Windows/macOS/Linux
- Large workspace performance (file tree/search/indexing)
- Security risks from broad filesystem or shell access
- Scope creep from trying to match full VSCode too early

## 8. Topics To Discuss (Need Product/Tech Decisions)
1. Engine choice: Monaco vs CodeMirror
2. Phase 1 language strategy: plain syntax first, or early LSP for TS/Rust?
3. Terminal depth: single shell session first, or multi-session from day one?
4. Git scope: status only, or include stage/commit in Phase 1?
5. Workspace model: single-root only first, or multi-root early?
6. Security baseline: strict workspace sandbox rules and path allowlist
7. Performance target: expected max repository size for Phase 1
8. UI style direction: close to VSCode familiarity vs custom visual identity
9. Testing bar for release: minimum automated tests and manual checklist
10. Phase 2 priority: LSP depth, debugger, or plugin system first

## 9. Immediate Next Actions
1. Confirm Phase 1 feature scope and non-goals.
2. Decide editor engine and terminal implementation approach.
3. Create task board from M0-M3 and define weekly acceptance checks.
4. Start M0 implementation with a minimal vertical slice.
