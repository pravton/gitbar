export interface Repo {
  name_with_owner: string;
}

export interface Author {
  login: string;
  avatar_url: string | null;
}

export interface CiCounts {
  failing: number;
  pending: number;
  total: number;
}

export interface Label {
  name: string;
  color: string;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: string;
  created_at: string;
  repository: Repo;
  author: Author;
  is_draft: boolean;
  review_decision: string | null;
  /**
   * `true` when this PR came from the `review-requested:@me` search —
   * i.e. the viewer was actually asked to review it. Drives the header's
   * "review" stat tile and the `reviewRequestedOnly` filter. Mirrors the
   * Rust `review_requested` field (see `src-tauri/src/github/models.rs`).
   */
  review_requested: boolean;
  ci_status: string | null;
  /**
   * Per-job breakdown behind `ci_status`, driving the pill's "CI 2/9
   * failing" text. `null` when the latest commit has no checks. Mirrors
   * the Rust `CiCounts` (see `src-tauri/src/github/models.rs`).
   */
  ci_counts: CiCounts | null;
  additions: number;
  deletions: number;
  comments: number;
  /**
   * URL to surface on the "Deploy" button. Source precedence:
   *   1. PR body marker — `Deploy:`/`Deploy-Link:`/`Preview:`/`Local-Deploy:`/`Local:` line,
   *      or an `<!-- gitbar:deploy=URL -->` HTML comment. See AGENTS.md.
   *   2. Latest commit's most recent deployment `environmentUrl` (GitHub deployments API).
   * `null` when neither is available.
   */
  deployment_url: string | null;
}

/**
 * One CI job's run on a PR's latest commit. Fetched lazily by the
 * `get_pr_checks` Tauri command when the user clicks a PR card's CI pill
 * to drill into "which job is red." Mirrors `CheckRun` in
 * `src-tauri/src/github/models.rs`.
 */
export interface CheckRun {
  /** Job name (e.g. "build", "test"). */
  name: string;
  /** Raw GraphQL `CheckStatusState`: `QUEUED` | `IN_PROGRESS` | `COMPLETED` | `WAITING` | `PENDING` | `REQUESTED`. */
  status: string;
  /** Raw GraphQL `CheckConclusionState`: `SUCCESS` | `FAILURE` | `NEUTRAL` | `CANCELLED` | `SKIPPED` | `TIMED_OUT` | `ACTION_REQUIRED` | `STALE` | `STARTUP_FAILURE`. `null` while the run is in flight. */
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  /** GitHub "Details" URL: clicking opens the job log on github.com. */
  url: string;
  /** Parent workflow name (e.g. "CI"). `null` for non-Actions checks. */
  workflow_name: string | null;
}

export interface Issue {
  number: number;
  title: string;
  url: string;
  created_at: string;
  repository: Repo;
  labels: Label[];
  state: string;
  /** Conversation comment count. */
  comments: number;
}

/**
 * One entry in a card's comments panel: a conversation comment or a
 * submitted PR review. Mirrors the Rust `CommentEntry` in
 * `src-tauri/src/github/models.rs`.
 */
export interface CommentEntry {
  kind: "comment" | "review";
  author: Author;
  /** Raw markdown; rendered as plain text with clickable links. */
  body: string;
  created_at: string;
  url: string;
  /** Reviews only: APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED. */
  review_state: string | null;
}

/** One inline review thread on a PR. Mirrors the Rust `ReviewThread`. */
export interface ReviewThread {
  path: string;
  /** Current line, or the original one when outdated; null for file-level threads. */
  line: number | null;
  is_resolved: boolean;
  is_outdated: boolean;
  /** Oldest first; the first entry starts the thread. Never empty. */
  comments: CommentEntry[];
  /** Replies past the first 10 that weren't fetched. */
  omitted: number;
}

/**
 * Result of `get_item_comments`. `omitted` counts older entries not
 * fetched. PRs also carry inline review threads, unresolved first.
 */
export interface ItemComments {
  entries: CommentEntry[];
  omitted: number;
  threads: ReviewThread[];
  /** Older threads that weren't fetched. */
  threads_omitted: number;
}

export interface AuthCheck {
  ok: boolean;
  login: string | null;
  message: string | null;
}

/**
 * Outcome of a `useGitHubAuth` mutating action (`addAccount`, `removeAccount`,
 * `switchAccount`, `replaceActiveToken`). When `ok` is false, `error` carries
 * the surface message: callers should prefer this over the hook's stored
 * `authError`, which can lag a render behind because React state updates
 * are batched.
 */
export type AuthResult = { ok: true } | { ok: false; error: string };

/**
 * Mirrors Rust's `AccountsList` (`list_accounts` command's return type).
 * `accounts` is every known login, in add-order; `active` is which one
 * (if any) the app is currently fetching data as.
 */
export interface AccountsList {
  accounts: string[];
  active: string | null;
}

/**
 * One sample of the three top-line counts at a moment in time.
 * Appended by Rust on every successful refresh and surfaced as
 * the `history` field of `GitHubData`. Frontend uses this to
 * render trend sparklines behind each stat tile.
 */
export interface HistorySample {
  at_ms: number;
  pr_count: number;
  review_requested: number;
  issue_count: number;
}

export interface GitHubData {
  prs: PullRequest[];
  issues: Issue[];
  partial_message: string | null;
  /**
   * Wall-clock time of the underlying fetch, in milliseconds since the
   * Unix epoch. `null` when no fetch timestamp is available - typically
   * because no fetch has happened yet (empty cache on first launch), but
   * also possible if the persisted timestamp is unrepresentable as
   * non-negative ms (corrupted disk snapshot, clock pre-1970). Callers
   * should treat `null` as "unknown age" rather than "no data".
   */
  last_fetched_at_ms: number | null;
  /**
   * 24-hour ring buffer of sample counts, ordered oldest -> newest.
   * Empty on first launch; populated on each successful refresh.
   */
  history: HistorySample[];
}

export type GitHubError =
  | { kind: "auth"; message: string }
  | { kind: "rate_limited"; message: string; retry_after_secs: number | null }
  | { kind: "network"; message: string }
  | { kind: "server"; message: string }
  | { kind: "partial"; message: string };
