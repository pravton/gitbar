mod accounts;
mod cache;
mod disk_cache;
mod github;
mod token_store;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use accounts::{AccountStore, FileKeychainAccountStore, InMemoryAccountStore};
use cache::Cache;
use disk_cache::{DiskCache, JsonFileDiskCache, PersistedCache, CACHE_FORMAT_VERSION};
use github::client;
use github::models::{AuthCheck, CheckRun, GitHubError, HistorySample, Issue, PullRequest};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, Wry};
use token_store::TokenStore;
use tokio::sync::Mutex as AsyncMutex;

/// Cache TTL is set below the frontend's poll interval (60s) so every poll finds
/// stale data and triggers exactly one refresh, instead of racing with the TTL boundary.
const CACHE_TTL_SECS: u64 = 30;

/// PNG bytes for the menu-bar tray template image. Embedded at compile
/// time so a missing or moved file at runtime can't leave the tray
/// without an icon. Module scope (rather than inside `run()`) so the
/// test below can pin that the embedded payload is a valid PNG.
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-icon-template.png");

/// The account currently backing all GitHub requests: its login (for
/// display) and its token (never sent back across the IPC boundary).
/// Kept as one struct behind one lock instead of two separately-locked
/// fields, so a reader can never observe a login paired with a token
/// (or vice versa) that belongs to a different account. Two
/// independently-locked mutexes updated in separate critical sections
/// could briefly produce exactly that torn state under concurrent
/// switches (a tray click racing a Settings-driven switch).
#[derive(Clone)]
struct ActiveIdentity {
    login: String,
    token: String,
}

pub struct AppState {
    pub(crate) cache: Mutex<Cache>,
    pub(crate) refresh_lock: AsyncMutex<()>,
    pub(crate) http: Client,
    /// Roster of known GitHub accounts (by login) and their PATs. The
    /// active account's identity is mirrored into `active` below;
    /// everything else, roster membership, other accounts' tokens,
    /// lives only here. The actual tokens never leave Rust process
    /// memory + the OS keychain; the webview never sees them.
    pub(crate) accounts: Box<dyn AccountStore>,
    /// In-memory mirror of the ACTIVE account's login + token. Read on
    /// every request; keeps `get_data` off the keychain hot path.
    /// Populated from `accounts` at startup and on every add/switch/
    /// remove. `None` if the roster's active pointer and its keychain
    /// entry didn't both resolve, so this never reports an account as
    /// active without a usable token behind it (see `with_stores`).
    pub(crate) active: Mutex<Option<ActiveIdentity>>,
    /// Persistent disk cache for the last successful refresh. Loaded on
    /// startup, written on every successful refresh (off the async
    /// runtime via `spawn_blocking`), cleared whenever the active
    /// identity changes (switch, or the last account being removed).
    /// Stored as `Arc` so the save closure can be cheaply cloned into
    /// the blocking task.
    pub(crate) disk_cache: Arc<dyn DiskCache>,
    /// Bumped every time the active identity changes (switch, add,
    /// logout). A refresh captures this before it hits the network and
    /// its queued disk write re-checks it, so a snapshot belonging to
    /// the previous account can't land on disk after the switch already
    /// cleared it. Without this, the `spawn_blocking` save is
    /// fire-and-forget and unordered against `clear_session_data`'s
    /// `remove_file`: alice's poll completes, a tray click to bob clears
    /// the file, then alice's queued task recreates it, and the next
    /// cold launch hydrates alice's PRs into bob's panel (the snapshot
    /// isn't keyed by account).
    pub(crate) session_generation: Arc<AtomicU64>,
    /// Serializes disk-cache writes against clears, so the generation
    /// re-check above and the write it guards are one atomic step
    /// rather than a TOCTOU window.
    pub(crate) disk_lock: Arc<Mutex<()>>,
}

impl AppState {
    pub fn new() -> Self {
        // If the platform doesn't expose a data dir (vanishingly rare),
        // fall back to no-op/in-memory stores so the app still functions
        // without persistence.
        let disk: Arc<dyn DiskCache> = match JsonFileDiskCache::for_app() {
            Some(impl_) => Arc::new(impl_),
            None => {
                eprintln!("gitbar: no platform data dir; running without disk cache");
                Arc::new(NoOpDiskCache)
            }
        };
        let accounts: Box<dyn AccountStore> = match FileKeychainAccountStore::for_app() {
            Some(impl_) => {
                // One-time opportunistic cleanup of a pre-multi-account
                // single keychain slot, run once here at startup rather
                // than on every add() call. A fresh install (or one
                // that's already migrated past this point) has an empty
                // roster forever after, so this only ever does real work
                // on the first launch following an upgrade from the
                // single-account scheme. Best-effort: a failure doesn't
                // block startup.
                if impl_.list().is_empty() {
                    if let Err(err) = token_store::KeychainTokenStore::legacy().delete() {
                        eprintln!("gitbar: legacy token cleanup failed (non-fatal): {err}");
                    }
                }
                Box::new(impl_)
            }
            None => {
                eprintln!("gitbar: no platform data dir; accounts won't persist across restarts");
                Box::new(InMemoryAccountStore::new())
            }
        };
        Self::with_stores(accounts, disk)
    }

