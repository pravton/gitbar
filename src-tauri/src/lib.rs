mod cache;
mod disk_cache;
mod github;
mod token_store;

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use cache::Cache;
use disk_cache::{DiskCache, JsonFileDiskCache, PersistedCache, CACHE_FORMAT_VERSION};
use github::client;
use github::models::{AuthCheck, GitHubError, Issue, PullRequest};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
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
    /// Persistent disk cache for the last successful refresh. Loaded on
    /// startup, written on every successful refresh (off the async
    /// runtime via `spawn_blocking`), cleared on `forget_token`. Stored
    /// as `Arc` so the save closure can be cheaply cloned into the
    /// blocking task.
    pub(crate) disk_cache: Arc<dyn DiskCache>,
}

impl AppState {
    pub fn new() -> Self {
        // If the platform doesn't expose a data dir (vanishingly rare),
        // fall back to a no-op disk cache so the app still functions
        // without persistence.
        let disk: Arc<dyn DiskCache> = match JsonFileDiskCache::for_app() {
            Some(impl_) => Arc::new(impl_),
            None => {
                eprintln!("gitbar: no platform data dir; running without disk cache");
                Arc::new(NoOpDiskCache)
            }
        };
        Self::with_stores(Box::new(KeychainTokenStore::new()), disk)
    }

    /// Construct with explicit stores. Tests use this with
    /// [`token_store::MemoryTokenStore`] and
    /// [`disk_cache::MemoryDiskCache`] so the real keychain and disk
    /// stay untouched.
    pub fn with_stores(
        token_store: Box<dyn TokenStore>,
        disk_cache: Arc<dyn DiskCache>,
    ) -> Self {
        let initial_token = token_store.load();
        let mut initial_cache = Cache::default();
        // Hydrate from disk if we have a stored snapshot. `last_fetch`
        // stays `None` so the next get_data still triggers a refresh —
        // we just give the UI immediate data to render while that
        // refresh is in flight.
        if let Some(snapshot) = disk_cache.load() {
            initial_cache.hydrate(
                snapshot.prs,
                snapshot.issues,
                snapshot.partial_message,
                snapshot.fetched_at,
            );
        }
        Self {
            cache: Mutex::new(initial_cache),
            refresh_lock: AsyncMutex::new(()),
            http: client::build_http_client(),
            token_store,
            token_cache: Mutex::new(initial_token),
            disk_cache,
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
            last_fetched_at_ms: cache.last_fetch_at.and_then(system_time_to_ms),
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
        // Drop the on-disk snapshot too, otherwise the next launch would
        // re-hydrate the previous identity's PR/issue list.
        self.disk_cache.clear();
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
        // Run the two underlying fetches concurrently and cap each at 15s.
        // Sequential previously meant up to ~2 round-trip latencies per
        // refresh, and a single hung TCP connection could wedge every
        // subsequent caller for the full reqwest 30s timeout. Per-call
        // timeout below 30s also gives faster feedback on flaky networks.
        const FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
        let prs_fut = tokio::time::timeout(FETCH_TIMEOUT, client::fetch_prs(&self.http, &token));
        let issues_fut =
            tokio::time::timeout(FETCH_TIMEOUT, client::fetch_issues(&self.http, &token));
        let (prs_result, issues_result) = tokio::join!(prs_fut, issues_fut);
        let prs_outcome = prs_result
            .map_err(|_| GitHubError::network("PR fetch timed out after 15s"))??;
        let issues = issues_result
            .map_err(|_| GitHubError::network("issue fetch timed out after 15s"))??;

        // Token may have been cleared while we were awaiting the
        // network (user clicked Disconnect mid-flight). If so, abandon
        // the write — otherwise we'd repopulate the in-memory cache and
        // disk snapshot with the previous identity's data after the
        // user just cleared everything.
        self.current_token()?;

        let mut cache = self
            .cache
            .lock()
            .map_err(|error| GitHubError::server(format!("cache poisoned: {error}")))?;
        cache.update(prs_outcome.prs, issues, prs_outcome.partial_message);

        // Build the persistence snapshot from the cache state we just
        // wrote, then hand it off to a blocking task. Disk I/O is
        // strictly best-effort: a failure inside the spawn is logged
        // (by JsonFileDiskCache) but never propagates back. Doing it
        // off-thread keeps a slow filesystem (network share, full
        // disk, antivirus scan) from stalling Tokio's executor.
        let snapshot = PersistedCache {
            version: CACHE_FORMAT_VERSION,
            prs: cache.prs.clone(),
            issues: cache.issues.clone(),
            partial_message: cache.partial_message.clone(),
            fetched_at: cache.last_fetch_at.unwrap_or_else(SystemTime::now),
        };
        // Drop the cache lock before scheduling the disk write so any
        // concurrent read isn't gated on the spawn dispatch.
        drop(cache);
        let disk = self.disk_cache.clone();
        tokio::task::spawn_blocking(move || disk.save(&snapshot));

        Ok(())
    }
}

fn system_time_to_ms(t: SystemTime) -> Option<u64> {
    t.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| u64::try_from(d.as_millis()).ok())
}

/// Used by `AppState::new` when `dirs::data_local_dir()` returns None.
/// Doesn't persist anything but keeps the code path uniform.
struct NoOpDiskCache;

