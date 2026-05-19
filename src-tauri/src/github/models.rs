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
