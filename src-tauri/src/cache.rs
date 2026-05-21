use std::time::{Duration, Instant, SystemTime};

use crate::github::models::{Issue, PullRequest};

#[derive(Debug)]
pub struct Cache {
    pub prs: Vec<PullRequest>,
    pub issues: Vec<Issue>,
    /// Monotonic timestamp used for the TTL staleness check. `None` means
    /// "no fetch has happened in this process yet" (always stale). When
    /// hydrating from disk, this stays `None` even though `last_fetch_at`
    /// is set — disk-loaded data should trigger a refresh on the next
    /// poll, since we can't reason about monotonic time across launches.
    pub last_fetch: Option<Instant>,
    /// Wall-clock timestamp of when the data was fetched. Surfaced to the
    /// frontend so the header's "Updated X ago" shows the *real* age
    /// instead of "0s ago" after a disk-cache hydrate.
    pub last_fetch_at: Option<SystemTime>,
    pub partial_message: Option<String>,
}

impl Default for Cache {
    fn default() -> Self {
        Self {
            prs: Vec::new(),
            issues: Vec::new(),
            last_fetch: None,
            last_fetch_at: None,
            partial_message: None,
        }
    }
}

impl Cache {
    pub fn is_stale(&self, ttl_secs: u64) -> bool {
        match self.last_fetch {
            None => true,
            Some(t) => t.elapsed() > Duration::from_secs(ttl_secs),
        }
    }

    pub fn update(
        &mut self,
        prs: Vec<PullRequest>,
        issues: Vec<Issue>,
        partial_message: Option<String>,
    ) {
        self.prs = prs;
        self.issues = issues;
        self.partial_message = partial_message;
        self.last_fetch = Some(Instant::now());
        self.last_fetch_at = Some(SystemTime::now());
    }

    /// Populate the cache from a persisted snapshot. `last_fetch`
    /// stays `None` (disk-loaded data is "stale by definition" for the
    /// TTL check), but `last_fetch_at` carries the original wall-clock
    /// timestamp so the UI can show its real age.
    pub fn hydrate(
        &mut self,
        prs: Vec<PullRequest>,
        issues: Vec<Issue>,
        partial_message: Option<String>,
        fetched_at: SystemTime,
    ) {
        self.prs = prs;
        self.issues = issues;
        self.partial_message = partial_message;
        self.last_fetch = None; // monotonic clock can't bridge launches
        self.last_fetch_at = Some(fetched_at);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::models::Repo;

    fn pr(url: &str, created_at: &str) -> PullRequest {
        PullRequest {
            number: 1,
            title: "t".into(),
            url: url.into(),
            state: "OPEN".into(),
            created_at: created_at.into(),
            repository: Repo { name_with_owner: "o/r".into() },
            author: crate::github::models::Author { login: "u".into(), avatar_url: None },
            is_draft: false,
            review_decision: None,
            ci_status: None,
            additions: 0,
            deletions: 0,
            comments: 0,
            deployment_url: None,
        }
    }

    #[test]
    fn default_is_stale() {
        let cache = Cache::default();
        assert!(cache.is_stale(60), "fresh cache should be stale before any fetch");
    }

    #[test]
    fn update_marks_fresh() {
        let mut cache = Cache::default();
        cache.update(vec![pr("u", "2025-01-01")], vec![], None);
        assert!(!cache.is_stale(60));
        assert_eq!(cache.prs.len(), 1);
        assert!(cache.last_fetch_at.is_some(), "wall-clock timestamp also set");
    }

    #[test]
    fn update_records_partial_message() {
        let mut cache = Cache::default();
        cache.update(vec![], vec![], Some("oops".into()));
        assert_eq!(cache.partial_message.as_deref(), Some("oops"));
    }

    /// Hydrate from a persisted snapshot: PR/issue data is restored and
    /// `last_fetch_at` carries the original wall-clock time, but
    /// `last_fetch` is None so the next get_data triggers a refresh.
    #[test]
    fn hydrate_preserves_wall_clock_but_marks_stale() {
        let mut cache = Cache::default();
        let one_hour_ago = SystemTime::now() - std::time::Duration::from_secs(3600);
        cache.hydrate(vec![pr("u", "x")], vec![], None, one_hour_ago);

        assert!(cache.is_stale(60), "hydrated cache must be stale (no monotonic anchor)");
        assert_eq!(cache.last_fetch_at, Some(one_hour_ago));
        assert_eq!(cache.prs.len(), 1);
    }
}