    /// Construct with explicit stores. Tests use this with
    /// [`accounts::InMemoryAccountStore`] and
    /// [`disk_cache::MemoryDiskCache`] so the real keychain and disk
    /// stay untouched.
    pub fn with_stores(
        accounts: Box<dyn AccountStore>,
        disk_cache: Arc<dyn DiskCache>,
    ) -> Self {
        // Only trust the roster's active-login pointer if its keychain
        // entry actually resolves too. A login recorded as active with
        // no retrievable token (a stale pointer, a keychain entry
        // deleted out-of-band while the app was closed) should read as
        // logged out, not as authenticated-but-broken.
        let active = accounts.active().and_then(|login| {
            accounts
                .token_for(&login)
                .map(|token| ActiveIdentity { login, token })
        });
        let mut initial_cache = Cache::default();
        // Hydrate from disk if we have a stored snapshot. `last_fetch`
        // stays `None` so the next get_data still triggers a refresh:
        // we just give the UI immediate data to render while that
        // refresh is in flight.
        if let Some(snapshot) = disk_cache.load() {
            initial_cache.hydrate(
                snapshot.prs,
                snapshot.issues,
                snapshot.partial_message,
                snapshot.fetched_at,
                snapshot.history,
            );
        }
        Self {
            cache: Mutex::new(initial_cache),
            refresh_lock: AsyncMutex::new(()),
            http: client::build_http_client(),
            accounts,
            active: Mutex::new(active),
            disk_cache,
            session_generation: Arc::new(AtomicU64::new(0)),
            disk_lock: Arc::new(Mutex::new(())),
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
            history: cache.history.iter().cloned().collect(),
        })
    }

    /// The full active identity (login + token), not just the token.
    /// `refresh_if_needed` needs both: the token to make the request,
    /// the login to confirm afterward that the identity it started with
    /// is still the one active.
    fn current_identity(&self) -> Result<ActiveIdentity, GitHubError> {
        let guard = self
            .active
            .lock()
            .map_err(|error| GitHubError::server(format!("active identity poisoned: {error}")))?;
        guard
            .clone()
            .ok_or_else(|| GitHubError::auth("no GitHub token configured"))
    }

    fn current_token(&self) -> Result<String, GitHubError> {
        self.current_identity().map(|identity| identity.token)
    }

    fn active_login(&self) -> Option<String> {
        self.active
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|identity| identity.login.clone()))
    }

    fn known_logins(&self) -> Vec<String> {
        self.accounts.list()
    }

    /// Test convenience: asserting on this reads better than
    /// `active_login().is_some()` at call sites. `#[allow(dead_code)]`
    /// because `cargo check`'s dead-code pass doesn't count the
    /// `#[cfg(test)] mod tests` call sites as reachable even though
    /// `cargo test` compiles and runs them.
    #[allow(dead_code)]
    fn has_active_account(&self) -> bool {
        self.active.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    /// Clear the in-memory + on-disk PR/issue cache. Shared by every path
    /// that changes (or clears) the active identity: the cached data was
    /// specific to whichever identity was active before.
    fn clear_session_data(&self) -> Result<(), GitHubError> {
        // Bump BEFORE clearing so an in-flight refresh's queued disk
        // write sees the new generation and skips, whichever order the
        // two actually reach `disk_lock`.
        self.session_generation.fetch_add(1, Ordering::SeqCst);
        let mut cache = self
            .cache
            .lock()
            .map_err(|error| GitHubError::server(format!("cache poisoned: {error}")))?;
        *cache = Cache::default();
        {
            let _disk_guard = self
                .disk_lock
                .lock()
                .map_err(|error| GitHubError::server(format!("disk lock poisoned: {error}")))?;
            self.disk_cache.clear();
        }
        Ok(())
    }

    /// Set (or clear) the active identity in one lock/write, then clear
    /// the session cache. The one place `switch_to`/`add_account`/
    /// `clear_active_identity` funnel through instead of each
    /// hand-rolling the same lock-and-write.
    fn set_active_identity(&self, identity: Option<ActiveIdentity>) -> Result<(), GitHubError> {
        {
            let mut guard = self
                .active
                .lock()
                .map_err(|error| GitHubError::server(format!("active identity poisoned: {error}")))?;
            *guard = identity;
        }
        self.clear_session_data()
    }

    /// Switch the in-memory active identity to `login`'s stored
    /// credentials and clear the session cache. Errors if `login` has no
    /// stored token (shouldn't happen for a caller passing a value from
    /// `known_logins()`, but the keychain read can still fail).
    fn switch_to(&self, login: &str) -> Result<(), GitHubError> {
        // Switching to the account that's already active is a no-op, NOT
        // a re-switch. The tray's "Switch Account" submenu lists every
        // known account including the active one, so clicking the active
        // entry (to confirm which one is live, or by mistake) would
        // otherwise run the full clear: `Cache::default()` drops the 24h
        // history ring buffer and `disk_cache.clear()` deletes the
        // offline snapshot that held it, so the sparklines go blank and
        // can't be recovered. Settings already hides its Switch button
        // for the active account; the tray has no such affordance.
        // Reconcile the roster's pointer in case it drifted, but leave
        // the session cache alone: same identity, data is still valid.
        if self.active_login().as_deref() == Some(login) {
            self.accounts.set_active(Some(login)).map_err(GitHubError::server)?;
            return Ok(());
        }
        let token = self
            .accounts
            .token_for(login)
            .ok_or_else(|| GitHubError::server(format!("no stored token for {login}")))?;
        self.accounts.set_active(Some(login)).map_err(GitHubError::server)?;
        self.set_active_identity(Some(ActiveIdentity { login: login.to_string(), token }))
    }

    /// Log out entirely: clear the active identity and the session
    /// cache, without touching the account roster. Used when the last
    /// remaining account is removed.
    fn clear_active_identity(&self) -> Result<(), GitHubError> {
        self.set_active_identity(None)
    }

    /// Add a new account and make it active. The frontend validates the
    /// token via `check_auth` (which also returns `login`) before calling
    /// this, and the `add_account` command re-verifies the pairing
    /// server-side before this is reached (see that command), so `login`
    /// and `token` are trusted here.
    fn add_account(&self, login: &str, token: &str) -> Result<(), GitHubError> {
        self.accounts.add(login, token).map_err(GitHubError::server)?;
        self.accounts.set_active(Some(login)).map_err(GitHubError::server)?;
        // Use the token already in hand rather than switch_to's keychain
        // re-read: we just wrote this exact value, no need to read it
        // back from the OS keychain a second time.
        self.set_active_identity(Some(ActiveIdentity { login: login.to_string(), token: token.to_string() }))
    }

    /// Remove an account. If it was active, picks the next known account
    /// (roster order) to become active, or logs out entirely if none
    /// remain.
    fn remove_account(&self, login: &str) -> Result<(), GitHubError> {
        let was_active = self.active_login().as_deref() == Some(login);
        self.accounts.remove(login).map_err(GitHubError::server)?;
        if was_active {
            match self.accounts.list().first() {
                Some(next) => {
                    // Promotion can fail (the next account's keychain
                    // entry was deleted out-of-band, or the keychain is
                    // momentarily unavailable). `switch_to` bails before
                    // writing `self.active`, which would leave the
                    // just-removed account's login AND token live in
                    // memory: the app would keep polling GitHub as an
                    // account the user deleted, until a restart. Log out
                    // entirely instead, which bounces the UI to
                    // onboarding, then surface the original error.
                    if let Err(error) = self.switch_to(next) {
                        self.clear_active_identity()?;
                        return Err(error);
                    }
                }
                None => self.clear_active_identity()?,
            }
        }
        Ok(())
    }

    /// Replace the ACTIVE account's stored token in place (PAT rotation).
    /// `expected_login` must match the currently active login: if the
    /// active account changed since the caller captured which one it
    /// meant to rotate (e.g. a tray-driven switch racing an open
    /// Settings panel), this refuses instead of silently applying the
    /// new token to the wrong account. Doesn't touch the roster or clear
    /// the session cache -- same identity, so cached data is still valid.
    fn replace_active_token(&self, expected_login: &str, token: &str) -> Result<(), GitHubError> {
        // Hold the `active` lock across the check AND the keychain
        // write. Reading the login, releasing, then writing left a
        // window (a keychain write plus two roster file ops, tens of ms)
        // in which a tray switch could land: the guard would have passed
        // for the old login, then `active` ended up holding the old
        // login paired with the NEW token, while the roster on disk said
        // the new login and its freshly-cleared cache refilled with the
        // other account's data. Nothing under this lock touches
        // `accounts`' own locks in the reverse order, so holding it here
        // can't deadlock.
        let mut guard = self
            .active
            .lock()
            .map_err(|error| GitHubError::server(format!("active identity poisoned: {error}")))?;
        let login = guard
            .as_ref()
            .map(|identity| identity.login.clone())
            .ok_or_else(|| GitHubError::auth("no account is active"))?;
        if login != expected_login {
            return Err(GitHubError::auth(format!(
                "active account changed to {login}; refusing to rotate the token for {expected_login}"
            )));
        }
        self.accounts.add(&login, token).map_err(GitHubError::server)?;
        *guard = Some(ActiveIdentity { login, token: token.to_string() });
        Ok(())
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

        let identity = self.current_identity()?;
        // Capture before the network round trip: any switch/logout while
        // we're awaiting bumps this, and the queued disk write below
        // then declines to persist results that belong to the identity
        // we started with.
        let my_generation = self.session_generation.load(Ordering::SeqCst);
        // Run the two underlying fetches concurrently and cap each at 15s.
        // Sequential previously meant up to ~2 round-trip latencies per
        // refresh, and a single hung TCP connection could wedge every
        // subsequent caller for the full reqwest 30s timeout. Per-call
        // timeout below 30s also gives faster feedback on flaky networks.
        const FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
        let prs_fut =
            tokio::time::timeout(FETCH_TIMEOUT, client::fetch_prs(&self.http, &identity.token));
        let issues_fut =
            tokio::time::timeout(FETCH_TIMEOUT, client::fetch_issues(&self.http, &identity.token));
        let (prs_result, issues_result) = tokio::join!(prs_fut, issues_fut);
        let prs_outcome = prs_result
            .map_err(|_| GitHubError::network("PR fetch timed out after 15s"))??;
        let issues_outcome = issues_result
            .map_err(|_| GitHubError::network("Issue fetch timed out after 15s"))??;

        // The active identity may have changed while we were awaiting
        // the network: cleared (Disconnect / last account removed), or
        // switched to a DIFFERENT account (tray click, Settings switch).
        // Checking only "is some token present" would miss the switched
        // case and let this fetch's results, belonging to the identity
        // captured above, get written into the NEW identity's cache and
        // disk snapshot: a cross-account data leak, not just staleness.
        // Comparing the login catches both cases.
        if self.active_login().as_deref() != Some(identity.login.as_str()) {
            return Err(GitHubError::auth("active account changed during refresh"));
        }

        // Combine partial_messages from the two fetches so a pagination
        // cap on issues doesn't get clobbered by a clean PR fetch (or
        // vice versa). Either-but-not-both surfaces alone; both present
        // get concatenated.
        let partial_message = match (prs_outcome.partial_message, issues_outcome.partial_message) {
            (Some(p), Some(i)) => Some(format!("{p} {i}")),
            (Some(p), None) => Some(p),
            (None, Some(i)) => Some(i),
            (None, None) => None,
        };

        let mut cache = self
            .cache
            .lock()
            .map_err(|error| GitHubError::server(format!("cache poisoned: {error}")))?;
        cache.update(prs_outcome.prs, issues_outcome.issues, partial_message);

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
            history: cache.history.iter().cloned().collect(),
        };
        // Drop the cache lock before scheduling the disk write so any
        // concurrent read isn't gated on the spawn dispatch.
        drop(cache);
        let disk = self.disk_cache.clone();
        let generation = self.session_generation.clone();
        let disk_lock = self.disk_lock.clone();
        tokio::task::spawn_blocking(move || {
            persist_if_current(&disk, &disk_lock, &generation, my_generation, &snapshot)
        });

        Ok(())
    }
}

