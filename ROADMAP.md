# Roadmap

What's tracked, what's deferred, what would be nice. Not a commitment.

## Security and hardening

- ~~**Move PAT off `localStorage`.**~~ Shipped: the PAT now lives in the OS keychain (`keyring` crate). Frontend tracks only an `isAuthenticated` boolean; data-fetch commands take no token parameter. See [`SECURITY.md`](SECURITY.md).
- **Tighten Content-Security-Policy.** Currently `null`. Pin Tailwind's runtime style insertion, add `connect-src` for the dev WebSocket only in debug builds, hard-restrict in release.
- **Dependency audit in CI.** Run `npm audit` + `cargo audit` on every PR; fail on `>=high` severity.

## Reliability

- **Persist last-good response to disk.** Cold start with no network currently shows an empty UI. `tauri-plugin-store` is already a dep; use it for a single-file cache keyed by token-hash.
- **Rate-limit countdown UI.** The `rate_limited` error already carries `retry_after_secs`. Surface it as a live countdown banner instead of a static "rate limited" message.
- **Paginate beyond 100.** The GraphQL search caps at 100 results per query. Anyone with >100 open PRs silently loses the tail. Add cursor-based pagination.
- **Webhook-driven updates.** Polling every 60s wastes API quota. A long-lived webhook receiver (or GitHub's GraphQL subscriptions when they're stable for issues/PRs) would deliver near-realtime updates with zero idle traffic.

## UX

- **Loading skeleton on first paint.** Replace the "Loading GitHub items..." text with a card-shaped shimmer.
- **Debounce `useWindowPersistence`.** Currently writes on every `onMoved`/`onResized` event during a drag. Add a 200ms trailing debounce.
- **Single-pass collapse animation.** The double-`requestAnimationFrame` in `App.tsx::toggleCollapsed` is a workaround. A `useLayoutEffect`-driven path would be cleaner.
- **Keyboard navigation.** Up/down through PR cards, Enter to open, `D` to open deploy link, `/` to focus filter search.
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
