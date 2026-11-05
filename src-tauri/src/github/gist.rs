//! Cross-machine filter sync: one secret gist on the user's account holds
//! filters and presets as JSON. Opt-in, and only ever called from the
//! Settings toggle and the frontend's sync cycle. This module moves the
//! JSON as an opaque string; merging lives in `src/lib/filterSync.ts`.

use std::collections::HashMap;

use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::{Client, RequestBuilder, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::github::models::GitHubError;

const DEFAULT_GISTS_URL: &str = "https://api.github.com/gists";
pub const GIST_DESCRIPTION: &str = "gitbar-filter-sync";
pub const GIST_FILENAME: &str = "gitbar-filters.json";
/// Filters and a few presets are a few KB. Refuses to write anything
/// close to GitHub's 1 MB inline content limit, past which reads truncate.
const MAX_PAYLOAD_BYTES: usize = 512 * 1024;
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const PER_PAGE: usize = 100;
/// Bounds the search on accounts with a very large number of gists. The
/// list is newest-updated first, so an active sync gist is on an early page.
const MAX_LIST_PAGES: u32 = 10;

const MISSING_SCOPE: &str = "This token can't use gists. Add the gist scope (classic token) \
    or Gists read and write (fine-grained token).";

/// Resolves the gists endpoint. Mirrors `client::endpoint()`: the override
/// is honored only in debug builds so a manipulated environment variable
/// can't redirect PAT-bearing requests in a release build.
fn endpoint() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(url) = std::env::var("GITBAR_GITHUB_GISTS_URL") {
            return url;
        }
    }
    DEFAULT_GISTS_URL.to_string()
}

/// Result of `gist_sync_enable`: which account and gist sync is bound to.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct GistSyncTarget {
    pub login: String,
    pub gist_id: String,
}

#[derive(Debug, Deserialize)]
struct GistSummary {
    id: String,
    description: Option<String>,
    public: bool,
    files: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct GistDetail {
    files: HashMap<String, GistFile>,
}

#[derive(Debug, Deserialize)]
struct GistFile {
    content: Option<String>,
    #[serde(default)]
    truncated: bool,
}

/// Finds the sync gist, or creates a secret one holding `initial_payload`.
pub async fn find_or_create(
    client: &Client,
    token: &str,
    initial_payload: &str,
) -> Result<String, GitHubError> {
    check_payload(initial_payload)?;
    if let Some(id) = find(client, token).await? {
        return Ok(id);
    }
    let response = send(
        client
            .post(endpoint())
            .json(&json!({
                "description": GIST_DESCRIPTION,
                "public": false,
                "files": { GIST_FILENAME: { "content": initial_payload } },
            })),
        token,
    )
    .await?;
    #[derive(Deserialize)]
    struct Created {
        id: String,
    }
    Ok(parse::<Created>(response).await?.id)
}

/// The sync file's content. `None` when the gist exists but the file is
/// gone, which the next push recreates.
pub async fn pull(
    client: &Client,
    token: &str,
    gist_id: &str,
) -> Result<Option<String>, GitHubError> {
    check_gist_id(gist_id)?;
    let response = send(client.get(format!("{}/{gist_id}", endpoint())), token).await?;
    let mut gist = parse::<GistDetail>(response).await?;
    match gist.files.remove(GIST_FILENAME) {
        // A truncated read isn't valid JSON, and merging it would lose data.
        Some(file) if file.truncated => {
            Err(GitHubError::server("the sync gist is too large to read"))
        }
        Some(file) => Ok(file.content),
        None => Ok(None),
    }
}

pub async fn push(
    client: &Client,
    token: &str,
    gist_id: &str,
    payload: &str,
) -> Result<(), GitHubError> {
    check_gist_id(gist_id)?;
    check_payload(payload)?;
    send(
        client
            .patch(format!("{}/{gist_id}", endpoint()))
            .json(&json!({ "files": { GIST_FILENAME: { "content": payload } } })),
        token,
    )
    .await?;
    Ok(())
}

async fn find(client: &Client, token: &str) -> Result<Option<String>, GitHubError> {
    for page in 1..=MAX_LIST_PAGES {
        let response = send(
            client.get(format!("{}?per_page={PER_PAGE}&page={page}", endpoint())),
            token,
        )
        .await?;
        // Classic tokens report their scopes, and without `gist` sync
        // can't write, so refuse up front. Fine-grained tokens send no
        // header; a missing permission shows up as a 403 on the create.
        if page == 1 {
            let scopes = response
                .headers()
                .get("x-oauth-scopes")
                .and_then(|h| h.to_str().ok());
            if let Some(scopes) = scopes {
                if !scopes.split(',').any(|s| s.trim() == "gist") {
                    return Err(GitHubError::server(MISSING_SCOPE));
                }
            }
        }
        let gists = parse::<Vec<GistSummary>>(response).await?;
        let count = gists.len();
        // Never adopt a public gist, even one with the right name: that
        // would publish the user's filters.
        let found = gists.into_iter().find(|g| {
            !g.public
                && g.description.as_deref() == Some(GIST_DESCRIPTION)
                && g.files.contains_key(GIST_FILENAME)
        });
        if let Some(gist) = found {
            return Ok(Some(gist.id));
        }
        if count < PER_PAGE {
            break;
        }
    }
    Ok(None)
}

async fn send(request: RequestBuilder, token: &str) -> Result<Response, GitHubError> {
    if token.trim().is_empty() {
        return Err(GitHubError::auth("missing GitHub token"));
    }
    let response = request
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(USER_AGENT, "gitbar")
        .header(ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|error| GitHubError::network(error.to_string()))?;

    let status = response.status();
    if status == StatusCode::UNAUTHORIZED {
        return Err(GitHubError::auth("GitHub rejected the token (401)"));
    }
    if status == StatusCode::FORBIDDEN {
        // Same split as client.rs's graphql(), by the rate-limit headers.
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|h| h.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
        };
        return if header("x-ratelimit-remaining") == Some(0) {
            Err(GitHubError::rate_limited(
                "GitHub API rate limit exhausted",
                header("retry-after"),
            ))
        } else {
            Err(GitHubError::server(MISSING_SCOPE))
        };
    }
    if status == StatusCode::NOT_FOUND {
        return Err(GitHubError::server(
            "Sync gist not found or not accessible. Turn sync off and on to set it up again.",
        ));
    }
    if !status.is_success() {
        return Err(GitHubError::server(format!("GitHub returned HTTP {status}")));
    }
    Ok(response)
}

