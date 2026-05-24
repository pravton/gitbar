/**
 * Inputs the header summarizes into a single glanceable sentence.
 * Keeping this typed and isolated so the (mostly straightforward)
 * pluralization + tone logic stays pure and unit-testable.
 */
export interface HeadlineCounts {
  /** Open pull requests (drafts included; the mood emoji is the
      place where draft-vs-published distinction surfaces). */
  prCount: number;
  /** PRs whose `review_decision === "REVIEW_REQUIRED"`. Surfaced
      separately because it's the single most actionable signal. */
  reviewRequestedCount: number;
  /** Open issues assigned to the viewer. */
  issueCount: number;
}

/**
 * One readable chunk of the headline. The renderer joins segments
 * with a middle-dot separator. `count` segments render the number
 * larger / weightier than the label; `text` segments render as
 * plain muted prose (the empty-state phrasing).
 */
export type HeadlineSegment =
  | { kind: "count"; n: number; label: string; tone: "default" | "accent" }
  | { kind: "text"; text: string };

/**
 * Build the glanceable header headline from the current counts.
 *
 * Examples:
 *   prCount=5, reviewRequested=1, issues=2
 *     -> [5 PRs] · [1 needs review (accent)] · [2 issues]
 *   prCount=1, reviewRequested=0, issues=0
 *     -> [1 PR]
 *   prCount=0, reviewRequested=0, issues=0
 *     -> "Inbox zero"
 *
 * Singular / plural follows English convention ("1 PR" vs "5 PRs").
 * The accent tone is reserved for `needs review` — anything else
 * would dilute the cue and make the accent meaningless.
 */
export function composeHeadline(counts: HeadlineCounts): HeadlineSegment[] {
  const { prCount, reviewRequestedCount, issueCount } = counts;

  if (prCount === 0 && issueCount === 0) {
    return [{ kind: "text", text: "Inbox zero" }];
  }

  const segments: HeadlineSegment[] = [];
  if (prCount > 0) {
    segments.push({
      kind: "count",
      n: prCount,
      label: prCount === 1 ? "PR" : "PRs",
      tone: "default",
    });
  }
  if (reviewRequestedCount > 0) {
    segments.push({
      kind: "count",
      n: reviewRequestedCount,
      label: "needs review",
      tone: "accent",
    });
  }
  if (issueCount > 0) {
    segments.push({
      kind: "count",
      n: issueCount,
      label: issueCount === 1 ? "issue" : "issues",
      tone: "default",
    });
  }
  return segments;
}
