//! Multi-account storage: a roster of known GitHub logins plus which one
//! is active. Each account's PAT lives in its own OS keychain slot
//! (`token_store::KeychainTokenStore::for_account`); the roster itself
//! (logins + active pointer) is non-secret metadata persisted as JSON in
//! the app-data directory, since `keyring` has no portable "list every
//! entry for this service" API to reconstruct the roster from the
//! keychain alone.
//!
//! Two implementations:
//!   - [`FileKeychainAccountStore`]: real, JSON roster file + keychain.
//!   - [`InMemoryAccountStore`]: everything in a `Mutex`, nothing
//!     touches disk or the keychain. Used by tests, *and* as the
//!     production fallback when the platform doesn't expose a data
//!     directory. That second use is why this isn't `#[cfg(test)]` like
//!     `token_store::MemoryTokenStore`/`disk_cache::MemoryDiskCache` are:
//!     those two are redundant persistence layers over state `AppState`
//!     already keeps in memory regardless, so their "no-op" fallback
//!     (`NoOpDiskCache`) only costs persistence. This trait holds the
//!     *only* copy of "which accounts exist," so a true no-op here would
//!     make multi-account silently non-functional, not just
//!     non-persistent, so the fallback needs to actually hold state for
//!     the process lifetime.
//!
//! No migration from the pre-multi-account single keychain slot
//! (`token_store::KeychainTokenStore::legacy()`): the previous token is
//! simply orphaned, and the user re-pastes it once as their first
//! account. Same tradeoff this project already made for the v0.1.0
//! `SERVICE` rename (see `token_store.rs`), acceptable because it's a
//! one-time re-onboard, not data loss, and keeps this cut from needing
//! an async migration path inside a sync constructor. The one-time
//! cleanup of the orphaned legacy slot runs from `AppState::new()`, not
//! from every `add()` call; see that function's comment.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::disk_cache::write_user_only;
use crate::token_store::{KeychainTokenStore, TokenStore};

const APP_DIR: &str = "io.github.pravton.gitbar";
const ROSTER_FILE: &str = "accounts.json";
const ROSTER_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct Roster {
    #[serde(default)]
    version: u32,
    /// Known logins, in the order they were added. Display order in both
    /// Settings and the tray "Switch Account" submenu.
    #[serde(default)]
    logins: Vec<String>,
    #[serde(default)]
    active_login: Option<String>,
}

pub trait AccountStore: Send + Sync {
    /// Known logins, in add-order.
    fn list(&self) -> Vec<String>;
    /// Which login (if any) is currently active.
    fn active(&self) -> Option<String>;
    /// Add a login to the roster (no-op on the roster if already present,
    /// but the token is always overwritten) and persist its token.
    /// Does NOT change which account is active: callers that want the
    /// newly-added account to become active call `set_active` afterward.
    fn add(&self, login: &str, token: &str) -> Result<(), String>;
    /// Remove a login from the roster and delete its stored token.
    /// Clears the active pointer if `login` was the active account.
    /// Callers are responsible for picking a new active login (or
    /// leaving it cleared) via `set_active` afterward.
    fn remove(&self, login: &str) -> Result<(), String>;
    /// Look up the stored token for a login. `None` if the login isn't
    /// known or the keychain entry is missing/unavailable.
    fn token_for(&self, login: &str) -> Option<String>;
    /// Set which login is active. `None` clears to "no active account".
    /// Does not validate `login` is in the roster. Callers only pass
    /// values that came from `list()`.
    fn set_active(&self, login: Option<&str>) -> Result<(), String>;
}

pub struct FileKeychainAccountStore {
    roster_path: PathBuf,
}

impl FileKeychainAccountStore {
    /// Construct using the default app-data path for the current
    /// platform. `None` only if the platform doesn't expose a data
    /// directory (vanishingly rare on macOS / Windows / Linux). Callers
    /// fall back to [`InMemoryAccountStore`] in that case.
    pub fn for_app() -> Option<Self> {
        let dir = dirs::data_local_dir()?.join(APP_DIR);
        Some(Self { roster_path: dir.join(ROSTER_FILE) })
    }

