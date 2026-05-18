# Brief: GitBar Phase 2 — Audit, Refactor, Tests

**Started:** 2026-05-18  
**Task slug:** `gitbar-p2-audit-refactor`

## Problem statement (from user)

> "It randomly fails when showing issues and PRs. There are a lot of UI issues which make it impossible to use."

The user wants a full audit, architectural cleanup, and a real test suite so the app is robust + scalable + usable.

## Audit — root causes of the "random failures"

Findings are ordered by how directly they explain the reported symptom.

### P0 — explains the "randomly empty / random failures" symptom

1. **Fan-out fetches on mount → 4+ concurrent GitHub round-trips that race.**  
   `usePRs` + `useIssues` each `refetch()` on mount. React `StrictMode` (enabled in `src/main.tsx`) double-fires every effect in dev. Each `invoke("get_prs")` / `invoke("get_issues")` call independently triggers `refresh_if_needed` in Rust, which in turn fetches **both** PRs *and* issues. So a single mount can fire 4× full PR+issue fetches at GitHub. They race to write `cache.update(...)`; the first request to win is overwritten by later ones, so the displayed list depends on whichever response landed last.

2. **`client::fetch_issues` silently swallows errors.**  
   On any failure (network, 401, 403 rate-limit, 5xx) it logs to stderr and returns `Ok(Vec::new())`. The UI shows "No issues assigned" — indistinguishable from a real empty state.

3. **`client::fetch_prs` silently drops half the result set if one of the two sub-queries fails.**  
   It runs `PR_AUTHOR_QUERY` + `PR_REVIEW_QUERY`; on a per-query error it `eprintln!`s and continues. If only the review query fails, the user just doesn't see review-requested PRs that day, with no UI signal.

4. **No network timeout on `reqwest::Client::new()`.**  
   A hung GitHub connection blocks the request indefinitely. The frontend shows a permanent spinner.

5. **No abort / cancellation on hook unmount or token change.**  
   If the user changes their PAT mid-fetch, a stale in-flight `invoke` can resolve after the new one and overwrite fresh data with stale data ("last write wins" instead of "newest data wins").

6. **No 401 handling.**  
   If GitHub revokes the PAT, `get_prs` returns a generic error string; the user sees a red banner but isn't pushed back to onboarding. Then `get_issues` fails the same way. Looks like "the app is broken" rather than "your token expired."

7. **Cache TTL (60s) equals frontend poll (60s) — race.**  
   The 60s React poll often fires a hair before the Rust TTL has elapsed, so every other poll returns stale cached data and the UI feels like it's stuck.

### P1 — UX / architecture issues

8. **Token in `localStorage`, sent on every `invoke()` call.**  
   Webview-readable secret. Should live in Rust process memory after `check_auth`, with commands taking no token argument.

9. **Two commands (`get_prs`, `get_issues`) when there should be one.**  
   The cache is updated atomically; the public API should reflect that with one `get_data` returning both, halving invoke noise and removing the race in #1 entirely.

10. **"X" button in header calls `appWindow.close()`** — on macOS that quits the app. The icon and the action don't match user intent (should hide-to-tray; quitting is what the tray menu's Quit is for).

11. **`useWindowPersistence` writes on every `onMoved`/`onResized` event.**  
    No debounce → many `localStorage.setItem` calls per drag. Cheap but wasteful and noisy under DevTools.

12. **`useWindowPersistence` restore is gated by a 150ms `setTimeout`.**  
    If the user drags the window in those 150ms, the saved-state restore clobbers it.

13. **Error UI is one generic red banner.**  
    "Network unreachable", "Token invalid", "Rate limited", and "GitHub 5xx" should look different and have different CTAs.

14. **`get_stats` and the rain-level bucket are dead code on the frontend.**  
    The header re-derives rain from `prCount + issueCount` locally. Either delete `get_stats` or wire it up.

15. **Collapse path uses a double `requestAnimationFrame` workaround in `App.tsx::toggleCollapsed`.**  
    Works but is fragile against future renders. Should be a single layout-driven path.

16. **Phase 1 delivery note references `localStorage` keys `gitbar-window-width` / `gitbar-window-height`** but the code only uses `gitbar.windowState`. Drift between docs and code.

### P2 — robustness gaps

