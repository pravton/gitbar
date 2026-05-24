import type { PullRequest } from "@/types";

/** Default threshold: 3+ PRs from the same repo collapse into a group. */
export const DEFAULT_GROUP_THRESHOLD = 3;

/**
 * Loose entry: a single PR that wasn't grouped (its repo has fewer
 * than `threshold` open PRs in the current list).
 */
export interface LoosePR {
  kind: "pr";
  /** Stable key for keyboard-nav + React reconciliation. Same as `pr.url`. */
  key: string;
  pr: PullRequest;
}

/**
 * Group entry: 3+ PRs from the same repo, rendered as a single
 * collapsible tile.
 */
export interface RepoGroup {
  kind: "group";
  /** Synthetic stable key, never collides with a real PR URL. */
  key: string;
  /** `owner/repo`. */
  repo: string;
  prs: PullRequest[];
}

export type DisplayItem = LoosePR | RepoGroup;

/**
 * Bucket PRs by repo. Buckets with `>= threshold` PRs become a
 * `RepoGroup`; smaller buckets contribute their PRs as `LoosePR`
 * entries.
 *
 * Output ordering:
 * - The relative order of repos in the input is preserved (we take
 *   the first PR's index in each bucket as the bucket's position).
 * - Within a `RepoGroup`, PRs keep their original input order so
 *   the caller can pre-sort (e.g. by creation date desc) and the
 *   group respects it.
 *
 * Returning a flat `DisplayItem[]` lets the caller render and
 * keyboard-nav across both kinds of items uniformly.
 */
export function groupPRsByRepo(
  prs: PullRequest[],
  threshold: number = DEFAULT_GROUP_THRESHOLD,
): DisplayItem[] {
  if (prs.length === 0) return [];

  // Single pass: collect into buckets while remembering each
  // bucket's first-seen index so we can restore the original
  // ordering at the end.
  const buckets = new Map<string, { firstIndex: number; prs: PullRequest[] }>();
  prs.forEach((pr, index) => {
    const repo = pr.repository.name_with_owner;
    const existing = buckets.get(repo);
    if (existing) {
      existing.prs.push(pr);
    } else {
      buckets.set(repo, { firstIndex: index, prs: [pr] });
    }
  });

  // Sort buckets by first-seen index (= preserve original order).
  const ordered = [...buckets.entries()].sort(
    (a, b) => a[1].firstIndex - b[1].firstIndex,
  );

  const out: DisplayItem[] = [];
  for (const [repo, bucket] of ordered) {
    if (bucket.prs.length >= threshold) {
      out.push({
        kind: "group",
        key: `group:${repo}`,
        repo,
        prs: bucket.prs,
      });
    } else {
      for (const pr of bucket.prs) {
        out.push({ kind: "pr", key: pr.url, pr });
      }
    }
  }
  return out;
}

/**
 * Flatten a `DisplayItem[]` to the PRs that are currently selectable
 * by keyboard nav, given which group keys are expanded. Used by
 * `ListView` to feed `useListSelection` with the same PR objects the
 * cards render against, so the keybinds that rely on PR fields
 * (e.g. `D` opens `deployment_url`) keep working uniformly across
 * grouped and ungrouped views.
 *
 * Rules:
 * - Loose PRs are always selectable.
 * - Repo group tiles themselves are NOT selectable (skipped by
 *   arrow keys); click-only by design for this MVP.
 * - When a group is expanded, its child PRs become selectable.
 */
export function selectableItems(
  items: DisplayItem[],
  expanded: ReadonlySet<string>,
): PullRequest[] {
  const out: PullRequest[] = [];
  for (const item of items) {
    if (item.kind === "pr") {
      out.push(item.pr);
    } else if (expanded.has(item.key)) {
      for (const pr of item.prs) {
        out.push(pr);
      }
    }
  }
  return out;
}
