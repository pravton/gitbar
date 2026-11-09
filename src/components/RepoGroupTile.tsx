import { ChevronDown, ChevronRight, GitPullRequest } from "lucide-react";
import type { Density } from "@/hooks/useDensityMode";
import { cn } from "@/lib/utils";
import type { RepoGroup } from "@/lib/grouping";
import { PRCard } from "@/components/PRCard";
import { UnreadBadge } from "@/components/UnreadBadge";

interface RepoGroupTileProps {
  group: RepoGroup;
  expanded: boolean;
  onToggle: () => void;
  density: Density;
  /** Renders the keyboard-nav selection ring on the group header. */
  selected?: boolean;
  /** Which child URL is currently keyboard-selected, if any. */
  selectedChildKey: string | null;
  /** Child PR URLs whose comments panel is open; see `PRCard`. */
  openComments?: Set<string>;
  onToggleComments?: (url: string) => void;
  /** Child PR URLs whose CI checks are open; see `PRCard`. */
  openChecks?: Set<string>;
  onToggleChecks?: (url: string) => void;
  /** New-comment count per child PR URL; see `PRCard`. */
  unreadComments?: ReadonlyMap<string, number>;
  onMarkCommentsSeen?: (url: string, count: number) => void;
}

/**
 * One row of "auto-merged" PRs from the same repo. Renders a small
 * header strip (chevron, repo name, count, summary). When expanded,
 * the contained PRCards render beneath with a slight left-indent so
 * they read as members of the group rather than independent items.
 *
 * The header is keyboard-nav selectable (`group.key` is its nav key):
 * arrow keys land on it and Enter toggles expand/collapse. Clicking
 * anywhere on the header toggles it too. When expanded, arrow keys
 * walk on into the PR children (wiring in ListView via `selectableItems`).
 */
export function RepoGroupTile({
  group,
  expanded,
  onToggle,
  density,
  selected = false,
  selectedChildKey,
  openComments,
  onToggleComments,
  openChecks,
  onToggleChecks,
  unreadComments,
  onMarkCommentsSeen,
}: RepoGroupTileProps) {
  // A group can hold a single PR: it stays a group while filtered or after
  // its other PRs merge.
  const prCountLabel = `${group.prs.length} ${group.prs.length === 1 ? "PR" : "PRs"}`;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const repoShort = group.repo.split("/").at(-1) ?? group.repo;
  // "N needs review" = PRs in this group you were asked to review. Uses
  // the review_requested flag (from the review-requested:@me search) to
  // stay consistent with the header tile and the per-card Eye icon,
  // rather than review_decision which is null without a required-review rule.
  const reviewWaiting = group.prs.filter((pr) => pr.review_requested).length;
  // Summed on the header so a collapsed group doesn't hide new comments.
  const groupUnread = group.prs.reduce((sum, pr) => sum + (unreadComments?.get(pr.url) ?? 0), 0);

  return (
    <div
      className={cn("card overflow-hidden", selected && "card-selected")}
      data-group-key={group.key}
      data-card-url={group.key}
      aria-current={selected ? "true" : undefined}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={expanded}
        aria-controls={`${group.key}-children`}
        title={`${expanded ? "Collapse" : "Expand"} ${group.repo} (${prCountLabel})`}
      >
        <Chevron size={14} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
        <GitPullRequest size={13} className="shrink-0 text-[var(--accent)]" aria-hidden />
        <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
          {repoShort}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-[var(--text-secondary)]">
          · {prCountLabel}
        </span>
        {reviewWaiting > 0 ? (
          <span
            className="shrink-0 font-mono text-[10px] text-[var(--accent-on-tint)]"
            title={`${reviewWaiting} waiting on your review`}
          >
            · {reviewWaiting} needs review
          </span>
        ) : null}
        <UnreadBadge count={groupUnread} />
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
              commentsOpen={openComments?.has(pr.url)}
              onToggleComments={onToggleComments}
              checksOpen={openChecks?.has(pr.url)}
              onToggleChecks={onToggleChecks}
              unreadComments={unreadComments?.get(pr.url)}
              onMarkCommentsSeen={onMarkCommentsSeen}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
