use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::{Client, StatusCode};

use crate::github::models::GitHubError;

const DEFAULT_NOTIFICATIONS_URL: &str = "https://api.github.com/notifications";

/// Resolves the notifications-check endpoint. Mirrors
/// `client::endpoint()`: the `GITBAR_GITHUB_NOTIFICATIONS_URL` override is
/// honored only in debug builds so a manipulated environment variable can't
/// redirect PAT-bearing requests in a release build.
fn endpoint() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(url) = std::env::var("GITBAR_GITHUB_NOTIFICATIONS_URL") {
            return url;
        }
    }
    DEFAULT_NOTIFICATIONS_URL.to_string()
}

/// Result of a single conditional check against `GET /notifications`.
#[derive(Debug)]
pub struct NotificationsCheckOutcome {
    /// `true` on HTTP 200 (something may have changed since the last
    /// check), `false` on HTTP 304 (nothing new).
    pub changed: bool,
    /// The response's `Last-Modified` header, to echo back as
    /// `If-Modified-Since` on the next check. `None` when GitHub didn't
    /// send one on this particular response: callers should not treat
    /// that as "clear the previously stored value", only as "this
    /// response didn't update it".
    pub last_modified: Option<String>,
}

/// Cheap tripwire for "has anything relevant happened since we last
/// looked?", used to gate the expensive GraphQL PR/issue search behind a
/// conditional request instead of running it unconditionally on every poll
/// tick. `GET /notifications` works on the `repo` scope GitBar already
/// requires (confirmed against GitHub's docs; no additional PAT scope
/// needed) and supports `Last-Modified`/`If-Modified-Since` conditional
/// requests, so an unchanged poll costs a `304` instead of a full search.
///
/// `per_page=1` and the body is never parsed: only the status code and the
/// `Last-Modified` header carry information we act on, so there's nothing
/// to gain from fetching (or paginating through) the actual notification
/// list.
pub async fn check_notifications(
    client: &Client,
    token: &str,
    if_modified_since: Option<&str>,
) -> Result<NotificationsCheckOutcome, GitHubError> {
    if token.trim().is_empty() {
        return Err(GitHubError::auth("missing GitHub token"));
    }

    let mut request = client
        .get(format!("{}?per_page=1", endpoint()))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(USER_AGENT, "gitbar")
        .header(ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");

    if let Some(value) = if_modified_since {
        request = request.header("If-Modified-Since", value);
    }

    let response = request
        .send()
        .await
        .map_err(|error| GitHubError::network(error.to_string()))?;

    let status = response.status();

    let last_modified = response
        .headers()
        .get("last-modified")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    if status == StatusCode::NOT_MODIFIED {
        return Ok(NotificationsCheckOutcome { changed: false, last_modified });
    }
    if status == StatusCode::UNAUTHORIZED {
        return Err(GitHubError::auth("GitHub rejected the token (401)"));
    }
    if status == StatusCode::FORBIDDEN {
        // Same split as client.rs's graphql(): a 403 is either exhausted
        // rate limit or some other denial (missing scope, abuse
        // detection, etc.), distinguished by the rate-limit headers.
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
                "GitHub returned 403 on the notifications check",
            ))
        };
    }
    if !status.is_success() {
        return Err(GitHubError::server(format!(
            "GitHub returned HTTP {status} on the notifications check"
        )));
    }

    // 200: something may have changed. We don't care about the body's
    // shape at all (see the doc comment above), just that the request
    // succeeded without error so the connection is left in a clean state
    // for reuse by the shared `reqwest::Client`.
    let _ = response
        .bytes()
        .await
        .map_err(|error| GitHubError::network(error.to_string()))?;

    Ok(NotificationsCheckOutcome { changed: true, last_modified })
}

