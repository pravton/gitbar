# Delivery: GitBar Phase 2 — Audit, Refactor, Tests (first cut)

**Date:** 2026-05-18  
**Task slug:** `gitbar-p2-audit-refactor`  
**Branch:** `fix/vite-localhost-binding` (unrelated name, kept from previous work — see notes)

## Scope of this cut

Brief is in `brief.md`. This commit covers Step 1 (housekeeping), Step 2 (test scaffolding), and the P0 reliability fixes from Step 3, plus the architecture cleanup pieces that gate the P0 fixes (`A1`, `A3`). Steps remaining for future commits are listed at the bottom.

## What changed

### Reliability — root causes of the "random failures"

- **Single-flight refresh.** `AppState::refresh_if_needed` now serializes concurrent stale callers behind a `tokio::sync::Mutex`. The four parallel fetches that React StrictMode + dual hooks used to fire on mount now collapse to exactly one GitHub round-trip. Test: `tests::refresh_if_needed_coalesces_concurrent_callers` runs four concurrent callers and asserts exactly 3 HTTP requests (= 1 refresh's worth: 2 PR sub-queries + 1 issues query).
- **Typed `GitHubError`** (`github::models::GitHubError`) — tagged enum with `auth | rate_limited | network | server | partial` variants. Replaces `Result<T, String>`. Tauri serializes it directly, frontend mirrors it in `src/types.ts`.
- **Errors no longer silently swallowed.** `client::fetch_issues` used to return `Ok(Vec::new())` on any failure; it now returns a typed `Err`. `client::fetch_prs` distinguishes "both queries failed" (error) from "one succeeded" (partial result + `partial_message` warning in the cache).
- **`reqwest::Client` built once** in `AppState::new()`, with `connect_timeout(10s) + timeout(30s)`. No more hung GitHub call wedging the cache.
- **401 / 403 / rate-limit handling.** GraphQL response inspection distinguishes 401 (auth), 403 + `X-RateLimit-Remaining: 0` (rate limited, with `Retry-After`), and 403 lacking that header (auth/scope issue).
- **Hook abort.** `useGitHubData` uses a generation counter; if the token changes or the hook unmounts while a fetch is in flight, the stale response is dropped instead of overwriting fresh data. Test: `useGitHubData > drops stale responses when the token changes mid-flight`.
- **Auth-error reroute.** When `useGitHubData` surfaces a `kind: "auth"` error, `App.tsx` calls `auth.clearToken()` and the user lands on `Onboarding` instead of staring at an empty list.
- **Cache TTL dropped from 60s → 30s.** Avoids the boundary race where the React 60s poll fires a hair before Rust thinks the cache has expired.

### Architecture cleanup

- **Single command** — `get_data` returns `{ prs, issues, partial_message }` from one `invoke`. The old `get_prs` + `get_issues` are gone, so polling halves and the on-mount race no longer exists at the API level. `refresh_cache` is kept for explicit-bust.
- **Dead code removed.** `get_stats` + the `Stats` struct + the `rain_level` server computation are gone; rain bucketing is local to `Header.tsx`.
- **Header X-button** no longer quits the app. `Minus` → minimize, `X` → hide-to-tray. Quit lives in the tray menu only.

### Test infrastructure

- **Frontend**: Vitest + jsdom + `@testing-library/react` + `@testing-library/user-event`. Setup in `src/test/setup.ts` mocks `@tauri-apps/api/core`, `@tauri-apps/api/window`, `@tauri-apps/api/dpi`, and `@tauri-apps/plugin-shell` so component + hook tests don't need a running Tauri shell. Coverage via `@vitest/coverage-v8`.
- **Rust**: `wiremock` as `[dev-dependencies]`. The GraphQL endpoint is now overridable via the `GITBAR_GITHUB_GRAPHQL_URL` env var, which `wiremock::MockServer` exploits. Tests are colocated in `#[cfg(test)] mod tests` blocks within `cache.rs`, `github/client.rs`, and `lib.rs`. Must run with `--test-threads=1` (env var is per-process), wired into `npm run test:rust`.
- **Scripts**: `npm test`, `npm run test:watch`, `npm run test:coverage`, `npm run test:rust`.
- **Tests written this commit (47 total):**
  - `src/lib/utils.test.ts` — 13 cases (`cn`, `timeAgo`, `truncate`).
  - `src/hooks/useGitHubData.test.tsx` — 6 cases (no-token short-circuit, single fetch on mount, typed error surfacing, stale-response drop on token change, `forceRefresh` routing, non-typed error normalization).
  - `src/components/ListView.test.tsx` — 7 cases (empty state, loading, error banner with auth heading, rate-limit retry display, partial warning, error suppresses warning, tab switching).
  - `src/components/Onboarding.test.tsx` — 4 cases (disabled-while-empty, submit calls `onConnect`, error display, checking state).
  - `src/components/PRCard.test.tsx` — 5 cases (CI labels for each status, click-to-open via shell plugin).
  - `src-tauri/src/cache.rs` — 3 cases (`default_is_stale`, `update_marks_fresh`, `update_records_partial_message`).
  - `src-tauri/src/github/client.rs` — 6 cases (dedup + null author, partial on 5xx, auth on 401, rate-limit on 403 + zero remaining, issues 500 → typed error, empty token short-circuit).
  - `src-tauri/src/lib.rs` — 3 cases (4-way coalescing, fresh-cache skips network, force=true always refreshes).

### Housekeeping

- `src-tauri/gen/` added to `.gitignore` (was untracked-noise on every status).
- `coverage/` ignored too.
- `tsconfig.json` adds `vitest/globals` + `@testing-library/jest-dom` types.

## What didn't ship this cut (deferred to follow-up commits)

- **Move PAT off `localStorage` into Rust process memory** (brief step A2). Architecturally clean but a non-trivial change to the auth flow + commands; skipped here to keep this commit reviewable. Track as a follow-up.
- **Debounced `useWindowPersistence`** (brief step A4) and the `useLayoutEffect`-driven collapse path (brief step 15). UX-only, not part of the "random failures" symptom.
- **Disk-cached last-good response, paginate beyond 100, X-RateLimit-Remaining ramp-down UI.** All P2 in the brief.
- **Loading skeleton** instead of "Loading GitHub items...". Cosmetic.

## Verification

- `npm run build` → green.
- `npm test` → **35/35 frontend tests passing**.
- `npm run test:rust` → **12/12 Rust tests passing**.
- Manual smoke test on macOS still required — flagged the bullet-points to actually walk through on the user's machine:
  1. Cold start → onboarding screen.
  2. Paste valid PAT → list appears within ~1s, error banner stays hidden.
  3. Revoke PAT in GitHub UI → within 60s, app bounces back to onboarding with the `auth` error reason visible.
  4. Reconnect → list reloads.
  5. With network off, click refresh → `network` error banner (not silent empty list).

## Notes

- Branch name is `fix/vite-localhost-binding` from the prior task; this commit's work has nothing to do with that. Recommend opening this as a PR against `master` titled `refactor: P2 audit + reliability fixes + tests` so the branch name doesn't mislead reviewers. (Per project convention, the slug should describe the work — flagging rather than renaming unilaterally because the branch already has unrelated merged commits.)
- Brief has the full audit; this delivery only summarizes the cut that shipped.
