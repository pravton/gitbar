use std::collections::HashMap;

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use reqwest::{Client, StatusCode};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;

use crate::github::models::{AuthCheck, Author, GitHubError, Issue, Label, PullRequest, Repo};
use crate::github::queries::{
    ISSUE_ASSIGNED_QUERY, PR_AUTHOR_QUERY, PR_REVIEW_QUERY, SEARCH_ISSUES, SEARCH_PRS, VIEWER,
};

const DEFAULT_GITHUB_GRAPHQL_URL: &str = "https://api.github.com/graphql";

fn endpoint() -> String {
    std::env::var("GITBAR_GITHUB_GRAPHQL_URL")
        .unwrap_or_else(|_| DEFAULT_GITHUB_GRAPHQL_URL.to_string())
}

#[derive(Debug, Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    message: String,
    #[serde(default)]
    #[serde(rename = "type")]
    type_: Option<String>,
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

/// Build a reqwest client with sensible timeouts. Reuse one per app — see `AppState`.
pub fn build_http_client() -> Client {
    Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("gitbar")
        .build()
        .expect("reqwest client should build")
}

#[derive(Debug)]
pub struct FetchPrsOutcome {
    pub prs: Vec<PullRequest>,
    /// Set when one of the two queries failed; the result is partial but still useful.
    pub partial_message: Option<String>,
}

pub async fn fetch_prs(client: &Client, token: &str) -> Result<FetchPrsOutcome, GitHubError> {
    let mut by_url: HashMap<String, PullRequest> = HashMap::new();
    let mut last_error: Option<GitHubError> = None;
    let mut failed_queries: Vec<&'static str> = Vec::new();
    let mut success_count = 0u8;

    for (label, query) in [("author", PR_AUTHOR_QUERY), ("review", PR_REVIEW_QUERY)] {
        match search_prs(client, token, query).await {
            Ok(prs) => {
                success_count += 1;
                for pr in prs {
                    by_url.insert(pr.url.clone(), pr);
                }
            }
            Err(err) => {
                // Auth + rate-limit failures apply to every subsequent call too — short-circuit.
                if matches!(
                    err,
                    GitHubError::Auth { .. } | GitHubError::RateLimited { .. }
                ) {
                    return Err(err);
                }
                failed_queries.push(label);
                last_error = Some(err);
            }
        }
    }

    if success_count == 0 {
        return Err(last_error.unwrap_or_else(|| GitHubError::server("PR fetch failed")));
    }

    let mut prs: Vec<PullRequest> = by_url.into_values().collect();
    prs.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    let partial_message = if failed_queries.is_empty() {
        None
    } else {
        Some(format!(
            "Some PR queries failed ({}); showing partial results.",
            failed_queries.join(", ")
        ))
    };

    Ok(FetchPrsOutcome { prs, partial_message })
}

pub async fn fetch_issues(client: &Client, token: &str) -> Result<Vec<Issue>, GitHubError> {
    let mut issues = search_issues(client, token, ISSUE_ASSIGNED_QUERY).await?;
    issues.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(issues)
}

pub async fn check_auth(client: &Client, token: &str) -> Result<AuthCheck, GitHubError> {
    match graphql::<ViewerData>(client, token, VIEWER, json!({})).await {
        Ok(data) => Ok(AuthCheck {
            ok: true,
            login: Some(data.viewer.login),
            message: None,
        }),
        Err(GitHubError::Auth { message }) => Ok(AuthCheck {
            ok: false,
            login: None,
            message: Some(message),
        }),
        Err(err) => Err(err),
    }
}

