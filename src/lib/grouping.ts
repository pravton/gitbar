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

/** The `RepoGroup.key` for a repo. */
export function groupKeyFor(repo: string): string {
  return `group:${repo}`;
}

/**
 * Which repos render as groups: those with `threshold`+ PRs, plus those in
 * `previous` that still have any PR. Pass the full, unfiltered list so typing
 * in search can't restructure the list, and feed the result back as `previous`
 * so a group doesn't dissolve when a PR merges. A repo with no PRs left drops
 * out and has to earn its group again.
 */
export function reposToGroup(
  prs: PullRequest[],
  previous: ReadonlySet<string> = new Set(),
  threshold: number = DEFAULT_GROUP_THRESHOLD,
): Set<string> {
  const counts = new Map<string, number>();
  for (const pr of prs) {
    counts.set(pr.repository.name_with_owner, (counts.get(pr.repository.name_with_owner) ?? 0) + 1);
  }
  const grouped = new Set<string>();
  for (const [repo, count] of counts) {
    if (count >= threshold || previous.has(repo)) grouped.add(repo);
  }
  return grouped;
}

/**
 * Lay PRs out for display. PRs from a repo in `groupedRepos` become one
 * `RepoGroup`, emitted at the repo's first occurrence in the input; the rest
 * become `LoosePR` entries **in their original positions**.
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
  groupedRepos: ReadonlySet<string> = reposToGroup(prs),
): DisplayItem[] {
  if (prs.length === 0) return [];

  // Walk the original list. Grouped repos get emitted ONCE at the first
  // occurrence (with all of that repo's PRs collected in input order);
  // subsequent PRs from the same grouped repo are skipped. Loose PRs are
  // emitted in place.
  const emitted = new Set<string>();
  const out: DisplayItem[] = [];
  for (const pr of prs) {
    const repo = pr.repository.name_with_owner;
    if (groupedRepos.has(repo)) {
      if (!emitted.has(repo)) {
        emitted.add(repo);
        const groupPrs = prs.filter(
          (candidate) => candidate.repository.name_with_owner === repo,
        );
        out.push({ kind: "group", key: groupKeyFor(repo), repo, prs: groupPrs });
      }
      // subsequent occurrences of a grouped repo are folded into the group
    } else {
      out.push({ kind: "pr", key: pr.url, pr });
    }
  }
  return out;
}

/**
 * A keyboard-nav-selectable entry in the PR list. Carries a `url` so it
 * plugs straight into `useListSelection` (which keys by `url`), plus a
 * discriminant so `ListView`'s keydown handler can branch: Enter on a
 * `pr` opens its URL, Enter on a `group` toggles its expansion.
 *
 * For a group entry, `url` is the synthetic `group.key` (`group:owner/repo`)
 * — it never collides with a real PR URL (those are `https://…`).
 */
export type PrNavItem =
  | { kind: "pr"; url: string; pr: PullRequest }
  | { kind: "group"; url: string; group: RepoGroup };

/**
 * Flatten a `DisplayItem[]` to the entries that are currently selectable
 * by keyboard nav, given which group keys are expanded. Used by
 * `ListView` to feed `useListSelection`, so the keybinds that rely on PR
 * fields (e.g. `D` opens `deployment_url`) keep working uniformly across
 * grouped and ungrouped views.
 *
 * Rules:
 * - Loose PRs are always selectable.
 * - A repo group TILE is selectable (Enter toggles expand/collapse); it
 *   sits at the position of the group, ahead of any children.
 * - When a group is expanded, its child PRs become selectable too, so
 *   arrow-down walks from the tile into its members.
 */
export function selectableItems(
  items: DisplayItem[],
  expanded: ReadonlySet<string>,
): PrNavItem[] {
  const out: PrNavItem[] = [];
  for (const item of items) {
    if (item.kind === "pr") {
      out.push({ kind: "pr", url: item.pr.url, pr: item.pr });
    } else {
      out.push({ kind: "group", url: item.key, group: item });
      if (expanded.has(item.key)) {
        for (const pr of item.prs) {
          out.push({ kind: "pr", url: pr.url, pr });
        }
      }
    }
  }
  return out;
}
