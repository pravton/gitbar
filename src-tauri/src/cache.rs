use std::time::{Duration, Instant};

use crate::github::models::{Issue, PullRequest};

#[derive(Debug)]
pub struct Cache {
    pub prs: Vec<PullRequest>,
    pub issues: Vec<Issue>,
    pub last_fetch: Option<Instant>,
    pub partial_message: Option<String>,
}

impl Default for Cache {
    fn default() -> Self {
        Self {
            prs: Vec::new(),
            issues: Vec::new(),
            last_fetch: None,
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
    }

    #[test]
    fn update_records_partial_message() {
        let mut cache = Cache::default();
        cache.update(vec![], vec![], Some("oops".into()));
        assert_eq!(cache.partial_message.as_deref(), Some("oops"));
    }
}
