# Repository Guidelines for Agentic Coding Agents

## Purpose
- This file defines repository-specific rules for coding agents.
- Prefer these rules over generic defaults.
- Make the smallest safe, reversible change that satisfies the request.
- Do not manually edit generated artifacts unless explicitly asked.

## Stack and Runtime
- Frontend: React 19 + TypeScript + Vite.
- Desktop shell: Tauri 2 + Rust (edition 2021).
- Package manager: `pnpm` (`pnpm@10.30.0` pinned in `package.json`).
- Frontend entrypoint: `src/main.tsx`.
- Main app surface: `src/App.tsx`.
- Tauri backend: `src-tauri/src/lib.rs` and `src-tauri/src/main.rs`.

## Repository Layout
- `src/`: frontend code.
- `src/components/`: UI panels and workbench widgets.
- `src/editor/`: Monaco setup, LSP integration, output store.
- `src/editor/lsp/lspManager.ts`: generic LSP session manager.
- `src/editor/lsp/monacoLspAdapter.ts`: Monaco provider bridge.
- `src/editor/languageRegistry.ts`: language and LSP server mapping.
- `src/api.ts`: typed wrappers around Tauri `invoke` commands.
- `src/types.ts`: shared frontend domain and contract types.
- `src-tauri/src/lib.rs`: Tauri command handlers + backend logic.
- `public/`: static assets.
- `dist/`: generated frontend output (do not hand-edit).
- `src-tauri/target/`: generated Rust build output (do not hand-edit).
- `src-tauri/gen/schemas/`: generated schema output (do not hand-edit).

## Build and Dev Commands
- Install deps: `pnpm install`.
- Frontend dev server: `pnpm dev`.
- Full desktop dev: `pnpm tauri dev`.
- Frontend build: `pnpm build`.
- Desktop bundle build: `pnpm tauri build`.
- Frontend preview: `pnpm preview`.

## Lint, Typecheck, and Format
- JS/TS lint script is not defined in `package.json`.
- Primary TS quality gate: `pnpm build` (`tsc && vite build`).
- TS strictness in `tsconfig.json`: `strict`, `noUnusedLocals`, `noUnusedParameters`.
- Rust formatting check (run in `src-tauri/`): `cargo fmt --check`.
- Rust lint pass (run in `src-tauri/`): `cargo clippy --all-targets --all-features`.

## Test Commands
- Run all Rust tests (in `src-tauri/`): `cargo test`.
- Run tests by name pattern: `cargo test <test_name>`.
- Run exact single test: `cargo test <test_name> -- --exact`.
- Run module-path test: `cargo test <module_path>::<test_name>`.
- Run integration target: `cargo test --test <target_file_stem>`.
- Show captured logs: `cargo test <test_name> -- --nocapture`.
- Deterministic single-thread run: `cargo test <test_name> -- --test-threads=1`.
- Frontend test runner is not configured; perform manual UI verification.

## Single-Test Cookbook (Important)
- In this repo, “single test” usually means a Rust unit test in `src-tauri/src/lib.rs`.
- Known examples:
  - `cargo test parse_git_status_reads_branch_and_changes`
  - `cargo test parse_git_branches_marks_local_and_remote`
  - `cargo test normalize_git_paths_rejects_workspace_root`
- If the name is ambiguous, prefer exact mode:
  - `cargo test parse_git_status_reads_branch_and_changes -- --exact`

## Validation by Change Type
- Frontend-only change:
  - Run: `pnpm build`
  - Document manual validation steps.
- Backend-only change:
  - Run: `cargo fmt --check`
  - Run: `cargo clippy --all-targets --all-features`
  - Run targeted `cargo test` (single test when possible).
- Cross-layer contract change (`src/types.ts` + Rust payload/serde):
  - Run both frontend and backend validation sets.