#[cfg(test)]
pub(crate) mod test_endpoint {
    //! Mirrors `client::test_endpoint`: an `EndpointGuard` takes a
    //! process-wide mutex so concurrent tests can't stomp on each other's
    //! `GITBAR_GITHUB_NOTIFICATIONS_URL`, and restores the previous value
    //! on drop.
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
            let prev = std::env::var("GITBAR_GITHUB_NOTIFICATIONS_URL").ok();
            std::env::set_var("GITBAR_GITHUB_NOTIFICATIONS_URL", url);
            Self { prev, _lock: lock }
        }
    }

    impl Drop for EndpointGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var("GITBAR_GITHUB_NOTIFICATIONS_URL", v),
                None => std::env::remove_var("GITBAR_GITHUB_NOTIFICATIONS_URL"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_endpoint::EndpointGuard;
    use super::*;
    use wiremock::matchers::{header, method};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn http() -> Client {
        Client::new()
    }

    #[tokio::test(flavor = "current_thread")]
    async fn sends_expected_headers_and_query_with_no_if_modified_since() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;

        check_notifications(&http(), "tok", None).await.expect("ok");

        let requests = server.received_requests().await.expect("requests recorded");
        assert_eq!(requests.len(), 1);
        let req = &requests[0];
        assert_eq!(req.url.query(), Some("per_page=1"));
        assert_eq!(req.headers.get("authorization").unwrap(), "Bearer tok");
        assert!(req.headers.get("if-modified-since").is_none());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn sends_if_modified_since_when_provided() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        // wiremock's `header()` matcher splits values on commas (it's meant
        // for genuinely multi-valued headers), so a real HTTP-date value
        // like "Wed, 01 Jan 2026 00:00:00 GMT" fails to match itself here.
        // The code treats this value as an opaque string regardless, so a
        // comma-free token exercises the same header-forwarding behavior.
        Mock::given(method("GET"))
            .and(header("if-modified-since", "opaque-cursor-value"))
            .respond_with(ResponseTemplate::new(304))
            .mount(&server)
            .await;

        let out = check_notifications(&http(), "tok", Some("opaque-cursor-value"))
            .await
            .expect("ok");
        assert!(!out.changed);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn returns_changed_true_on_200_and_captures_last_modified() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("Last-Modified", "Thu, 02 Jan 2026 00:00:00 GMT")
                    .set_body_string("[]"),
            )
            .mount(&server)
            .await;

        let out = check_notifications(&http(), "tok", None).await.expect("ok");
        assert!(out.changed);
        assert_eq!(out.last_modified.as_deref(), Some("Thu, 02 Jan 2026 00:00:00 GMT"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn returns_changed_false_on_304() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(304))
            .mount(&server)
            .await;

        let out = check_notifications(&http(), "tok", None).await.expect("ok");
        assert!(!out.changed);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn preserves_no_last_modified_when_304_omits_header() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(304))
            .mount(&server)
            .await;

        let out = check_notifications(&http(), "tok", Some("stale-value"))
            .await
            .expect("ok");
        assert!(!out.changed);
        assert_eq!(out.last_modified, None);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn maps_401_to_auth_error() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        let err = check_notifications(&http(), "tok", None).await.unwrap_err();
        assert!(matches!(err, GitHubError::Auth { .. }));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn maps_403_rate_limited_when_remaining_zero() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(403)
                    .insert_header("x-ratelimit-remaining", "0")
                    .insert_header("retry-after", "30"),
            )
            .mount(&server)
            .await;

        let err = check_notifications(&http(), "tok", None).await.unwrap_err();
        match err {
            GitHubError::RateLimited { retry_after_secs, .. } => {
                assert_eq!(retry_after_secs, Some(30));
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn maps_generic_403_to_server_error() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;

        let err = check_notifications(&http(), "tok", None).await.unwrap_err();
        assert!(matches!(err, GitHubError::Server { .. }));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn maps_5xx_to_server_error() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let err = check_notifications(&http(), "tok", None).await.unwrap_err();
        assert!(matches!(err, GitHubError::Server { .. }));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn rejects_empty_token() {
        let err = check_notifications(&http(), "", None).await.unwrap_err();
        assert!(matches!(err, GitHubError::Auth { .. }));
    }
}
