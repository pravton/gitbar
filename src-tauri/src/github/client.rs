use std::collections::hash_map::Entry;
use std::collections::HashMap;

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use reqwest::{Client, StatusCode};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;

use crate::github::models::{
    AuthCheck, Author, CheckRun, GitHubError, Issue, Label, PullRequest, Repo,
};
use crate::github::queries::{
    ISSUE_ASSIGNED_QUERY, PR_AUTHOR_QUERY, PR_REVIEW_QUERY, SEARCH_ISSUES, SEARCH_PRS, VIEWER,
};

const DEFAULT_GITHUB_GRAPHQL_URL: &str = "https://api.github.com/graphql";

/// Hard ceiling on the size of a GitHub GraphQL response we'll buffer.
/// Real-world payloads are tens of kilobytes; this cap exists so a
/// misbehaving (or hostile, given the debug-build env override exists)
/// upstream can't stream gigabytes of bytes at us and OOM the process.
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;

/// Resolves the GraphQL endpoint.
///
/// The `GITBAR_GITHUB_GRAPHQL_URL` override is honored only in debug builds
/// (which includes `cargo test`). Release builds always target the canonical
/// GitHub host so a manipulated environment variable cannot redirect the
/// PAT-bearing requests to an attacker-controlled server.
fn endpoint() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(url) = std::env::var("GITBAR_GITHUB_GRAPHQL_URL") {
            return url;
        }
    }
    DEFAULT_GITHUB_GRAPHQL_URL.to_string()
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
    #[serde(default)]
    path: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct SearchData<T> {
    search: SearchConnection<T>,
}

#[derive(Debug, Deserialize)]
struct SearchConnection<T> {
    // GitHub returns a null edge (not just a null node) when a specific
    // result is gated by SAML / org permission. Accept null edges so the
    // rest of the response decodes; we filter them out before mapping.
    edges: Vec<Option<SearchEdge<T>>>,
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
    #[serde(default)]
    body: Option<String>,
    created_at: String,
    is_draft: bool,
    review_decision: Option<String>,
    additions: u64,
    deletions: u64,
    /// `PullRequest.totalCommentsCount` — the aggregate count that GitHub
    /// itself shows on the PR page, including general PR comments, review
    /// submissions, and inline review-thread comments. The narrower
    /// `comments { totalCount }` field would miss the inline reviews.
    /// Nullable in GitHub's schema (`Int`, not `Int!`), so model as Option.
    #[serde(default)]
    total_comments_count: Option<u64>,
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
    #[serde(default)]
    deployments: Option<DeploymentConnection>,
}

#[derive(Debug, Deserialize)]
struct StatusCheckRollup {
    state: String,
}

