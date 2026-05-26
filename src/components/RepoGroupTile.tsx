import { ChevronDown, ChevronRight, GitPullRequest } from "lucide-react";
import type { Density } from "@/hooks/useDensityMode";
import { cn } from "@/lib/utils";
import type { RepoGroup } from "@/lib/grouping";
import { PRCard } from "@/components/PRCard";

interface RepoGroupTileProps {
  group: RepoGroup;
  expanded: boolean;
  onToggle: () => void;
  density: Density;
  /** Which child URL is currently keyboard-selected, if any. */
  selectedChildKey: string | null;
}

/**
 * One row of "auto-merged" PRs from the same repo. Renders a small
 * header strip (chevron, repo name, count, summary). When expanded,
 * the contained PRCards render beneath with a slight left-indent so
 * they read as members of the group rather than independent items.
 *
 * The header itself is NOT a keyboard-nav selectable item in this
 * MVP. Click anywhere on the header toggles expand/collapse. Arrow
 * keys still walk through visible PR children (handled in ListView
 * via `selectableItems`).
 */
export function RepoGroupTile({
  group,
  expanded,
  onToggle,
  density,
  selectedChildKey,
}: RepoGroupTileProps) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const repoShort = group.repo.split("/").at(-1) ?? group.repo;
  // "N needs review" = PRs in this group you were asked to review. Uses
  // the review_requested flag (from the review-requested:@me search) to
  // stay consistent with the header tile and the per-card Eye icon,
  // rather than review_decision which is null without a required-review rule.
  const reviewWaiting = group.prs.filter((pr) => pr.review_requested).length;

  return (
    <div className="card overflow-hidden" data-group-key={group.key}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={expanded}
        aria-controls={`${group.key}-children`}
        title={`${expanded ? "Collapse" : "Expand"} ${group.repo} (${group.prs.length} PRs)`}
      >
        <Chevron size={14} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
        <GitPullRequest size={13} className="shrink-0 text-[var(--accent)]" aria-hidden />
        <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
          {repoShort}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-[var(--text-secondary)]">
          · {group.prs.length} PRs
        </span>
        {reviewWaiting > 0 ? (
          <span
            className="shrink-0 font-mono text-[10px] text-[var(--accent-on-tint)]"
            title={`${reviewWaiting} waiting on your review`}
          >
            · {reviewWaiting} needs review
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div
          id={`${group.key}-children`}
          className={cn(
            "mt-2 border-l-2 border-[var(--border)] pl-2",
            density === "compact" ? "space-y-0.5" : "space-y-2",
          )}
        >
          {group.prs.map((pr) => (
            <PRCard
              key={pr.url}
              pr={pr}
              density={density}
              selected={selectedChildKey === pr.url}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
