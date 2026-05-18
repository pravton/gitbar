# Delivery: GitBar Phase 1 Polish

**Completed:** 2026-05-18 16:17 EDT  
**Branch:** `feat/compact-strip-drag-minimize`

## Changes

- Added Tauri drag-region CSS and a `.no-drag` utility in `src/styles/index.css`.
- Changed the Header minus button from `hide()` to `minimize()`.
- Added a compact draggable `Strip` view with PR, draft, issue, and updated-time summary.
- Added compact/expanded state in `src/App.tsx`, including Tauri window resizing via `PhysicalSize`.
- Persisted compact state and expanded window dimensions with `gitbar-window-width` and `gitbar-window-height`.
- Lowered Tauri minimum window size to `280x48`.

## Verification

- `npm run build` passes.

## Notes

- No commit was created.
- Manual macOS smoke testing is still recommended for drag behavior and Dock minimize restore.
- OpenClaw completion notification was attempted, but the local gateway was unavailable and could not be started from this sandbox.
