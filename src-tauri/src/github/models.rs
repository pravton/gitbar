use serde::{Deserialize, Serialize};

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
pub struct Stats {
    pub total_prs: u32,
    pub total_issues: u32,
    pub rain_level: String,
    pub repos_with_prs: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct AuthCheck {
    pub ok: bool,
    pub login: Option<String>,
    pub message: Option<String>,
}
