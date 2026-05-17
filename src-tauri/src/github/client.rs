use std::collections::HashMap;

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;

use crate::github::models::{AuthCheck, Author, Issue, Label, PullRequest, Repo};
use crate::github::queries::{
    ISSUE_ASSIGNED_QUERY, PR_AUTHOR_QUERY, PR_REVIEW_QUERY, SEARCH_ISSUES, SEARCH_PRS, VIEWER,
};

const GITHUB_GRAPHQL_URL: &str = "https://api.github.com/graphql";

#[derive(Debug, Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct SearchData<T> {
    search: SearchConnection<T>,
}

#[derive(Debug, Deserialize)]
struct SearchConnection<T> {
    edges: Vec<SearchEdge<T>>,
}

#[derive(Debug, Deserialize)]
struct SearchEdge<T> {
    node: Option<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestNode {
    number: u64,
    title: String,
    url: String,
    state: String,
    created_at: String,
    is_draft: bool,
    review_decision: Option<String>,
    additions: u64,
    deletions: u64,
    repository: RepoNode,
    author: Option<AuthorNode>,
    commits: CommitConnection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueNode {
    number: u64,
    title: String,
    url: String,
    state: String,
    created_at: String,
    repository: RepoNode,
    labels: LabelConnection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoNode {
    name_with_owner: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthorNode {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LabelConnection {
    nodes: Vec<Option<LabelNode>>,
}

#[derive(Debug, Deserialize)]
struct LabelNode {
    name: String,
    color: String,
}

#[derive(Debug, Deserialize)]
struct CommitConnection {
    nodes: Vec<Option<CommitNode>>,
}

#[derive(Debug, Deserialize)]
struct CommitNode {
    commit: Commit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Commit {
    status_check_rollup: Option<StatusCheckRollup>,
}

#[derive(Debug, Deserialize)]
struct StatusCheckRollup {
    state: String,
}

#[derive(Debug, Deserialize)]
struct ViewerData {
    viewer: Viewer,
}

#[derive(Debug, Deserialize)]
struct Viewer {
    login: String,
}

pub async fn fetch_prs(token: &str) -> Result<Vec<PullRequest>, String> {
    let mut by_url: HashMap<String, PullRequest> = HashMap::new();

    for query in [PR_AUTHOR_QUERY, PR_REVIEW_QUERY] {
        match search_prs(token, query).await {
            Ok(prs) => {
                for pr in prs {
                    by_url.insert(pr.url.clone(), pr);
                }
            }
            Err(error) => {
                eprintln!("GitBar PR fetch failed for '{query}': {error}");
            }
        }
    }

    let mut prs: Vec<PullRequest> = by_url.into_values().collect();
    prs.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(prs)
}

pub async fn fetch_issues(token: &str) -> Result<Vec<Issue>, String> {
    match search_issues(token, ISSUE_ASSIGNED_QUERY).await {
        Ok(mut issues) => {
            issues.sort_by(|a, b| a.created_at.cmp(&b.created_at));
            Ok(issues)
        }
        Err(error) => {
            eprintln!("GitBar issue fetch failed: {error}");
            Ok(Vec::new())
        }
    }
}

pub async fn check_auth(token: &str) -> Result<AuthCheck, String> {
    match graphql::<ViewerData>(token, VIEWER, json!({})).await {
        Ok(data) => Ok(AuthCheck {
            ok: true,
            login: Some(data.viewer.login),
            message: None,
        }),
        Err(error) => Ok(AuthCheck {
            ok: false,
            login: None,
            message: Some(error),
        }),
    }
}

async fn search_prs(token: &str, query: &str) -> Result<Vec<PullRequest>, String> {
    let data = graphql::<SearchData<PullRequestNode>>(
        token,
        SEARCH_PRS,
        json!({
            "query": query,
        }),
    )
    .await?;

    Ok(data
        .search
        .edges
        .into_iter()
        .filter_map(|edge| edge.node)
        .map(PullRequest::from)
        .collect())
}

async fn search_issues(token: &str, query: &str) -> Result<Vec<Issue>, String> {
    let data = graphql::<SearchData<IssueNode>>(
        token,
        SEARCH_ISSUES,
        json!({
            "query": query,
        }),
    )
    .await?;

    Ok(data
        .search
        .edges
        .into_iter()
        .filter_map(|edge| edge.node)
        .map(Issue::from)
        .collect())
}

async fn graphql<T>(token: &str, query: &str, variables: serde_json::Value) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let client = reqwest::Client::new();
    let response = client
        .post(GITHUB_GRAPHQL_URL)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(USER_AGENT, "gitbar")
        .header(ACCEPT, "application/vnd.github+json")
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({
            "query": query,
            "variables": variables,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("GitHub returned HTTP {}", response.status()));
    }

    let body = response
        .json::<GraphQlResponse<T>>()
        .await
        .map_err(|error| error.to_string())?;

    if let Some(errors) = body.errors {
        let message = errors
            .into_iter()
            .map(|error| error.message)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(message);
    }

    body.data
        .ok_or_else(|| "GitHub returned no data".to_string())
}

impl From<PullRequestNode> for PullRequest {
    fn from(node: PullRequestNode) -> Self {
        let ci_status = node
            .commits
            .nodes
            .into_iter()
            .flatten()
            .last()
            .and_then(|commit| commit.commit.status_check_rollup)
            .map(|rollup| rollup.state);

        let author = node.author.map_or(
            Author {
                login: "unknown".to_string(),
                avatar_url: None,
            },
            |author| Author {
                login: author.login,
                avatar_url: author.avatar_url,
            },
        );

        Self {
            number: node.number,
            title: node.title,
            url: node.url,
            state: node.state,
            created_at: node.created_at,
            repository: Repo {
                name_with_owner: node.repository.name_with_owner,
            },
            author,
            is_draft: node.is_draft,
            review_decision: node.review_decision,
            ci_status,
            additions: node.additions,
            deletions: node.deletions,
        }
    }
}

impl From<IssueNode> for Issue {
    fn from(node: IssueNode) -> Self {
        Self {
            number: node.number,
            title: node.title,
            url: node.url,
            created_at: node.created_at,
            repository: Repo {
                name_with_owner: node.repository.name_with_owner,
            },
            labels: node
                .labels
                .nodes
                .into_iter()
                .flatten()
                .map(|label| Label {
                    name: label.name,
                    color: label.color,
                })
                .collect(),
            state: node.state,
        }
    }
}
