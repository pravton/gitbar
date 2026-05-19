# GitBar

An always-on-top, frameless desktop panel that tracks your open GitHub pull requests and assigned issues. Built with Tauri 2 and React. Designed to live in a corner of your screen so you can glance at your queue without context-switching to a browser tab.

## Status

- **Platform:** macOS only (universal binary via DMG). Linux/Windows builds have not been tested.
- **Auth:** GitHub Personal Access Token, stored in the webview's `localStorage`. Moving the secret into the OS keychain is a tracked roadmap item.
- **Data:** PRs (`is:pr is:open author:@me` plus `is:pr is:open review-requested:@me`, deduped) and issues (`is:issue is:open assignee:@me`) fetched from GitHub's GraphQL API. Polled every 60 seconds. Backed by an in-memory cache with a 30 second TTL.

## Install

### From release

Pre-built DMGs ship under [Releases](https://github.com/pravton/gitbar/releases). Download, drag to Applications, launch.

### From source

```sh
git clone https://github.com/pravton/gitbar.git
cd gitbar
npm install
npm run tauri build
```

The DMG lands in `src-tauri/target/release/bundle/dmg/`.

Requirements:

- Node.js `^20.19.0` or `>=22.12.0` (Vite 8 minimum; enforced via `engines` in `package.json`)
- Rust toolchain (stable, install via [rustup](https://rustup.rs))
- macOS 13+ for `color-mix()` and `:has()` CSS support in the webview

## Use

1. Generate a GitHub Personal Access Token with the `repo` and `read:org` scopes ([github.com/settings/tokens](https://github.com/settings/tokens)).
2. Launch GitBar. Paste the token into the onboarding screen.
3. The panel sits always-on-top. Drag the header to move, click the chevron to collapse to a strip, click the tray icon to toggle visibility.

### Deploy links on PR cards

GitBar parses a labeled line out of the PR body and surfaces it as a click-through "Deploy" button. Drop one of these into your PR description:

```
Deploy: https://my-preview.example.com
```

Accepted labels (case-insensitive): `Deploy:`, `Deploy-Link:`, `Preview:`, `Local-Deploy:`, `Local:`. Or use an invisible HTML comment:

```
<!-- gitbar:deploy=https://my-preview.example.com -->
```

If both a body marker and a GitHub deployments-API URL exist, the body marker wins. This is intentional — a manually pasted local URL (Tailscale tunnel, ngrok, internal staging box) is usually more useful than an auto-generated cloud preview.

See [`AGENTS.md`](AGENTS.md) for the full convention if you want an AI agent to add the line when opening PRs.

### Filters

The filter button on the PRs tab opens a popover with toggles for draft state, organization, CI status, and review-requested-only. Filters and named presets persist to `localStorage` per machine. Cross-machine preset sync is a roadmap item.

## Architecture

Frontend (React + TypeScript + Tailwind v4) calls Rust commands via `@tauri-apps/api` `invoke()`. Rust calls GitHub's GraphQL API directly. Three commands:

- `check_auth(token)` — validates the PAT.
- `get_data(token)` — returns `{ prs, issues, partial_message }` from the cache, refreshing if stale.
- `refresh_cache(token)` — forces a refresh.

A `tokio::sync::Mutex` in `AppState` makes refreshes single-flight: concurrent stale callers wait on one in-flight fetch rather than firing parallel requests. Errors flow back to the UI as a tagged enum (`auth | rate_limited | network | server | partial`) so the frontend can route 401s back to onboarding and surface rate-limit retry-after times.

For full architecture detail see [`CLAUDE.md`](CLAUDE.md).

## Develop

```sh
npm install                # install JS deps
git config core.hooksPath .githooks  # enable the pre-commit hook (one-time)
npm run tauri dev          # full app with native window + HMR
npm run dev                # frontend only (for browser iteration)
npm run build              # tsc + vite build
npm run typecheck          # tsc --noEmit (also runs in the pre-commit hook)
npm test                   # Vitest (frontend)
npm run test:rust          # cargo test (Rust)
```

The pre-commit hook runs `tsc --noEmit` and `cargo check` only on the relevant file types (~2-3s). CI (`.github/workflows/ci.yml`) runs the full test suite plus `npm audit` + `cargo audit` on every PR. Releases (`.github/workflows/release.yml`) build a universal macOS DMG when a `v*` tag is pushed.

Tests run at default parallelism — no `--test-threads=1` needed. The Rust GraphQL endpoint is overridable in debug builds via `GITBAR_GITHUB_GRAPHQL_URL` for `wiremock`-based tests; the override is gated behind `cfg(debug_assertions)` so release builds always target `api.github.com`.

Branch conventions and commit style are in [`CLAUDE.md`](CLAUDE.md). Contribution guidelines: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Security

- **PAT storage.** Stored in `localStorage` inside the Tauri webview. Any compromised script in the webview could read it. Moving to OS keychain (`tauri-plugin-stronghold` or platform-native APIs) is on the roadmap.
- **Endpoint override.** The `GITBAR_GITHUB_GRAPHQL_URL` env var is honored only in debug builds. Release builds hard-code `api.github.com` so a hostile environment cannot redirect PAT-bearing requests.
- **Content-Security-Policy.** Currently `null` in `tauri.conf.json` to allow Tailwind's runtime style injection and Vite HMR. Tightening this is a roadmap item.
- **Dependencies.** `npm audit` clean. `cargo audit` reports 17 advisories, all *unmaintained-crate notices* (not active CVEs) on transitive GTK bindings only used in Linux builds. None affect the macOS target.

Report security issues via [GitHub private vulnerability reporting](https://github.com/pravton/gitbar/security/advisories/new); do not open public issues for vulnerabilities. Full policy in [`SECURITY.md`](SECURITY.md).

## Roadmap

See [`ROADMAP.md`](ROADMAP.md) for tracked work and ideas.

## License

MIT, see [`LICENSE`](LICENSE).
