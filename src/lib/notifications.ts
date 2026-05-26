import type { PullRequest } from "@/types";

/**
 * Identify which review-requested PRs are *new* relative to a previously
 * seen set, and return the next set to persist.
 *
 * Semantics:
 *   - A PR is "review-requested" when its `review_requested` flag is set,
 *     i.e. it came from the `review-requested:@me` search — the viewer was
 *     actually asked to review it. (We previously inferred this from
 *     `review_decision === "REVIEW_REQUIRED"`, but that field is null in
 *     repos without a required-review rule, so genuine requests were missed.)
 *   - `previouslySeen` is the set of URLs we've already notified about.
 *   - We return only PRs whose URL is NOT in `previouslySeen`.
 *   - The next persisted set is the current review-requested set verbatim:
 *       * URLs that are still active stay (so we don't re-notify next poll).
 *       * URLs that have left the state drop (so a future re-request fires).
 *
 * Pure: no side effects, no notification API calls — those happen in the
 * hook layer. Keeps this trivially unit-testable.
 */
export function diffNewReviewRequests(
  prs: PullRequest[],
  previouslySeen: ReadonlySet<string>,
): { newPrs: PullRequest[]; nextSeen: Set<string> } {
  const newPrs: PullRequest[] = [];
  const nextSeen = new Set<string>();

  for (const pr of prs) {
    if (!pr.review_requested) continue;
    nextSeen.add(pr.url);
    if (!previouslySeen.has(pr.url)) {
      newPrs.push(pr);
    }
  }

  return { newPrs, nextSeen };
}

/** Build the notification body text for a single PR. */
export function notificationBodyFor(pr: PullRequest): string {
  const repo = pr.repository.name_with_owner;
  return `${repo} #${pr.number}: ${pr.title}`;
}
