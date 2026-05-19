# Security

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting:** [github.com/pravton/gitbar/security/advisories/new](https://github.com/pravton/gitbar/security/advisories/new). It's the canonical path — the report goes directly to the maintainer, stays private until a fix is published, and is the route I monitor.

Do not open a public issue for a security report.

Acknowledgment target: within 72 hours. Fix or mitigation target: within two weeks for confirmed issues. If the issue is exploitable in a current release, expect a coordinated disclosure timeline.

## Known limitations

These are documented trade-offs, not vulnerabilities I can fix without breaking changes. They're tracked in [`ROADMAP.md`](ROADMAP.md).

### PAT in `localStorage`

The GitHub Personal Access Token is stored in the Tauri webview's `localStorage`. Any compromised script running in the webview (a Tailwind plugin, a malicious dep, a future XSS bug) could read it. The token is passed to every Rust `invoke()` call.

Migrating to the OS keychain (or in-process Rust memory with a `set_token` command flow) is on the roadmap.

### No Content-Security-Policy

`tauri.conf.json` sets `csp: null`. A tight CSP is desirable but conflicts with Tailwind v4's runtime style injection and Vite HMR. Tightening this requires moving Tailwind to a build-time-only pipeline or finding a way to pin its inserted stylesheets.

### Dependency audits

`npm audit` is clean at the time of writing. `cargo audit` reports 17 RustSec advisories, all *unmaintained-crate notices* on `gtk-*` / `proc-macro-error` / `unic-char-*` transitive deps. None are exploitable on the supported macOS target, but if you build for Linux they apply.

Re-run before each release:

```sh
npm audit --omit=dev
cargo audit --manifest-path src-tauri/Cargo.toml
```

## Endpoint pinning

The Rust client reads `GITBAR_GITHUB_GRAPHQL_URL` only when `#[cfg(debug_assertions)]` is true. Release builds hard-code `https://api.github.com/graphql` so a hostile environment cannot redirect PAT-bearing requests.

Tests rely on this override + a process-wide mutex (`client::test_endpoint::EndpointGuard`) to serialize endpoint manipulation without `--test-threads=1`.
