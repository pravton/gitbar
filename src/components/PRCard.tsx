import { memo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Eye, ExternalLink, GitPullRequestDraft, XCircle } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { Density } from "@/hooks/useDensityMode";
import { cn, safeOpen, timeAgo, truncate } from "@/lib/utils";
import type { CiCounts, PullRequest } from "@/types";
import { PRChecksPanel } from "@/components/PRChecksPanel";
import { CommentsPanel } from "@/components/CommentsPanel";
import { CommentsToggle } from "@/components/CommentsToggle";
import { UnreadBadge } from "@/components/UnreadBadge";

interface PRCardProps {
  pr: PullRequest;
  /** Renders the keyboard-nav selection ring. Defaults to false. */
  selected?: boolean;
  /** Layout density. `compact` switches to a single-line row. */
  density?: Density;
  /**
   * Comments panel state, owned by `ListView` so the `C` shortcut can
   * toggle it. When omitted the card keeps its own state.
   */
  commentsOpen?: boolean;
  onToggleComments?: (url: string) => void;
  /** CI checks panel state, owned by `ListView` so it survives a remount. When
      omitted the card keeps its own state. */
  checksOpen?: boolean;
  onToggleChecks?: (url: string) => void;
  /** Comments added since the user last saw this PR. */
  unreadComments?: number;
  /** Called when the comments are read: panel loaded, or opened on GitHub. */
  onMarkCommentsSeen?: (url: string, count: number) => void;
}

type Tone = "success" | "warning" | "danger" | "neutral";

function ciTone(status: string | null): Tone {
  if (status === "SUCCESS") return "success";
  if (status === "FAILURE" || status === "ERROR") return "danger";
  return "warning";
}

/**
 * Failing jobs win over running ones: "CI 2/9 failing" is the actionable
 * signal even while the rest of the run is still going. Without counts
 * (no checks, or an older cached snapshot) it falls back to the
 * aggregate label.
 */
export function ciLabel(status: string | null, counts: CiCounts | null = null): string {
  if (counts && counts.failing > 0) return `CI ${counts.failing}/${counts.total} failing`;
  if (counts && counts.pending > 0) return `CI ${counts.pending}/${counts.total} running`;
  if (status === "SUCCESS") return "CI passing";
  if (status === "FAILURE" || status === "ERROR") return "CI failing";
  if (status === "PENDING" || status === "EXPECTED") return "CI pending";
  return "CI unknown";
}

/**
 * Overall PR tone for the status dot at the top of the card.
 *
 * Draft state SUPERSEDES the CI/review state for this summary signal: a
 * draft isn't asking for review yet, so the dot reads "deprioritized"
 * (neutral) regardless of what CI is doing. The CI pill below still
 * surfaces the real CI state, and the new `GitPullRequestDraft` glyph
 * next to the repo name makes "this is a draft" explicit.
 *
 * Previously `is_draft` collapsed into the same amber ("warning") tone
 * as CI-pending, so a draft and a CI-pending published PR were
 * visually indistinguishable at a glance.
 */
export function prTone(pr: PullRequest): Tone {
  if (pr.is_draft) return "neutral";
  if (pr.ci_status === "FAILURE" || pr.ci_status === "ERROR" || pr.review_decision === "CHANGES_REQUESTED") {
    return "danger";
  }
  if (pr.ci_status === "PENDING") return "warning";
  if (pr.ci_status === "SUCCESS") return "success";
  return "warning";
}

/**
 * Card identity is stable across polls when the upstream PR object hasn't
 * changed shape (which is the common case: most PRs in the list don't
 * shift between refreshes). `selected` is the only thing that flips for
 * the two cards involved in an arrow-key move. Without memo, every poll
 * tick re-renders all 30 cards; with memo, only the two whose `selected`
 * actually changes re-render.
 */
export const PRCard = memo(PRCardImpl);