impl DiskCache for NoOpDiskCache {
    fn load(&self) -> Option<PersistedCache> {
        None
    }
    fn save(&self, _value: &PersistedCache) {}
    fn clear(&self) {}
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
    /// Wall-clock time of the underlying fetch, in milliseconds since
    /// the Unix epoch. `None` only when the cache is empty (first
    /// launch, no prior data on disk). Disk-hydrated responses carry
    /// the timestamp of the original fetch so the UI's "Updated X ago"
    /// reflects real age, not "now".
    pub last_fetched_at_ms: Option<u64>,
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
    use crate::disk_cache::MemoryDiskCache;
    use crate::github::client::test_endpoint::EndpointGuard;
    use crate::token_store::MemoryTokenStore;
    use std::sync::Arc;
    use std::time::Duration;
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn empty_prs_body() -> serde_json::Value {
        serde_json::json!({ "data": { "search": { "edges": [] } } })
    }

    fn test_state() -> AppState {
        AppState::with_stores(
            Box::new(MemoryTokenStore::new()),
            Arc::new(MemoryDiskCache::new()),
        )
    }

    fn state_with_token(token: &str) -> AppState {
        let state = test_state();
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
        let state = test_state();
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
            last_fetched_at_ms: Some(1747700000000),
        };
        let actual = serde_json::to_string_pretty(&value).expect("serialize");
        let expected = r#"{
  "prs": [],
  "issues": [],
  "partial_message": "Review query failed.",
  "last_fetched_at_ms": 1747700000000
}"#;
        assert_eq!(actual, expected);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn save_and_forget_token_persists_through_store() {
        let state = test_state();

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

        let state = AppState::with_stores(
            Box::new(store),
            Arc::new(MemoryDiskCache::new()),
        );
        assert!(state.has_token(), "token from store should be loaded on construct");
    }

    /// A successful refresh persists the snapshot to disk.
    /// Uses a multi_thread runtime so `spawn_blocking` for the disk
    /// write actually runs to completion before the test asserts.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn refresh_persists_to_disk_cache() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(empty_prs_body()))
            .mount(&server)
            .await;

        let disk = Arc::new(MemoryDiskCache::new());
        let state = AppState::with_stores(
            Box::new(MemoryTokenStore::new()),
            disk.clone(),
        );
        state.store_token("tok").unwrap();

        assert!(disk.load().is_none(), "disk empty before refresh");
        state.refresh_if_needed(false).await.unwrap();

        // The disk save is dispatched via spawn_blocking; give it a
        // moment to land. Poll up to ~500ms.
        for _ in 0..50 {
            if disk.load().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(disk.load().is_some(), "disk written after successful refresh");
    }

    /// AppState constructed with a pre-populated disk cache should
    /// hydrate from it without needing a network round-trip.
    #[test]
    fn appstate_hydrates_from_disk_cache_on_construct() {
        let disk = Arc::new(MemoryDiskCache::new());
        let stored_at = SystemTime::now() - Duration::from_secs(120);
        disk.save(&PersistedCache {
            version: CACHE_FORMAT_VERSION,
            prs: vec![],
            issues: vec![],
            partial_message: Some("warmed cache".into()),
            fetched_at: stored_at,
        });

        let state = AppState::with_stores(
            Box::new(MemoryTokenStore::new()),
            disk,
        );
        let snap = state.snapshot().expect("snapshot ok");
        assert_eq!(snap.partial_message.as_deref(), Some("warmed cache"));
        assert!(snap.last_fetched_at_ms.is_some(), "wall-clock ts hydrated");
    }

    /// `forget_token` also wipes the disk cache so a future identity
    /// doesn't see the previous user's PRs/issues on next launch.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn forget_token_clears_disk_cache() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(empty_prs_body()))
            .mount(&server)
            .await;

        let disk = Arc::new(MemoryDiskCache::new());
        let state = AppState::with_stores(
            Box::new(MemoryTokenStore::new()),
            disk.clone(),
        );
        state.store_token("tok").unwrap();
        state.refresh_if_needed(false).await.unwrap();
        for _ in 0..50 {
            if disk.load().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(disk.load().is_some());

        state.forget_token().unwrap();
        assert!(disk.load().is_none(), "disk cache cleared on disconnect");
    }

    /// Token cleared mid-flight (after fetch_prs/fetch_issues complete
    /// but before the cache + disk write) must not be repopulated by
    /// the in-flight refresh — that would leak the previous identity's
    /// data through the disk snapshot after the user disconnected.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn refresh_aborts_if_token_cleared_after_network_call() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        // Slow response: gives us time to clear the token after the
        // refresh has started awaiting network but before it returns.
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(empty_prs_body())
                    .set_delay(Duration::from_millis(150)),
            )
            .mount(&server)
            .await;

        let disk = Arc::new(MemoryDiskCache::new());
        let state = Arc::new(AppState::with_stores(
            Box::new(MemoryTokenStore::new()),
            disk.clone(),
        ));
        state.store_token("tok").unwrap();

        let refresh_state = state.clone();
        let refresh = tokio::spawn(async move {
            refresh_state.refresh_if_needed(false).await
        });

        // Clear the token while the refresh is awaiting network.
        tokio::time::sleep(Duration::from_millis(20)).await;
        state.forget_token().unwrap();

        // The refresh should bail with an auth error (token gone),
        // not silently persist the previous identity's data.
        let result = refresh.await.expect("task panicked");
        assert!(
            matches!(result, Err(GitHubError::Auth { .. })),
            "got: {result:?}",
        );
        assert!(disk.load().is_none(), "disk must NOT have stale data");
    }
}
