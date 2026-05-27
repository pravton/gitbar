# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GitBar is a macOS desktop app: a frameless, always-on-top floating panel that lists the user's open GitHub PRs and assigned issues. Tauri v2 shell, React + TypeScript + Tailwind v4 frontend, Rust backend that talks to the GitHub GraphQL API.

## Commands

- `npm run dev` — Vite only (frontend on `127.0.0.1:1420`). Useful when you only want to iterate on UI in a browser; most real work needs the Tauri shell.
- `npm run tauri dev` — full app (spawns Vite via `beforeDevCommand` with `TAURI_DEV_HOST=127.0.0.1`, then launches the native window). This is the normal dev loop.
- `npm run build` — `tsc && vite build`. Required before committing per `AGENTS.md`.
- `npm run tauri build` — produces the macOS `.app` and DMG (`bundle.targets = ["app", "dmg"]`). The `app` target also emits the signed updater artifact (`.app.tar.gz`) that the release pipeline turns into `latest.json`; the DMG is the manual-download bundle.
- `npm test` — Vitest run (frontend hooks, components, utils). `npm run test:watch` for TDD. `npm run test:coverage` for v8 coverage.
- `npm run test:rust` — `cargo test ...`. Safe at default parallelism: tests using the `GITBAR_GITHUB_GRAPHQL_URL` env override take a process-wide mutex via `client::test_endpoint::EndpointGuard`, which also restores the prior value on drop.
- `cargo check` / `cargo build` from `src-tauri/` — Rust-side type/compile check without launching the app.

A single test file: `npm test -- src/path/to/file.test.ts` (frontend) or `cargo test --manifest-path src-tauri/Cargo.toml test_name` (Rust).

## Architecture

### Process boundary

The frontend never calls GitHub directly. It calls Rust commands via `@tauri-apps/api/core`'s `invoke(...)`, and Rust calls GitHub's GraphQL API. The token is stored in the OS keychain (`keyring` crate) and lives only in Rust process memory + the keychain; it never crosses the JS→Rust IPC after onboarding. The six commands exposed from `src-tauri/src/lib.rs` are:

- `check_auth(token)` — validates a candidate PAT via the `viewer { login }` query. The only data-path command that takes a token; called from onboarding before `save_token`.
- `save_token(token)` — persists a validated token to the keychain + in-memory cache.
- `clear_token()` — removes the token from the keychain + cache. Also clears the PR/issue cache (data was scoped to the old identity).
- `has_token()` — boolean. Frontend uses this on mount to decide between onboarding and the list view.
- `get_data()` — returns `{ prs, issues, partial_message }`, refreshing if the cache is older than `CACHE_TTL_SECS` (30s). Reads the token from `AppState.token_cache`; returns an `auth` error if no token is configured.
- `refresh_cache()` — forces a refresh and returns the same shape. Used by the manual "refresh" button.

The keychain is abstracted behind a `TokenStore` trait (`src-tauri/src/token_store.rs`). Production uses `KeychainTokenStore`; tests inject `MemoryTokenStore`. The same pattern applies to the on-disk PR/issue snapshot via `DiskCache` (`src-tauri/src/disk_cache.rs`): production uses `JsonFileDiskCache` (writes to the platform app-data dir, e.g. `~/Library/Application Support/io.github.pravton.gitbar/cache.json`), tests use `MemoryDiskCache`. Both stores are passed via `AppState::with_stores(token_store, disk_cache)` so the real keychain and real disk stay untouched in CI.

The disk cache is loaded on `AppState::new()` and persisted on every successful refresh. `Cache.last_fetch` stays `None` after a hydrate so the next get_data still triggers a refresh (we can't reason about monotonic time across launches), but `Cache.last_fetch_at` carries the original wall-clock so the UI's "Updated X ago" is accurate even on cold start.

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

1. `useGitHubAuth` tracks an `isAuthenticated` boolean only — the token itself lives in the Rust-side keychain/cache and never enters JS land after onboarding. On mount the hook (a) migrates any legacy `gitbar.githubToken` localStorage entry into the keychain via `save_token` and removes it, then (b) calls `has_token` to set `isAuthenticated`. `checkToken(candidate)` validates via `check_auth` then persists via `save_token`; the candidate string is discarded immediately after.
2. `useGitHubData(enabled)` is the single data hook. It polls every 60s while `enabled` is true, makes one `invoke("get_data")` per tick (no `token` parameter — Rust pulls from `AppState`), and exposes `{ prs, issues, partialMessage, loading, error, updatedAt, refetch, forceRefresh }`. A `generationRef` counter drops stale responses when `enabled` flips or the hook unmounts.
3. `useWindowPersistence` saves window position + size to `localStorage` (`gitbar.windowState`) on `onMoved`/`onResized` and restores on mount. Frontend-only; no Rust round-trip.
4. `App` tracks a `collapsed` boolean and an `expandedSize` ref. Collapse shrinks the Tauri window to `COLLAPSED_HEIGHT = 48` and hides the list; expand restores the saved size via `PhysicalSize`. The double `requestAnimationFrame` before `setSize` is intentional — it lets React paint the collapsed layout before the OS resize fires.

### Window chrome

The Tauri window is `decorations: false`, `alwaysOnTop: true`, `minHeight: 48`. There is no OS title bar, so the header is the drag handle: drag regions use `data-tauri-drag-region` (see CSS in `src/styles/index.css` and `.no-drag` opt-out for interactive children). If you add controls inside the header strip, they need `.no-drag` or clicks become drags.

A system tray icon with `Show GitBar` / `Quit` items is configured in `lib.rs::run`; clicking the tray icon toggles window visibility.

### Path alias

Vite + tsconfig both alias `@/*` to `src/*`. Use `@/components/...` style imports in new code; the existing files do.

## Conventions

- **Use `cn()` from `src/lib/utils.ts`** for conditional className composition. Don't reimport `clsx` or roll a local helper. `timeAgo` and `truncate` also live there; reuse them rather than redefining.
- **Any text rendered on a color from outside our palette must pass through `pickReadableTextColor()` in `src/lib/contrast.ts`.** That covers GitHub label colors, user-chosen theme tints, anything we don't control. The util uses the YIQ luminance formula to pick black or white; static palette colors defined in CSS vars are already paired with readable text and don't need it.
- **Delivery protocol** (from `AGENTS.md`): non-trivial tasks have a `artifacts/<task-slug>/brief.md` written before work begins and a matching `delivery.md` on completion, plus an update to `IN_PROGRESS.md`. Read `IN_PROGRESS.md` at session start to understand what's mid-flight. Skip this for tiny changes (typo fixes, doc tweaks).
- **Never commit** `node_modules/`, `target/`, or `.env`. `src-tauri/gen/` is also generated and should not be hand-edited.
- The Vite config ignores `src-tauri/**` from HMR watching — keep it that way; Rust changes go through `cargo`/Tauri's own reload.
