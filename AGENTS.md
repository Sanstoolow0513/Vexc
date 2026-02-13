# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the React + TypeScript frontend (`main.tsx` entry point, `App.tsx` main UI, and styles in `App.css`).
- `src/assets/` stores frontend-local assets; `public/` stores static files served directly by Vite.
- `src-tauri/` contains the Rust host app (`src/main.rs` desktop entry, `src/lib.rs` Tauri commands/plugins, `tauri.conf.json` runtime/build config, `icons/` app icons).
- Generated output lives in `dist/` (frontend) and `src-tauri/target/` (Rust build artifacts). Treat both as build output, not source.

## Build, Test, and Development Commands 
- `pnpm install`: install JavaScript dependencies.
- `pnpm dev`: run Vite dev server (`http://localhost:1420`).
- `pnpm tauri dev`: run the full desktop app (Vite + Rust backend).
- `pnpm build`: run `tsc` type-checking and build frontend assets.
- `pnpm tauri build`: build desktop bundles/installers.
- `pnpm preview`: preview the production frontend build.
- `cargo test` (run in `src-tauri/`): execute Rust tests when present.

## Coding Style & Naming Conventions
- TypeScript is configured with strict checks; keep changes type-safe and remove unused locals/parameters.
- Match existing frontend style: 2-space indentation and double quotes in TS/TSX.
- Use `PascalCase` for React components and `camelCase` for variables/functions/hooks.
- Follow Rust defaults (`rustfmt` style): 4-space indentation and `snake_case` function names.
- Keep Tauri commands explicit and small (example: `#[tauri::command] fn greet(...)` in `src-tauri/src/lib.rs`).

## Testing Guidelines
- No JavaScript test framework is currently committed. For UI changes, include manual verification steps in PRs.
- Add Rust unit tests with `#[cfg(test)]` in `src-tauri/src` for backend logic.
- When JS tests are introduced, prefer colocated `*.test.tsx` files beside components.

## Commit & Pull Request Guidelines
- Git history is not available in this workspace snapshot, so use Conventional Commit style going forward: `feat(ui): ...`, `fix(tauri): ...`, `chore: ...`.
- Keep commits scoped to one concern (frontend, Rust backend, or config) for easier review.
- PRs should include a clear summary, linked issue/ticket, test evidence, and screenshots or screen recordings for UI changes.
