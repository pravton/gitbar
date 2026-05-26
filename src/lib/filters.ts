import type { PullRequest } from "@/types";

export type DraftMode = "all" | "drafts" | "published";
export type CiKey = "success" | "failure" | "pending" | "unknown";

export interface PRFilters {
  draft: DraftMode;
  orgs: string[];
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
    if (f.ciStatus.length > 0 && !f.ciStatus.includes(ciKey(pr.ci_status))) return false;
    if (f.reviewRequestedOnly && !pr.review_requested) return false;
    return true;
  });
}

export function activeFilterCount(f: PRFilters): number {
  let n = 0;
  if (f.draft !== "all") n++;
  if (f.orgs.length > 0) n++;
  if (f.ciStatus.length > 0) n++;
  if (f.reviewRequestedOnly) n++;
  return n;
}

/** Return the unique set of orgs across the given PRs, sorted ascending. */
export function deriveOrgs(prs: PullRequest[]): string[] {
  return Array.from(new Set(prs.map(orgOf))).filter(Boolean).sort();
}

export function newPresetId(): string {
  return `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
