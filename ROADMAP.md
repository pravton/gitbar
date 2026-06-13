# Roadmap

What's tracked, what's deferred, what would be nice. Not a commitment.

## Security and hardening

- ~~**Move PAT off `localStorage`.**~~ Shipped: the PAT now lives in the OS keychain (`keyring` crate). Frontend tracks only an `isAuthenticated` boolean; data-fetch commands take no token parameter. See [`SECURITY.md`](SECURITY.md).
- ~~**Tighten Content-Security-Policy.**~~ Shipped: distinct `csp` (release) and `devCsp` (dev) policies in `tauri.conf.json`. Release locks `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`. The Vite HMR WebSocket / `'unsafe-eval'` relaxations are dev-only. See `SECURITY.md`.
- ~~**Dependency audit in CI.**~~ Shipped: `.github/workflows/ci.yml` runs `npm audit --omit=dev --audit-level=moderate` and `cargo audit` on every push to `main`, on `workflow_dispatch`, and on a weekly Monday cron (so newly-disclosed advisories on pinned deps surface even when nobody pushes between releases). The Tauri-transitive unmaintained-crate advisories are listed explicitly with `--ignore` flags so a green job means "no new findings", not "no advisories at all".

## Reliability

- ~~**Persist last-good response to disk.**~~ Shipped: `disk_cache::JsonFileDiskCache` writes a versioned JSON snapshot to the platform app-data dir on every successful refresh, hydrates from it on `AppState::new()`, clears on `forget_token`. `GitHubData.last_fetched_at_ms` carries the original wall-clock timestamp so the header's "Updated X ago" reflects real age after a disk hydrate, not "now".
- **Rate-limit countdown UI.** The `rate_limited` error already carries `retry_after_secs`. Surface it as a live countdown banner instead of a static "rate limited" message.
- **Paginate beyond 100.** The GraphQL search caps at 100 results per query. Anyone with >100 open PRs silently loses the tail. Add cursor-based pagination.
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
- **GitHub Actions status pill.** Today we show `statusCheckRollup.state`. Surface the specific failing check name and a link to its log.

## Platform

- **Linux build.** Tauri supports it, the code is platform-agnostic. Needs CI + a smoke test. The GTK transitive `cargo audit` warnings apply here, so monitoring is needed.
- **Windows build.** Same as Linux. The frameless window + drag-region behaviors will need verification on Windows compositors.
- **Universal binary release pipeline.** GitHub Action that builds the DMG, signs, and uploads on tag.

## Tooling

- **ESLint.** None today. Tailwind v4 + React 18 + TS strict catches most issues, but a Tailwind class-order rule and a `no-restricted-imports` for `clsx` would be cheap wins.
- **Pre-commit hook.** `tsc --noEmit && cargo check` before any commit. Skip when `git commit --no-verify` is explicit.

## Won't do

- **Embedded browser for PR viewing.** Defeats the point. We're a launcher, not a client.
- **Custom GitHub OAuth app.** PAT works fine and avoids hosting a callback server.
- **Notifications for every poll tick.** Annoying and rate-limit-blind.
