# AGENTS.md — GitBar

## Delivery Protocol
Read `IN_PROGRESS.md` on session start. Read `artifacts/<task-slug>/brief.md` before work.
Write `artifacts/<task-slug>/delivery.md` on completion. Update `IN_PROGRESS.md`.

## Tech Stack
- Tauri v2 (Rust backend)
- React + TypeScript (frontend)
- Tailwind CSS v4
- Node.js ≥22

## Rules
- Never commit `node_modules/`, `target/`, or `.env`
- Run `npm run build` before committing
- Use `cn()` from lib/utils — not local helpers

## PR body convention: deploy / preview / local URLs

GitBar parses the PR body for a deploy URL and surfaces it as a click-through "Deploy" button on the card. Any of these formats works; **the HTML comment form wins if both are present**.

Visible trailer (humans can also click it on github.com):

    Deploy: https://my-preview.example.com

Other accepted labels (case-insensitive): `Deploy-Link:`, `Preview:`, `Local-Deploy:`, `Local:`.

Invisible HTML comment (no clutter in the PR description):

    <!-- gitbar:deploy=https://my-preview.example.com -->

Rules:
- The URL must start with `http://` or `https://`.
- The first matching line wins.
- Markdown decoration (`**Deploy:**`, leading `>`/`-`/`#`) is tolerated.
- The body-marker URL takes precedence over GitHub's deployments API URL, so an explicit local link wins over an auto-generated preview deploy.

For agents opening PRs (the pre-PR hook): if the change has a local dev URL worth surfacing (Tailscale tunnel, ngrok, internal staging box), add one line of either form to the PR body before opening.
