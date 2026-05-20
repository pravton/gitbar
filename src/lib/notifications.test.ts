import { describe, expect, it } from "vitest";
import { diffNewReviewRequests, notificationBodyFor } from "@/lib/notifications";
import type { PullRequest } from "@/types";

function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: "feat: x",
    url: "https://github.com/o/r/pull/1",
    state: "OPEN",
    created_at: "2025-01-01T00:00:00Z",
    repository: { name_with_owner: "o/r" },
    author: { login: "u", avatar_url: null },
    is_draft: false,
    review_decision: "REVIEW_REQUIRED",
    ci_status: null,
    additions: 0,
    deletions: 0,
    comments: 0,
    deployment_url: null,
    ...overrides,
  };
}

describe("diffNewReviewRequests", () => {
  it("returns PRs that are review-requested AND not previously seen", () => {
    const prs = [
      pr({ url: "https://x/1" }),
      pr({ url: "https://x/2" }),
      pr({ url: "https://x/3", review_decision: "APPROVED" }), // not review-requested
    ];
    const { newPrs } = diffNewReviewRequests(prs, new Set(["https://x/1"]));
    expect(newPrs.map((p) => p.url)).toEqual(["https://x/2"]);
  });

  it("returns nothing when the same PR is already seen", () => {
    const prs = [pr({ url: "https://x/1" })];
    const { newPrs } = diffNewReviewRequests(prs, new Set(["https://x/1"]));
    expect(newPrs).toEqual([]);
  });

  it("nextSeen contains only currently review-requested URLs", () => {
    const prs = [
      pr({ url: "https://x/1" }),
      pr({ url: "https://x/2", review_decision: "APPROVED" }),
      pr({ url: "https://x/3", review_decision: null }),
    ];
    // x/2 and x/3 were previously seen but are no longer review-requested.
    // They should drop from nextSeen so a future re-request fires.
    const previouslySeen = new Set(["https://x/2", "https://x/3"]);
    const { nextSeen } = diffNewReviewRequests(prs, previouslySeen);
    expect([...nextSeen]).toEqual(["https://x/1"]);
  });

  it("drops PRs that left the review-requested state", () => {
    // Was previously notified for x/1, but now x/1 has been approved.
    // We should not return x/1 as new, and nextSeen should NOT include it.
    const prs = [pr({ url: "https://x/1", review_decision: "APPROVED" })];
    const previouslySeen = new Set(["https://x/1"]);
    const { newPrs, nextSeen } = diffNewReviewRequests(prs, previouslySeen);
    expect(newPrs).toEqual([]);
    expect([...nextSeen]).toEqual([]);
  });

  it("returns multiple new review requests in one diff", () => {
    const prs = [
      pr({ url: "https://x/1", title: "first" }),
      pr({ url: "https://x/2", title: "second" }),
    ];
    const { newPrs } = diffNewReviewRequests(prs, new Set());
    expect(newPrs.map((p) => p.title)).toEqual(["first", "second"]);
  });

  it("ignores PRs that aren't review-requested even when not previously seen", () => {
    const prs = [
      pr({ url: "https://x/1", review_decision: "APPROVED" }),
      pr({ url: "https://x/2", review_decision: "CHANGES_REQUESTED" }),
      pr({ url: "https://x/3", review_decision: null }),
    ];
    const { newPrs, nextSeen } = diffNewReviewRequests(prs, new Set());
    expect(newPrs).toEqual([]);
    expect([...nextSeen]).toEqual([]);
  });
});

describe("notificationBodyFor", () => {
  it("formats as 'repo #number: title'", () => {
    const body = notificationBodyFor(
      pr({
        repository: { name_with_owner: "anthropic/sdk" },
        number: 42,
        title: "fix: nullable field",
      }),
    );
    expect(body).toBe("anthropic/sdk #42: fix: nullable field");
  });
});