function PRCardImpl({
  pr,
  selected = false,
  density = "comfortable",
  commentsOpen,
  onToggleComments,
  checksOpen,
  onToggleChecks,
  unreadComments = 0,
  onMarkCommentsSeen,
}: PRCardProps) {
  const overall = prTone(pr);
  const ci = ciTone(pr.ci_status);
  const repoName = pr.repository.name_with_owner.split("/").at(-1) ?? pr.repository.name_with_owner;
  // Same shape as comments below: ListView owns this so a card keeps its open
  // checks when a repo starts grouping and the card remounts under the tile.
  const [localChecksOpen, setLocalChecksOpen] = useState(false);
  const showChecks = checksOpen ?? localChecksOpen;
  const [localCommentsOpen, setLocalCommentsOpen] = useState(false);
  const showComments = commentsOpen ?? localCommentsOpen;
  const toggleComments = () =>
    onToggleComments ? onToggleComments(pr.url) : setLocalCommentsOpen((v) => !v);
  // Approvals and change requests can exist with zero comments, so the
  // toggle also shows for those. Not REVIEW_REQUIRED: that means no
  // review has been submitted yet, so the panel would be empty.
  const hasConversation =
    pr.comments > 0 ||
    pr.review_decision === "APPROVED" ||
    pr.review_decision === "CHANGES_REQUESTED";
  // Eye = "you were asked to review this PR." Keyed off the same
  // review_requested signal (came from the review-requested:@me search)
  // as the header review tile, so the indicators stay consistent even in
  // repos that don't enforce a required review (where review_decision is
  // null).
  const reviewRequested = pr.review_requested;

  const markCommentsSeen = () => onMarkCommentsSeen?.(pr.url, pr.comments);

  const openPr = (event: React.MouseEvent) => {
    event.preventDefault();
    safeOpen(pr.url, open);
    markCommentsSeen();
  };
  const openDeployment = (event: React.MouseEvent) => {
    event.preventDefault();
    safeOpen(pr.deployment_url, open);
  };

  if (density === "compact") {
    return <CompactPRRow
      pr={pr}
      overall={overall}
      ci={ci}
      repoName={repoName}
      selected={selected}
      unreadComments={unreadComments}
      onClickRow={openPr}
    />;
  }

  return (
    <article
      className={cn("card group w-full", selected && "card-selected")}
      data-card-url={pr.url}
      aria-current={selected ? "true" : undefined}
      title={pr.title}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("status-dot", `status-${overall}`)} />
          {pr.is_draft ? (
            <GitPullRequestDraft
              size={12}
              className="shrink-0 text-[var(--text-secondary)]"
              aria-label="Draft"
            />
          ) : null}
          <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{repoName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--text-secondary)]">
          {reviewRequested ? <Eye size={12} className="text-[var(--accent)]" /> : null}
          <span>{timeAgo(pr.created_at)}</span>
        </div>
      </div>

      <a
        href={pr.url}
        onClick={openPr}
        className="mt-2 block truncate text-[13px] font-medium text-[var(--text-primary)] outline-none hover:text-[var(--accent)] focus-visible:underline focus-visible:underline-offset-2"
      >
        {truncate(pr.title, 100)}
      </a>
      <p className="mt-1 truncate font-mono text-[11px] text-[var(--text-secondary)]">
        #{pr.number} opened by @{pr.author.login}
      </p>

      <div className="mt-3 flex min-w-0 items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5 text-[11px] text-[var(--text-secondary)]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (onToggleChecks) onToggleChecks(pr.url);
              else setLocalChecksOpen((v) => !v);
            }}
            aria-expanded={showChecks}
            aria-controls={`${pr.url}-checks`}
            title={showChecks ? "Hide CI checks" : "Show CI checks"}
            className={cn("ci-pill", `ci-pill-${ci}`, "shrink-0 cursor-pointer")}
          >
            {showChecks ? (
              <ChevronDown size={10} aria-hidden className="text-[var(--text-secondary)]" />
            ) : (
              <ChevronRight size={10} aria-hidden className="text-[var(--text-secondary)]" />
            )}
            <span className={cn("status-dot", `status-${ci}`)} aria-hidden />
            {ciLabel(pr.ci_status, pr.ci_counts)}
          </button>
          {pr.deployment_url ? (
            <a
              href={pr.deployment_url}
              onClick={openDeployment}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-on-tint)] hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/10"
              title={`Open deployment: ${pr.deployment_url}`}
            >
              <ExternalLink size={10} aria-hidden />
              Deploy
            </a>
          ) : null}
          {hasConversation || showComments ? (
            <CommentsToggle
              itemUrl={pr.url}
              count={pr.comments}
              unread={unreadComments}
              open={showComments}
              onToggle={toggleComments}
              emptyLabel="Reviews"
            />
          ) : null}
        </div>
        <span className="shrink-0 font-mono tabular-nums">
          <span className="text-[var(--success)]">+{pr.additions}</span>{" "}
          <span className="text-[var(--danger)]">-{pr.deletions}</span>
        </span>
      </div>

      {showChecks ? (
        <div id={`${pr.url}-checks`}>
          <PRChecksPanel prUrl={pr.url} />
        </div>
      ) : null}

      {showComments ? (
        <div id={`${pr.url}-comments`}>
          <CommentsPanel
            itemUrl={pr.url}
            revision={pr.comments}
            unreadCount={unreadComments}
            onSeen={markCommentsSeen}
            onClose={toggleComments}
          />
        </div>
      ) : null}
    </article>
  );
}