async fn parse<T: serde::de::DeserializeOwned>(mut response: Response) -> Result<T, GitHubError> {
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| GitHubError::network(error.to_string()))?
    {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(GitHubError::server("GitHub gist response too large"));
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body)
        .map_err(|error| GitHubError::server(format!("unexpected gist response: {error}")))
}

/// The id comes from JS and goes into a PAT-bearing URL, so it must not
/// be able to change the path.
fn check_gist_id(id: &str) -> Result<(), GitHubError> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(GitHubError::server("invalid gist id"));
    }
    Ok(())
}

fn check_payload(payload: &str) -> Result<(), GitHubError> {
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err(GitHubError::server("filter data is too large to sync"));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod test_endpoint {
    //! Mirrors `client::test_endpoint` for `GITBAR_GITHUB_GISTS_URL`.
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
            let prev = std::env::var("GITBAR_GITHUB_GISTS_URL").ok();
            std::env::set_var("GITBAR_GITHUB_GISTS_URL", url);
            Self { prev, _lock: lock }
        }
    }

    impl Drop for EndpointGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var("GITBAR_GITHUB_GISTS_URL", v),
                None => std::env::remove_var("GITBAR_GITHUB_GISTS_URL"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_endpoint::EndpointGuard;
    use super::*;
    use wiremock::matchers::{body_partial_json, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn summary(id: &str, description: &str, public: bool, file: &str) -> serde_json::Value {
        json!({ "id": id, "description": description, "public": public, "files": { file: {} } })
    }

    fn list(body: serde_json::Value) -> ResponseTemplate {
        ResponseTemplate::new(200)
            .insert_header("x-oauth-scopes", "repo, gist")
            .set_body_json(body)
    }

    #[tokio::test(flavor = "current_thread")]
    async fn adopts_an_existing_secret_gist_without_creating() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&format!("{}/gists", server.uri()));
        Mock::given(method("GET"))
            .and(path("/gists"))
            .respond_with(list(json!([
                summary("other", "something else", false, GIST_FILENAME),
                summary("wrongfile", GIST_DESCRIPTION, false, "notes.md"),
                summary("found1", GIST_DESCRIPTION, false, GIST_FILENAME),
            ])))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(201).set_body_json(json!({ "id": "new" })))
            .expect(0)
            .mount(&server)
            .await;

        let id = find_or_create(&Client::new(), "tok", "{}").await.expect("ok");
        assert_eq!(id, "found1");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn never_adopts_a_public_gist_and_creates_a_secret_one() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&format!("{}/gists", server.uri()));
        Mock::given(method("GET"))
            .and(path("/gists"))
            .respond_with(list(json!([summary("pub", GIST_DESCRIPTION, true, GIST_FILENAME)])))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/gists"))
            .and(body_partial_json(json!({
                "description": GIST_DESCRIPTION,
                "public": false,
                "files": { GIST_FILENAME: { "content": "{\"a\":1}" } },
            })))
            .respond_with(ResponseTemplate::new(201).set_body_json(json!({ "id": "new1" })))
            .expect(1)
            .mount(&server)
            .await;

        let id = find_or_create(&Client::new(), "tok", "{\"a\":1}").await.expect("ok");
        assert_eq!(id, "new1");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn searches_later_pages() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&format!("{}/gists", server.uri()));
        let full: Vec<_> = (0..PER_PAGE)
            .map(|i| summary(&format!("g{i}"), "other", false, "x"))
            .collect();
        Mock::given(method("GET"))
            .and(query_param("page", "1"))
            .respond_with(list(json!(full)))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(query_param("page", "2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([summary(
                "p2",
                GIST_DESCRIPTION,
                false,
                GIST_FILENAME
            )])))
            .mount(&server)
            .await;

        let id = find_or_create(&Client::new(), "tok", "{}").await.expect("ok");
        assert_eq!(id, "p2");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn classic_token_without_gist_scope_is_refused_before_creating() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&format!("{}/gists", server.uri()));
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("x-oauth-scopes", "repo, read:org")
                    .set_body_json(json!([])),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(201).set_body_json(json!({ "id": "new" })))
            .expect(0)
            .mount(&server)
            .await;

        let err = find_or_create(&Client::new(), "tok", "{}").await.unwrap_err();
        assert!(matches!(&err, GitHubError::Server { message } if message.contains("gist scope")), "got: {err:?}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fine_grained_token_without_permission_gets_the_scope_message() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&format!("{}/gists", server.uri()));
        // No x-oauth-scopes header, as for a fine-grained token.
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;

        let err = find_or_create(&Client::new(), "tok", "{}").await.unwrap_err();
        assert!(matches!(&err, GitHubError::Server { message } if message.contains("gist scope")), "got: {err:?}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn pull_returns_the_file_or_none_and_rejects_truncation() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&format!("{}/gists", server.uri()));
        Mock::given(method("GET"))
            .and(path("/gists/ok"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "files": { GIST_FILENAME: { "content": "{\"version\":1}", "truncated": false } }
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/gists/nofile"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "files": {} })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/gists/big"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "files": { GIST_FILENAME: { "content": "{\"ver", "truncated": true } }
            })))
            .mount(&server)
            .await;

        let client = Client::new();
        assert_eq!(pull(&client, "t", "ok").await.expect("ok").as_deref(), Some("{\"version\":1}"));
        assert_eq!(pull(&client, "t", "nofile").await.expect("ok"), None);
        assert!(pull(&client, "t", "big").await.is_err());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn missing_gist_says_how_to_recover() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&format!("{}/gists", server.uri()));
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let err = pull(&Client::new(), "t", "gone").await.unwrap_err();
        assert!(matches!(&err, GitHubError::Server { message } if message.contains("Turn sync off and on")), "got: {err:?}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn push_patches_the_file_and_maps_rate_limit() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&format!("{}/gists", server.uri()));
        Mock::given(method("PATCH"))
            .and(path("/gists/abc123"))
            .and(body_partial_json(json!({ "files": { GIST_FILENAME: { "content": "{}" } } })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("PATCH"))
            .and(path("/gists/limited"))
            .respond_with(
                ResponseTemplate::new(403)
                    .insert_header("x-ratelimit-remaining", "0")
                    .insert_header("retry-after", "60"),
            )
            .mount(&server)
            .await;

        let client = Client::new();
        push(&client, "t", "abc123", "{}").await.expect("ok");
        let err = push(&client, "t", "limited", "{}").await.unwrap_err();
        assert!(matches!(err, GitHubError::RateLimited { .. }), "got: {err:?}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn rejects_bad_ids_and_oversized_payloads_without_a_request() {
        let client = Client::new();
        for id in ["", "../user", "a/b", "a?x=1", &"a".repeat(65)] {
            assert!(pull(&client, "t", id).await.is_err(), "accepted {id:?}");
        }
        let big = "x".repeat(MAX_PAYLOAD_BYTES + 1);
        assert!(push(&client, "t", "abc", &big).await.is_err());
        assert!(find_or_create(&client, "t", &big).await.is_err());
    }
}
