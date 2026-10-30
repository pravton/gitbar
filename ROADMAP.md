# Roadmap

What's tracked, what's deferred, what would be nice. Not a commitment.

## Security and hardening

- ~~**Move PAT off `localStorage`.**~~ Shipped: the PAT now lives in the OS keychain (`keyring` crate). Frontend tracks only an `isAuthenticated` boolean; data-fetch commands take no token parameter. See [`SECURITY.md`](SECURITY.md).
- ~~**Tighten Content-Security-Policy.**~~ Shipped: distinct `csp` (release) and `devCsp` (dev) policies in `tauri.conf.json`. Release locks `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`. The Vite HMR WebSocket / `'unsafe-eval'` relaxations are dev-only. See `SECURITY.md`.
- ~~**Dependency audit in CI.**~~ Shipped: `.github/workflows/ci.yml` runs `npm audit --omit=dev --audit-level=moderate` and `cargo audit` on pushes to `main` (except doc-only changes, per the workflow's `paths-ignore`), on `workflow_dispatch`, and on a weekly Monday cron (so newly-disclosed advisories on pinned deps surface even when nobody pushes between releases). The Tauri-transitive unmaintained-crate advisories are listed explicitly with `--ignore` flags so a green job means "no new findings", not "no advisories at all".

## Reliability

- ~~**Persist last-good response to disk.**~~ Shipped: `disk_cache::JsonFileDiskCache` writes a versioned JSON snapshot to the platform app-data dir on every successful refresh, hydrates from it on `AppState::new()`, clears on `forget_token`. `GitHubData.last_fetched_at_ms` carries the original wall-clock timestamp so the header's "Updated X ago" reflects real age after a disk hydrate, not "now".
- ~~**Rate-limit countdown UI.**~~ Shipped: `backoffFor()` in `src/lib/backoff.ts` consumes the rate-limited error's `retry_after_secs` (with a 1s jitter) and falls back to exponential backoff only when GitHub didn't send the header; `useGitHubData` sets `RetryState { retryAt, attempt }` on retryable failures and `ListView::ErrorBanner` runs `useCountdown(retry.retryAt)` to render the live tick ("Retrying in 42s" → "Retrying…" → next refetch auto-fires). Heading switches to a generic "Rate limited by GitHub" once a retry is queued so the seconds aren't double-displayed. Test coverage: `backoff.test.ts` pins the retry_after_secs vs. exponential fallback; `ListView.test.tsx` pins the live countdown render.
- ~~**Paginate beyond 100.**~~ Shipped: `search_prs` / `search_issues` now walk `pageInfo.endCursor` up to a five-page cap (500 results per underlying query). Hitting the cap surfaces a `partial_message` ("Showing the first 500 PRs from your <query> search; more exist on GitHub.") so the truncation is never silent.
- **Webhook-driven updates.** Polling every 60s wastes API quota. A long-lived webhook receiver (or GitHub's GraphQL subscriptions when they're stable for issues/PRs) would deliver near-realtime updates with zero idle traffic. Partly mitigated in v0.3: a notifications tripwire (`github::notifications::check_notifications`) does a cheap conditional `GET /notifications` before each poll and skips the GraphQL refresh on a `304`, with a full refresh forced at least every 5 minutes.

## UX

- ~~**Loading skeleton on first paint.**~~ Shipped: `CardSkeleton`/`CardSkeletonList` (`src/components/CardSkeleton.tsx`) replace the "Loading GitHub items..." text with a card-shaped shimmer, respecting `prefers-reduced-motion`. A persistent `sr-only` status span in `ListView` announces the loading state to screen readers.
- ~~**Debounce `useWindowPersistence`.**~~ Shipped: `trailingDebounce()` (`src/lib/debounce.ts`) coalesces `onMoved`/`onResized` bursts into a single write 200ms after the user lets go, instead of one localStorage write per drag-frame event.
- ~~**Single-pass collapse animation.**~~ Already resolved (not by this list, before it was tracked here): `App.tsx::toggleCollapsed` measures the header synchronously via `getBoundingClientRect()` at click time and issues one `setSize()` call; there is no `requestAnimationFrame` anywhere in the collapse path. `onResized` is the single source of truth for the `collapsed` boolean. See the `fd1d70c`/`e52ee5c` commits for the history.
- ~~**Keyboard navigation.**~~ Shipped: ↑/↓ (or j/k) to navigate cards with wraparound, Enter to open the selected card, D to open its deploy link, Cmd+1/2 to switch tabs, `/` to open the filter popover, Esc to clear selection or close popover. Keys are swallowed inside any text input.
- ~~**Repo filter from a saved allowlist.**~~ Shipped: a persisted `repos: string[]` allowlist in `PRFilters` (`src/lib/filters.ts`), managed from the Filters popover (`src/components/FilterPopover.tsx`) with autocomplete suggestions drawn from the currently visible PRs.
- ~~**Light theme.**~~ Shipped: follows the macOS appearance via `prefers-color-scheme: light` overrides in `src/styles/index.css` (palette vars, overlay fills, card hairlines, label pills). No in-app toggle; it tracks the system setting.

## Features

- ~~**Notifications on new review-requested PR.**~~ Shipped: opt-in OS-level via `tauri-plugin-notification`, fires when a PR newly enters `review_decision === "REVIEW_REQUIRED"`. Per-PR dedup persisted in `localStorage` so a relaunch doesn't re-notify, and dropped from the seen-set when the PR leaves the state so a future re-request fires again.
- ~~**Multi-account.**~~ Shipped: hold multiple PATs (work + personal), each in its own keychain entry, with a roster in `src-tauri/src/accounts.rs`. Switch from the tray's "Switch Account" submenu or from Settings; add, remove, and rotate tokens in Settings. Switching clears the PR/issue cache and disk snapshot so one account's data never shows under another.
- **Cross-machine filter sync via private GitHub Gist.** Already designed at the data layer (filters and presets are plain JSON). Requires expanding PAT scope to include `gist`.
- **In-app comment view.** Partly shipped in v0.4: a read-only comments panel on PR and issue cards (conversation + submitted reviews, `C` to toggle), plain text with clickable links. Still to come: inline review threads (file:line, resolved/outdated).
- ~~**GitHub Actions status pill: job counts.**~~ Shipped in v0.4: the pill reads "CI 2/9 failing" or "CI 3/9 running" from `statusCheckRollup.contexts`' per-state counts (fetched with the regular poll at no extra rate-limit cost), and falls back to the aggregate label when nothing is failing or running. The click-to-expand Checks panel (`src/components/PRChecksPanel.tsx`, PR #46) still has the per-job detail.

## Platform

- **Linux build.** Tauri supports it, the code is platform-agnostic. Needs CI + a smoke test. The GTK transitive `cargo audit` warnings apply here, so monitoring is needed.
- **Windows build.** Same as Linux. The frameless window + drag-region behaviors will need verification on Windows compositors.
- ~~**Universal binary release pipeline.**~~ Shipped: `.github/workflows/release.yml` fires on `v*` tag push, builds via `tauri-action` with `--target universal-apple-darwin` (one DMG for Apple Silicon + Intel), signs the updater `.app.tar.gz` against the minisign key in `TAURI_SIGNING_PRIVATE_KEY`, and uploads DMG + signed tarball + signature + `latest.json` to a draft release. Used end-to-end for v0.1.0 and v0.2.0.

## Tooling

- ~~**ESLint.**~~ Shipped: `eslint.config.js` (flat config) with `typescript-eslint` recommended, `eslint-plugin-react-hooks`, a Tailwind class-order rule (`eslint-plugin-better-tailwindcss`'s `enforce-consistent-class-order`), and `no-restricted-imports` blocking direct `clsx`/`classnames` imports (enforces the existing `cn()` convention). Wired into `.githooks/pre-commit` for staged TS/TSX files. Non-type-aware by design: `tsc --noEmit` already covers type checking. Note: having `eslint.config.js` at the repo root deadlocked `vite build`, because Tailwind v4's automatic content scan walks it and it imports `eslint-plugin-better-tailwindcss` (its own Tailwind-aware tooling); fixed with `@source not "../../*.config.*";` in `src/styles/index.css`.
- ~~**Pre-commit hook.**~~ Shipped: `.githooks/pre-commit` runs `tsc --noEmit` on TS/config changes and `cargo check` on Rust changes (only the relevant file types, so the typical run is ~2-3s). Enable per-clone with `git config core.hooksPath .githooks`. `git commit --no-verify` skips it in an emergency.

## Won't do

- **Embedded browser for PR viewing.** Defeats the point. We're a launcher, not a client.
- **Custom GitHub OAuth app.** PAT works fine and avoids hosting a callback server.
- **Notifications for every poll tick.** Annoying and rate-limit-blind.
