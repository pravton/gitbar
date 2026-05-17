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
