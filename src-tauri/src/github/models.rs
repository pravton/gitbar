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
    pub ci_status: Option<String>,
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

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Issue {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub created_at: String,
    pub repository: Repo,
    pub labels: Vec<Label>,
    pub state: String,
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
            ci_status: Some("SUCCESS".into()),
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
  "ci_status": "SUCCESS",
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
  "state": "OPEN"
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