17. **No persisted disk cache.** Cold start with no network shows an empty UI instead of last-known-good data.
18. **No rate-limit handling.** GitHub's `X-RateLimit-Remaining` / `Retry-After` headers are ignored.
19. **Hard-coded `first: 100`** in GraphQL search. Anyone with >100 open items silently loses the tail.
20. **Zero automated tests** — frontend, hooks, or Rust.
21. **`src-tauri/gen/` is untracked but not in `.gitignore`** — every status check noises it up.

## Plan

Sequenced so each step lands behind a green build + tests.

### Step 1 — repo housekeeping
- Add `src-tauri/gen/` to `.gitignore`.
- Update `IN_PROGRESS.md`.

### Step 2 — test scaffolding
- **Frontend:** Vitest + jsdom + `@testing-library/react` + `@testing-library/jest-dom`. Mock `@tauri-apps/api` in setup.
- **Rust:** `cargo test` already works; add a `[dev-dependencies]` block with `tokio-test`. Use `httpmock` (or `wiremock`) for GitHub GraphQL mocking.
- Wire `npm test` + `npm run test:rust` into `package.json`.

### Step 3 — P0 fixes (with tests proving each)
- **F1.** Single-flight `refresh_if_needed`: use `tokio::sync::Mutex` + an `Option<Notify>` so concurrent callers await the same in-flight refresh.
- **F2.** Surface real errors from `fetch_issues` / `fetch_prs`. Return `Err(...)` on full failure; if at least one PR sub-query succeeded, log the partial failure but include it in the response payload for UI to show a warning.
- **F3.** `reqwest::Client` configured with a 10s connect + 30s overall timeout; built once in `AppState`, not per-request.
- **F4.** Hook abort: track a "request generation" id; ignore responses from an outdated generation in the `setPrs`/`setIssues` callback.
- **F5.** Distinguish 401 in the GraphQL client; surface a typed `AuthError`. Frontend listens for it via the existing `error` channel and routes the user back to onboarding.
- **F6.** Drop cache TTL to 30s while frontend poll stays at 60s so a poll always finds stale data and refetches.

### Step 4 — architecture cleanup
- **A1.** Consolidate `get_prs` + `get_issues` into `get_data { prs, issues }`. Keep `refresh_cache` as the explicit-bust command.
- **A2.** Stop passing `token` on each `invoke()`. After `check_auth` succeeds, store it in `AppState` (in-process only — no disk yet); `set_token`/`clear_token` commands manage it. Frontend keeps localStorage *only* for "have we onboarded" UX; the actual PAT lives in Rust.
- **A3.** Header "X" → hide-to-tray (rename + remove `close()`). Quit moves to the tray menu only.
- **A4.** Debounce `useWindowPersistence` writes (200ms trailing).

### Step 5 — UI/UX polish
- Typed error states (auth, rate-limit, network, generic) with distinct presentation.
- Loading skeleton for first paint instead of "Loading GitHub items...".
- Remove dead `get_stats` command (or wire it up if we keep rain bucketing server-side; cheaper to just delete).

### Step 6 — broader tests
- Utils: `cn`, `timeAgo`, `truncate`.
- Hooks: `usePRs`, `useIssues`, `useGitHubAuth` against the mocked Tauri layer.
- Components: `Header` rain bucket, `PRCard` tone derivation, `Onboarding` submit guard, `Settings` mask + clear flow.
- Rust unit: `Cache::is_stale`, `From<PullRequestNode>`, `From<IssueNode>` (with null author / null status check rollup / empty labels).
- Rust integration: mocked GitHub GraphQL endpoint, single-flight coalescing, 401 propagation.

### Step 7 — robustness (stretch)
- Disk cache (`tauri-plugin-store`) for last-good response.
- Read `X-RateLimit-*` headers; surface "rate limited, retry at HH:MM".
- Paginate beyond 100.

## Out of scope (this task)
- New features (notifications, repo filtering, multi-account).
- Keychain-backed secret storage. (P1 for a follow-up — in-process is a strict improvement on `localStorage`.)
- Cross-platform packaging beyond macOS.

## Definition of done
- `npm run build` green.
- `npm test` + `cargo test` green.
- Manual macOS smoke: onboarding → list loads → revoke PAT in GitHub → app surfaces auth error and offers re-onboard → reconnect → list reloads.
- `IN_PROGRESS.md` + `artifacts/gitbar-p2-audit-refactor/delivery.md` updated.
