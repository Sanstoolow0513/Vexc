# Repository Guidelines for Agentic Coding Agents

## Purpose
- This file is the operating guide for coding agents in this repo.
- Follow repo conventions over generic defaults.
- Prefer small, targeted, reversible changes.
- Do not modify generated outputs unless explicitly requested.

## Stack and Runtime
- Frontend: React 19 + TypeScript + Vite.
- Desktop shell: Tauri 2 with Rust (edition 2021).
- Package manager: `pnpm`.
- Frontend entry: `src/main.tsx`.
- Backend entry: `src-tauri/src/main.rs` and `src-tauri/src/lib.rs`.

## Project Structure
- `src/`: frontend app code.
- `src/App.tsx`: main workbench UI and state orchestration.
- `src/api.ts`: typed wrappers for Tauri `invoke` commands.
- `src/types.ts`: frontend domain and payload types.
- `src/utils.ts`: utility helpers.
- `src-tauri/src/lib.rs`: command handlers, terminal integration, workspace/file logic.
- `src-tauri/tauri.conf.json`: app build and runtime config.
- `public/`: static assets for Vite.
- `dist/`: generated frontend build output.
- `src-tauri/target/`: generated Rust build output.
- `src-tauri/gen/schemas/`: generated Tauri schemas.

## Build and Dev Commands
- Install dependencies: `pnpm install`
- Frontend dev server: `pnpm dev`
- Desktop app dev (frontend + Rust): `pnpm tauri dev`
- Frontend production build: `pnpm build`
- Desktop production bundle: `pnpm tauri build`
- Preview frontend build: `pnpm preview`

## Lint, Typecheck, and Format
- JS/TS lint script is not currently defined in `package.json`.
- Primary TS quality gate: `pnpm build` (runs `tsc && vite build`).
- TypeScript rules are enforced through `tsconfig.json` strict settings.
- Rust format check (recommended): `cargo fmt --check` in `src-tauri/`.
- Rust lint (recommended): `cargo clippy --all-targets --all-features` in `src-tauri/`.

## Test Commands
- Rust tests (all): `cargo test` (run in `src-tauri/`).
- Rust test by name: `cargo test <test_name>`.
- Rust test by module path: `cargo test <module_path>::<test_name>`.
- Rust integration test target: `cargo test --test <file_name>`.
- Rust test with output: `cargo test <test_name> -- --nocapture`.
- Frontend test runner is not configured yet.

## Single-Test Expectations
- In this repo, "single test" mainly means a Rust test target in `src-tauri/`.
- If changing backend logic, add focused Rust unit tests where practical.
- If changing frontend behavior, include manual validation steps in PR notes.
- Do not assume `pnpm test` exists unless a test framework is added.

## TypeScript and React Style
- Use 2-space indentation and double quotes.
- Keep semicolons and trailing commas in multiline structures.
- Use function and variable names in `camelCase`.
- Use component names and type names in `PascalCase`.
- Prefer explicit return types for exported functions.
- Avoid `any`; use interfaces, unions, and narrow types.

## Rust Style
- Use `rustfmt` defaults (4-space indentation).
- Use `snake_case` for functions, variables, and modules.
- Keep Tauri commands explicit and narrowly scoped.
- Return `Result<T, String>` from command handlers.
- Use clear `map_err` context for user-facing failures.

## Import Conventions
- Order imports by groups:
- 1) framework/core packages, 2) third-party libs, 3) local modules, 4) side-effect imports.
- Keep side-effect imports (for example CSS) near the end.
- Use `import type` for type-only imports.
- Prefer named imports over wildcard imports.
- Break very long import lists across multiple lines.

## Naming Conventions
- Boolean names should read as state, typically `is*`, `has*`, `can*`.
- Constants should use `UPPER_SNAKE_CASE`.
- Internal helper names should be specific to domain intent.
- Avoid abbreviations unless already established (for example `cwd`).
- Keep Rust and TypeScript field names aligned with payload intent.

## Types and Cross-Layer Contracts
- Keep `src/types.ts` aligned with Rust command payloads.
- Rust structs sent to frontend should use `#[serde(rename_all = "camelCase")]`.
- Preserve nullable behavior mapping (`Option<T>` to TS nullable/optional fields).
- Update both sides together whenever command payloads change.
- Keep API wrappers in `src/api.ts` strongly typed.

## Error Handling Rules
- Validate inputs early and return fast on invalid states.
- Wrap async frontend operations in `try/catch`.
- Use user-readable status messages in UI (`setStatusMessage`).
- In frontend catch blocks, stringify unknown errors safely (`String(error)`).
- Use `finally` for cleanup of loading flags or in-flight request maps.
- Avoid panics in backend command code paths.

## Security and File Boundary Rules
- Keep all file operations constrained to workspace boundaries.
- Reuse path validation helpers before read/write operations.
- Preserve binary-file guards for editor open and search flows.
- Preserve ignored heavy directories (`node_modules`, `dist`, `target`).
- Do not widen shell or filesystem access without explicit request.

## State Management Patterns
- Follow existing ref-sync pattern to avoid stale closures in async flows.
- Keep one source of truth per major UI concern.
- Use `useMemo` for derived values and stable references.
- Cleanup all event listeners and observers in effect cleanup callbacks.
- Prefix intentionally unawaited async calls with `void` in handlers.

## File Editing and Generated Artifacts
- Edit source and config files only when needed for the task.
- Do not commit or manually edit generated outputs in `dist/`.
- Do not commit or manually edit generated outputs in `src-tauri/target/`.
- Do not hand-edit generated schemas in `src-tauri/gen/schemas/`.

## Commit and PR Guidance
- Use Conventional Commits (for example `feat(ui): ...`, `fix(tauri): ...`, `chore: ...`).
- Keep each commit focused on one concern.
- PRs should include summary, test evidence, and UI screenshots when relevant.
- Mention manual verification steps for frontend changes.

## Cursor and Copilot Rules Status
- Checked `.cursor/rules/`: not present.
- Checked `.cursorrules`: not present.
- Checked `.github/copilot-instructions.md`: not present.
- If any of these are added later, merge their guidance into this file.

## Agent Execution Checklist
- Read relevant files before editing (`package.json`, `tsconfig.json`, touched modules).
- Make the minimum safe change that satisfies the request.
- Run applicable validation commands for changed layers.
- Report what changed, how it was validated, and any remaining risks.
- If validation cannot run, provide exact manual verification instructions.
