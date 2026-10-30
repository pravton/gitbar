use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GitHubError {
    Auth { message: String },
    RateLimited { message: String, retry_after_secs: Option<u64> },
    Network { message: String },
    Server { message: String },
    /// At least one underlying request succeeded; `message` describes which failed.
    Partial { message: String },
}

impl GitHubError {
    pub fn network(msg: impl Into<String>) -> Self {
        Self::Network { message: msg.into() }
    }
    pub fn server(msg: impl Into<String>) -> Self {
        Self::Server { message: msg.into() }
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::Auth { message: msg.into() }
    }
    pub fn rate_limited(msg: impl Into<String>, retry_after_secs: Option<u64>) -> Self {
        Self::RateLimited { message: msg.into(), retry_after_secs }
    }
}

impl std::fmt::Display for GitHubError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Auth { message } => write!(f, "auth: {message}"),
            Self::RateLimited { message, .. } => write!(f, "rate limited: {message}"),
            Self::Network { message } => write!(f, "network: {message}"),
            Self::Server { message } => write!(f, "server: {message}"),
            Self::Partial { message } => write!(f, "partial: {message}"),
        }
    }
}

impl std::error::Error for GitHubError {}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Repo {
    pub name_with_owner: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Author {
    pub login: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Label {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub created_at: String,
    pub repository: Repo,
    pub author: Author,
    pub is_draft: bool,
    pub review_decision: Option<String>,
    /// `true` when this PR surfaced from the `review-requested:@me`
    /// search (someone asked *this* user to review it), as opposed to
    /// only `author:@me`. Drives the header's "review" stat tile and
    /// `reviewRequestedOnly` filter. More reliable than inferring intent
    /// from `review_decision`, which GitHub leaves `null` unless the
    /// repo enforces a required review. `#[serde(default)]` so cache
    /// files written before this field existed hydrate as `false`.
    #[serde(default)]
    pub review_requested: bool,
    pub ci_status: Option<String>,
    /// Per-job breakdown behind `ci_status`, for the CI pill's "2/9
    /// failing" text. `None` when the latest commit has no checks.
    /// `#[serde(default)]` so cache files written before this field
    /// existed hydrate as `None`.
    #[serde(default)]
    pub ci_counts: Option<CiCounts>,
    pub additions: u64,
    pub deletions: u64,
    pub comments: u64,
    /// URL surfaced as a click-through "Deploy" link on the PR card.
    /// Source precedence:
    ///   1. Body marker parsed by [`crate::github::client::parse_deploy_link_from_body`]
    ///      (`Deploy:`/`Deploy-Link:`/`Preview:`/`Local-Deploy:`/`Local:` trailer or
    ///      `<!-- gitbar:deploy=URL -->` HTML comment).
    ///   2. The most recent deployment on the latest commit, via GitHub's
    ///      deployments API.
    /// `None` if neither source has a URL.
    pub deployment_url: Option<String>,
}

/// Check-run and status-context counts on a PR's latest commit, bucketed
/// from GitHub's `checkRunCountsByState` / `statusContextCountsByState`.
/// Jobs that are neither failing nor pending (success, neutral, skipped,
/// stale) count only towards `total`.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub struct CiCounts {
    pub failing: u64,
    pub pending: u64,
    pub total: u64,
}

/// One CI job's run on a PR's latest commit. Surfaced lazily on the
/// frontend when the user clicks the CI pill of a PR card, so we can
/// drill into "which job is red" without leaving the panel. Status and
/// conclusion are GitHub's raw enum strings (see GraphQL `CheckStatusState`
/// and `CheckConclusionState`); the frontend maps them to icons/colors.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct CheckRun {
    /// Job name (e.g. "build", "test").
    pub name: String,
    /// `QUEUED` | `IN_PROGRESS` | `COMPLETED` | `WAITING` | `PENDING` | `REQUESTED`.
    pub status: String,
    /// `SUCCESS` | `FAILURE` | `NEUTRAL` | `CANCELLED` | `SKIPPED` | `TIMED_OUT`
    /// | `ACTION_REQUIRED` | `STALE` | `STARTUP_FAILURE`. `None` when the run
    /// has not completed yet.
    pub conclusion: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    /// GitHub "Details" URL (clicking opens the job page).
    pub url: String,
    /// Parent workflow run's workflow name (e.g. "CI"). `None` if the run
    /// wasn't produced by GitHub Actions (e.g. a third-party check).
    pub workflow_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Issue {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub created_at: String,
    pub repository: Repo,
    pub labels: Vec<Label>,
    pub state: String,
    /// Conversation comment count. `#[serde(default)]` so cache files
    /// written before this field existed hydrate as 0.
    #[serde(default)]
    pub comments: u64,
}

/// One entry in a PR's or issue's comments panel: a conversation
/// comment, or a submitted PR review.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct CommentEntry {
    pub kind: CommentKind,
    pub author: Author,
    /// Raw markdown. The frontend renders it as plain text with links.
    pub body: String,
    pub created_at: String,
    pub url: String,
    /// Reviews only: `APPROVED` | `CHANGES_REQUESTED` | `COMMENTED` |
    /// `DISMISSED`.
    pub review_state: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CommentKind {
    Comment,
    Review,
}

/// Result of `get_item_comments`: entries oldest first, plus how many
/// older comments and reviews weren't fetched (shown as "N earlier on
/// GitHub").
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ItemComments {
    pub entries: Vec<CommentEntry>,
    pub omitted: u64,
}

/// One sample of the panel's three top-line counts at a moment in
/// time. Appended to a ring buffer on every successful refresh so
/// the frontend can render a 24-hour trend sparkline behind each
/// stat tile. Wall-clock milliseconds (since the Unix epoch) is
/// what the frontend wants for axis math, and it survives
/// serialization to disk cleanly.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct HistorySample {
    pub at_ms: u64,
    pub pr_count: u32,
    pub review_requested: u32,
    pub issue_count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct AuthCheck {
    pub ok: bool,
    pub login: Option<String>,
    pub message: Option<String>,
}

#[cfg(test)]
mod wire_format_snapshots {
    //! Pin the JSON wire format of every type that crosses the Tauri IPC
    //! boundary. If any of these tests fail, the serialized shape has
    //! changed — make sure `src/types.ts` is updated to match, then update
    //! the snapshot literal. This catches Rust-side serde drift before it
    //! becomes a runtime mismatch with the frontend.
    use super::*;

