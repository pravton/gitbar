mod cache;
mod github;
mod token_store;

use std::sync::Mutex;

use cache::Cache;
use github::client;
use github::models::{AuthCheck, GitHubError, Issue, PullRequest};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State};
use token_store::{KeychainTokenStore, TokenStore};
use tokio::sync::Mutex as AsyncMutex;

/// Cache TTL is set below the frontend's poll interval (60s) so every poll finds
/// stale data and triggers exactly one refresh, instead of racing with the TTL boundary.
const CACHE_TTL_SECS: u64 = 30;

pub struct AppState {
    pub(crate) cache: Mutex<Cache>,
    pub(crate) refresh_lock: AsyncMutex<()>,
    pub(crate) http: Client,
    /// Backing store for the GitHub PAT. The actual token never leaves
    /// Rust process memory + the OS keychain; the webview never sees it.
    pub(crate) token_store: Box<dyn TokenStore>,
    /// In-memory mirror of the stored token. Read on every request; keeps
    /// `get_data` off the keychain hot path. Populated from `token_store`
    /// at startup; written through to `token_store` on save/clear.
    pub(crate) token_cache: Mutex<Option<String>>,
}

impl AppState {
    pub fn new() -> Self {
        Self::with_store(Box::new(KeychainTokenStore::new()))
    }

    /// Construct with a specific [`TokenStore`]. Tests use this with
    /// [`token_store::MemoryTokenStore`] so the real keychain stays
    /// untouched.
    pub fn with_store(token_store: Box<dyn TokenStore>) -> Self {
        let initial = token_store.load();
        Self {
            cache: Mutex::new(Cache::default()),
            refresh_lock: AsyncMutex::new(()),
            http: client::build_http_client(),
            token_store,
            token_cache: Mutex::new(initial),
        }
    }

    pub(crate) fn snapshot(&self) -> Result<GitHubData, GitHubError> {
        let cache = self
            .cache
            .lock()
            .map_err(|error| GitHubError::server(format!("cache poisoned: {error}")))?;
        Ok(GitHubData {
            prs: cache.prs.clone(),
            issues: cache.issues.clone(),
            partial_message: cache.partial_message.clone(),
        })
    }

    fn current_token(&self) -> Result<String, GitHubError> {
        let guard = self
            .token_cache
            .lock()
            .map_err(|error| GitHubError::server(format!("token cache poisoned: {error}")))?;
        guard
            .clone()
            .ok_or_else(|| GitHubError::auth("no GitHub token configured"))
    }

    fn store_token(&self, token: &str) -> Result<(), GitHubError> {
        self.token_store
            .save(token)
            .map_err(GitHubError::server)?;
        let mut guard = self
            .token_cache
            .lock()
            .map_err(|error| GitHubError::server(format!("token cache poisoned: {error}")))?;
        *guard = Some(token.to_string());
        Ok(())
    }

    fn forget_token(&self) -> Result<(), GitHubError> {
        self.token_store.delete().map_err(GitHubError::server)?;
        let mut guard = self
            .token_cache
            .lock()
            .map_err(|error| GitHubError::server(format!("token cache poisoned: {error}")))?;
        *guard = None;
        // The cached PR/issue data was specific to the previous token; clear
        // it so the next get_data triggers a fresh fetch. Propagate a
        // poisoned-lock error rather than silently leaving stale data —
        // matches the behavior of `snapshot` and `refresh_if_needed`.
        let mut cache = self
            .cache
            .lock()
            .map_err(|error| GitHubError::server(format!("cache poisoned: {error}")))?;
        *cache = Cache::default();
        Ok(())
    }

    fn has_token(&self) -> bool {
        self.token_cache
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }

