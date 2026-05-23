//! Persistent storage for the user's GitHub PAT.
//!
//! Two implementations:
//!   - [`KeychainTokenStore`] uses the platform's OS keychain via the
//!     `keyring` crate (macOS Keychain, Windows Credential Manager, Linux
//!     Secret Service). Encrypted at rest, scoped to the user account.
//!   - [`MemoryTokenStore`] keeps the token in a `Mutex<Option<String>>`.
//!     Used by tests so they don't touch the real keychain.
//!
//! The trait is intentionally narrow: `load`, `save`, `delete`. Anything
//! richer (rotation, multi-account) belongs in a higher layer.

#[cfg(test)]
use std::sync::Mutex;

/// Matches `tauri.conf.json`'s `identifier`. The keyring entry is scoped
/// per-service-name, so renaming this orphans the old credential. This
/// is intentional for the v0.1.0 cut: pre-release installs (none in
/// the wild) need to re-onboard once.
const SERVICE: &str = "io.github.pravton.gitbar";
const ACCOUNT: &str = "github-pat";

pub trait TokenStore: Send + Sync {
    /// Returns the stored token if one exists. `None` covers both "no
    /// entry" and "the backend was unavailable" — callers treat both as
    /// "user needs to onboard".
    fn load(&self) -> Option<String>;

    /// Persist the token. Overwrites any existing value.
    fn save(&self, token: &str) -> Result<(), String>;

    /// Remove the persisted token if one exists. No-op when nothing is
    /// stored.
    fn delete(&self) -> Result<(), String>;
}

pub struct KeychainTokenStore;

impl KeychainTokenStore {
    pub fn new() -> Self {
        Self
    }

    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("keychain entry: {e}"))
    }
}

impl Default for KeychainTokenStore {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenStore for KeychainTokenStore {
    fn load(&self) -> Option<String> {
        Self::entry().ok().and_then(|entry| match entry.get_password() {
            Ok(token) => Some(token),
            Err(keyring::Error::NoEntry) => None,
            Err(err) => {
                eprintln!("gitbar: keychain load failed: {err}");
                None
            }
        })
    }

    fn save(&self, token: &str) -> Result<(), String> {
        let entry = Self::entry()?;
        entry
            .set_password(token)
            .map_err(|e| format!("keychain save: {e}"))
    }

    fn delete(&self) -> Result<(), String> {
        let entry = Self::entry()?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            // Deleting a non-existent credential is a no-op as far as our
            // callers are concerned.
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(format!("keychain delete: {err}")),
        }
    }
}

/// In-memory token store. Used by tests; gated behind `cfg(test)` so it
/// never compiles into release binaries.
#[cfg(test)]
pub struct MemoryTokenStore {
    inner: Mutex<Option<String>>,
}

#[cfg(test)]
impl MemoryTokenStore {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

#[cfg(test)]
impl Default for MemoryTokenStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
impl TokenStore for MemoryTokenStore {
    fn load(&self) -> Option<String> {
        self.inner.lock().ok().and_then(|guard| guard.clone())
    }

    fn save(&self, token: &str) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        *guard = Some(token.to_string());
        Ok(())
    }

    fn delete(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        *guard = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_round_trip() {
        let store = MemoryTokenStore::new();
        assert_eq!(store.load(), None);

        store.save("ghp_abc").unwrap();
        assert_eq!(store.load().as_deref(), Some("ghp_abc"));

        store.save("ghp_xyz").unwrap();
        assert_eq!(store.load().as_deref(), Some("ghp_xyz"), "save overwrites");

        store.delete().unwrap();
        assert_eq!(store.load(), None);

        // Deleting nothing is fine.
        store.delete().unwrap();
    }
}
