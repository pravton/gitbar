mod cache;
mod github;

use std::sync::Mutex;

use cache::Cache;
use github::client;
use github::models::{AuthCheck, GitHubError, Issue, PullRequest};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State};
use tokio::sync::Mutex as AsyncMutex;

/// Cache TTL is set below the frontend's poll interval (60s) so every poll finds
/// stale data and triggers exactly one refresh, instead of racing with the TTL boundary.
const CACHE_TTL_SECS: u64 = 30;

pub struct AppState {
    pub(crate) cache: Mutex<Cache>,
    pub(crate) refresh_lock: AsyncMutex<()>,
    pub(crate) http: Client,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(Cache::default()),
            refresh_lock: AsyncMutex::new(()),
            http: client::build_http_client(),
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

    /// Coalesces concurrent refreshes: while one task is fetching from GitHub, every
    /// other caller waits on `refresh_lock`. The second caller then re-checks
    /// staleness and skips the fetch if the first caller already populated the cache.
    pub(crate) async fn refresh_if_needed(
        &self,
        token: &str,
        force: bool,
    ) -> Result<(), GitHubError> {
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

        let prs_outcome = client::fetch_prs(&self.http, token).await?;
        let issues = client::fetch_issues(&self.http, token).await?;

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
async fn get_data(token: String, state: State<'_, AppState>) -> Result<GitHubData, GitHubError> {
    state.refresh_if_needed(&token, false).await?;
    state.snapshot()
}

#[tauri::command]
async fn refresh_cache(
    token: String,
    state: State<'_, AppState>,
) -> Result<GitHubData, GitHubError> {
    state.refresh_if_needed(&token, true).await?;
    state.snapshot()
}

#[tauri::command]
async fn check_auth(
    token: String,
    state: State<'_, AppState>,
) -> Result<AuthCheck, GitHubError> {
    client::check_auth(&state.http, &token).await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
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
        .invoke_handler(tauri::generate_handler![get_data, refresh_cache, check_auth])
        .run(tauri::generate_context!())
        .expect("error while running GitBar");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::client::test_endpoint::EndpointGuard;
    use std::sync::Arc;
    use std::time::Duration;
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn empty_prs_body() -> serde_json::Value {
        serde_json::json!({ "data": { "search": { "edges": [] } } })
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

        let state = Arc::new(AppState::new());

        let tasks: Vec<_> = (0..4)
            .map(|_| {
                let s = state.clone();
                tokio::spawn(async move { s.refresh_if_needed("tok", false).await })
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

        let state = AppState::new();
        state.refresh_if_needed("tok", false).await.unwrap();
        let first_count = server.received_requests().await.unwrap().len();

        state.refresh_if_needed("tok", false).await.unwrap();
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

        let state = AppState::new();
        state.refresh_if_needed("tok", false).await.unwrap();
        let first = server.received_requests().await.unwrap().len();

        state.refresh_if_needed("tok", true).await.unwrap();
        let second = server.received_requests().await.unwrap().len();

        assert!(second > first, "force=true must produce additional requests");
    }
}
