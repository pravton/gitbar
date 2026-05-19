# AGENTS.md — GitBar

Conventions for AI agents (Claude Code, Codex, anything else) working on this repo.

## Read first

- [`CLAUDE.md`](CLAUDE.md) — commands, architecture, conventions.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — branch + commit format, test gates.
- [`IN_PROGRESS.md`](IN_PROGRESS.md) — what's mid-flight. Read at session start.

## Delivery protocol

For non-trivial work (anything beyond a small fix):

1. Read `IN_PROGRESS.md` to know what's in flight.
2. Write `artifacts/<task-slug>/brief.md` before starting.
3. Write `artifacts/<task-slug>/delivery.md` on completion.
4. Update `IN_PROGRESS.md`.

Skip for typo fixes, doc tweaks, and dependency bumps.

## Tech stack constraints

- Tauri 2 (Rust backend), React 18 + TypeScript strict (frontend), Tailwind v4.
- Node `^20.19.0` or `>=22.12.0` (Vite 8 minimum, enforced via `engines` in `package.json`); Rust stable.
- macOS-first. Linux/Windows builds are not currently supported.

## Hard rules

- Don't commit `node_modules/`, `src-tauri/target/`, `src-tauri/gen/`, or `.env*`.
- Run `npm run build` + `npm test` + `npm run test:rust` before committing. All three must pass.
- Use `cn()` from `src/lib/utils.ts` for class composition. Don't import `clsx` or roll a helper.
- Use `pickReadableTextColor()` from `src/lib/contrast.ts` for any text on a dynamic background (GitHub label colors, user-themed colors).
- No em dashes (U+2014) in any output. Use periods, commas, colons, parentheses, or rewrite.
- Branch names describe the change. `claude/<adjective-surname-hex>` and similar generated names are not acceptable — rename to `<type>/<slug>` before any commit.

## PR body convention: deploy / preview / local URLs

GitBar parses one line out of the PR body and renders it as a click-through "Deploy" button on the PR card.

When opening a PR for a change that exposes a runnable URL (Tailscale tunnel, ngrok, internal staging, preview deploy, LAN dev server), add one line to the body. Either form works; the HTML comment wins if both are present.

Visible trailer:

    Deploy: https://my-preview.example.com

Other accepted labels (case-insensitive): `Deploy-Link:`, `Preview:`, `Local-Deploy:`, `Local:`.

Invisible HTML comment:

    <!-- gitbar:deploy=https://my-preview.example.com -->

Rules:

- URL must start with `http://` or `https://`.
- First matching line wins.
- Markdown decoration (`**Deploy:**`, leading `>`/`-`/`#`) is tolerated.
- The body marker takes precedence over GitHub's deployments API URL.

Skip when there's no meaningful URL to surface (pure refactors, doc-only PRs, internal-tooling changes). Pick the single most useful URL if the change has many.

## When in doubt

Ask in the conversation. Never invent a convention.
