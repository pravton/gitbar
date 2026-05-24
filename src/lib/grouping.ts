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
 * `RepoGroup` (emitted once at the repo's first occurrence in the
 * input); smaller buckets contribute their PRs as `LoosePR` entries
 * **in their original positions**.
 *
 * Why two passes: a single-pass-then-bucket-emit approach reorders
 * interleaved loose PRs. Input `[A1, B1, A2]` with no grouping
 * would emit as `[A1, A2, B1]` because A's bucket flushes together.
 * Counting first lets the second pass walk the original list and
 * emit each loose PR in place.
 *
 * Output ordering:
 * - Loose PRs appear in their original input position.
 * - A repo group appears at the position of that repo's FIRST PR
 *   in the input; subsequent PRs of the same grouped repo are
 *   absorbed into the group rather than re-emitted.
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

  // Pass 1: count per repo.
  const counts = new Map<string, number>();
  for (const pr of prs) {
    counts.set(pr.repository.name_with_owner, (counts.get(pr.repository.name_with_owner) ?? 0) + 1);
  }

  // Pass 2: walk the original list. Grouped repos get emitted ONCE
  // at the first occurrence (with all of that repo's PRs collected
  // in input order); subsequent PRs from the same grouped repo are
  // skipped. Loose PRs are emitted in place.
  const emitted = new Set<string>();
  const out: DisplayItem[] = [];
  for (const pr of prs) {
    const repo = pr.repository.name_with_owner;
    const count = counts.get(repo) ?? 0;
    if (count >= threshold) {
      if (!emitted.has(repo)) {
        emitted.add(repo);
        const groupPrs = prs.filter(
          (candidate) => candidate.repository.name_with_owner === repo,
        );
        out.push({ kind: "group", key: `group:${repo}`, repo, prs: groupPrs });
      }
      // subsequent occurrences of a grouped repo are folded into the group
    } else {
      out.push({ kind: "pr", key: pr.url, pr });
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