/// Persist `snapshot` only if the session generation still matches the
/// one its refresh started under. Both the check and the write happen
/// inside `disk_lock`, so a concurrent `clear_session_data` (which bumps
/// the generation BEFORE taking the same lock) either completes fully
/// first, in which case this skips, or waits until after, in which case
/// it removes what this wrote. Either interleaving ends with no stale
/// snapshot on disk.
///
/// Returns whether the write happened, for the test below.
fn persist_if_current(
    disk: &Arc<dyn DiskCache>,
    disk_lock: &Mutex<()>,
    generation: &AtomicU64,
    my_generation: u64,
    snapshot: &PersistedCache,
) -> bool {
    let Ok(_disk_guard) = disk_lock.lock() else {
        return false;
    };
    if generation.load(Ordering::SeqCst) != my_generation {
        return false;
    }
    disk.save(snapshot);
    true
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
    /// 24-hour history ring buffer, ordered oldest -> newest. Used by
    /// the frontend to render trend sparklines behind the stat tiles.
    /// Empty on first launch; populated on each successful refresh.
    pub history: Vec<HistorySample>,
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

/// Validate a candidate token. Used by the onboarding/Settings "add
/// account" flow to confirm a pasted PAT works, and to learn its login,
/// before persisting it via [`add_account`]. Takes the token as an
/// argument: this and [`add_account`]/[`replace_active_token`] are the
/// only commands that do.
#[tauri::command]
async fn check_auth(
    token: String,
    state: State<'_, AppState>,
) -> Result<AuthCheck, GitHubError> {
    client::check_auth(&state.http, &token).await
}

/// One known GitHub account and which one (if any) is active. Frontend
/// uses this on mount, and after every add/remove/switch, to decide
/// between the onboarding screen and the list view and to render the
/// account switcher.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccountsList {
    /// Known logins, in add-order.
    pub accounts: Vec<String>,
    pub active: Option<String>,
}

impl AppState {
    fn accounts_list(&self) -> AccountsList {
        AccountsList {
            accounts: self.known_logins(),
            active: self.active_login(),
        }
    }
}

#[tauri::command]
async fn list_accounts(state: State<'_, AppState>) -> Result<AccountsList, GitHubError> {
    Ok(state.accounts_list())
}

