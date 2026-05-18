# Brief: GitBar Phase 1 — Window Polish + Compact View

**Status:** `running`  
**Spawning:** 2026-05-18 15:10 EDT  
**Task slug:** `gitbar-p1-polish`  
**Created:** 2026-05-18  
**Repo:** `pravton/gitbar`  
**Base branch:** `master` (PR #1 already merged)

---

## Objective

Fix three UX issues from the initial macOS test:

1. **Window can't be dragged to reposition**
2. **Minimize hides the window with no way to restore**
3. **Add a collapsed "strip" summary view that expands on toggle**

---

## 1. Fix Window Dragging

### Current state
- Window has `decorations: false` (no native title bar)
- `data-tauri-drag-region` is on the `<header>` but doesn't work reliably on macOS
- No CSS styling for the drag region to ensure it's visible/present

### Required changes

**A. `tauri.conf.json`** — The window config is fine. Don't change.

**B. `src/styles/index.css`** — Add drag region CSS:
```css
[data-tauri-drag-region] {
  cursor: grab;
  -webkit-app-region: drag;
}

/* Non-draggable elements inside the drag region must opt out */
[data-tauri-drag-region] button,
[data-tauri-drag-region] input,
[data-tauri-drag-region] a,
.no-drag {
  -webkit-app-region: no-drag;
  cursor: default;
}

/* Show grab cursor on the drag region for affordance */
[data-tauri-drag-region]:active {
  cursor: grabbing;
}
```

**C. `src/components/Header.tsx`** — Verify the header element has `data-tauri-drag-region` and that all buttons inside have `className` that doesn't interfere with `no-drag`. The existing icon buttons should work but verify they're not blocked.

Also add more drag surface: make the entire collapsed strip (see §3) draggable too, so users can grab from anywhere.

### Acceptance
- User can click-drag on the header area (or collapsed strip) to move the window
- Buttons in the header still click normally
- Works on macOS

---

## 2. Fix Minimize Behavior

### Current state
- Minus button calls `appWindow.hide()` — on macOS this hides the window but there's no system tray icon, so the window is gone
- The Rust code has tray icon code but it may not work on macOS
- Tauri 2 tray support on macOS is limited — the tray icon renders in the menu bar extras area

### Required changes

**A. `src/components/Header.tsx`** — Change minimize behavior:
```tsx
// Replace:
onClick={() => void appWindow.hide()}

// With:
onClick={() => void appWindow.minimize()}
```

On macOS, `minimize()` sends the window to the Dock (Cmd+M equivalent). The user can click the Dock icon to restore.

**B. `src-tauri/tauri.conf.json`** — Add a Tauri plugin for window management:
No config change needed — `minimize()` is built into Tauri's Window API.

**C. Rust side (`src-tauri/src/lib.rs`)** — The tray code already handles show/hide via context menu and click. Keep it as-is. On macOS, the Dock icon + tray click to toggle visibility is the right pattern.

**D. Optional: Add a "Quit" menu item to the tray** — Already exists in the Rust code, verify it works.

### Acceptance
- Clicking the minus button minimizes the window
- Window can be restored from the Dock (macOS)
- Clicking the tray icon toggles window visibility
- Right-clicking tray icon shows Show/Hide/Quit menu

---

## 3. Compact "Strip" Summary View

### Current state
- Full-height window (~500px) always showing PR/Issue list
- No way to collapse to a glance-able summary

### Design

**Collapsed state (strip):**
```
┌─────────────────────────────────────────────────┐
│ 🌤️ 5 PRs (2 drafts) · 3 issues    ⚙️ 🔄 ▼   │
│ Updated 5m ago                                    │
└─────────────────────────────────────────────────┘
```
- Height: compact (48-56px, content-driven)
- Shows: rain emoji, PR counts (with draft count), issue count, last updated time, settings/refresh/expand buttons
- Entire strip is draggable `data-tauri-drag-region`
- Window resizes to `minHeight: 48` when collapsed, back to `500` when expanded

**Expanded state:** Current full view with tabbed PR/Issue list

**Toggle:** Click the expand chevron (▼/▲) button or double-click the strip

### Required changes

**A. New component: `src/components/Strip.tsx`**
```tsx
interface StripProps {
  prCount: number;
  draftCount: number;
  issueCount: number;
  updatedAt: Date | null;
  refreshing: boolean;
  isCompact: boolean;
  onRefresh: () => void;
  onSettings: () => void;
  onToggle: () => void;
}
```

- Always draggable (`data-tauri-drag-region`)
- Shows condensed info
- Chevron button toggles compact mode
- Same refresh/settings/minimize/close buttons

**B. Modify `src/App.tsx`**
- Add `isCompact` state (default: false, or persisted via useWindowPersistence hook)
- When `isCompact`: render only `<Strip />`, window resizes to compact height
- When expanded: render `<Header />` + `<ListView />`
- Window resize: use `appWindow.setSize()` to shrink/grow

**C. Modify `src/hooks/useWindowPersistence.ts`**
- Add `isCompact` to the persisted state
- Load on mount, save on change

**D. `src-tauri/tauri.conf.json`** — Update window config:
```json
"windows": [{
  "minHeight": 48,   // was 320 — allow full collapse
  "minWidth": 280,   // was 320 — strip can be narrower
  ...
}]
```

**E. `src-tauri/src/lib.rs`** — No Rust changes needed for this feature. Window resize happens from JS side via `appWindow.setSize()`.

**F. Toggle behavior:**
- Click expand chevron → toggle compact/expanded
- Double-click strip area → toggle (optional enhancement)
- When expanding: restore to last known expanded size (persist in localStorage: `gitbar-window-size`)
- When collapsing: save current size, then resize to compact

### Window resize flow
```tsx
async function toggleCompact() {
  const appWindow = getCurrentWindow();
  if (isCompact) {
    // Expanding: restore saved size
    const saved = getSavedSize(); // { width, height } from localStorage
    await appWindow.setSize(new PhysicalSize(saved.width, saved.height));
    setIsCompact(false);
  } else {
    // Collapsing: save current size, shrink
    const current = await appWindow.outerSize();
    saveWindowSize({ width: current.width, height: current.height });
    await appWindow.setSize(new PhysicalSize(current.width, 56));
    setIsCompact(true);
  }
}
```

### Acceptance
- Clicking the toggle button shrinks window to ~56px strip and expands back
- Strip shows PR count (with drafts), issue count, last-updated time
- Strip is fully draggable
- Expanded size is restored correctly
- Compact state persists across app restarts (localStorage or Tauri store)
- Double-clicking the strip also toggles

---

## Implementation Order

1. **Fix window dragging** (CSS + Header verify) — quick
2. **Fix minimize** (one line change) — quick  
3. **Compact strip** (new component + App state + window resize) — main work

---

## Files to Change

| File | Change |
|------|--------|
| `src/styles/index.css` | Add `[data-tauri-drag-region]` CSS rules |
| `src/components/Header.tsx` | Change hide → minimize, add drag region verification |
| `src/components/Strip.tsx` | **New** — compact summary bar component |
| `src/App.tsx` | Add `isCompact` state, conditional rendering, window resize |
| `src/hooks/useWindowPersistence.ts` | Add `isCompact` persistence |
| `src-tauri/tauri.conf.json` | `minHeight: 48`, `minWidth: 280` |
| `src-tauri/src/lib.rs` | Verify tray minimize works (likely no changes needed) |

## Project Conventions

- React + TypeScript + Tailwind CSS v4
- Tauri v2 window API: `import { getCurrentWindow } from "@tauri-apps/api/window"`
- Window resize: `appWindow.setSize(new PhysicalSize(w, h))`
- Import `PhysicalSize` from `@tauri-apps/api/dpi`
- Existing icon button pattern: `<button type="button" className="icon-button">...</button>`
- CSS variables for theming: `--bg-primary`, `--text-secondary`, etc.
- `useWindowPersistence` hook pattern: wraps `tauri-plugin-store`
- No external npm deps beyond existing (lucide-react, @tauri-apps/api, etc.)

## Verification

```bash
cd ~/Projects/gitbar
npm run build          # Vite frontend must compile
# On macOS:
npm run tauri dev       # Window should open, drag, minimize, toggle strip
```
