pub const SEARCH_PRS: &str = r#"
query($query: String!) {
  search(query: $query, type: ISSUE, first: 100) {
    issueCount
    edges {
      node {
        ... on PullRequest {
          number
          title
          url
          state
          body
          createdAt
          isDraft
          reviewDecision
          additions
          deletions
          totalCommentsCount
          repository { nameWithOwner }
          author { login avatarUrl }
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup { state }
                deployments(last: 5) {
                  nodes {
                    latestStatus { environmentUrl }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
"#;

pub const SEARCH_ISSUES: &str = r#"
query($query: String!) {
  search(query: $query, type: ISSUE, first: 100) {
    issueCount
    edges {
      node {
        ... on Issue {
          number
          title
          url
          state
          createdAt
          repository { nameWithOwner }
          labels(first: 10) {
            nodes { name color }
          }
        }
      }
    }
  }
}
"#;

pub const VIEWER: &str = r#"
query {
  viewer { login }
}
"#;

pub const PR_AUTHOR_QUERY: &str = "is:pr is:open author:@me";
pub const PR_REVIEW_QUERY: &str = "is:pr is:open review-requested:@me";
pub const ISSUE_ASSIGNED_QUERY: &str = "is:issue is:open assignee:@me";

/// Drill-down: check runs (CI jobs) on a PR's latest commit. Fired lazily
/// when the user clicks the CI pill on a PR card, so we don't add per-poll
/// load. Pulls `checkSuites` (one per workflow run) and the `checkRuns`
/// inside each (one per job). `workflowRun.workflow.name` is the
/// human-readable workflow label; `name` on the check run is the job
/// label (e.g. "build", "test").
pub const PR_CHECKS: &str = r#"
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(last: 1) {
        nodes {
          commit {
            checkSuites(first: 20) {
              nodes {
                workflowRun {
                  workflow { name }
                }
                checkRuns(first: 30) {
                  nodes {
                    name
                    status
                    conclusion
                    startedAt
                    completedAt
                    detailsUrl
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
"#;
