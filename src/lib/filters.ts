import type { PullRequest } from "@/types";

export type DraftMode = "all" | "drafts" | "published";
export type CiKey = "success" | "failure" | "pending" | "unknown";

export interface PRFilters {
  draft: DraftMode;
  orgs: string[];
  /**
   * Saved allowlist of `owner/name` strings. A non-empty list filters
   * PRs to ONLY those repos — survives across sessions and is
   * independent of which repos happen to be in the currently visible
   * list. Use this to pin "these are the 5 repos I actually care about"
   * out of a 50-repo PAT footprint.
   */
  repos: string[];
  ciStatus: CiKey[];
  reviewRequestedOnly: boolean;
}

export interface FilterPreset {
  id: string;
  name: string;
  filters: PRFilters;
}

export const EMPTY_FILTERS: PRFilters = {
  draft: "all",
  orgs: [],
  repos: [],
  ciStatus: [],
  reviewRequestedOnly: false,
};

export function ciKey(status: string | null): CiKey {
  if (status === "SUCCESS") return "success";
  if (status === "FAILURE" || status === "ERROR") return "failure";
  if (status === "PENDING" || status === "EXPECTED") return "pending";
  return "unknown";
}

export function orgOf(pr: PullRequest): string {
  return pr.repository.name_with_owner.split("/")[0] ?? "";
}

export function applyFilters(prs: PullRequest[], f: PRFilters): PullRequest[] {
  return prs.filter((pr) => {
    if (f.draft === "drafts" && !pr.is_draft) return false;
    if (f.draft === "published" && pr.is_draft) return false;
    if (f.orgs.length > 0 && !f.orgs.includes(orgOf(pr))) return false;
    if (f.repos.length > 0 && !f.repos.includes(pr.repository.name_with_owner)) return false;
    if (f.ciStatus.length > 0 && !f.ciStatus.includes(ciKey(pr.ci_status))) return false;
    if (f.reviewRequestedOnly && !pr.review_requested) return false;
    return true;
  });
}

export function activeFilterCount(f: PRFilters): number {
  let n = 0;
  if (f.draft !== "all") n++;
  if (f.orgs.length > 0) n++;
  if (f.repos.length > 0) n++;
  if (f.ciStatus.length > 0) n++;
  if (f.reviewRequestedOnly) n++;
  return n;
}

/** Return the unique set of orgs across the given PRs, sorted ascending. */
export function deriveOrgs(prs: PullRequest[]): string[] {
  return Array.from(new Set(prs.map(orgOf))).filter(Boolean).sort();
}

/** Return the unique set of `owner/name` repos across the given PRs, sorted ascending. */
export function deriveRepos(prs: PullRequest[]): string[] {
  return Array.from(new Set(prs.map((p) => p.repository.name_with_owner)))
    .filter(Boolean)
    .sort();
}

/**
 * `owner/name` validation. Permissive enough to match GitHub's actual
 * rules: ASCII alphanumerics, hyphens, underscores, dots in either
 * segment, no leading/trailing slashes. Used both by manual-entry input
 * and by `normalizeFilters` so legacy persisted state can't slip
 * malformed strings into the allowlist.
 */
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function isValidRepoSlug(s: string): boolean {
  return REPO_RE.test(s);
}

/**
 * Coerce arbitrary JSON (typically read back from localStorage written
 * by an older version that didn't have `repos`) into a fully-shaped
 * `PRFilters`. Missing keys fall back to `EMPTY_FILTERS`. Invalid types
 * are dropped rather than thrown — a corrupted persisted blob should
 * degrade to "no filters" instead of crashing the list view.
 */
export function normalizeFilters(input: unknown): PRFilters {
  if (typeof input !== "object" || input === null) return EMPTY_FILTERS;
  const raw = input as Partial<PRFilters>;
  const draft: DraftMode =
    raw.draft === "drafts" || raw.draft === "published" || raw.draft === "all"
      ? raw.draft
      : "all";
  const orgs = Array.isArray(raw.orgs)
    ? raw.orgs.filter((s): s is string => typeof s === "string")
    : [];
  const repos = Array.isArray(raw.repos)
    ? raw.repos.filter((s): s is string => typeof s === "string" && isValidRepoSlug(s))
    : [];
  const validCiKeys: CiKey[] = ["success", "failure", "pending", "unknown"];
  const ciStatus = Array.isArray(raw.ciStatus)
    ? raw.ciStatus.filter((c): c is CiKey =>
        typeof c === "string" && (validCiKeys as string[]).includes(c),
      )
    : [];
  const reviewRequestedOnly =
    typeof raw.reviewRequestedOnly === "boolean" ? raw.reviewRequestedOnly : false;
  return { draft, orgs, repos, ciStatus, reviewRequestedOnly };
}

export function newPresetId(): string {
  return `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
