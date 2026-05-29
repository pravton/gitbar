import { memo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Eye, ExternalLink, GitPullRequestDraft, MessageSquare, XCircle } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { Density } from "@/hooks/useDensityMode";
import { cn, safeOpen, timeAgo, truncate } from "@/lib/utils";
import type { PullRequest } from "@/types";
import { PRChecksPanel } from "@/components/PRChecksPanel";

interface PRCardProps {
  pr: PullRequest;
  /** Renders the keyboard-nav selection ring. Defaults to false. */
  selected?: boolean;
  /** Layout density. `compact` switches to a single-line row. */
  density?: Density;
}

type Tone = "success" | "warning" | "danger" | "neutral";

function ciTone(status: string | null): Tone {
  if (status === "SUCCESS") return "success";
  if (status === "FAILURE" || status === "ERROR") return "danger";
  return "warning";
}

function ciLabel(status: string | null): string {
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

function PRCardImpl({ pr, selected = false, density = "comfortable" }: PRCardProps) {
  const overall = prTone(pr);
  const ci = ciTone(pr.ci_status);
  const repoName = pr.repository.name_with_owner.split("/").at(-1) ?? pr.repository.name_with_owner;
  // Per-card state: is the CI checks drill-down expanded? Local because
  // each card maintains its own independent expansion; collapsing the
  // card or having it leave the list resets it implicitly via unmount.
  const [checksOpen, setChecksOpen] = useState(false);
  // Eye = "you were asked to review this PR." Keyed off the same
  // review_requested signal (came from the review-requested:@me search)
  // as the header review tile, so the indicators stay consistent even in
  // repos that don't enforce a required review (where review_decision is
  // null).
  const reviewRequested = pr.review_requested;

  const openPr = (event: React.MouseEvent) => {
    event.preventDefault();
    safeOpen(pr.url, open);
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
          {pr.comments > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 font-mono tabular-nums"
              title={`${pr.comments} comment${pr.comments === 1 ? "" : "s"}`}
            >
              <MessageSquare size={11} aria-hidden />
              {pr.comments}
            </span>
          ) : null}
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
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setChecksOpen((open) => !open);
            }}
            aria-expanded={checksOpen}
            aria-controls={`${pr.url}-checks`}
            title={checksOpen ? "Hide CI checks" : "Show CI checks"}
            className={cn("ci-pill", `ci-pill-${ci}`, "shrink-0 cursor-pointer")}
          >
            {checksOpen ? (
              <ChevronDown size={10} aria-hidden className="text-[var(--text-secondary)]" />
            ) : (
              <ChevronRight size={10} aria-hidden className="text-[var(--text-secondary)]" />
            )}
            <span className={cn("status-dot", `status-${ci}`)} aria-hidden />
            {ciLabel(pr.ci_status)}
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
        </div>
        <span className="shrink-0 font-mono tabular-nums">
          <span className="text-[var(--success)]">+{pr.additions}</span>{" "}
          <span className="text-[var(--danger)]">-{pr.deletions}</span>
        </span>
      </div>

      {checksOpen ? (
        <div id={`${pr.url}-checks`}>
          <PRChecksPanel prUrl={pr.url} />
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
  onClickRow: (event: React.MouseEvent) => void;
}

function CompactPRRow({
  pr,
  overall,
  ci,
  repoName,
  selected,
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
      <span className="shrink-0 max-w-[110px] truncate text-[12px] font-medium text-[var(--text-primary)]">
        {repoName}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-[var(--text-secondary)]">
        #{pr.number}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-primary)]">
        {truncate(pr.title, 80)}
      </span>
      <CIIcon
        size={12}
        className="shrink-0"
        style={{ color: `var(--${ci})` }}
        aria-label={ciLabel(pr.ci_status)}
      />
      <span className="shrink-0 font-mono text-[10px] text-[var(--text-secondary)]">
        {timeAgo(pr.created_at)}
      </span>
    </button>
  );
}