/**
 * Single-line PR row. Used when the global density mode is "compact".
 * Sacrifices the deploy link, additions/deletions, "opened by" line,
 * and the full CI pill label in favor of fitting roughly 3x more PRs
 * per screen. The full PR is still one click away (the whole row).
 *
 * Same data attribute (`data-card-url`) and `aria-current` so the
 * keyboard-nav scroll-into-view and selection-ring logic works
 * uniformly across densities.
 */
interface CompactPRRowProps {
  pr: PullRequest;
  overall: Tone;
  ci: Tone;
  repoName: string;
  selected: boolean;
  unreadComments: number;
  onClickRow: (event: React.MouseEvent) => void;
}

function CompactPRRow({
  pr,
  overall,
  ci,
  repoName,
  selected,
  unreadComments,
  onClickRow,
}: CompactPRRowProps) {
  const CIIcon = ci === "success" ? CheckCircle2 : ci === "danger" ? XCircle : Circle;
  return (
    <button
      type="button"
      onClick={onClickRow}
      className={cn(
        "card group flex w-full items-center gap-2 px-2 py-1.5 text-left",
        selected && "card-selected",
      )}
      data-card-url={pr.url}
      aria-current={selected ? "true" : undefined}
      title={`${pr.title}\n#${pr.number} opened by @${pr.author.login}`}
    >
      <span className={cn("status-dot shrink-0", `status-${overall}`)} aria-hidden />
      {pr.is_draft ? (
        <GitPullRequestDraft
          size={12}
          className="shrink-0 text-[var(--text-secondary)]"
          aria-label="Draft"
        />
      ) : null}
      <span className="max-w-[110px] shrink-0 truncate text-[12px] font-medium text-[var(--text-primary)]">
        {repoName}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-[var(--text-secondary)]">
        #{pr.number}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-primary)]">
        {truncate(pr.title, 80)}
      </span>
      <UnreadBadge count={unreadComments} />
      <CIIcon
        size={12}
        className="shrink-0"
        style={{ color: `var(--${ci})` }}
        aria-label={ciLabel(pr.ci_status, pr.ci_counts)}
      />
      <span className="shrink-0 font-mono text-[10px] text-[var(--text-secondary)]">
        {timeAgo(pr.created_at)}
      </span>
    </button>
  );
}