## TypeScript and React Style
- Use 2-space indentation, double quotes, semicolons.
- Keep trailing commas in multiline literals.
- Prefer `const`; use `let` only when reassignment is required.
- Use `PascalCase` for React components/types and `camelCase` for values/functions.
- Use explicit return types for exported functions.
- Avoid `any`; prefer unions, interfaces, utility types, and narrowing.
- Use `import type` for type-only imports.
- Keep components/hooks focused; extract helpers for complex blocks.

## Import Conventions
- Order imports by group:
  1) framework/core packages
  2) third-party packages
  3) local modules
  4) side-effect imports (for example CSS)
- Prefer named imports over wildcard imports.
- Break long import lists across multiple lines.

## React State and Async Patterns
- Follow ref-sync patterns used in `src/App.tsx` to avoid stale closures.
- Keep a single source of truth per UI concern.
- Use `useMemo` / `useCallback` when derivation or callback stability matters.
- Clean up listeners, timers, observers, and subscriptions in effect cleanup.
- Prefix intentionally unawaited async calls with `void` in event handlers.

## LSP-Specific Guidance
- Keep protocol/session logic generic in `src/editor/lsp/lspManager.ts`.
- Keep Monaco bridging logic in `src/editor/lsp/monacoLspAdapter.ts`.
- Keep language/server mapping in `src/editor/languageRegistry.ts`.
- Avoid language-specific logic in shared manager unless unavoidable.
- Preserve diagnostic mapping shape (`EditorDiagnostic`) and marker ownership conventions.

## Rust Style
- Use rustfmt defaults (4 spaces).
- Use `snake_case` for functions/variables/modules.
- Use `CamelCase` for structs/enums.
- Tauri commands exposed to frontend should return `Result<T, String>`.
- Add context with `map_err` for user-readable failures.
- Avoid panics in runtime command paths.

## Naming Conventions
- Boolean fields should read as state: `is*`, `has*`, `can*`.
- Constants use `UPPER_SNAKE_CASE`.
- Helpers should be domain-revealing, not generic verbs.
- Keep TS and Rust names semantically aligned across API boundary.
- Avoid unclear abbreviations unless already established (`cwd`, `lsp`).

## Types and Cross-Layer Contracts
- Keep `src/types.ts` aligned with Rust payloads in `src-tauri/src/lib.rs`.
- Rust structs sent to frontend should use `#[serde(rename_all = "camelCase")]`.
- Keep nullability consistent (`Option<T>` ↔ optional/nullable TS fields).
- Update `src/api.ts` wrappers whenever command signatures or payloads change.

## Error Handling Rules
- Validate input early and fail fast with actionable messages.
- Wrap async frontend operations in `try/catch`.
- Convert unknown frontend errors with `String(error)`.
- Use `finally` for loading flags and in-flight cleanup.
- Surface actionable feedback via status bar, output panel, or toast.
- In Rust, propagate errors with context and avoid silent fallthrough.

## Security and Workspace Boundaries
- Keep filesystem operations constrained to current workspace root.
- Reuse path-validation helpers before read/write/move/delete.
- Preserve binary-file guards in open/search flows.
- Keep heavy directories ignored (`node_modules`, `dist`, `target`).
- Do not broaden filesystem/shell scope unless explicitly requested.

## Generated Files Policy
- Do not manually edit `dist/`.
- Do not manually edit `src-tauri/target/`.
- Do not manually edit `src-tauri/gen/schemas/`.

## Commit and PR Guidance
- Use Conventional Commits (`feat(...)`, `fix(...)`, `chore(...)`, etc.).
- Keep each commit focused on one concern.
- Include validation evidence in PR descriptions.
- Include screenshots when UI behavior changes.
- Document manual verification when frontend behavior changes.

## Cursor and Copilot Rules
- `.cursor/rules/`: not present.
- `.cursorrules`: not present.
- `.github/copilot-instructions.md`: not present.
- If any are added later, merge their guidance into this file.

## Agent Execution Checklist
- Read relevant configs and touched modules before editing.
- Prefer small, surgical edits over broad refactors.
- Run validation commands appropriate to touched layers.
- Report what changed, what was run, and remaining risks.
- If a command cannot be run, provide exact manual verification steps.
