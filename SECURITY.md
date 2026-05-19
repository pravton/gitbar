# Security

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting:** [github.com/pravton/gitbar/security/advisories/new](https://github.com/pravton/gitbar/security/advisories/new). It's the canonical path — the report goes directly to the maintainer, stays private until a fix is published, and is the route I monitor.

Do not open a public issue for a security report.

Acknowledgment target: within 72 hours. Fix or mitigation target: within two weeks for confirmed issues. If the issue is exploitable in a current release, expect a coordinated disclosure timeline.

## Known limitations

These are documented trade-offs, not vulnerabilities I can fix without breaking changes. They're tracked in [`ROADMAP.md`](ROADMAP.md).

### PAT storage

The GitHub Personal Access Token is stored in the **OS keychain** (macOS Keychain Services, Windows Credential Manager, Linux Secret Service) via the `keyring` crate. Encrypted at rest, scoped to the logged-in user, never visible to the Tauri webview.

The frontend never holds the token after onboarding — `useGitHubAuth` tracks only an `isAuthenticated` boolean. Data-fetch commands (`get_data`, `refresh_cache`) take no `token` parameter; Rust reads the token from its in-memory mirror (populated from the keychain at startup) on each call.

This eliminates the *steady-state* attack surface for the stored token: a webview compromise (XSS, malicious npm dep, etc.) can no longer dump it from `localStorage` or scrape it from IPC payloads, because neither contains it anymore. A token that was already saved and is in routine use cannot be exfiltrated by webview-side code.

The token is still exposed to the webview during the onboarding and "Replace token" flows — it lives in the `<input>` element while you type or paste, and is passed to Rust via `check_auth(token)` and `save_token(token)` before being discarded. Code running in the webview at that exact moment (e.g. a malicious dep loaded for a few seconds during entry) could still capture it. The keychain design doesn't remove that risk; it just constrains the window in which the token is JS-reachable to "while the user is actively entering it" instead of "for the lifetime of the install".

#### Migration from pre-v0.2 (`localStorage`)

Earlier versions stored the PAT in `localStorage` under `gitbar.githubToken`. On first launch of a version with the keychain backend, the frontend silently lifts that value into the OS keychain and removes the legacy entry. If the migration `save_token` call fails (e.g. keychain unavailable), the legacy entry is preserved so the next launch can retry rather than losing the token.

### No Content-Security-Policy

`tauri.conf.json` sets `csp: null`. A tight CSP is desirable but conflicts with Tailwind v4's runtime style injection and Vite HMR. Tightening this requires moving Tailwind to a build-time-only pipeline or finding a way to pin its inserted stylesheets.

### Dependency audits

`npm audit` is clean at the time of writing. `cargo audit` reports 17 RustSec advisories, all *unmaintained-crate notices* on transitive deps that come through Tauri: `gtk-*`, `glib`, `proc-macro-error`, `unic-*`. None are exploitable on the supported macOS target, but if you build for Linux they apply. CI ignores the full list explicitly so a green audit job means "no NEW vulnerabilities", not "no advisories at all".

Re-run before each release:

```sh
npm audit --omit=dev
cargo audit --manifest-path src-tauri/Cargo.toml
```

## Endpoint pinning

The Rust client reads `GITBAR_GITHUB_GRAPHQL_URL` only when `#[cfg(debug_assertions)]` is true. Release builds hard-code `https://api.github.com/graphql` so a hostile environment cannot redirect PAT-bearing requests.

Tests rely on this override + a process-wide mutex (`client::test_endpoint::EndpointGuard`) to serialize endpoint manipulation without `--test-threads=1`.