    /// Coalesces concurrent refreshes: while one task is fetching from GitHub, every
    /// other caller waits on `refresh_lock`. The second caller then re-checks
    /// staleness and skips the fetch if the first caller already populated the cache.
    pub(crate) async fn refresh_if_needed(&self, force: bool) -> Result<(), GitHubError> {
        if !force {
            let cache = self
                .cache
                .lock()
                .map_err(|error| GitHubError::server(format!("cache poisoned: {error}")))?;
            if !cache.is_stale(CACHE_TTL_SECS) {
                return Ok(());
            }
        }

        let _refresh_guard = self.refresh_lock.lock().await;

        if !force {
            let cache = self
                .cache
                .lock()
                .map_err(|error| GitHubError::server(format!("cache poisoned: {error}")))?;
            if !cache.is_stale(CACHE_TTL_SECS) {
                return Ok(());
            }
        }

        let token = self.current_token()?;
        let prs_outcome = client::fetch_prs(&self.http, &token).await?;
        let issues = client::fetch_issues(&self.http, &token).await?;

        let mut cache = self
            .cache
            .lock()
            .map_err(|error| GitHubError::server(format!("cache poisoned: {error}")))?;
        cache.update(prs_outcome.prs, issues, prs_outcome.partial_message);
        Ok(())
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHubData {
    pub prs: Vec<PullRequest>,
    pub issues: Vec<Issue>,
    pub partial_message: Option<String>,
}

#[tauri::command]
async fn get_data(state: State<'_, AppState>) -> Result<GitHubData, GitHubError> {
    state.refresh_if_needed(false).await?;
    state.snapshot()
}

#[tauri::command]
async fn refresh_cache(state: State<'_, AppState>) -> Result<GitHubData, GitHubError> {
    state.refresh_if_needed(true).await?;
    state.snapshot()
}

/// Validate a candidate token. Used by the onboarding screen to confirm a
/// pasted PAT works before persisting it via [`save_token`]. Takes the
/// token as an argument — this is the *only* command that does.
#[tauri::command]
async fn check_auth(
    token: String,
    state: State<'_, AppState>,
) -> Result<AuthCheck, GitHubError> {
    client::check_auth(&state.http, &token).await
}

/// Persist a token into the OS keychain and the in-memory cache.
#[tauri::command]
async fn save_token(token: String, state: State<'_, AppState>) -> Result<(), GitHubError> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err(GitHubError::auth("token cannot be empty"));
    }
    state.store_token(trimmed)
}

/// Remove the persisted token from the keychain and the cache. Also clears
/// the cached PR/issue data, since it was specific to the old identity.
#[tauri::command]
async fn clear_token(state: State<'_, AppState>) -> Result<(), GitHubError> {
    state.forget_token()
}

/// Reports whether a token is currently configured. Frontend uses this on
/// mount to decide between the onboarding screen and the list view.
#[tauri::command]
async fn has_token(state: State<'_, AppState>) -> Result<bool, GitHubError> {
    Ok(state.has_token())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::new())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                let _ = window.show();
            }

            let show = MenuItem::with_id(app, "show", "Show GitBar", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            // Left-click toggles visibility; right-click shows the menu.
            let mut tray = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            tray.on_menu_event(|app, event| match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    if let Some(window) = tray.app_handle().get_webview_window("main") {
                        let minimized = window.is_minimized().unwrap_or(false);
                        let visible = window.is_visible().unwrap_or(false);
                        if visible && !minimized {
                            let _ = window.hide();
                        } else {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            })
            .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_data,
            refresh_cache,
            check_auth,
            save_token,
            clear_token,
            has_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitBar");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::client::test_endpoint::EndpointGuard;
    use crate::token_store::MemoryTokenStore;
    use std::sync::Arc;
    use std::time::Duration;
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn empty_prs_body() -> serde_json::Value {
        serde_json::json!({ "data": { "search": { "edges": [] } } })
    }

    fn state_with_token(token: &str) -> AppState {
        let state = AppState::with_store(Box::new(MemoryTokenStore::new()));
        state.store_token(token).expect("seed token");
        state
    }

    /// Four concurrent stale callers should produce exactly one underlying refresh
    /// (= 2 PR sub-queries + 1 issues query = 3 HTTP requests), not 12.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn refresh_if_needed_coalesces_concurrent_callers() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        // Delay each response so all 4 callers reach the lock before the first finishes.
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(empty_prs_body())
                    .set_delay(Duration::from_millis(80)),
            )
            .mount(&server)
            .await;

        let state = Arc::new(state_with_token("tok"));

        let tasks: Vec<_> = (0..4)
            .map(|_| {
                let s = state.clone();
                tokio::spawn(async move { s.refresh_if_needed(false).await })
            })
            .collect();

        for handle in tasks {
            handle.await.expect("task did not panic").expect("refresh ok");
        }

        let received = server.received_requests().await.unwrap();
        assert_eq!(
            received.len(),
            3,
            "single-flight: 4 concurrent callers should produce 1 refresh = 3 requests, got {}",
            received.len()
        );
    }

    /// A second `force=false` call after a successful refresh should hit the cache,
    /// not the network.
    #[tokio::test(flavor = "current_thread")]
    async fn refresh_if_needed_skips_network_when_cache_fresh() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(empty_prs_body()))
            .mount(&server)
            .await;

        let state = state_with_token("tok");
        state.refresh_if_needed(false).await.unwrap();
        let first_count = server.received_requests().await.unwrap().len();

        state.refresh_if_needed(false).await.unwrap();
        let second_count = server.received_requests().await.unwrap().len();

        assert_eq!(first_count, second_count, "cached call must not hit network");
    }

    /// `force=true` must always refresh, even when the cache is fresh.
    #[tokio::test(flavor = "current_thread")]
    async fn force_refresh_always_hits_network() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(empty_prs_body()))
            .mount(&server)
            .await;

        let state = state_with_token("tok");
        state.refresh_if_needed(false).await.unwrap();
        let first = server.received_requests().await.unwrap().len();

        state.refresh_if_needed(true).await.unwrap();
        let second = server.received_requests().await.unwrap().len();

        assert!(second > first, "force=true must produce additional requests");
    }

    /// Without a token configured, `refresh_if_needed` returns an auth error
    /// without reaching out to the network.
    #[tokio::test(flavor = "current_thread")]
    async fn refresh_without_token_returns_auth_error() {
        let state = AppState::with_store(Box::new(MemoryTokenStore::new()));
        let err = state.refresh_if_needed(false).await.unwrap_err();
        assert!(matches!(err, GitHubError::Auth { .. }), "got: {err:?}");
    }

    /// Wire-format snapshot for `GitHubData`. Mirror in `src/types.ts` when
    /// you change this. See the parallel `wire_format_snapshots` module in
    /// `github::models` for the rationale.
    #[test]
    fn github_data_wire_shape() {
        let value = GitHubData {
            prs: vec![],
            issues: vec![],
            partial_message: Some("Review query failed.".into()),
        };
        let actual = serde_json::to_string_pretty(&value).expect("serialize");
        let expected = r#"{
  "prs": [],
  "issues": [],
  "partial_message": "Review query failed."
}"#;
        assert_eq!(actual, expected);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn save_and_forget_token_persists_through_store() {
        let store = Box::new(MemoryTokenStore::new());
        let state = AppState::with_store(store);

        assert!(!state.has_token());
        state.store_token("ghp_a").unwrap();
        assert!(state.has_token());

        state.forget_token().unwrap();
        assert!(!state.has_token());
    }

    /// After `forget_token`, the cached PR/issue data is wiped so the next
    /// fetch under a different identity starts clean.
    #[tokio::test(flavor = "current_thread")]
    async fn forget_token_clears_cached_data() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(empty_prs_body()))
            .mount(&server)
            .await;

        let state = state_with_token("tok");
        state.refresh_if_needed(false).await.unwrap();
        // Cache is now fresh.
        assert!(state.snapshot().is_ok());

        state.forget_token().unwrap();
        // Next snapshot still works (returns empty), and `refresh_if_needed`
        // would now require a re-seeded token to fetch.
        assert!(state.snapshot().is_ok());
        let err = state.refresh_if_needed(false).await.unwrap_err();
        assert!(matches!(err, GitHubError::Auth { .. }));
    }

    /// Store seeded on disk before AppState boots is picked up by `new()`.
    #[test]
    fn appstate_loads_existing_token_on_construction() {
        let store = MemoryTokenStore::new();
        store.save("ghp_pre").unwrap();

        let state = AppState::with_store(Box::new(store));
        assert!(state.has_token(), "token from store should be loaded on construct");
    }
}