    fn json(v: &impl Serialize) -> String {
        serde_json::to_string_pretty(v).expect("serialize")
    }

    #[test]
    fn repo_wire_shape() {
        let value = Repo { name_with_owner: "anthropic/sdk".into() };
        let expected = r#"{
  "name_with_owner": "anthropic/sdk"
}"#;
        assert_eq!(json(&value), expected);
    }

    #[test]
    fn author_wire_shape() {
        let value = Author {
            login: "alice".into(),
            avatar_url: Some("https://x/a.png".into()),
        };
        let expected = r#"{
  "login": "alice",
  "avatar_url": "https://x/a.png"
}"#;
        assert_eq!(json(&value), expected);
    }

    #[test]
    fn label_wire_shape() {
        let value = Label { name: "bug".into(), color: "d73a49".into() };
        let expected = r#"{
  "name": "bug",
  "color": "d73a49"
}"#;
        assert_eq!(json(&value), expected);
    }

    #[test]
    fn pull_request_wire_shape() {
        let value = PullRequest {
            number: 7,
            title: "feat: thing".into(),
            url: "https://github.com/o/r/pull/7".into(),
            state: "OPEN".into(),
            created_at: "2026-05-19T00:00:00Z".into(),
            repository: Repo { name_with_owner: "o/r".into() },
            author: Author { login: "u".into(), avatar_url: None },
            is_draft: false,
            review_decision: Some("REVIEW_REQUIRED".into()),
            review_requested: true,
            ci_status: Some("FAILURE".into()),
            ci_counts: Some(CiCounts { failing: 2, pending: 1, total: 9 }),
            additions: 12,
            deletions: 3,
            comments: 4,
            deployment_url: Some("https://preview.example.com/7".into()),
        };
        let expected = r#"{
  "number": 7,
  "title": "feat: thing",
  "url": "https://github.com/o/r/pull/7",
  "state": "OPEN",
  "created_at": "2026-05-19T00:00:00Z",
  "repository": {
    "name_with_owner": "o/r"
  },
  "author": {
    "login": "u",
    "avatar_url": null
  },
  "is_draft": false,
  "review_decision": "REVIEW_REQUIRED",
  "review_requested": true,
  "ci_status": "FAILURE",
  "ci_counts": {
    "failing": 2,
    "pending": 1,
    "total": 9
  },
  "additions": 12,
  "deletions": 3,
  "comments": 4,
  "deployment_url": "https://preview.example.com/7"
}"#;
        assert_eq!(json(&value), expected);
    }

    #[test]
    fn issue_wire_shape() {
        let value = Issue {
            number: 11,
            title: "bug: oops".into(),
            url: "https://github.com/o/r/issues/11".into(),
            created_at: "2026-05-19T00:00:00Z".into(),
            repository: Repo { name_with_owner: "o/r".into() },
            labels: vec![Label { name: "bug".into(), color: "d73a49".into() }],
            state: "OPEN".into(),
            comments: 2,
        };
        let expected = r#"{
  "number": 11,
  "title": "bug: oops",
  "url": "https://github.com/o/r/issues/11",
  "created_at": "2026-05-19T00:00:00Z",
  "repository": {
    "name_with_owner": "o/r"
  },
  "labels": [
    {
      "name": "bug",
      "color": "d73a49"
    }
  ],
  "state": "OPEN",
  "comments": 2
}"#;
        assert_eq!(json(&value), expected);
    }

    #[test]
    fn item_comments_wire_shape() {
        let value = ItemComments {
            entries: vec![CommentEntry {
                kind: CommentKind::Review,
                author: Author { login: "r".into(), avatar_url: None },
                body: "lgtm".into(),
                created_at: "2026-05-19T00:00:00Z".into(),
                url: "https://github.com/o/r/pull/7#pullrequestreview-1".into(),
                review_state: Some("APPROVED".into()),
            }],
            omitted: 3,
        };
        let expected = r#"{
  "entries": [
    {
      "kind": "review",
      "author": {
        "login": "r",
        "avatar_url": null
      },
      "body": "lgtm",
      "created_at": "2026-05-19T00:00:00Z",
      "url": "https://github.com/o/r/pull/7#pullrequestreview-1",
      "review_state": "APPROVED"
    }
  ],
  "omitted": 3
}"#;
        assert_eq!(json(&value), expected);
    }

    #[test]
    fn auth_check_wire_shape() {
        let ok = AuthCheck {
            ok: true,
            login: Some("alice".into()),
            message: None,
        };
        let expected_ok = r#"{
  "ok": true,
  "login": "alice",
  "message": null
}"#;
        assert_eq!(json(&ok), expected_ok);

        let failed = AuthCheck {
            ok: false,
            login: None,
            message: Some("Bad credentials".into()),
        };
        let expected_failed = r#"{
  "ok": false,
  "login": null,
  "message": "Bad credentials"
}"#;
        assert_eq!(json(&failed), expected_failed);
    }

    #[test]
    fn github_error_wire_shape_auth() {
        let value = GitHubError::auth("bad token");
        let expected = r#"{
  "kind": "auth",
  "message": "bad token"
}"#;
        assert_eq!(json(&value), expected);
    }

    #[test]
    fn github_error_wire_shape_rate_limited_with_retry_after() {
        let value = GitHubError::rate_limited("slow down", Some(42));
        let expected = r#"{
  "kind": "rate_limited",
  "message": "slow down",
  "retry_after_secs": 42
}"#;
        assert_eq!(json(&value), expected);
    }

    #[test]
    fn github_error_wire_shape_rate_limited_without_retry_after() {
        let value = GitHubError::rate_limited("slow down", None);
        let expected = r#"{
  "kind": "rate_limited",
  "message": "slow down",
  "retry_after_secs": null
}"#;
        assert_eq!(json(&value), expected);
    }

    #[test]
    fn github_error_wire_shape_network() {
        let value = GitHubError::network("offline");
        let expected = r#"{
  "kind": "network",
  "message": "offline"
}"#;
        assert_eq!(json(&value), expected);
    }

    #[test]
    fn github_error_wire_shape_server() {
        let value = GitHubError::server("500");
        let expected = r#"{
  "kind": "server",
  "message": "500"
}"#;
        assert_eq!(json(&value), expected);
    }

    #[test]
    fn github_error_wire_shape_partial() {
        let value = GitHubError::Partial { message: "review failed".into() };
        let expected = r#"{
  "kind": "partial",
  "message": "review failed"
}"#;
        assert_eq!(json(&value), expected);
    }
}
