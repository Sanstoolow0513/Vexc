# Repository Guidelines for Agentic Coding Agents

## Purpose
- This file is the operating guide for coding agents in this repository.
- Prefer repository conventions over generic defaults.
- Make the minimum safe, reversible change that solves the requested task.
- Do not edit generated outputs unless the user explicitly asks.

## Stack and Runtime
- Frontend: React 19 + TypeScript + Vite.
- Desktop shell: Tauri 2 + Rust (edition 2021).
- Package manager: `pnpm` (`pnpm@10.30.0` pinned in `package.json`).
- Frontend entrypoint: `src/main.tsx`.
- Tauri backend entrypoints: `src-tauri/src/main.rs` and `src-tauri/src/lib.rs`.

## Repository Layout
- `src/`: frontend source.
- `src/App.tsx`: main workbench UI and orchestration.
- `src/api.ts`: typed wrappers around Tauri `invoke` commands.
- `src/types.ts`: shared frontend domain types.
- `src/utils.ts`: frontend helpers.
- `src-tauri/src/lib.rs`: Tauri command handlers and backend logic.
- `src-tauri/tauri.conf.json`: Tauri runtime/build config.
- `public/`: static assets.
- `dist/`: generated frontend build output (do not hand-edit).
- `src-tauri/target/`: generated Rust artifacts (do not hand-edit).
- `src-tauri/gen/schemas/`: generated schemas (do not hand-edit).

## Build and Dev Commands
- Install dependencies: `pnpm install`.
- Frontend dev server: `pnpm dev`.
- Desktop dev (frontend + Rust): `pnpm tauri dev`.
- Frontend production build: `pnpm build`.
- Desktop bundle build: `pnpm tauri build`.
- Frontend preview: `pnpm preview`.

## Lint, Typecheck, and Format Commands
- No dedicated JS/TS lint script is currently defined in `package.json`.
- Primary TS quality gate: `pnpm build` (`tsc && vite build`).
- TS strictness is enforced by `tsconfig.json` (`strict`, no unused locals/params).
- Rust format check: `cargo fmt --check` (run from `src-tauri/`).
- Rust lint pass: `cargo clippy --all-targets --all-features` (run from `src-tauri/`).

## Test Commands
- Run all Rust tests: `cargo test` (from `src-tauri/`).
- Run by exact test name: `cargo test <test_name>`.
- Run by module path: `cargo test <module_path>::<test_name>`.
- Run integration target: `cargo test --test <target_file_stem>`.
- Show test output: `cargo test <test_name> -- --nocapture`.
- Frontend test runner is not configured yet; use manual validation for UI changes.

## Single-Test Cookbook (Important)
- In this repository, "single test" typically means a Rust unit test in `src-tauri/src/lib.rs`.
- Current examples:
  - `cargo test parse_git_status_reads_branch_and_changes`
  - `cargo test parse_git_branches_marks_local_and_remote`
  - `cargo test normalize_git_paths_rejects_workspace_root`
- For deterministic runs while debugging shared filesystem state, you may use:
  - `cargo test <test_name> -- --test-threads=1`

## Validation by Change Type
- Frontend-only change: run `pnpm build` and document manual UI verification.
- Backend-only change: run `cargo fmt --check`, `cargo clippy --all-targets --all-features`, and targeted `cargo test`.
- Cross-layer contract change (`src/types.ts` + Rust payloads): run both frontend and backend validations.

## TypeScript and React Style
- Use 2-space indentation, double quotes, semicolons, and trailing commas in multiline literals.
- Prefer `const`; only use `let` when reassignment is required.
- Use `camelCase` for functions/variables and `PascalCase` for components/types.
- Prefer explicit return types for exported functions.
- Avoid `any`; use unions, interfaces, utility types, and narrowing.
- Use `import type` for type-only imports.
- Keep components and hooks focused; extract helpers when a block becomes hard to scan.

## Import Conventions
- Group imports in this order:
- 1) framework/core packages, 2) third-party packages, 3) local modules, 4) side-effect imports.
- Keep side-effect imports (for example CSS) at the end.
- Prefer named imports over wildcard imports.
- Break very long import lists across multiple lines, matching existing file style.

## React State and Async Patterns
- Follow the ref-sync pattern used in `src/App.tsx` to avoid stale closures.
- Keep one source of truth per UI concern.
- Use `useMemo`/`useCallback` for expensive derivations and stable callbacks where needed.
- Clean up listeners, observers, timers, and subscriptions in effect cleanup callbacks.
- Prefix intentionally unawaited async calls with `void` in event handlers.

## Rust Style
- Use `rustfmt` defaults (4-space indentation).
- Use `snake_case` for functions/variables/modules and `CamelCase` for structs/enums.
- Keep Tauri command handlers explicit and narrowly scoped.
- Return `Result<T, String>` from command handlers exposed to frontend.
- Prefer clear `map_err` context messages suitable for users/logs.
- Avoid panics in runtime command code paths.

## Naming Conventions
- Boolean fields should read as state: `is*`, `has*`, `can*`.
- Constants should use `UPPER_SNAKE_CASE`.
- Internal helpers should encode domain intent, not generic verbs.
- Avoid unclear abbreviations unless already established (`cwd`, `lsp`).
- Keep TS and Rust names semantically aligned across the API boundary.

## Types and Cross-Layer Contracts
- Keep `src/types.ts` aligned with Rust payloads in `src-tauri/src/lib.rs`.
- Rust structs sent to frontend should use `#[serde(rename_all = "camelCase")]`.
- Preserve nullability mapping (`Option<T>` in Rust to optional/nullable TS fields).
- Update API wrappers in `src/api.ts` together with command signature changes.
- Validate both layers whenever command payloads or result shapes change.

## Error Handling Rules
- Validate inputs early and fail fast with user-readable errors.
- Wrap async frontend operations in `try/catch`.
- Convert unknown frontend errors with `String(error)`.
- Use `finally` for loading flags and in-flight cleanup.
- Use status/toast messaging for actionable user feedback.
- In Rust, propagate errors with context; avoid silent fallthroughs.

## Security and File-Boundary Rules
- Keep filesystem operations constrained to the active workspace boundary.
- Reuse path validation helpers before read/write/move/delete operations.
- Preserve binary-file guards in open/search flows.
- Keep heavy directories ignored in traversal (`node_modules`, `dist`, `target`).
- Do not expand shell/filesystem access scope unless explicitly requested.

## Generated Files Policy
- Do not manually edit or commit generated frontend output in `dist/`.
- Do not manually edit or commit generated Rust build artifacts in `src-tauri/target/`.
- Do not manually edit generated schemas in `src-tauri/gen/schemas/`.

## Commit and PR Guidance
- Use Conventional Commits (for example `feat(ui): ...`, `fix(tauri): ...`, `chore: ...`).
- Keep each commit focused on one concern.
- PRs should include: concise summary, test/validation evidence, and screenshots for UI changes.
- Document manual verification steps when frontend behavior changes.

## Cursor and Copilot Rule Sources
- Checked `.cursor/rules/`: not present.
- Checked `.cursorrules`: not present.
- Checked `.github/copilot-instructions.md`: not present.
- If any of these files are added later, merge their guidance into this document immediately.

## Agent Execution Checklist
- Read relevant configs and touched modules before editing (`package.json`, `tsconfig.json`, `Cargo.toml`).
- Prefer small, surgical edits over broad refactors.
- Run validation commands appropriate to the layers you changed.
- Report what changed, what you ran, and any remaining risks.
- If a command cannot be run, provide exact manual verification steps.
