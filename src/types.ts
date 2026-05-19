export interface Repo {
  name_with_owner: string;
}

export interface Author {
  login: string;
  avatar_url: string | null;
}

export interface Label {
  name: string;
  color: string;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: string;
  created_at: string;
  repository: Repo;
  author: Author;
  is_draft: boolean;
  review_decision: string | null;
  ci_status: string | null;
  additions: number;
  deletions: number;
  comments: number;
  /**
   * URL to surface on the "Deploy" button. Source precedence:
   *   1. PR body marker — `Deploy:`/`Deploy-Link:`/`Preview:`/`Local-Deploy:`/`Local:` line,
   *      or an `<!-- gitbar:deploy=URL -->` HTML comment. See AGENTS.md.
   *   2. Latest commit's most recent deployment `environmentUrl` (GitHub deployments API).
   * `null` when neither is available.
   */
  deployment_url: string | null;
}

export interface Issue {
  number: number;
  title: string;
  url: string;
  created_at: string;
  repository: Repo;
  labels: Label[];
  state: string;
}

export interface AuthCheck {
  ok: boolean;
  login: string | null;
  message: string | null;
}

export interface GitHubData {
  prs: PullRequest[];
  issues: Issue[];
  partial_message: string | null;
}

export type GitHubError =
  | { kind: "auth"; message: string }
  | { kind: "rate_limited"; message: string; retry_after_secs: number | null }
  | { kind: "network"; message: string }
  | { kind: "server"; message: string }
  | { kind: "partial"; message: string };
