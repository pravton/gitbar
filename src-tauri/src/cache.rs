use std::collections::VecDeque;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::github::models::{HistorySample, Issue, PullRequest};

/// 24-hour retention for the sparkline ring buffer, in milliseconds.
/// Samples older than this are evicted on every `update`.
const HISTORY_WINDOW_MS: u64 = 24 * 60 * 60 * 1000;

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
    /// Ring buffer of the panel's three top-line counts over the past
    /// 24 hours. One sample is appended per successful refresh and
    /// any samples older than the window get evicted from the front.
    /// Persisted to disk so the trend doesn't reset on every launch.
    pub history: VecDeque<HistorySample>,
}

impl Default for Cache {
    fn default() -> Self {
        Self {
            prs: Vec::new(),
            issues: Vec::new(),
            last_fetch: None,
            last_fetch_at: None,
            partial_message: None,
            history: VecDeque::new(),
        }
    }
}

/// Wall-clock milliseconds since the Unix epoch, or `None` if the
/// system clock can't be represented that way. Two ways to get None:
///   - clock currently set before 1970 (cold-booted device with a
///     dead RTC battery, ntpd not synced yet);
///   - ms count overflows u64 (~584 million years from now).
///
/// Callers MUST treat `None` as "skip the history step entirely" -
/// inventing a fallback value like `0` here breaks the ring buffer's
/// monotonic-order invariant: a `0` sample sandwiched between real
/// ones makes the eviction cutoff (which is computed *against* the
/// current time) never advance past the buffer's front, so old data
/// piles up unboundedly until the clock is fixed AND a clean refresh
/// happens.
fn now_ms() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| u64::try_from(d.as_millis()).ok())
}

fn count_review_requested(prs: &[PullRequest]) -> u32 {
    // Matches the header tile + filter: count PRs the user was actually
    // asked to review (from the `review-requested:@me` search), not PRs
    // whose `review_decision` happens to be REVIEW_REQUIRED.
    prs.iter().filter(|p| p.review_requested).count() as u32
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
        // Compute and append the sparkline sample BEFORE moving prs/issues
        // into self, so we don't have to clone just to read lengths.
        // Skip the history step entirely if the clock isn't usable - see
        // `now_ms` for why a bogus fallback would corrupt eviction.
        if let Some(at_ms) = now_ms() {
            let sample = HistorySample {
                at_ms,
                pr_count: prs.len() as u32,
                review_requested: count_review_requested(&prs),
                issue_count: issues.len() as u32,
            };
            self.append_history(sample);
        }

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
        history: Vec<HistorySample>,
    ) {
        self.prs = prs;
        self.issues = issues;
        self.partial_message = partial_message;
        self.last_fetch = None; // monotonic clock can't bridge launches
        self.last_fetch_at = Some(fetched_at);
        // Replace the in-memory ring with the persisted samples,
        // then evict anything older than the retention window. Even
        // a long-quit app coming back after >24h drops obsolete data
        // on hydrate rather than letting it leak into the chart. If
        // the clock is unusable we keep the persisted samples as-is
        // and let the next valid refresh do the eviction; that's
        // strictly safer than evicting against a fabricated `0`.
        self.history = VecDeque::from(history);
        if let Some(now) = now_ms() {
            self.evict_expired_history(now);
        }
    }

    /// Push a sample onto the back of the ring buffer, evicting any
    /// samples older than the retention window from the front. Public
    /// only at crate level so tests can exercise the eviction logic
    /// directly without going through `update`.
    pub(crate) fn append_history(&mut self, sample: HistorySample) {
        self.evict_expired_history(sample.at_ms);
        self.history.push_back(sample);
    }

    fn evict_expired_history(&mut self, now_ms: u64) {
        let cutoff = now_ms.saturating_sub(HISTORY_WINDOW_MS);
        while self
            .history
            .front()
            .map(|s| s.at_ms < cutoff)
            .unwrap_or(false)
        {
            self.history.pop_front();
        }
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
            review_requested: false,
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
        cache.hydrate(vec![pr("u", "x")], vec![], None, one_hour_ago, Vec::new());

        assert!(cache.is_stale(60), "hydrated cache must be stale (no monotonic anchor)");
        assert_eq!(cache.last_fetch_at, Some(one_hour_ago));
        assert_eq!(cache.prs.len(), 1);
    }

    /// update() appends a sample for the current refresh. The sample's
    /// counts mirror the PR/issue vectors handed in, including the
    /// review-requested subcount derived from the `review_requested`
    /// flag (set when a PR came from the `review-requested:@me` search).
    #[test]
    fn update_appends_history_sample() {
        let mut cache = Cache::default();
        let mut review_pr = pr("u1", "2025-01-01");
        review_pr.review_requested = true;
        cache.update(vec![review_pr, pr("u2", "x")], vec![], None);

        assert_eq!(cache.history.len(), 1);
        let s = cache.history.back().expect("sample");
        assert_eq!(s.pr_count, 2);
        assert_eq!(s.review_requested, 1);
        assert_eq!(s.issue_count, 0);
    }

    /// Samples older than 24h are evicted from the front of the ring
    /// before the new sample is appended. Tests both the eviction
    /// path and that fresh samples stick around.
    #[test]
    fn append_history_evicts_samples_older_than_window() {
        use crate::github::models::HistorySample;
        let mut cache = Cache::default();
        let now = now_ms().expect("clock available in tests");
        cache.append_history(HistorySample {
            at_ms: now - HISTORY_WINDOW_MS - 1, // outside the window
            pr_count: 1,
            review_requested: 0,
            issue_count: 0,
        });
        cache.append_history(HistorySample {
            at_ms: now - 60_000, // inside the window
            pr_count: 2,
            review_requested: 0,
            issue_count: 0,
        });
        cache.append_history(HistorySample {
            at_ms: now,
            pr_count: 3,
            review_requested: 0,
            issue_count: 0,
        });

        assert_eq!(cache.history.len(), 2);
        assert_eq!(cache.history.front().unwrap().pr_count, 2);
        assert_eq!(cache.history.back().unwrap().pr_count, 3);
    }

    /// Hydrating from a long-quit app drops obsolete samples on the
    /// floor rather than rendering them in the chart.
    #[test]
    fn hydrate_evicts_expired_persisted_samples() {
        use crate::github::models::HistorySample;
        let mut cache = Cache::default();
        let now = now_ms().expect("clock available in tests");
        cache.hydrate(
            vec![],
            vec![],
            None,
            SystemTime::now(),
            vec![
                HistorySample {
                    at_ms: now - HISTORY_WINDOW_MS - 1000,
                    pr_count: 1,
                    review_requested: 0,
                    issue_count: 0,
                },
                HistorySample {
                    at_ms: now - 1000,
                    pr_count: 2,
                    review_requested: 0,
                    issue_count: 0,
                },
            ],
        );
        assert_eq!(cache.history.len(), 1);
        assert_eq!(cache.history.front().unwrap().pr_count, 2);
    }
}