/// Add a new account and make it active. `login` comes from a prior
/// `check_auth` call on the frontend, but is re-verified against `token`
/// here rather than trusted blindly: any IPC caller could otherwise
/// associate an arbitrary label with a real token without ever going
/// through `check_auth` first. Returns the resulting account list
/// directly so the frontend doesn't need a separate `list_accounts`
/// round trip on the success path.
#[tauri::command]
async fn add_account(
    login: String,
    token: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AccountsList, GitHubError> {
    let trimmed_login = login.trim();
    let trimmed_token = token.trim();
    if trimmed_login.is_empty() || trimmed_token.is_empty() {
        return Err(GitHubError::auth("login and token are required"));
    }
    let check = client::check_auth(&state.http, trimmed_token).await?;
    if !check.ok || check.login.as_deref() != Some(trimmed_login) {
        return Err(GitHubError::auth("token does not match the claimed account"));
    }
    let result = state.add_account(trimmed_login, trimmed_token);
    // Refresh the tray regardless of outcome: add_account's internal
    // roster write can succeed even if a later step (activation) fails,
    // and the tray should never show a stale list either way.
    refresh_tray_menu(&app, &state);
    result?;
    Ok(state.accounts_list())
}

/// Remove an account from the roster and delete its stored token. If it
/// was active, another known account becomes active (or the app logs out
/// entirely if none remain). Returns the resulting account list directly,
/// same rationale as `add_account`.
#[tauri::command]
async fn remove_account(
    login: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AccountsList, GitHubError> {
    let result = state.remove_account(login.trim());
    // Refresh the tray even if the removal's promotion step failed
    // partway through: the roster may already have changed, and a
    // removed login must not linger as a clickable tray item.
    refresh_tray_menu(&app, &state);
    result?;
    Ok(state.accounts_list())
}

/// Switch the active account to an already-known login (one already
/// present in the roster; use `add_account` for a login that isn't yet
/// known). Returns the resulting account list directly, same rationale
/// as `add_account`.
#[tauri::command]
async fn switch_account(
    login: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AccountsList, GitHubError> {
    let result = state.switch_to(login.trim());
    refresh_tray_menu(&app, &state);
    result?;
    Ok(state.accounts_list())
}

/// Replace the currently active account's stored token in place (PAT
/// rotation): same identity, same roster position, cached data stays
/// valid. `expected_login` must match whichever account the caller
/// believes is active (typically captured when the rotate form was
/// opened) -- if the active account changed in the meantime, this
/// refuses rather than silently rotating the wrong account's token. The
/// new token is also re-verified via `check_auth` against
/// `expected_login` before being persisted, for the same reason
/// `add_account` re-verifies: an IPC caller shouldn't be able to
/// overwrite a stored credential with an arbitrary, unverified string.
#[tauri::command]
async fn replace_active_token(
    expected_login: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), GitHubError> {
    let trimmed_login = expected_login.trim();
    let trimmed_token = token.trim();
    if trimmed_token.is_empty() {
        return Err(GitHubError::auth("token cannot be empty"));
    }
    let check = client::check_auth(&state.http, trimmed_token).await?;
    if !check.ok || check.login.as_deref() != Some(trimmed_login) {
        return Err(GitHubError::auth("token does not match the active account"));
    }
    state.replace_active_token(trimmed_login, trimmed_token)
}

/// Drill-down: fetch the CI check runs on a PR's latest commit. Called
/// lazily from the frontend when the user clicks the CI pill on a PR
/// card; we don't poll this on a schedule because the load is
/// proportional to the number of PRs the user expands.
///
/// `pr_url` is the canonical GitHub PR URL the frontend already has on
/// the card (`https://github.com/<owner>/<repo>/pull/<n>`). We parse it
/// in Rust so the frontend doesn't have to learn the URL shape AND so
/// invalid input gets a typed error instead of a serde panic.
#[tauri::command]
async fn get_pr_checks(
    pr_url: String,
    state: State<'_, AppState>,
) -> Result<Vec<CheckRun>, GitHubError> {
    let (owner, name, number) = parse_pr_url(&pr_url)
        .ok_or_else(|| GitHubError::server(format!("not a PR url: {pr_url}")))?;
    let token = state.current_token()?;
    client::fetch_pr_checks(&state.http, &token, &owner, &name, number).await
}

/// Parse a PR URL like `https://github.com/owner/repo/pull/123` into
/// `(owner, repo, number)`. Tolerates a trailing slash or `#anchor`.
/// Returns `None` on anything that doesn't look like a PR URL so the
/// caller can surface a clear error.
fn parse_pr_url(url: &str) -> Option<(String, String, i64)> {
    let after_host = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))?;
    let trimmed = after_host
        .split('#')
        .next()?
        .split('?')
        .next()?
        .trim_end_matches('/');
    let mut parts = trimmed.split('/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();
    let kind = parts.next()?;
    if kind != "pull" {
        return None;
    }
    let number: i64 = parts.next()?.parse().ok()?;
    if owner.is_empty() || repo.is_empty() || number <= 0 {
        return None;
    }
    Some((owner, repo, number))
}

/// Bring the panel into view from the tray. Re-asserts the macOS
/// collection behavior + always-on-top before showing, so that anything
/// that may have stripped them (a brief full-screen app, Mission Control
/// gestures, an OS state restore quirk) doesn't strand the window on a
/// Space the user can't reach. Cheap, idempotent, only fired on
/// user-initiated show actions (tray click / tray menu's "Show GitBar").
fn show_panel(window: &tauri::WebviewWindow) {
    // Diagnose failures on the two calls this fix hinges on: if either
    // silently fails in the field, we'd reproduce the original "tray
    // click does nothing" symptom with no signal. The remaining three
    // (unminimize/show/set_focus) stay best-effort — failures there are
    // either inconsequential or already surface via the UI not moving.
    if let Err(err) = window.set_visible_on_all_workspaces(true) {
        eprintln!("gitbar: set_visible_on_all_workspaces failed: {err}");
    }
    if let Err(err) = window.set_always_on_top(true) {
        eprintln!("gitbar: set_always_on_top failed: {err}");
    }
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// Prefix for the "Switch Account" submenu's per-account item ids.
/// GitHub logins can't contain `:` (alphanumeric + hyphens only), so it's
/// a safe separator between the prefix and the login.
const SWITCH_ACCOUNT_ID_PREFIX: &str = "switch-account:";

/// Build the tray's menu: "Show GitBar", a "Switch Account" submenu (one
/// checkable item per known account, checked on whichever is active,
/// disabled entirely when there's nothing to switch to), and "Quit".
/// Called once at startup and again after every account-roster change,
/// add/remove/switch, whether triggered from Settings or from the tray
/// itself, via `refresh_tray_menu`, so the tray never shows a stale
/// list or a stale checkmark.
fn build_tray_menu(app: &AppHandle, accounts: &[String], active: Option<&str>) -> tauri::Result<Menu<Wry>> {
    let show = MenuItem::with_id(app, "show", "Show GitBar", true, None::<&str>)?;

    let switch_items: Vec<CheckMenuItem<Wry>> = accounts
        .iter()
        .map(|login| {
            CheckMenuItem::with_id(
                app,
                format!("{SWITCH_ACCOUNT_ID_PREFIX}{login}"),
                login,
                true,
                active == Some(login.as_str()),
                None::<&str>,
            )
        })
        .collect::<tauri::Result<_>>()?;
    let switch_refs: Vec<&dyn IsMenuItem<Wry>> = switch_items
        .iter()
        .map(|item| item as &dyn IsMenuItem<Wry>)
        .collect();
    // Nothing to switch TO with 0 or 1 known accounts; disable the whole
    // submenu rather than show an empty or single-item list.
    let switch_submenu = Submenu::with_items(app, "Switch Account", accounts.len() > 1, &switch_refs)?;

    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    Menu::with_items(app, &[&show, &switch_submenu, &quit])
}

/// Rebuild the tray's menu from the account store's current state and
/// apply it. Best-effort: a failure here means the tray shows a stale
/// menu until the next successful rebuild, not a hard error for the
/// caller (an account add/remove/switch that otherwise succeeded
/// shouldn't fail just because the tray redraw did).
fn refresh_tray_menu(app: &AppHandle, state: &AppState) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    match build_tray_menu(app, &state.known_logins(), state.active_login().as_deref()) {
        Ok(menu) => {
            if let Err(err) = tray.set_menu(Some(menu)) {
                eprintln!("gitbar: tray menu rebuild failed: {err}");
            }
        }
        Err(err) => eprintln!("gitbar: tray menu build failed: {err}"),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Err(err) = window.set_always_on_top(true) {
                    eprintln!("gitbar: set_always_on_top failed at setup: {err}");
                }
                // Make the panel join whichever macOS Space the user is on
                // when shown, instead of staying pinned to the Space it was
                // last visible on. Without this, `always_on_top` only
                // covers "on top within the current Space"; if the panel
                // gets stranded on another Space (Mission Control gesture,
                // dragging a window across screens, a full-screen app
                // briefly hiding it), clicking the tray icon calls
                // `show()` but the window reappears on the OTHER Space and
                // the user can't see it — the symptom is "tray click does
                // nothing, only restarting fixes it." This is the canonical
                // collection behavior for menu-bar-style floating panels.
                // Log on failure: if this silently doesn't take effect, the
                // "tray click does nothing" symptom comes back without any
                // diagnostic trail.
                if let Err(err) = window.set_visible_on_all_workspaces(true) {
                    eprintln!("gitbar: set_visible_on_all_workspaces failed at setup: {err}");
                }
                // Kill the default macOS window shadow. macOS draws the
                // shadow off the underlying NSWindow's rectangular shape,
                // not the NSVisualEffectView's rounded shape, so it
                // shows as a sharp-cornered "ghost rectangle" behind
                // the panel. The CSS inset highlight on the outer
                // wrapper provides the raised-glass cue without the
                // doubled-up rectangular shadow.
                let _ = window.set_shadow(false);
                // Apply the macOS vibrancy material before the window is
                // first shown so the user never sees an opaque slab
                // flicker on launch. `Sidebar` is the most translucent
                // of the practical materials: it tints with the desktop
                // wallpaper enough that the panel reads as "frosted
                // glass." `HudWindow` is more opaque and reads as
                // "dark rectangle with a hint of color" on most
                // wallpapers, which defeats the floating-widget feel.
                //
                // The window must also be configured with
                // `transparent: true` in tauri.conf.json or the vibrancy
                // has nothing to show through (it would be hidden behind
                // the opaque window background). Failures are best-
                // effort; on non-macOS targets the call returns
                // Err(Unsupported) which we deliberately ignore.
                #[cfg(target_os = "macos")]
                {
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                    // The 4th argument is the corner radius applied to
                    // the NSVisualEffectView itself. Without it the
                    // vibrancy material is a sharp rectangle filling
                    // the whole window rect, visible at the corners
                    // outside the rounded CSS panel. Matching this to
                    // CSS `--panel-radius` makes the OS-level backdrop
                    // and the HTML surface share one rounded shape.
                    if let Err(err) = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::Sidebar,
                        None,
                        Some(14.0),
                    ) {
                        eprintln!("gitbar: vibrancy apply failed ({err}); falling back to solid background");
                    }
                }
                let _ = window.show();
            }

            let state = app.state::<AppState>();
            let menu = build_tray_menu(app.handle(), &state.known_logins(), state.active_login().as_deref())?;

            // Left-click toggles visibility; right-click shows the menu.
            let mut tray = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .show_menu_on_left_click(false);
            // Tray icon: dedicated single-color template image so macOS
            // tints it to match the menu bar (white on dark mode, black
            // on light, dimmed when inactive). Without `icon_as_template`,
            // the colorful sun-and-cloud bundle icon shows as a dark
            // sticker in the menu bar where it expects a monochrome glyph.
            // Embed the bytes so a missing file at runtime can't strand
            // the tray with no icon at all.
            match tauri::image::Image::from_bytes(TRAY_ICON_BYTES) {
                Ok(icon) => {
                    tray = tray.icon(icon).icon_as_template(true);
                }
                Err(err) => {
                    eprintln!("gitbar: tray template icon failed to load ({err}); falling back to bundle icon");
                    if let Some(icon) = app.default_window_icon() {
                        tray = tray.icon(icon.clone());
                    }
                }
            }

            tray.on_menu_event(|app, event| {
                let id = event.id().as_ref();
                if let Some(login) = id.strip_prefix(SWITCH_ACCOUNT_ID_PREFIX) {
                    // Dispatched off the menu event loop thread instead of
                    // running inline: switch_to does a real keychain read
                    // (an IPC round trip to the OS keychain daemon, which
                    // can take tens of milliseconds and, on some Linux
                    // keyring backends, block on an unlock prompt) plus
                    // roster disk I/O. Running that synchronously inside
                    // the tray's native menu-click callback would risk a
                    // perceptible hitch or freeze on every switch.
                    let login = login.to_string();
                    let app = app.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let state = app.state::<AppState>();
                        let outcome = state.switch_to(&login);
                        // Rebuild regardless of outcome. macOS toggles a
                        // CheckMenuItem's state BEFORE emitting the event,
                        // so on a failed switch the menu is left showing
                        // the account the user did NOT switch to as
                        // checked (alongside the one still actually
                        // active). Rebuilding from the store's real state
                        // puts the checkmark back where it belongs.
                        refresh_tray_menu(&app, &state);
                        match outcome {
                            Ok(()) => {
                                // The switch happened in Rust, not from a
                                // frontend-awaited command promise, so the
                                // webview has no other way to learn about
                                // it. It listens for this and re-fetches
                                // (account list + a forced data refresh)
                                // on receipt.
                                if let Err(err) = app.emit("account-switched", &login) {
                                    eprintln!("gitbar: account-switched emit failed: {err}");
                                }
                            }
                            Err(err) => {
                                eprintln!("gitbar: tray switch_to({login}) failed: {err}");
                                // Surface it in the panel rather than
                                // failing silently: a tray switch has no
                                // command promise for the frontend to
                                // catch, so without this the only symptom
                                // is "nothing happened".
                                if let Err(emit_err) =
                                    app.emit("account-switch-failed", format!("{login}: {err}"))
                                {
                                    eprintln!("gitbar: account-switch-failed emit failed: {emit_err}");
                                }
                            }
                        }
                    });
                    return;
                }
                match id {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            show_panel(&window);
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                }
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
                            show_panel(&window);
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
            list_accounts,
            add_account,
            remove_account,
            switch_account,
            replace_active_token,
            get_pr_checks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitBar");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::InMemoryAccountStore;
    use crate::disk_cache::MemoryDiskCache;
    use crate::github::client::test_endpoint::EndpointGuard;
    use std::sync::Arc;
    use std::time::Duration;
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn empty_prs_body() -> serde_json::Value {
        serde_json::json!({ "data": { "search": { "edges": [] } } })
    }

    #[test]
    fn parse_pr_url_extracts_owner_repo_number() {
        assert_eq!(
            parse_pr_url("https://github.com/anthropic/sdk/pull/42"),
            Some(("anthropic".into(), "sdk".into(), 42)),
        );
    }

    #[test]
    fn parse_pr_url_tolerates_trailing_slash_anchor_and_query() {
        assert_eq!(
            parse_pr_url("https://github.com/o/r/pull/7/"),
            Some(("o".into(), "r".into(), 7)),
        );
        assert_eq!(
            parse_pr_url("https://github.com/o/r/pull/7#issuecomment-1"),
            Some(("o".into(), "r".into(), 7)),
        );
        assert_eq!(
            parse_pr_url("https://github.com/o/r/pull/7?foo=bar"),
            Some(("o".into(), "r".into(), 7)),
        );
    }

    #[test]
    fn parse_pr_url_rejects_non_pr_paths() {
        // Issue URLs and tree/blob/etc. paths must NOT parse as a PR.
        assert_eq!(parse_pr_url("https://github.com/o/r/issues/7"), None);
        assert_eq!(parse_pr_url("https://github.com/o/r"), None);
        assert_eq!(parse_pr_url("https://example.com/o/r/pull/7"), None);
        assert_eq!(parse_pr_url("https://github.com/o/r/pull/notanumber"), None);
        // Zero/negative PR numbers don't exist on GitHub.
        assert_eq!(parse_pr_url("https://github.com/o/r/pull/0"), None);
    }

    /// The embedded tray template PNG must decode at compile-link time.
    /// Without this test a corrupted PNG (or, more likely, an LFS pointer
    /// file masquerading as a PNG after a bad git checkout) would only
    /// surface at app startup as a stderr-only fallback to the bundle
    /// icon. The fallback path still works, but the user loses the
    /// monochrome menu-bar tint and we'd have no signal that anything
    /// went wrong.
    #[test]
    fn embedded_tray_template_icon_decodes() {
        let result = tauri::image::Image::from_bytes(TRAY_ICON_BYTES);
        assert!(
            result.is_ok(),
            "embedded tray template PNG should decode; got {:?}",
            result.err(),
        );
    }

    fn test_state() -> AppState {
        AppState::with_stores(
            Box::new(InMemoryAccountStore::new()),
            Arc::new(MemoryDiskCache::new()),
        )
    }

    /// Seed a single account and make it active: the common case most
    /// of the pre-existing single-account tests want, now expressed in
    /// account-store terms. `state_with_accounts` below is for tests that
    /// actually exercise multiple accounts.
    fn state_with_token(token: &str) -> AppState {
        let state = test_state();
        state.add_account("octocat", token).expect("seed account");
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

    /// Wire-format snapshot for `AccountsList`. Mirror in `src/types.ts`
    /// when you change this.
    #[test]
    fn accounts_list_wire_shape() {
        let value = AccountsList {
            accounts: vec!["alice".into(), "bob".into()],
            active: Some("bob".into()),
        };
        let actual = serde_json::to_string_pretty(&value).expect("serialize");
        let expected = r#"{
  "accounts": [
    "alice",
    "bob"
  ],
  "active": "bob"
}"#;
        assert_eq!(actual, expected);
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
            history: vec![HistorySample {
                at_ms: 1747700000000,
                pr_count: 3,
                review_requested: 1,
                issue_count: 2,
            }],
        };
        let actual = serde_json::to_string_pretty(&value).expect("serialize");
        let expected = r#"{
  "prs": [],
  "issues": [],
  "partial_message": "Review query failed.",
  "last_fetched_at_ms": 1747700000000,
  "history": [
    {
      "at_ms": 1747700000000,
      "pr_count": 3,
      "review_requested": 1,
      "issue_count": 2
    }
  ]
}"#;
        assert_eq!(actual, expected);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn add_and_remove_account_persists_through_store() {
        let state = test_state();

        assert!(!state.has_active_account());
        state.add_account("octocat", "ghp_a").unwrap();
        assert!(state.has_active_account());
        assert_eq!(state.active_login().as_deref(), Some("octocat"));

        state.remove_account("octocat").unwrap();
        assert!(!state.has_active_account());
        assert_eq!(state.active_login(), None);
    }

    /// After removing the active account, the cached PR/issue data is
    /// wiped so the next fetch under a different identity starts clean.
    #[tokio::test(flavor = "current_thread")]
    async fn remove_active_account_clears_cached_data() {
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

        state.remove_account("octocat").unwrap();
        // Next snapshot still works (returns empty), and `refresh_if_needed`
        // would now require a re-added account to fetch.
        assert!(state.snapshot().is_ok());
        let err = state.refresh_if_needed(false).await.unwrap_err();
        assert!(matches!(err, GitHubError::Auth { .. }));
    }

    /// An account already in the store + marked active before AppState
    /// boots is picked up by `new()`/`with_stores()`.
    #[test]
    fn appstate_loads_existing_active_account_on_construction() {
        let store = InMemoryAccountStore::new();
        store.add("octocat", "ghp_pre").unwrap();
        store.set_active(Some("octocat")).unwrap();

        let state = AppState::with_stores(
            Box::new(store),
            Arc::new(MemoryDiskCache::new()),
        );
        assert!(state.has_active_account(), "active account should be loaded on construct");
        assert_eq!(state.active_login().as_deref(), Some("octocat"));
    }

    /// An account in the store that is NOT marked active is known (shows
    /// up in `known_logins()`) but doesn't make the app think it's logged
    /// in: matches `add_account`'s "add doesn't imply active" contract.
    #[test]
    fn appstate_does_not_activate_a_non_active_stored_account() {
        let store = InMemoryAccountStore::new();
        store.add("octocat", "ghp_pre").unwrap();
        // Note: no set_active call.

        let state = AppState::with_stores(
            Box::new(store),
            Arc::new(MemoryDiskCache::new()),
        );
        assert!(!state.has_active_account());
        assert_eq!(state.known_logins(), vec!["octocat".to_string()]);
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
            Box::new(InMemoryAccountStore::new()),
            disk.clone(),
        );
        state.add_account("octocat", "tok").unwrap();

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
            history: vec![],
        });

        let state = AppState::with_stores(
            Box::new(InMemoryAccountStore::new()),
            disk,
        );
        let snap = state.snapshot().expect("snapshot ok");
        assert_eq!(snap.partial_message.as_deref(), Some("warmed cache"));
        assert!(snap.last_fetched_at_ms.is_some(), "wall-clock ts hydrated");
    }

    /// Removing the active account also wipes the disk cache so a future
    /// identity doesn't see the previous account's PRs/issues on next
    /// launch.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn remove_active_account_clears_disk_cache() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(empty_prs_body()))
            .mount(&server)
            .await;

        let disk = Arc::new(MemoryDiskCache::new());
        let state = AppState::with_stores(
            Box::new(InMemoryAccountStore::new()),
            disk.clone(),
        );
        state.add_account("octocat", "tok").unwrap();
        state.refresh_if_needed(false).await.unwrap();
        for _ in 0..50 {
            if disk.load().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(disk.load().is_some());

        state.remove_account("octocat").unwrap();
        assert!(disk.load().is_none(), "disk cache cleared when the active account is removed");
    }

    /// Token cleared mid-flight (after fetch_prs/fetch_issues complete
    /// but before the cache + disk write) must not be repopulated by
    /// the in-flight refresh: that would leak the previous identity's
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
            Box::new(InMemoryAccountStore::new()),
            disk.clone(),
        ));
        state.add_account("octocat", "tok").unwrap();

        let refresh_state = state.clone();
        let refresh = tokio::spawn(async move {
            refresh_state.refresh_if_needed(false).await
        });

        // Clear the token while the refresh is awaiting network.
        tokio::time::sleep(Duration::from_millis(20)).await;
        state.remove_account("octocat").unwrap();

        // The refresh should bail with an auth error (token gone),
        // not silently persist the previous identity's data.
        let result = refresh.await.expect("task panicked");
        assert!(
            matches!(result, Err(GitHubError::Auth { .. })),
            "got: {result:?}",
        );
        assert!(disk.load().is_none(), "disk must NOT have stale data");
    }

    /// The multi-account sibling of the test above: the active account
    /// changing mid-flight to a DIFFERENT account (not just being
    /// cleared) must also abort the write. Checking only "is some token
    /// present" would miss this case and leak the outgoing account's
    /// data into the new account's cache and disk snapshot.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn refresh_aborts_if_account_switched_after_network_call() {
        let server = MockServer::start().await;
        let _endpoint = EndpointGuard::install(&server.uri());

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
            Box::new(InMemoryAccountStore::new()),
            disk.clone(),
        ));
        state.add_account("alice", "ghp_alice").unwrap();

        let refresh_state = state.clone();
        let refresh = tokio::spawn(async move {
            refresh_state.refresh_if_needed(false).await
        });

        // Switch to a different account while alice's refresh is still
        // awaiting network. switch_to clears the session cache for bob;
        // alice's in-flight fetch must not repopulate it afterward.
        tokio::time::sleep(Duration::from_millis(20)).await;
        state.add_account("bob", "ghp_bob").unwrap();

        let result = refresh.await.expect("task panicked");
        assert!(
            matches!(result, Err(GitHubError::Auth { .. })),
            "alice's stale refresh must not silently succeed once bob is active: got {result:?}",
        );
        assert_eq!(state.active_login().as_deref(), Some("bob"));
        assert!(
            disk.load().is_none(),
            "bob's disk cache must NOT contain alice's data",
        );
        let snap = state.snapshot().unwrap();
        assert!(
            snap.prs.is_empty(),
            "bob's in-memory cache must NOT contain alice's data",
        );
    }

    // --- Multi-account specific behavior ---

    #[test]
    fn switch_to_changes_active_token_and_login() {
        let state = test_state();
        state.add_account("alice", "ghp_alice").unwrap();
        state.add_account("bob", "ghp_bob").unwrap();
        // `add_account` activates the account it just added, so we're on
        // bob now; switch back to alice and confirm both the in-memory
        // token and the reported active login follow.
        assert_eq!(state.active_login().as_deref(), Some("bob"));

        state.switch_to("alice").unwrap();
        assert_eq!(state.active_login().as_deref(), Some("alice"));
        assert_eq!(state.current_token().unwrap(), "ghp_alice");
    }

    #[test]
    fn switch_to_unknown_login_errors_without_disturbing_active_account() {
        let state = state_with_token("tok");
        let err = state.switch_to("nobody").unwrap_err();
        assert!(matches!(err, GitHubError::Server { .. }), "got: {err:?}");
        // The failed switch must not have logged the existing account out.
        assert_eq!(state.active_login().as_deref(), Some("octocat"));
    }

    #[test]
    fn adding_a_second_account_does_not_remove_the_first() {
        let state = test_state();
        state.add_account("alice", "ghp_alice").unwrap();
        state.add_account("bob", "ghp_bob").unwrap();
        assert_eq!(
            state.known_logins(),
            vec!["alice".to_string(), "bob".to_string()],
            "both accounts remain known, in add-order",
        );
    }

    #[test]
    fn switch_clears_session_cache_even_between_two_known_accounts() {
        let state = test_state();
        state.add_account("alice", "ghp_alice").unwrap();
        {
            let mut cache = state.cache.lock().unwrap();
            cache.update(vec![], vec![], Some("alice's data".into()));
        }
        state.add_account("bob", "ghp_bob").unwrap();
        // add_account("bob", ...) internally switches to bob, which must
        // have cleared alice's leftover cache contents.
        let snap = state.snapshot().unwrap();
        assert_eq!(snap.partial_message, None, "switching accounts must not leak the previous account's cache");
    }

    /// A snapshot whose refresh began under an older session
    /// generation must not land on disk: the identity changed while it
    /// was in flight, and the on-disk cache isn't keyed by account, so
    /// the next cold launch would hydrate the previous account's PRs
    /// into the new account's panel.
    #[test]
    fn queued_disk_write_is_dropped_when_the_identity_changed_mid_refresh() {
        let disk: Arc<dyn DiskCache> = Arc::new(MemoryDiskCache::new());
        let disk_lock = Mutex::new(());
        let generation = AtomicU64::new(7);
        let snapshot = PersistedCache {
            version: CACHE_FORMAT_VERSION,
            prs: vec![],
            issues: vec![],
            partial_message: Some("alice's data".into()),
            fetched_at: SystemTime::now(),
            history: vec![],
        };

        // Same generation: the write goes through.
        assert!(persist_if_current(&disk, &disk_lock, &generation, 7, &snapshot));
        assert!(disk.load().is_some());
        disk.clear();

        // An account switch bumped the generation while the refresh was
        // awaiting the network. The queued write must be dropped.
        generation.fetch_add(1, Ordering::SeqCst);
        assert!(!persist_if_current(&disk, &disk_lock, &generation, 7, &snapshot));
        assert!(
            disk.load().is_none(),
            "a snapshot from the previous identity must not be persisted",
        );
    }

    #[test]
    fn switching_to_the_already_active_account_preserves_the_session_cache() {
        // The tray's "Switch Account" submenu lists the active account
        // too, so this fires on a click that changes nothing. It must
        // not wipe the cache (and with it the 24h history ring buffer
        // and the offline disk snapshot).
        let state = test_state();
        state.add_account("alice", "ghp_alice").unwrap();
        {
            let mut cache = state.cache.lock().unwrap();
            cache.update(vec![], vec![], Some("alice's data".into()));
        }

        state.switch_to("alice").unwrap();

        assert_eq!(state.active_login().as_deref(), Some("alice"));
        assert_eq!(state.current_token().unwrap(), "ghp_alice");
        let snap = state.snapshot().unwrap();
        assert_eq!(
            snap.partial_message.as_deref(),
            Some("alice's data"),
            "a no-op switch to the active account must not clear the cache",
        );
    }

    #[test]
    fn failed_promotion_after_removing_active_account_logs_out_instead_of_keeping_removed_identity() {
        // bob is in the roster but his keychain entry is gone, so the
        // promotion after removing alice fails. The removed account's
        // credentials must not stay live in memory: that would keep the
        // app polling GitHub as an account the user just deleted.
        let store = InMemoryAccountStore::new();
        store.add("alice", "ghp_alice").unwrap();
        store.add("bob", "ghp_bob").unwrap();
        store.set_active(Some("alice")).unwrap();
        store.orphan_token_for_test("bob");
        let state = AppState::with_stores(Box::new(store), Arc::new(MemoryDiskCache::new()));
        assert_eq!(state.active_login().as_deref(), Some("alice"));

        let err = state.remove_account("alice").unwrap_err();

        assert!(matches!(err, GitHubError::Server { .. }), "got: {err:?}");
        assert!(
            !state.has_active_account(),
            "a failed promotion must log out, not retain the removed account",
        );
        assert_eq!(state.active_login(), None);
        assert!(
            state.current_token().is_err(),
            "the removed account's token must not remain usable",
        );
    }

    #[test]
    fn remove_active_account_promotes_the_next_known_account() {
        let state = test_state();
        state.add_account("alice", "ghp_alice").unwrap();
        state.add_account("bob", "ghp_bob").unwrap();
        // Active is bob (most recently added). Removing bob should
        // promote alice, the only remaining known account.
        state.remove_account("bob").unwrap();
        assert_eq!(state.active_login().as_deref(), Some("alice"));
        assert_eq!(state.current_token().unwrap(), "ghp_alice");
        assert_eq!(state.known_logins(), vec!["alice".to_string()]);
    }

    #[test]
    fn remove_last_account_logs_out_entirely() {
        let state = state_with_token("tok");
        state.remove_account("octocat").unwrap();
        assert!(!state.has_active_account());
        assert_eq!(state.active_login(), None);
        assert_eq!(state.known_logins(), Vec::<String>::new());
        assert!(state.current_token().is_err());
    }

    #[test]
    fn remove_inactive_account_leaves_active_account_untouched() {
        let state = test_state();
        state.add_account("alice", "ghp_alice").unwrap();
        state.add_account("bob", "ghp_bob").unwrap();
        // Active is bob. Removing alice (not active) shouldn't touch it.
        state.remove_account("alice").unwrap();
        assert_eq!(state.active_login().as_deref(), Some("bob"));
        assert_eq!(state.current_token().unwrap(), "ghp_bob");
    }

    #[test]
    fn replace_active_token_updates_token_without_clearing_cache() {
        let state = state_with_token("ghp_old");
        {
            let mut cache = state.cache.lock().unwrap();
            cache.update(vec![], vec![], Some("still valid".into()));
        }
        state.replace_active_token("octocat", "ghp_new").unwrap();
        assert_eq!(state.current_token().unwrap(), "ghp_new");
        assert_eq!(state.active_login().as_deref(), Some("octocat"), "same identity, roster position unchanged");
        let snap = state.snapshot().unwrap();
        assert_eq!(snap.partial_message.as_deref(), Some("still valid"), "rotating the token for the SAME identity must not clear the cache");
    }

    #[test]
    fn replace_active_token_without_an_active_account_errors() {
        let state = test_state();
        let err = state.replace_active_token("octocat", "ghp_new").unwrap_err();
        assert!(matches!(err, GitHubError::Auth { .. }), "got: {err:?}");
    }

    /// If the active account changed since the caller captured
    /// `expected_login` (e.g. a tray-driven switch racing an open
    /// Settings panel mid-edit), the rotation must refuse rather than
    /// silently applying the new token to whichever account happens to
    /// be active now.
    #[test]
    fn replace_active_token_refuses_when_active_account_changed() {
        let state = test_state();
        state.add_account("alice", "ghp_alice").unwrap();
        state.add_account("bob", "ghp_bob").unwrap();
        // Active is bob (most recently added); caller believes alice is
        // still active and tries to rotate alice's token.
        let err = state.replace_active_token("alice", "ghp_new").unwrap_err();
        assert!(matches!(err, GitHubError::Auth { .. }), "got: {err:?}");
        // Neither account's token should have changed.
        assert_eq!(state.current_token().unwrap(), "ghp_bob", "bob's token untouched");
        state.switch_to("alice").unwrap();
        assert_eq!(state.current_token().unwrap(), "ghp_alice", "alice's token untouched too");
    }
}