    /// Read-modify-write callers all go through this so any future
    /// `list()`/`active()` change to reload rather than trust an
    /// already-loaded copy is a one-line fix.
    fn load_roster(&self) -> Roster {
        let raw = match std::fs::read(&self.roster_path) {
            Ok(raw) => raw,
            // Missing file is the normal "nothing added yet" case, not
            // worth logging.
            Err(_) => return Roster::default(),
        };
        match serde_json::from_slice::<Roster>(&raw) {
            Ok(parsed) if parsed.version == ROSTER_FORMAT_VERSION => parsed,
            Ok(parsed) => {
                // Mirrors disk_cache.rs's handling of the same situation
                // for cache.json: log instead of silently resetting, so
                // "my accounts disappeared" has a diagnostic trail.
                eprintln!(
                    "gitbar: accounts roster version {} ignored (expected {})",
                    parsed.version, ROSTER_FORMAT_VERSION,
                );
                Roster::default()
            }
            Err(err) => {
                eprintln!("gitbar: accounts roster decode failed (will reset): {err}");
                Roster::default()
            }
        }
    }

    fn save_roster(&self, roster: &Roster) -> Result<(), String> {
        if let Some(parent) = self.roster_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("accounts dir: {e}"))?;
        }
        let bytes = serde_json::to_vec(roster).map_err(|e| format!("accounts encode: {e}"))?;
        // Atomic write: temp file + rename, same pattern `disk_cache.rs`
        // uses for the PR/issue cache, so a mid-write crash can't leave a
        // truncated roster behind. `write_user_only` also matches that
        // file's permission hardening (0600 on Unix): the roster lists
        // which GitHub logins are connected to this machine, which is
        // non-public metadata even though it isn't a secret the way the
        // tokens themselves are.
        let tmp = self.roster_path.with_extension("json.tmp");
        write_user_only(&tmp, &bytes).map_err(|e| format!("accounts write: {e}"))?;
        std::fs::rename(&tmp, &self.roster_path).map_err(|e| format!("accounts rename: {e}"))?;
        Ok(())
    }
}

impl AccountStore for FileKeychainAccountStore {
    fn list(&self) -> Vec<String> {
        self.load_roster().logins
    }

    fn active(&self) -> Option<String> {
        self.load_roster().active_login
    }

    fn add(&self, login: &str, token: &str) -> Result<(), String> {
        KeychainTokenStore::for_account(login).save(token)?;
        let mut roster = self.load_roster();
        if !roster.logins.iter().any(|l| l == login) {
            roster.logins.push(login.to_string());
        }
        roster.version = ROSTER_FORMAT_VERSION;
        self.save_roster(&roster)
    }

    fn remove(&self, login: &str) -> Result<(), String> {
        // Persist the roster change FIRST, keychain deletion second. If
        // this were reversed and the roster save failed after a
        // successful keychain delete, the roster would keep listing a
        // login (possibly as active) whose secret is already gone: a
        // "ghost" account with no token and no way to recover from
        // within the app. This order's worst case on a keychain-delete
        // failure is the opposite and strictly safer: an orphaned
        // keychain secret with no roster reference, which is harmless
        // leftover data rather than a broken account.
        let mut roster = self.load_roster();
        roster.logins.retain(|l| l != login);
        if roster.active_login.as_deref() == Some(login) {
            roster.active_login = None;
        }
        roster.version = ROSTER_FORMAT_VERSION;
        self.save_roster(&roster)?;
        if let Err(err) = KeychainTokenStore::for_account(login).delete() {
            eprintln!("gitbar: keychain cleanup for removed account {login} failed (non-fatal): {err}");
        }
        Ok(())
    }

    fn token_for(&self, login: &str) -> Option<String> {
        KeychainTokenStore::for_account(login).load()
    }

    fn set_active(&self, login: Option<&str>) -> Result<(), String> {
        let mut roster = self.load_roster();
        roster.active_login = login.map(|l| l.to_string());
        roster.version = ROSTER_FORMAT_VERSION;
        self.save_roster(&roster)
    }
}

pub struct InMemoryAccountStore {
    roster: Mutex<Roster>,
    tokens: Mutex<HashMap<String, String>>,
}

impl InMemoryAccountStore {
    pub fn new() -> Self {
        Self {
            roster: Mutex::new(Roster::default()),
            tokens: Mutex::new(HashMap::new()),
        }
    }

    /// Drop a login's stored token while LEAVING it in the roster, so
    /// `token_for` returns `None` for a login `list()` still reports.
    /// Models the real-world orphan: the keychain entry was deleted
    /// out-of-band (Keychain Access.app, a half-finished profile
    /// migration) or the keychain is momentarily unavailable, while the
    /// roster JSON on disk still lists the account.
    #[cfg(test)]
    pub fn orphan_token_for_test(&self, login: &str) {
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.remove(login);
        }
    }
}

