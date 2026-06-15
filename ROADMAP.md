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
- **Webhook-driven updates.** Polling every 60s wastes API quota. A long-lived webhook receiver (or GitHub's GraphQL subscriptions when they're stable for issues/PRs) would deliver near-realtime updates with zero idle traffic.

## UX

- **Loading skeleton on first paint.** Replace the "Loading GitHub items..." text with a card-shaped shimmer.
- **Debounce `useWindowPersistence`.** Currently writes on every `onMoved`/`onResized` event during a drag. Add a 200ms trailing debounce.
- **Single-pass collapse animation.** The double-`requestAnimationFrame` in `App.tsx::toggleCollapsed` is a workaround. A `useLayoutEffect`-driven path would be cleaner.
- ~~**Keyboard navigation.**~~ Shipped: ↑/↓ (or j/k) to navigate cards with wraparound, Enter to open the selected card, D to open its deploy link, Cmd+1/2 to switch tabs, `/` to open the filter popover, Esc to clear selection or close popover. Keys are swallowed inside any text input.
- **Repo filter from a saved allowlist.** A user with 50+ repos may only care about 5. Currently filters are derived from visible PRs only.
- **Light theme.** Dark is the only theme today.

## Features

- ~~**Notifications on new review-requested PR.**~~ Shipped: opt-in OS-level via `tauri-plugin-notification`, fires when a PR newly enters `review_decision === "REVIEW_REQUIRED"`. Per-PR dedup persisted in `localStorage` so a relaunch doesn't re-notify, and dropped from the seen-set when the PR leaves the state so a future re-request fires again.
- **Multi-account.** Hold multiple PATs (work + personal). Switch via tray menu.
- **Cross-machine filter sync via private GitHub Gist.** Already designed at the data layer (filters and presets are plain JSON). Requires expanding PAT scope to include `gist`.
- **In-app comment view.** Expand a PR card to show the latest comments inline, without leaving GitBar.
- **GitHub Actions status pill — drill-down done, pill itself still aggregate.** v0.2 added the click-to-expand Checks panel under each PR card (`src/components/PRChecksPanel.tsx`, PR #46): per-job name + workflow + status + duration + click-through to the job log on github.com. The CI pill itself still shows the `statusCheckRollup.state` aggregate; revisit only if a one-glance "X of Y jobs failing" string in the pill is worth the visual noise.

## Platform

- **Linux build.** Tauri supports it, the code is platform-agnostic. Needs CI + a smoke test. The GTK transitive `cargo audit` warnings apply here, so monitoring is needed.
- **Windows build.** Same as Linux. The frameless window + drag-region behaviors will need verification on Windows compositors.
- ~~**Universal binary release pipeline.**~~ Shipped: `.github/workflows/release.yml` fires on `v*` tag push, builds via `tauri-action` with `--target universal-apple-darwin` (one DMG for Apple Silicon + Intel), signs the updater `.app.tar.gz` against the minisign key in `TAURI_SIGNING_PRIVATE_KEY`, and uploads DMG + signed tarball + signature + `latest.json` to a draft release. Used end-to-end for v0.1.0 and v0.2.0.

## Tooling

- **ESLint.** None today. Tailwind v4 + React 18 + TS strict catches most issues, but a Tailwind class-order rule and a `no-restricted-imports` for `clsx` would be cheap wins.
- ~~**Pre-commit hook.**~~ Shipped: `.githooks/pre-commit` runs `tsc --noEmit` on TS/config changes and `cargo check` on Rust changes (only the relevant file types, so the typical run is ~2-3s). Enable per-clone with `git config core.hooksPath .githooks`. `git commit --no-verify` skips it in an emergency.

## Won't do

- **Embedded browser for PR viewing.** Defeats the point. We're a launcher, not a client.
- **Custom GitHub OAuth app.** PAT works fine and avoids hosting a callback server.
- **Notifications for every poll tick.** Annoying and rate-limit-blind.
