use std::time::{Duration, Instant};

use crate::github::models::{Issue, PullRequest};

#[derive(Debug)]
pub struct Cache {
    pub prs: Vec<PullRequest>,
    pub issues: Vec<Issue>,
    pub last_fetch: Instant,
}

impl Default for Cache {
    fn default() -> Self {
        Self {
            prs: Vec::new(),
            issues: Vec::new(),
            last_fetch: Instant::now() - Duration::from_secs(3600),
        }
    }
}

impl Cache {
    pub fn is_stale(&self, ttl_secs: u64) -> bool {
        self.last_fetch.elapsed() > Duration::from_secs(ttl_secs)
    }

    pub fn update(&mut self, prs: Vec<PullRequest>, issues: Vec<Issue>) {
        self.prs = prs;
        self.issues = issues;
        self.last_fetch = Instant::now();
    }
}
