# Contributing

Thanks for considering a contribution.

## Getting started

```sh
git clone https://github.com/pravton/gitbar.git
cd gitbar
npm install
npm run tauri dev
```

Requirements: Node `^20.19.0` or `>=22.12.0`, Rust stable, macOS 13+ (for `color-mix()` / `:has()` in the webview). The Node range is enforced via `engines` in `package.json`.

After cloning, enable the repo's pre-commit hook (one time per clone):

```sh
git config core.hooksPath .githooks
```

The hook runs `tsc --noEmit` on TS/config changes and `cargo check` on Rust changes — fast (~2-3s combined). It can be bypassed in an emergency with `git commit --no-verify`; the full test suite still runs in CI on push.

## Before you commit

```sh
npm run build              # tsc + vite build
npm test                   # frontend (Vitest)
npm run test:rust          # backend (cargo test)
```

All three must pass — they're also the gate on CI. `npm run build` runs `tsc` in strict mode. `npm run typecheck` (used by the pre-commit hook) is the same `tsc --noEmit` without the bundle step.

## Branches and commits

- Branch names describe the change. Use one of `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `refactor/<slug>`, `docs/<slug>`, `test/<slug>`. Random/generated names (e.g. `claude/<adjective-surname-hex>`) are not accepted.
- Commits follow conventional-commit-ish format: `<type>: <subject>` with a body explaining *why*, not *what*. The diff already shows *what*.
- Don't use em dashes in commit messages or code. Use a period, comma, colon, parentheses, or rewrite. En dashes for numeric ranges are fine.

## Code style

- TypeScript: strict. Use `cn()` from `src/lib/utils.ts` for conditional class strings. Use `pickReadableTextColor()` from `src/lib/contrast.ts` for any text on a dynamic background.
- Default to writing no comments. Only add one when the *why* is non-obvious. Identifiers should explain *what*.
- Rust: standard `cargo fmt` formatting. Tests colocate as `#[cfg(test)] mod tests` inside the module they test.
- No new dependencies without justification. We're deliberately small.

## Architecture before PR

If you're adding more than a small feature, read [`CLAUDE.md`](CLAUDE.md) first. It documents the process boundary (frontend invoke → Rust GraphQL), the single-flight refresh, the typed error contract, and the conventions for the filter and deploy-link systems.

## Tests

- Frontend: Vitest + React Testing Library. Tauri APIs are mocked in `src/test/setup.ts`. A single file: `npm test -- src/path/to/file.test.ts`.
- Rust: `cargo test`. GraphQL is mocked with `wiremock`; the endpoint override (`GITBAR_GITHUB_GRAPHQL_URL`) is serialized via `client::test_endpoint::EndpointGuard`. A single test: `cargo test --manifest-path src-tauri/Cargo.toml test_name`.

Write a test that fails before your fix and passes after. For UI changes that the test suite can't cover (drag, window resize, native dialog), run `npm run tauri dev` and verify in the actual app.

## PR template

Title format: `<type>: <short description>`. The PR body should cover:

- **Summary**: 1-3 sentences on what changed and why.
- **Test plan**: a checklist of what you ran and what you verified manually.

If you opened a PR with a runnable URL (preview deploy, local tunnel), add a line so the maintainer's GitBar surfaces it:

```
Deploy: https://your-preview.example.com
```

## Security issues

Don't open a public issue. Use [GitHub private vulnerability reporting](https://github.com/pravton/gitbar/security/advisories/new) instead. See [`SECURITY.md`](SECURITY.md).
