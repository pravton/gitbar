# IN_PROGRESS.md — GitBar

**Last updated:** 2026-05-17 13:50 EDT  
**Phase:** Phase 0 — Complete → Phase 1 (macOS build & test)  

## Active task
- **Task:** `gitbar-v1` — Core MVP: floating PR/issue tracking panel
- **Artifacts:** `artifacts/gitbar-v1/brief.md`, `artifacts/gitbar-v1/delivery.md`
- **Status:** `delivered` — frontend builds clean, Rust checks pending macOS deps

## Blocked on
- `none` (code is written; needs macOS build test)

## Next step
1. Clinton pulls repo on Mac: `git clone git@github.com:pravton/gitbar.git`
2. `npm install && npm run build && cargo check --manifest-path src-tauri/Cargo.toml`
3. `npm run tauri dev` — enter PAT, verify UI renders with live data
4. `npm run tauri build` — confirm .dmg output
5. Iterate on UI polish

## Agent sessions

| Session | Task | Status | Completed |
|---|---|---|---|
| `quick-lobster` (Codex) | gitbar-v1 | delivered | 2026-05-17 13:20 EDT |