impl Default for InMemoryAccountStore {
    fn default() -> Self {
        Self::new()
    }
}

impl AccountStore for InMemoryAccountStore {
    fn list(&self) -> Vec<String> {
        self.roster.lock().map(|r| r.logins.clone()).unwrap_or_default()
    }

    fn active(&self) -> Option<String> {
        self.roster.lock().ok().and_then(|r| r.active_login.clone())
    }

    fn add(&self, login: &str, token: &str) -> Result<(), String> {
        self.tokens
            .lock()
            .map_err(|e| e.to_string())?
            .insert(login.to_string(), token.to_string());
        let mut roster = self.roster.lock().map_err(|e| e.to_string())?;
        if !roster.logins.iter().any(|l| l == login) {
            roster.logins.push(login.to_string());
        }
        Ok(())
    }

    fn remove(&self, login: &str) -> Result<(), String> {
        self.tokens.lock().map_err(|e| e.to_string())?.remove(login);
        let mut roster = self.roster.lock().map_err(|e| e.to_string())?;
        roster.logins.retain(|l| l != login);
        if roster.active_login.as_deref() == Some(login) {
            roster.active_login = None;
        }
        Ok(())
    }

    fn token_for(&self, login: &str) -> Option<String> {
        self.tokens.lock().ok().and_then(|t| t.get(login).cloned())
    }

    fn set_active(&self, login: Option<&str>) -> Result<(), String> {
        let mut roster = self.roster.lock().map_err(|e| e.to_string())?;
        roster.active_login = login.map(|l| l.to_string());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_list_and_token_for_round_trip() {
        let store = InMemoryAccountStore::new();
        assert_eq!(store.list(), Vec::<String>::new());

        store.add("alice", "ghp_a").unwrap();
        assert_eq!(store.list(), vec!["alice".to_string()]);
        assert_eq!(store.token_for("alice").as_deref(), Some("ghp_a"));

        store.add("bob", "ghp_b").unwrap();
        assert_eq!(store.list(), vec!["alice".to_string(), "bob".to_string()], "add-order preserved");
    }

    #[test]
    fn add_is_idempotent_on_login_but_overwrites_token() {
        let store = InMemoryAccountStore::new();
        store.add("alice", "ghp_old").unwrap();
        store.add("alice", "ghp_new").unwrap();
        assert_eq!(store.list(), vec!["alice".to_string()], "no duplicate roster entry");
        assert_eq!(store.token_for("alice").as_deref(), Some("ghp_new"), "token overwritten");
    }

    #[test]
    fn set_active_and_active_round_trip() {
        let store = InMemoryAccountStore::new();
        assert_eq!(store.active(), None);
        store.add("alice", "ghp_a").unwrap();
        store.set_active(Some("alice")).unwrap();
        assert_eq!(store.active().as_deref(), Some("alice"));
        store.set_active(None).unwrap();
        assert_eq!(store.active(), None);
    }

    #[test]
    fn remove_clears_token_and_roster_entry() {
        let store = InMemoryAccountStore::new();
        store.add("alice", "ghp_a").unwrap();
        store.remove("alice").unwrap();
        assert_eq!(store.list(), Vec::<String>::new());
        assert_eq!(store.token_for("alice"), None);
    }

    #[test]
    fn remove_clears_active_pointer_if_it_was_the_active_account() {
        let store = InMemoryAccountStore::new();
        store.add("alice", "ghp_a").unwrap();
        store.set_active(Some("alice")).unwrap();
        store.remove("alice").unwrap();
        assert_eq!(store.active(), None, "removing the active account clears the pointer");
    }

    #[test]
    fn remove_of_inactive_account_leaves_active_pointer_alone() {
        let store = InMemoryAccountStore::new();
        store.add("alice", "ghp_a").unwrap();
        store.add("bob", "ghp_b").unwrap();
        store.set_active(Some("alice")).unwrap();
        store.remove("bob").unwrap();
        assert_eq!(store.active().as_deref(), Some("alice"), "removing a non-active account doesn't touch the pointer");
    }

    #[test]
    fn remove_of_unknown_login_is_a_no_op() {
        let store = InMemoryAccountStore::new();
        store.add("alice", "ghp_a").unwrap();
        store.remove("nobody").unwrap();
        assert_eq!(store.list(), vec!["alice".to_string()]);
    }
}
