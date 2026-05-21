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

### Content-Security-Policy

`tauri.conf.json` sets distinct policies for `csp` (release) and `devCsp` (dev). The release policy is:

```
default-src 'self';
img-src 'self' data:;
style-src 'self' 'unsafe-inline';
script-src 'self';
connect-src 'self' ipc: http://ipc.localhost;
font-src 'self';
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
```

What's strict:

- `script-src 'self'` — only bundled scripts run. An attacker who manages to inject `<script>...</script>` into the DOM has no way to execute it. This is the load-bearing line for the "compromise-can-still-exfiltrate-PAT-during-onboarding" concern from earlier in this doc.
- `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` — block plugin embeds, base-tag URL rewrites, and iframe embedding of GitBar.
- `connect-src` is limited to the Tauri IPC bridge — no outbound HTTP from JS to anywhere. GitHub API calls go through Rust, which has the PAT; the webview never makes them directly.

What we trade off:

- `style-src 'unsafe-inline'` — required for Tailwind v4's runtime style injection and for React's inline `style={...}` attributes (the issue-label background colors). An attacker who could inject styles could mount visual confusion attacks (overlay an invisible click target) but cannot exfiltrate data through styles alone. The script restriction is the more important line.

The `devCsp` permits `'unsafe-inline'` + `'unsafe-eval'` in `script-src` and adds the Vite HMR WebSocket / HTTP origin to `connect-src`. Dev mode is the developer's machine, so the relaxation is acceptable; `cfg(debug_assertions)` already gates other dev-only conveniences.

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