async fn search_prs(
    client: &Client,
    token: &str,
    query: &str,
) -> Result<Vec<PullRequest>, GitHubError> {
    let data = graphql::<SearchData<PullRequestNode>>(
        client,
        token,
        SEARCH_PRS,
        json!({ "query": query }),
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

async fn search_issues(
    client: &Client,
    token: &str,
    query: &str,
) -> Result<Vec<Issue>, GitHubError> {
    let data = graphql::<SearchData<IssueNode>>(
        client,
        token,
        SEARCH_ISSUES,
        json!({ "query": query }),
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

async fn graphql<T>(
    client: &Client,
    token: &str,
    query: &str,
    variables: serde_json::Value,
) -> Result<T, GitHubError>
where
    T: DeserializeOwned,
{
    if token.trim().is_empty() {
        return Err(GitHubError::auth("missing GitHub token"));
    }

    let response = client
        .post(endpoint())
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
        .map_err(|error| GitHubError::network(error.to_string()))?;

    let status = response.status();

    if status == StatusCode::UNAUTHORIZED {
        return Err(GitHubError::auth("GitHub rejected the token (401)"));
    }
    if status == StatusCode::FORBIDDEN {
        // GitHub uses 403 for both auth issues and rate limiting.
        let retry_after_secs = response
            .headers()
            .get("retry-after")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok());

        let remaining = response
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok());

        return if remaining == Some(0) {
            Err(GitHubError::rate_limited(
                "GitHub API rate limit exhausted",
                retry_after_secs,
            ))
        } else {
            Err(GitHubError::auth(
                "GitHub returned 403; the token may lack required scopes",
            ))
        };
    }
    if status.is_server_error() {
        return Err(GitHubError::server(format!("GitHub returned HTTP {status}")));
    }
    if !status.is_success() {
        return Err(GitHubError::server(format!("GitHub returned HTTP {status}")));
    }

    let body = response
        .json::<GraphQlResponse<T>>()
        .await
        .map_err(|error| GitHubError::server(format!("invalid GitHub response: {error}")))?;

    if let Some(errors) = body.errors {
        // If any inner error is auth-flavored, classify it as such.
        let is_auth = errors
            .iter()
            .any(|e| matches!(e.type_.as_deref(), Some("UNAUTHORIZED") | Some("FORBIDDEN")));
        let message = errors
            .into_iter()
            .map(|error| error.message)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(if is_auth {
            GitHubError::auth(message)
        } else {
            GitHubError::server(message)
        });
    }

    body.data
        .ok_or_else(|| GitHubError::server("GitHub returned no data"))
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{header, method};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn install_endpoint(server: &MockServer) {
        // Tests in the same crate run in parallel by default; cargo serializes them
        // only with `--test-threads=1`. We rely on the per-test env var being read
        // synchronously inside `endpoint()` before the await. Each test mounts its
        // own server and overwrites the var. If parallel tests start interleaving,
        // run with `cargo test -- --test-threads=1`.
        std::env::set_var("GITBAR_GITHUB_GRAPHQL_URL", server.uri());
    }

    fn http() -> Client {
        build_http_client()
    }

    fn pr_edge_json() -> serde_json::Value {
        json!({ "node": {
            "number": 1, "title": "A", "url": "https://x/1", "state": "OPEN",
            "createdAt": "2025-01-01T00:00:00Z", "isDraft": false,
            "reviewDecision": null, "additions": 1, "deletions": 0,
            "repository": { "nameWithOwner": "o/r" },
            "author": { "login": "u", "avatarUrl": null },
            "commits": { "nodes": [] }
        }})
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fetch_prs_dedupes_and_handles_null_author() {
        let server = MockServer::start().await;
        install_endpoint(&server);

        let body = json!({
            "data": { "search": { "edges": [
                pr_edge_json(),
                { "node": {
                    "number": 2, "title": "B", "url": "https://x/2", "state": "OPEN",
                    "createdAt": "2025-02-01T00:00:00Z", "isDraft": false,
                    "reviewDecision": null, "additions": 1, "deletions": 0,
                    "repository": { "nameWithOwner": "o/r" },
                    "author": null,
                    "commits": { "nodes": [{ "commit": { "statusCheckRollup": { "state": "SUCCESS" } } }] }
                }}
            ]}}
        });

        Mock::given(method("POST"))
            .and(header("authorization", "Bearer tok"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;

        let out = fetch_prs(&http(), "tok").await.expect("ok");
        assert_eq!(out.prs.len(), 2, "deduped across both PR sub-queries");
        assert_eq!(out.prs[0].created_at, "2025-01-01T00:00:00Z");
        let pr_b = out.prs.iter().find(|p| p.number == 2).unwrap();
        assert_eq!(pr_b.author.login, "unknown", "null author falls back");
        assert_eq!(pr_b.ci_status.as_deref(), Some("SUCCESS"));
        assert!(out.partial_message.is_none());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fetch_prs_partial_when_one_query_5xxs() {
        let server = MockServer::start().await;
        install_endpoint(&server);

        let success_body = json!({
            "data": { "search": { "edges": [pr_edge_json()] }}
        });

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(success_body))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(500).set_body_string("nope"))
            .mount(&server)
            .await;

        let out = fetch_prs(&http(), "tok").await.expect("partial ok");
        assert_eq!(out.prs.len(), 1);
        assert!(out.partial_message.is_some());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fetch_prs_propagates_auth_error() {
        let server = MockServer::start().await;
        install_endpoint(&server);

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        let err = fetch_prs(&http(), "tok").await.unwrap_err();
        assert!(matches!(err, GitHubError::Auth { .. }), "got: {err:?}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn graphql_403_with_zero_remaining_is_rate_limited() {
        let server = MockServer::start().await;
        install_endpoint(&server);

        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(403)
                    .insert_header("x-ratelimit-remaining", "0")
                    .insert_header("retry-after", "90"),
            )
            .mount(&server)
            .await;

        let err = fetch_prs(&http(), "tok").await.unwrap_err();
        match err {
            GitHubError::RateLimited { retry_after_secs, .. } => {
                assert_eq!(retry_after_secs, Some(90));
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fetch_issues_returns_typed_error_instead_of_empty_vec() {
        let server = MockServer::start().await;
        install_endpoint(&server);

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let err = fetch_issues(&http(), "tok").await.unwrap_err();
        assert!(matches!(err, GitHubError::Server { .. }), "got: {err:?}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn empty_token_short_circuits_to_auth_error() {
        // No mock server needed — `graphql()` short-circuits before sending.
        let err = fetch_prs(&http(), "").await.unwrap_err();
        assert!(matches!(err, GitHubError::Auth { .. }));
    }
}
