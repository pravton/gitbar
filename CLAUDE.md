# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GitBar is a macOS desktop app: a frameless, always-on-top floating panel that lists the user's open GitHub PRs and assigned issues. Tauri v2 shell, React + TypeScript + Tailwind v4 frontend, Rust backend that talks to the GitHub GraphQL API.

## Commands

- `npm run dev` — Vite only (frontend on `127.0.0.1:1420`). Useful when you only want to iterate on UI in a browser; most real work needs the Tauri shell.
- `npm run tauri dev` — full app (spawns Vite via `beforeDevCommand` with `TAURI_DEV_HOST=127.0.0.1`, then launches the native window). This is the normal dev loop.
- `npm run build` — `tsc && vite build`. Required before committing per `AGENTS.md`.
- `npm run tauri build` — produces the macOS DMG (`bundle.targets = ["dmg"]`).
- `npm test` — Vitest run (frontend hooks, components, utils). `npm run test:watch` for TDD. `npm run test:coverage` for v8 coverage.
- `npm run test:rust` — `cargo test ... -- --test-threads=1`. Serial is required because the GitHub GraphQL endpoint is overridden via the `GITBAR_GITHUB_GRAPHQL_URL` env var; parallel tests would stomp each other.
- `cargo check` / `cargo build` from `src-tauri/` — Rust-side type/compile check without launching the app.

A single test file: `npm test -- src/path/to/file.test.ts` (frontend) or `cargo test --manifest-path src-tauri/Cargo.toml test_name -- --test-threads=1` (Rust).

## Architecture

### Process boundary

The frontend never calls GitHub directly. It calls Rust commands via `@tauri-apps/api/core`'s `invoke(...)`, and Rust calls GitHub's GraphQL API. The three commands exposed from `src-tauri/src/lib.rs` are:

- `check_auth(token)` — validates a PAT via the `viewer { login }` query. Called from onboarding.
- `get_data(token)` — returns `{ prs, issues, partial_message }`, refreshing if the cache is older than `CACHE_TTL_SECS` (30s).
- `refresh_cache(token)` — forces a refresh and returns the same shape. Used by the manual "refresh" button.

The cache (`src-tauri/src/cache.rs`, held in `AppState` as `Mutex<Cache>`) is the single source of truth for PR/issue lists on the Rust side. `AppState::refresh_if_needed` is the gate every command goes through; treat that as the only path that ever hits the network.

### Single-flight refresh

`AppState` holds a `tokio::sync::Mutex<()>` (`refresh_lock`). Concurrent stale callers double-check staleness, await the lock, then double-check again. This collapses N concurrent callers down to 1 GitHub round-trip — see `src-tauri/src/lib.rs::AppState::refresh_if_needed` and the `refresh_if_needed_coalesces_concurrent_callers` test that pins this behavior. Cache TTL (30s) is deliberately shorter than the frontend poll (60s) so polls always trigger exactly one refresh per cycle, never racing the TTL boundary.

### Typed errors

GitHub failures are modeled in `github::models::GitHubError` as a tagged enum (`auth`, `rate_limited`, `network`, `server`, `partial`). Tauri serializes the enum to the frontend; `src/types.ts` mirrors the shape. The frontend renders distinct UI per kind in `components/ListView.tsx::ErrorBanner` and bounces back to onboarding when `kind === "auth"` (see `App.tsx`).

For PR fetches specifically: there are two underlying GraphQL queries (`author:@me`, `review-requested:@me`). If one succeeds and one fails, the cache stores the partial results plus a `partial_message` that the UI renders as a warning banner. Both failing → error returned to the frontend.

### GitHub queries

PRs come from **two** GraphQL searches that are merged and deduped by URL in `client::fetch_prs`:

- `PR_AUTHOR_QUERY` — `is:pr is:open author:@me`
- `PR_REVIEW_QUERY` — `is:pr is:open review-requested:@me`

Issues come from `ISSUE_ASSIGNED_QUERY` (`is:issue is:open assignee:@me`). If you add a new "kind" of result, follow the same pattern: define the search string in `queries.rs`, a `*Node` deserializer + `From` impl in `client.rs`, and surface the public type from `models.rs`.

### Frontend shape

`src/App.tsx` is the root and owns the high-level state machine:

1. `useGitHubAuth` reads/writes the PAT from `localStorage` under `gitbar.githubToken`. If absent, render `Onboarding` instead of the main UI. **There is no secure storage yet** — the v1 design deliberately uses `localStorage`; do not assume Tauri's store plugin is wired up just because the dependency is listed.
2. `useGitHubData(token)` is the single data hook. It polls every 60s, makes one `invoke("get_data")` per tick, and exposes `{ prs, issues, partialMessage, loading, error, updatedAt, refetch, forceRefresh }`. A `generationRef` counter drops stale responses when the token changes or the hook unmounts — older in-flight calls cannot overwrite newer data.
3. `useWindowPersistence` saves window position + size to `localStorage` (`gitbar.windowState`) on `onMoved`/`onResized` and restores on mount. Frontend-only — does not use `tauri-plugin-store` even though the dep is in `Cargo.toml`.
4. `App` tracks a `collapsed` boolean and an `expandedSize` ref. Collapse shrinks the Tauri window to `COLLAPSED_HEIGHT = 48` and hides the list; expand restores the saved size via `PhysicalSize`. The double `requestAnimationFrame` before `setSize` is intentional — it lets React paint the collapsed layout before the OS resize fires.

### Window chrome

The Tauri window is `decorations: false`, `alwaysOnTop: true`, `minHeight: 48`. There is no OS title bar, so the header is the drag handle: drag regions use `data-tauri-drag-region` (see CSS in `src/styles/index.css` and `.no-drag` opt-out for interactive children). If you add controls inside the header strip, they need `.no-drag` or clicks become drags.

A system tray icon with `Show GitBar` / `Quit` items is configured in `lib.rs::run`; clicking the tray icon toggles window visibility.

### Path alias

Vite + tsconfig both alias `@/*` to `src/*`. Use `@/components/...` style imports in new code; the existing files do.

## Conventions

- **Use `cn()` from `src/lib/utils.ts`** for conditional className composition. Don't reimport `clsx` or roll a local helper. `timeAgo` and `truncate` also live there; reuse them rather than redefining.
- **Delivery protocol** (from `AGENTS.md`): non-trivial tasks have a `artifacts/<task-slug>/brief.md` written before work begins and a matching `delivery.md` on completion, plus an update to `IN_PROGRESS.md`. Read `IN_PROGRESS.md` at session start to understand what's mid-flight. Skip this for tiny changes (typo fixes, doc tweaks).
- **Never commit** `node_modules/`, `target/`, or `.env`. `src-tauri/gen/` is also generated and should not be hand-edited.
- The Vite config ignores `src-tauri/**` from HMR watching — keep it that way; Rust changes go through `cargo`/Tauri's own reload.