#[derive(Debug, Deserialize, Default)]
struct DeploymentConnection {
    // Tolerate the field being absent from cross-repo permission-restricted
    // responses — empty list means "no deployments visible", not a decode error.
    #[serde(default)]
    nodes: Vec<Option<DeploymentNode>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeploymentNode {
    #[serde(default)]
    latest_status: Option<DeploymentStatus>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeploymentStatus {
    environment_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ViewerData {
    viewer: Viewer,
}

#[derive(Debug, Deserialize)]
struct Viewer {
    login: String,
}

// --- Check-runs query deserializers (PR_CHECKS) ---------------------------

#[derive(Debug, Deserialize)]
struct PrChecksData {
    repository: Option<RepositoryChecks>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryChecks {
    pull_request: Option<PullRequestChecks>,
}

#[derive(Debug, Deserialize)]
struct PullRequestChecks {
    commits: Connection<PullRequestCommit>,
}

#[derive(Debug, Deserialize)]
struct Connection<T> {
    nodes: Vec<T>,
}

#[derive(Debug, Deserialize)]
struct PullRequestCommit {
    commit: CommitChecks,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitChecks {
    check_suites: Connection<CheckSuiteNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckSuiteNode {
    workflow_run: Option<WorkflowRunNode>,
    check_runs: Connection<CheckRunNode>,
}

#[derive(Debug, Deserialize)]
struct WorkflowRunNode {
    workflow: Option<WorkflowName>,
}

#[derive(Debug, Deserialize)]
struct WorkflowName {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckRunNode {
    name: String,
    status: String,
    conclusion: Option<String>,
    started_at: Option<String>,
    completed_at: Option<String>,
    details_url: String,
}

/// Extract a deploy/preview URL from a PR body.
///
/// Recognized forms (the HTML comment wins if both are present):
///   <!-- gitbar:deploy=https://example.com -->
///   Deploy: https://example.com
///   Deploy-Link: https://example.com
///   Preview: https://example.com
///   Local-Deploy: https://example.com
///   Local: https://example.com
///
/// Labels are case-insensitive. Leading markdown decoration (`*`, `**`, `#`,
/// `-`, `>`, whitespace) on the line is stripped. The URL must start with
/// `http://` or `https://`; the parser takes the first whitespace-terminated
/// token after the label and strips trailing punctuation.
pub fn parse_deploy_link_from_body(body: &str) -> Option<String> {
    // HTML comment form first — highest priority because it's explicit + invisible.
    const COMMENT_PREFIX: &str = "<!-- gitbar:deploy=";
    if let Some(start) = body.find(COMMENT_PREFIX) {
        let rest = &body[start + COMMENT_PREFIX.len()..];
        if let Some(end) = rest.find("-->") {
            // Only whitespace-trim. Don't strip trailing `=` — that's a valid
            // character in query strings (e.g. base64-padded tokens like
            // `?token=YWJjZA==`).
            let candidate = rest[..end].trim();
            if is_supported_url(candidate) {
                return Some(candidate.to_string());
            }
        }
    }

    const PREFIXES: [&str; 5] = [
        "deploy-link:",
        "local-deploy:",
        "deploy:",
        "preview:",
        "local:",
    ];

    for raw_line in body.lines() {
        let line = raw_line
            .trim()
            .trim_start_matches(['*', '#', '-', '>', ' '])
            .trim_start_matches("**")
            .trim();
        let lower = line.to_ascii_lowercase();
        for prefix in PREFIXES {
            if let Some(stripped) = lower.strip_prefix(prefix) {
                // Recover the original-case suffix at the same offset.
                let original_suffix = &line[line.len() - stripped.len()..];
                let after = original_suffix.trim().trim_start_matches("**").trim();
                if let Some(token) = after.split_whitespace().next() {
                    let url = token.trim_end_matches([',', '.', ';', ')', ']', '*']);
                    if is_supported_url(url) {
                        return Some(url.to_string());
                    }
                }
            }
        }
    }
    None
}

fn is_supported_url(s: &str) -> bool {
    for scheme in ["https://", "http://"] {
        if let Some(rest) = s.strip_prefix(scheme) {
            // Reject empty host and "scheme:///path" (where host is absent).
            return !rest.is_empty() && !rest.starts_with('/');
        }
    }
    false
}

/// Build a reqwest client with sensible timeouts. Reuse one per app — see `AppState`.
///
/// If the configured builder fails (e.g. an unusual TLS-backend issue), fall
/// back to a stock `Client::new()` rather than panicking at startup. The
/// fallback has no custom timeout but is functional; the user gets a working
/// app over a crash on every launch.
pub fn build_http_client() -> Client {
    Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("gitbar")
        .build()
        .unwrap_or_else(|err| {
            eprintln!(
                "gitbar: failed to build configured HTTP client ({err}); falling back to default"
            );
            Client::new()
        })
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
                let from_review = label == "review";
                for mut pr in prs {
                    pr.review_requested = from_review;
                    match by_url.entry(pr.url.clone()) {
                        Entry::Occupied(mut slot) => {
                            // A PR can surface in both searches. Last
                            // query wins on field data (prior behavior),
                            // but review_requested is sticky: true if
                            // either search returned it.
                            pr.review_requested |= slot.get().review_requested;
                            slot.insert(pr);
                        }
                        Entry::Vacant(slot) => {
                            slot.insert(pr);
                        }
                    }
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
        // Include the underlying error so the UI surfaces *why* the query
        // failed instead of leaving the user staring at a perpetual
        // "showing partial results" banner with no diagnosis.
        let detail = last_error
            .as_ref()
            .map(|err| format!(" ({err})"))
            .unwrap_or_default();
        Some(format!(
            "Some PR queries failed ({}){detail}",
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

/// Drill-down: fetch the check runs (CI jobs) on the PR's latest commit.
/// Called lazily from the frontend when the user clicks the CI pill, so
/// it does not run on every poll. Output is flat (across all check
/// suites), sorted newest `started_at` first; check runs with no
/// `started_at` (queued but not yet started) sink to the end.
pub async fn fetch_pr_checks(
    client: &Client,
    token: &str,
    owner: &str,
    name: &str,
    number: i64,
) -> Result<Vec<CheckRun>, GitHubError> {
    let data = graphql::<PrChecksData>(
        client,
        token,
        crate::github::queries::PR_CHECKS,
        json!({ "owner": owner, "name": name, "number": number }),
    )
    .await?;

    let mut out: Vec<CheckRun> = Vec::new();
    let suites = data
        .repository
        .and_then(|r| r.pull_request)
        .and_then(|pr| pr.commits.nodes.into_iter().next())
        .map(|node| node.commit.check_suites.nodes)
        .unwrap_or_default();
    for suite in suites {
        let workflow_name = suite
            .workflow_run
            .and_then(|wr| wr.workflow.map(|w| w.name));
        for run in suite.check_runs.nodes {
            out.push(CheckRun {
                name: run.name,
                status: run.status,
                conclusion: run.conclusion,
                started_at: run.started_at,
                completed_at: run.completed_at,
                url: run.details_url,
                workflow_name: workflow_name.clone(),
            });
        }
    }
    // Newest started first; runs without `startedAt` (still queued) go last.
    out.sort_by(|a, b| match (&a.started_at, &b.started_at) {
        (Some(x), Some(y)) => y.cmp(x),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
    Ok(out)
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
        .flatten()
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
        .flatten()
        .filter_map(|edge| edge.node)
        .map(Issue::from)
        .collect())
}

/// Streams a `reqwest::Response` body into a `String` with a hard size cap.
///
/// We can't trust the `Content-Length` header alone (chunked transfers
/// don't have one, and a server could lie). `response.chunk()` gives
/// us per-chunk control without needing the reqwest `stream` feature.
async fn read_bounded(response: reqwest::Response) -> Result<String, GitHubError> {
    let mut response = response;
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| GitHubError::network(e.to_string()))?
    {
        if buf.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(GitHubError::server(format!(
                "GitHub response exceeded {} byte cap",
                MAX_RESPONSE_BYTES
            )));
        }
        buf.extend_from_slice(&chunk);
    }
    String::from_utf8(buf).map_err(|e| GitHubError::server(format!("non-UTF8 body: {e}")))
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
        // GitHub uses 403 for both rate limiting AND a grab-bag of other
        // denials (missing scopes, SAML challenges, repo permissions,
        // secondary abuse limits). Only the rate-limit case maps to
        // `auth`/`rate_limited`; the rest map to `server` so the
        // frontend's typed-error UI shows "GitHub error" instead of
        // "Token rejected — reconnect required" (which would imply the
        // PAT is bad and historically caused the auto-clear path to
        // wipe a perfectly good keychain entry).
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
            Err(GitHubError::server(
                "GitHub returned 403; the token may lack required scopes or this repo is org-restricted",
            ))
        };
    }
    if status.is_server_error() {
        return Err(GitHubError::server(format!("GitHub returned HTTP {status}")));
    }
    if !status.is_success() {
        return Err(GitHubError::server(format!("GitHub returned HTTP {status}")));
    }

    // Pre-check Content-Length: cheap upfront rejection for an
    // honest-but-oversized response, before we start buffering.
    if let Some(declared) = response.content_length() {
        if declared > MAX_RESPONSE_BYTES as u64 {
            return Err(GitHubError::server(format!(
                "GitHub response too large: declared {} bytes (cap {})",
                declared, MAX_RESPONSE_BYTES
            )));
        }
    }

    // Stream chunks with a running cap so a server that lies about
    // Content-Length (or uses chunked transfer with no declared size)
    // can't silently OOM us. `response.chunk()` is available without
    // the reqwest `stream` feature.
    //
    // Read the body as text first so a decode failure can surface (a)
    // serde's detailed error (`missing field `X` at line Y column Z`)
    // and (b) a truncated body preview, which together let us actually
    // diagnose server-shape changes. Going through `response.json()`
    // collapses both.
    let raw = read_bounded(response).await?;

    let body: GraphQlResponse<T> = serde_json::from_str(&raw).map_err(|error| {
        let preview: String = raw.chars().take(400).collect();
        let suffix = if raw.len() > 400 { "…" } else { "" };
        GitHubError::server(format!(
            "invalid GitHub response: {error}; body starts: {preview}{suffix}"
        ))
    })?;

    // GraphQL allows `data` and `errors` to coexist — the request partially
    // succeeded. The canonical example is SAML-protected items: GitHub
    // returns the other (accessible) results in `data` and reports the
    // restricted item as a FORBIDDEN error with `path` pointing at the
    // specific edge. Treating that as a fatal failure (the old behavior)
    // hid the rest of the results behind a banner.
    //
    // New behavior: if `data` came back, use it and just log the errors to
    // stderr. Only surface an error to the UI when `data` is absent.
    match (body.data, body.errors) {
        (Some(data), errors_opt) => {
            if let Some(errors) = errors_opt {
                for err in errors {
                    eprintln!(
                        "gitbar: GitHub returned a per-field error (using partial data): \
                         type={:?} path={:?} message={}",
                        err.type_, err.path, err.message,
                    );
                }
            }
            Ok(data)
        }
        (None, Some(errors)) => {
            // No data — request really did fail. Classify and surface.
            let is_auth = errors
                .iter()
                .any(|e| matches!(e.type_.as_deref(), Some("UNAUTHORIZED") | Some("FORBIDDEN")));
            let message = errors
                .into_iter()
                .map(|error| error.message)
                .collect::<Vec<_>>()
                .join("; ");
            Err(if is_auth {
                GitHubError::auth(message)
            } else {
                GitHubError::server(message)
            })
        }
        (None, None) => Err(GitHubError::server("GitHub returned no data")),
    }
}

impl From<PullRequestNode> for PullRequest {
    fn from(node: PullRequestNode) -> Self {
        // Extract both ci_status and deployment_url from the latest commit in
        // a single pass so we don't have to clone the commits vec.
        let last_commit = node.commits.nodes.into_iter().flatten().last();
        let (ci_status, github_deployment_url) = match last_commit {
            Some(c) => {
                let ci_status = c.commit.status_check_rollup.map(|rollup| rollup.state);
                let deployment_url = c.commit.deployments.and_then(|conn| {
                    conn.nodes
                        .into_iter()
                        .flatten()
                        .filter_map(|node| node.latest_status.and_then(|s| s.environment_url))
                        .filter(|url| !url.is_empty())
                        .last()
                });
                (ci_status, deployment_url)
            }
            None => (None, None),
        };

        // An explicit body marker wins over GitHub's deployments API URL.
        // Convention: `Deploy: https://...` line or `<!-- gitbar:deploy=... -->`
        // HTML comment in the PR body. See AGENTS.md.
        let deployment_url = node
            .body
            .as_deref()
            .and_then(parse_deploy_link_from_body)
            .or(github_deployment_url);

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
            // Tagged in `fetch_prs` based on which search returned the
            // PR; the GraphQL node carries no such signal on its own.
            review_requested: false,
            ci_status,
            additions: node.additions,
            deletions: node.deletions,
            comments: node.total_comments_count.unwrap_or(0),
            deployment_url,
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
pub(crate) mod test_endpoint {
    //! Tests share one process-wide env var (`GITBAR_GITHUB_GRAPHQL_URL`). An
    //! `EndpointGuard` (1) takes a global mutex so concurrent tests can't
    //! overwrite each other's endpoint, and (2) restores the previous value on
    //! drop so state doesn't leak across tests. With this in place `cargo test`
    //! is safe at default parallelism — `--test-threads=1` is no longer needed.
    use std::sync::{Mutex, MutexGuard, OnceLock};

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    pub struct EndpointGuard {
        prev: Option<String>,
        _lock: MutexGuard<'static, ()>,
    }

    impl EndpointGuard {
        pub fn install(url: &str) -> Self {
            let lock = ENV_LOCK
                .get_or_init(|| Mutex::new(()))
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let prev = std::env::var("GITBAR_GITHUB_GRAPHQL_URL").ok();
            std::env::set_var("GITBAR_GITHUB_GRAPHQL_URL", url);
            Self { prev, _lock: lock }
        }
    }

    impl Drop for EndpointGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var("GITBAR_GITHUB_GRAPHQL_URL", v),
                None => std::env::remove_var("GITBAR_GITHUB_GRAPHQL_URL"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::test_endpoint::EndpointGuard;
    use serde_json::json;
    use wiremock::matchers::{header, method};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn http() -> Client {
        build_http_client()
    }

    #[test]
    fn parse_deploy_link_finds_simple_trailer() {
        let body = "Some description.\n\nDeploy: https://preview.example.com/123\n";
        assert_eq!(
            parse_deploy_link_from_body(body).as_deref(),
            Some("https://preview.example.com/123"),
        );
    }

    #[test]
    fn parse_deploy_link_is_case_insensitive() {
        for variant in ["DEPLOY:", "deploy:", "Deploy-Link:", "preview:", "Local:"] {
            let body = format!("{variant} https://example.com/x");
            assert_eq!(
                parse_deploy_link_from_body(&body).as_deref(),
                Some("https://example.com/x"),
                "variant {variant} should match",
            );
        }
    }

    #[test]
    fn parse_deploy_link_strips_markdown_decoration() {
        let body = "**Deploy:** https://example.com/x";
        assert_eq!(
            parse_deploy_link_from_body(body).as_deref(),
            Some("https://example.com/x"),
        );
    }

    #[test]
    fn parse_deploy_link_strips_trailing_punctuation() {
        let body = "Deploy: https://example.com/x.";
        assert_eq!(
            parse_deploy_link_from_body(body).as_deref(),
            Some("https://example.com/x"),
        );
    }

    #[test]
    fn parse_deploy_link_handles_html_comment() {
        let body = "Anything here.\n<!-- gitbar:deploy=https://preview.example.com/123 -->\nMore.";
        assert_eq!(
            parse_deploy_link_from_body(body).as_deref(),
            Some("https://preview.example.com/123"),
        );
    }

    #[test]
    fn parse_deploy_link_html_comment_wins_over_trailer() {
        let body = "<!-- gitbar:deploy=https://invisible.example.com -->\nDeploy: https://visible.example.com";
        assert_eq!(
            parse_deploy_link_from_body(body).as_deref(),
            Some("https://invisible.example.com"),
        );
    }

    #[test]
    fn parse_deploy_link_rejects_non_http_scheme() {
        let body = "Deploy: ftp://example.com/x";
        assert!(parse_deploy_link_from_body(body).is_none());
    }

    #[test]
    fn parse_deploy_link_preserves_base64_padding_in_html_comment() {
        // `=` is a legal character inside query strings (base64 padding,
        // some session tokens). Don't strip it.
        let body = "<!-- gitbar:deploy=https://example.com/cb?token=YWJjZA== -->";
        assert_eq!(
            parse_deploy_link_from_body(body).as_deref(),
            Some("https://example.com/cb?token=YWJjZA=="),
        );
    }

    #[test]
    fn parse_deploy_link_accepts_short_hostnames() {
        // `is_supported_url` used to reject anything <= 8 chars, which
        // killed legitimate short URLs like `http://a` (8 chars).
        let body = "Deploy: http://a";
        assert_eq!(parse_deploy_link_from_body(body).as_deref(), Some("http://a"));
    }

    #[test]
    fn parse_deploy_link_rejects_empty_host() {
        for body in ["Deploy: https://", "Deploy: http:///path"] {
            assert!(
                parse_deploy_link_from_body(body).is_none(),
                "should reject empty-host URL: {body}",
            );
        }
    }

    #[test]
    fn parse_deploy_link_returns_none_when_no_marker() {
        let body = "This PR fixes #123. There is no deploy link in this body.";
        assert!(parse_deploy_link_from_body(body).is_none());
    }

    #[test]
    fn parse_deploy_link_handles_realistic_user_url() {
        // The exact URL the user pasted as the motivating example.
        let body = "## Voxbridge\n\nLocal-Deploy: https://cypher-ton-nucbox-k12.tail059184.ts.net:10000/v2/talk\n\nDetails follow.";
        assert_eq!(
            parse_deploy_link_from_body(body).as_deref(),
            Some("https://cypher-ton-nucbox-k12.tail059184.ts.net:10000/v2/talk"),
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fetch_prs_uses_body_deploy_marker_over_github_deployment() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        let body = json!({
            "data": { "search": { "edges": [{ "node": {
                "number": 9, "title": "voxbridge", "url": "https://x/9", "state": "OPEN",
                "body": "Local-Deploy: https://cypher-ton.tail059184.ts.net:10000/v2/talk",
                "createdAt": "2025-01-01T00:00:00Z", "isDraft": false,
                "reviewDecision": null, "additions": 1, "deletions": 0,
                "totalCommentsCount": 0,
                "repository": { "nameWithOwner": "o/r" },
                "author": { "login": "u", "avatarUrl": null },
                "commits": { "nodes": [{ "commit": {
                    "statusCheckRollup": null,
                    "deployments": { "nodes": [
                        { "latestStatus": { "environmentUrl": "https://vercel-preview.example.com/9", "state": "SUCCESS" } }
                    ]}
                }}]}
            }}]}}
        });

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;

        let out = fetch_prs(&http(), "tok").await.expect("ok");
        assert_eq!(out.prs.len(), 1);
        assert_eq!(
            out.prs[0].deployment_url.as_deref(),
            Some("https://cypher-ton.tail059184.ts.net:10000/v2/talk"),
            "body marker should override GitHub deployment URL",
        );
    }

    fn pr_edge_json() -> serde_json::Value {
        json!({ "node": {
            "number": 1, "title": "A", "url": "https://x/1", "state": "OPEN",
            "createdAt": "2025-01-01T00:00:00Z", "isDraft": false,
            "reviewDecision": null, "additions": 1, "deletions": 0,
            "comments": { "totalCount": 0 },
            "repository": { "nameWithOwner": "o/r" },
            "author": { "login": "u", "avatarUrl": null },
            "commits": { "nodes": [] }
        }})
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fetch_prs_dedupes_and_handles_null_author() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

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
    async fn fetch_prs_tags_review_requested_by_source_query() {
        use wiremock::matchers::body_string_contains;

        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        // The author search returns PR #1; the review search returns
        // PR #2. We match each mock on the search string embedded in the
        // GraphQL variables so the two queries get distinct responses.
        let author_body = json!({
            "data": { "search": { "edges": [{ "node": {
                "number": 1, "title": "mine", "url": "https://x/1", "state": "OPEN",
                "createdAt": "2025-01-01T00:00:00Z", "isDraft": false,
                "reviewDecision": null, "additions": 1, "deletions": 0,
                "repository": { "nameWithOwner": "o/r" },
                "author": { "login": "me", "avatarUrl": null },
                "commits": { "nodes": [] }
            }}]}}
        });
        let review_body = json!({
            "data": { "search": { "edges": [{ "node": {
                "number": 2, "title": "please review", "url": "https://x/2", "state": "OPEN",
                "createdAt": "2025-02-01T00:00:00Z", "isDraft": false,
                "reviewDecision": null, "additions": 1, "deletions": 0,
                "repository": { "nameWithOwner": "o/r" },
                "author": { "login": "someone", "avatarUrl": null },
                "commits": { "nodes": [] }
            }}]}}
        });

        Mock::given(method("POST"))
            .and(body_string_contains("author:@me"))
            .respond_with(ResponseTemplate::new(200).set_body_json(author_body))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(body_string_contains("review-requested:@me"))
            .respond_with(ResponseTemplate::new(200).set_body_json(review_body))
            .mount(&server)
            .await;

        let out = fetch_prs(&http(), "tok").await.expect("ok");
        let authored = out.prs.iter().find(|p| p.number == 1).unwrap();
        let to_review = out.prs.iter().find(|p| p.number == 2).unwrap();
        assert!(
            !authored.review_requested,
            "author-only PR must not be flagged review_requested"
        );
        assert!(
            to_review.review_requested,
            "PR from the review-requested search must be flagged"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fetch_prs_extracts_comments_and_deployment_url() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        let body = json!({
            "data": { "search": { "edges": [{ "node": {
                "number": 7, "title": "deploy thing", "url": "https://x/7", "state": "OPEN",
                "createdAt": "2025-01-01T00:00:00Z", "isDraft": false,
                "reviewDecision": null, "additions": 1, "deletions": 0,
                "totalCommentsCount": 12,
                "repository": { "nameWithOwner": "o/r" },
                "author": { "login": "u", "avatarUrl": null },
                "commits": { "nodes": [{ "commit": {
                    "statusCheckRollup": { "state": "SUCCESS" },
                    "deployments": { "nodes": [
                        // An older deployment without a URL (filtered out).
                        { "latestStatus": { "environmentUrl": "", "state": "SUCCESS" } },
                        // The deployment we should surface.
                        { "latestStatus": { "environmentUrl": "https://preview.example.com/7", "state": "SUCCESS" } }
                    ]}
                }}]}
            }}]}}
        });

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;

        let out = fetch_prs(&http(), "tok").await.expect("ok");
        assert_eq!(out.prs.len(), 1);
        assert_eq!(out.prs[0].comments, 12);
        assert_eq!(
            out.prs[0].deployment_url.as_deref(),
            Some("https://preview.example.com/7"),
        );
    }

    /// Regression: `totalCommentsCount` is nullable in GitHub's schema. A
    /// literal `null` (vs missing field) must decode cleanly to `comments: 0`,
    /// not propagate up as a server-decode error.
    #[tokio::test(flavor = "current_thread")]
    async fn fetch_prs_accepts_null_total_comments_count() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        let body = json!({
            "data": { "search": { "edges": [{ "node": {
                "number": 11, "title": "no count", "url": "https://x/11", "state": "OPEN",
                "createdAt": "2025-01-01T00:00:00Z", "isDraft": false,
                "reviewDecision": null, "additions": 0, "deletions": 0,
                "totalCommentsCount": null,
                "repository": { "nameWithOwner": "o/r" },
                "author": { "login": "u", "avatarUrl": null },
                "commits": { "nodes": [] }
            }}]}}
        });

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;

        let out = fetch_prs(&http(), "tok").await.expect("ok");
        assert_eq!(out.prs.len(), 1);
        assert_eq!(out.prs[0].comments, 0);
    }

    /// Regression: cross-repo permission-restricted responses sometimes
    /// return `deployments: {}` without a `nodes` field. The whole response
    /// used to fail decoding; now it should yield `deployment_url: None`.
    #[tokio::test(flavor = "current_thread")]
    async fn fetch_prs_accepts_deployments_without_nodes_field() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        let body = json!({
            "data": { "search": { "edges": [{ "node": {
                "number": 12, "title": "cross-repo PR", "url": "https://x/12", "state": "OPEN",
                "createdAt": "2025-01-01T00:00:00Z", "isDraft": false,
                "reviewDecision": null, "additions": 1, "deletions": 0,
                "totalCommentsCount": 0,
                "repository": { "nameWithOwner": "o/r" },
                "author": { "login": "u", "avatarUrl": null },
                "commits": { "nodes": [{ "commit": {
                    "statusCheckRollup": null,
                    "deployments": {}
                }}]}
            }}]}}
        });

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;

        let out = fetch_prs(&http(), "tok").await.expect("ok");
        assert_eq!(out.prs.len(), 1);
        assert!(out.prs[0].deployment_url.is_none());
    }

    /// Regression: when the body really is malformed, the surfaced error
    /// must include a snippet of the body so the user can see what GitHub
    /// returned, not just a generic "error decoding response body".
    #[tokio::test(flavor = "current_thread")]
    async fn decode_failure_surfaces_body_preview() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "application/json")
                    .set_body_string("this is definitely not the expected GraphQL shape"),
            )
            .mount(&server)
            .await;

        let err = fetch_prs(&http(), "tok").await.unwrap_err();
        let message = match err {
            GitHubError::Server { message } => message,
            other => panic!("expected Server error, got {other:?}"),
        };
        assert!(
            message.contains("body starts:"),
            "error should include body preview marker; got: {message}",
        );
        assert!(
            message.contains("this is definitely not"),
            "preview should include the actual response text; got: {message}",
        );
    }

    /// SAML-restricted scenario: GitHub returns the accessible PR in `data`
    /// AND a FORBIDDEN error with `saml_failure: true` in `errors` for the
    /// inaccessible one. The accessible PR must come through silently.
    #[tokio::test(flavor = "current_thread")]
    async fn fetch_prs_returns_partial_data_when_some_edges_are_saml_restricted() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        // First edge is null (the SAML-restricted one); second is a real PR.
        // GitHub also returns an `errors` array describing the restriction.
        let body = json!({
            "data": {
                "search": {
                    "issueCount": 2,
                    "edges": [
                        null,
                        pr_edge_json(),
                    ],
                }
            },
            "errors": [{
                "type": "FORBIDDEN",
                "path": ["search", "edges", 0],
                "extensions": { "saml_failure": true },
                "locations": [{ "line": 5, "column": 5 }],
                "message": "Resource protected by organization SAML enforcement."
            }]
        });

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;

        let out = fetch_prs(&http(), "tok").await.expect(
            "SAML on one edge should not fail the whole query when other data came through",
        );
        assert_eq!(out.prs.len(), 1, "the accessible PR comes through");
        assert!(out.partial_message.is_none(), "no banner — log only");
    }

    /// Errors-only (no `data`) is still a real failure; FORBIDDEN there should
    /// still propagate as an auth error.
    #[tokio::test(flavor = "current_thread")]
    async fn fetch_prs_errors_without_data_still_surface() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        let body = json!({
            "data": null,
            "errors": [{
                "type": "FORBIDDEN",
                "message": "Resource not accessible by integration",
            }]
        });

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;

        let err = fetch_prs(&http(), "tok").await.unwrap_err();
        assert!(matches!(err, GitHubError::Auth { .. }), "got: {err:?}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fetch_prs_partial_message_includes_underlying_error() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        let success_body = json!({
            "data": { "search": { "edges": [pr_edge_json()] }}
        });

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(success_body))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(500).set_body_string("boom"))
            .mount(&server)
            .await;

        let out = fetch_prs(&http(), "tok").await.expect("partial ok");
        let msg = out.partial_message.expect("partial_message set");
        assert!(msg.contains("review"), "names the failed query: {msg}");
        assert!(msg.contains("server"), "includes the underlying error kind: {msg}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fetch_prs_partial_when_one_query_5xxs() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

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
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        let err = fetch_prs(&http(), "tok").await.unwrap_err();
        assert!(matches!(err, GitHubError::Auth { .. }), "got: {err:?}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn graphql_403_without_rate_limit_headers_is_server_not_auth() {
        // Regression: previously this fell through to GitHubError::auth,
        // which the frontend treated as 'token rejected' and (worse) the
        // auto-clear effect used to wipe the keychain. A 403 with no
        // rate-limit signal usually means a SAML / scope / repo-permission
        // issue, not a bad token, so it must NOT classify as auth.
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;

        let err = fetch_prs(&http(), "tok").await.unwrap_err();
        assert!(
            matches!(err, GitHubError::Server { .. }),
            "got: {err:?} (expected Server, must not be Auth)",
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn graphql_403_with_zero_remaining_is_rate_limited() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

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
        let _endpoint = EndpointGuard::install(&server.uri());

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

    /// Body-size cap: a response whose body exceeds MAX_RESPONSE_BYTES
    /// surfaces a Server error with a size-limit message. wiremock
    /// always emits an accurate `content-length` header for `set_body_string`
    /// (hyper validates body length against the header on the receiving
    /// side, so we can't inject a lying Content-Length without the request
    /// itself failing at the protocol layer). That means in practice this
    /// test exercises the upfront Content-Length branch of `read_bounded`;
    /// the streaming branch is the safety net for servers that omit
    /// Content-Length entirely or use chunked transfer, and is best
    /// covered manually with a custom HTTP server.
    #[tokio::test(flavor = "current_thread")]
    async fn oversized_body_is_rejected_with_size_error() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        // 11 MB of bytes; just over the 10 MB cap.
        let huge = "x".repeat(11 * 1024 * 1024);
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_string(huge))
            .mount(&server)
            .await;

        let err = fetch_prs(&http(), "tok").await.unwrap_err();
        let message = match err {
            GitHubError::Server { message } => message,
            other => panic!("expected Server error, got {other:?}"),
        };
        assert!(
            message.contains("too large") || message.contains("byte cap"),
            "error should mention the size limit; got: {message}",
        );
    }

    /// A body just under the cap should pass through and decode normally
    /// (or fail later for body-shape reasons, but NOT for size). This is
    /// the lower-bound regression: confirms the cap isn't off-by-one and
    /// doesn't reject legitimate large GitHub responses.
    #[tokio::test(flavor = "current_thread")]
    async fn under_cap_body_is_not_rejected_for_size() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        // Padded to ~9 MB with `extra` JSON keys so the response is large
        // but well under the 10 MB cap. The body is still a valid GraphQL
        // shape with empty search edges, so the request succeeds.
        let padding = "x".repeat(9 * 1024 * 1024);
        let body = format!(
            r#"{{"data": {{ "search": {{ "edges": [] }} }}, "extra": "{}" }}"#,
            padding,
        );
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .mount(&server)
            .await;

        let out = fetch_prs(&http(), "tok").await.expect("under-cap body should decode");
        assert_eq!(out.prs.len(), 0);
    }
}
