//! Persistent on-disk cache for the most recent successful refresh.
//!
//! Why this exists: a cold launch with no network currently shows an
//! empty UI. With this cache, the last known PRs/issues come up
//! immediately — and the in-memory cache is rehydrated so the next
//! poll's first request decides whether to refresh.
//!
//! Two implementations, mirroring the `TokenStore` pattern:
//!   - [`JsonFileDiskCache`]: writes JSON to the platform's app-data
//!     directory (macOS: `~/Library/Application Support/com.gitbar.app/`).
//!   - [`MemoryDiskCache`]: in-memory, used by tests so they don't
//!     touch real disk paths.
//!
//! Failures are logged and ignored — the disk cache is strictly a
//! performance / offline-UX enhancement, never a hard requirement.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::github::models::{Issue, PullRequest};

const APP_DIR: &str = "com.gitbar.app";
const CACHE_FILE: &str = "cache.json";
const CACHE_FORMAT_VERSION: u32 = 1;

/// Wire format for the persisted cache. Versioned so a future change
/// to the shape can detect-and-drop stale on-disk files instead of
/// panicking on deserialization.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersistedCache {
    pub version: u32,
    pub prs: Vec<PullRequest>,
    pub issues: Vec<Issue>,
    pub partial_message: Option<String>,
    /// Wall-clock time the data was fetched.
    pub fetched_at: SystemTime,
}

pub trait DiskCache: Send + Sync {
    /// Load the last persisted snapshot, if any. Returns `None` for
    /// "not present" *and* for "present but unreadable / version
    /// mismatch" — callers treat both as "no cache".
    fn load(&self) -> Option<PersistedCache>;

    /// Persist the latest snapshot. Errors are logged but not
    /// propagated; the in-memory state is still authoritative.
    fn save(&self, value: &PersistedCache);

    /// Drop the persisted snapshot. Called when the user disconnects
    /// (the data was specific to the previous identity).
    fn clear(&self);
}

pub struct JsonFileDiskCache {
    path: PathBuf,
}

impl JsonFileDiskCache {
    /// Construct using the default app-data path for the current
    /// platform. `None` only if the platform doesn't expose a data
    /// directory (vanishingly rare on macOS / Windows / Linux).
    pub fn for_app() -> Option<Self> {
        let dir = dirs::data_local_dir()?.join(APP_DIR);
        Some(Self { path: dir.join(CACHE_FILE) })
    }
}

impl DiskCache for JsonFileDiskCache {
    fn load(&self) -> Option<PersistedCache> {
        let raw = std::fs::read(&self.path).ok()?;
        let parsed: PersistedCache = serde_json::from_slice(&raw)
            .map_err(|err| {
                eprintln!("gitbar: disk cache decode failed (will refetch): {err}");
            })
            .ok()?;
        if parsed.version != CACHE_FORMAT_VERSION {
            eprintln!(
                "gitbar: disk cache version {} ignored (expected {})",
                parsed.version, CACHE_FORMAT_VERSION,
            );
            return None;
        }
        Some(parsed)
    }

    fn save(&self, value: &PersistedCache) {
        if let Some(parent) = self.path.parent() {
            if let Err(err) = std::fs::create_dir_all(parent) {
                eprintln!("gitbar: disk cache mkdir failed: {err}");
                return;
            }
        }
        let bytes = match serde_json::to_vec(value) {
            Ok(b) => b,
            Err(err) => {
                eprintln!("gitbar: disk cache encode failed: {err}");
                return;
            }
        };
        if let Err(err) = std::fs::write(&self.path, bytes) {
            eprintln!("gitbar: disk cache write failed: {err}");
        }
    }

    fn clear(&self) {
        match std::fs::remove_file(&self.path) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => eprintln!("gitbar: disk cache delete failed: {err}"),
        }
    }
}

#[cfg(test)]
pub struct MemoryDiskCache {
    inner: Mutex<Option<PersistedCache>>,
}

#[cfg(test)]
impl MemoryDiskCache {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }
}

#[cfg(test)]
impl Default for MemoryDiskCache {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
impl DiskCache for MemoryDiskCache {
    fn load(&self) -> Option<PersistedCache> {
        self.inner.lock().ok().and_then(|guard| guard.clone())
    }

    fn save(&self, value: &PersistedCache) {
        if let Ok(mut guard) = self.inner.lock() {
            *guard = Some(value.clone());
        }
    }

    fn clear(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            *guard = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> PersistedCache {
        PersistedCache {
            version: CACHE_FORMAT_VERSION,
            prs: vec![],
            issues: vec![],
            partial_message: None,
            fetched_at: SystemTime::now(),
        }
    }

    #[test]
    fn memory_disk_cache_round_trip() {
        let cache = MemoryDiskCache::new();
        assert!(cache.load().is_none());

        let snap = snapshot();
        cache.save(&snap);
        let loaded = cache.load().expect("should load");
        assert_eq!(loaded.version, CACHE_FORMAT_VERSION);

        cache.clear();
        assert!(cache.load().is_none());
    }

    /// A version mismatch on disk is treated as "no cache". Forwards
    /// compatibility insurance: future shape changes drop old data
    /// rather than panic.
    #[test]
    fn version_mismatch_returns_none() {
        let dir = std::env::temp_dir().join(format!(
            "gitbar-test-disk-cache-{}",
            std::process::id(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cache.json");

        // Write a payload claiming a future version.
        std::fs::write(
            &path,
            r#"{"version":9999,"prs":[],"issues":[],"partial_message":null,"fetched_at":{"secs_since_epoch":0,"nanos_since_epoch":0}}"#,
        )
        .unwrap();

        let cache = JsonFileDiskCache { path: path.clone() };
        assert!(cache.load().is_none());

        // Cleanup.
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&dir);
    }
}
