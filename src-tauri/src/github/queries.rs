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
          comments { totalCount }
          repository { nameWithOwner }
          author { login avatarUrl }
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup { state }
                deployments(last: 5) {
                  nodes {
                    environment
                    latestStatus { environmentUrl state }
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
