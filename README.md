# GitBar

An always-on-top, frameless desktop panel that tracks your open GitHub pull requests and assigned issues. Built with Tauri 2 and React. Designed to live in a corner of your screen so you can glance at your queue without context-switching to a browser tab.

## Status

- **Platform:** macOS only (universal binary via DMG). Linux/Windows builds have not been tested.
- **Auth:** GitHub Personal Access Token, stored in the OS keychain (macOS Keychain Services / Windows Credential Manager / Linux Secret Service) via the `keyring` crate. The token never crosses the JS→Rust IPC after onboarding.
- **Data:** PRs (`is:pr is:open author:@me` plus `is:pr is:open review-requested:@me`, deduped) and issues (`is:issue is:open assignee:@me`) fetched from GitHub's GraphQL API. Polled every 60 seconds. Backed by an in-memory cache with a 30 second TTL.

## Install

### From release

Pre-built DMGs ship under [Releases](https://github.com/pravton/gitbar/releases). Download, drag to Applications, launch.

**First-launch Gatekeeper warning.** The DMG is signed with a minisign key (for the in-app auto-update path) but is not Apple-Developer-ID code-signed or notarized yet, so macOS will show *"GitBar can't be opened because Apple cannot check it for malicious software"* the first time you launch. The workaround is a one-time approval:

1. In `/Applications`, right-click (or Control-click) `GitBar.app` and choose **Open**.
2. In the dialog that appears, click **Open** again.
3. Future launches work normally from Spotlight, the Dock, or Finder.

Apple-Developer-ID signing is on the roadmap for a future release. Until then, the right-click-Open dance is the cost of running a small OSS macOS app.

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

### Keyboard shortcuts

The list is fully keyboard-driven:

| Key | Action |
|---|---|
| `↓` / `↑` (or `j` / `k`) | Move selection between cards, wraps at the ends |
| `Enter` | Open the selected PR or issue in your browser |
| `D` | Open the selected PR's deploy URL (if it has one) |
| `Cmd+1` / `Cmd+2` | Switch to the PRs / Issues tab |
| `/` | Open the filter popover |
| `R` | Refresh data now |
| `S` | Open settings |
| `?` | Show the in-app keyboard-shortcut cheat sheet |
| `Esc` | Close the help / filter popover, or clear the selection (in that order) |

Press `?` in-app, or click the `?` button in the header, to see this list as a modal. Keys that would otherwise be hotkeys (digits, letters, `/`, `?`) are swallowed by any input you're typing in, so the filter popover's text fields work normally.

## Architecture

Frontend (React + TypeScript + Tailwind v4) calls Rust commands via `@tauri-apps/api` `invoke()`. Rust calls GitHub's GraphQL API directly. The PAT is held in the OS keychain and in Rust process memory only; it never crosses the JS to Rust IPC after onboarding. Six commands are exposed:

- `check_auth(token)`: validates a candidate PAT. The only data-path command that takes a token; called from onboarding before `save_token`.
- `save_token(token)`: persists a validated token to the keychain plus in-memory cache.
- `clear_token()`: removes the token from the keychain plus cache, and clears the PR/issue snapshot (scoped to the old identity).
- `has_token()`: boolean. Frontend uses this on mount to decide between onboarding and the list view.
- `get_data()`: returns `{ prs, issues, partial_message, last_fetched_at_ms }`, refreshing if the cache is older than 30 seconds. Reads the token from Rust state; takes no parameter.
- `refresh_cache()`: forces a refresh and returns the same shape. Used by the manual refresh button.

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
npm run install:local      # build + replace /Applications/GitBar.app (see below)
```

### Auto-update

GitBar checks for a newer signed build on startup via `tauri-plugin-updater`. When one is available, a thin strip appears between the header and the list with a `Restart to install` button. The download + install + relaunch is one click. Updates are signed with a minisign keypair; the public key lives in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey` and the corresponding private key is held in the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret. Releases without a valid signature are rejected by the client.

For maintainers cutting a release:
1. Make sure `TAURI_SIGNING_PRIVATE_KEY` is set as a repository secret (one-time).
2. Bump `version` in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
3. Tag and push (`git tag vX.Y.Z && git push origin vX.Y.Z`). The `release.yml` workflow builds a universal DMG, signs the `.app.tar.gz`, generates `latest.json`, and uploads everything to a draft GitHub release.
4. Publish the draft. The updater endpoint resolves `latest.json` via the `/releases/latest/download/` redirect, so only published, non-prerelease tags are seen by users.

Rotating the signing key (only do this if the old private key is compromised; it forces every existing install to be reinstalled manually):

```sh
npx tauri signer generate -p "" -w .secrets/tauri-updater.key --ci -f
# Update plugins.updater.pubkey in src-tauri/tauri.conf.json with the
# contents of .secrets/tauri-updater.key.pub, then push the new private
# key to the TAURI_SIGNING_PRIVATE_KEY repo secret.
```

### Updating your installed copy after a change

`npm run install:local` rebuilds and atomically swaps `/Applications/GitBar.app` so the version you launch from Spotlight/Dock matches your current checkout. It also quits the running app, strips macOS quarantine, and relaunches. Cold build is 3-8 minutes; warm cache is ~30 seconds. Use this when you want to test against the production-style binary instead of `npm run tauri dev`.

The pre-commit hook runs `tsc --noEmit` and `cargo check` only on the relevant file types (~2-3s) and is the per-commit gate. CI (`.github/workflows/ci.yml`) is deliberately sparse: it only runs on `push` to `main` (post-merge) and skips doc-only commits — it's the integration-branch health check, not a per-PR gate. CI can also be triggered manually from the Actions tab via `workflow_dispatch`. Releases (`.github/workflows/release.yml`) build a universal macOS DMG when a `v*` tag is pushed.

Tests run at default parallelism — no `--test-threads=1` needed. The Rust GraphQL endpoint is overridable in debug builds via `GITBAR_GITHUB_GRAPHQL_URL` for `wiremock`-based tests; the override is gated behind `cfg(debug_assertions)` so release builds always target `api.github.com`.

Branch conventions and commit style are in [`CLAUDE.md`](CLAUDE.md). Contribution guidelines: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Security

- **PAT storage.** Stored in the OS keychain (`keyring` crate). The webview never receives or holds the token after onboarding; data-fetch commands take no `token` parameter. Earlier versions stored it in `localStorage`; first launch of v0.2+ migrates that value into the keychain silently and removes the legacy entry. Details in [`SECURITY.md`](SECURITY.md).
- **Endpoint override.** The `GITBAR_GITHUB_GRAPHQL_URL` env var is honored only in debug builds. Release builds hard-code `api.github.com` so a hostile environment cannot redirect PAT-bearing requests.
- **Content-Security-Policy.** Distinct policies for release (`csp`) and dev (`devCsp`) in `tauri.conf.json`. Release locks `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`; only `style-src 'unsafe-inline'` is permitted (Tailwind v4's runtime style injection requires it). The Vite HMR WebSocket and `'unsafe-eval'` are dev-only. See [`SECURITY.md`](SECURITY.md).
- **Dependencies.** `npm audit` clean. `cargo audit` reports 17 advisories, all *unmaintained-crate notices* (not active CVEs) on transitive deps pulled in by Tauri (`gtk-*`, `glib`, `proc-macro-error`, `unic-*`). None affect the macOS target. CI ignores them explicitly so the audit job stays meaningful for new findings.

Report security issues via [GitHub private vulnerability reporting](https://github.com/pravton/gitbar/security/advisories/new); do not open public issues for vulnerabilities. Full policy in [`SECURITY.md`](SECURITY.md).

## Roadmap

See [`ROADMAP.md`](ROADMAP.md) for tracked work and ideas.

## License

MIT, see [`LICENSE`](LICENSE).
