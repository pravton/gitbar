# AGENTS.md — GitBar

## Delivery Protocol
Read `IN_PROGRESS.md` on session start. Read `artifacts/<task-slug>/brief.md` before work.
Write `artifacts/<task-slug>/delivery.md` on completion. Update `IN_PROGRESS.md`.

## Tech Stack
- Tauri v2 (Rust backend)
- React + TypeScript (frontend)
- Tailwind CSS v4
- Node.js ≥22

## Rules
- Never commit `node_modules/`, `target/`, or `.env`
- Run `npm run build` before committing
- Use `cn()` from lib/utils — not local helpers
