import { describe, expect, it } from "vitest";
import { composeHeadline } from "@/lib/headline";

describe("composeHeadline", () => {
  it('returns "Inbox zero" when there are no PRs and no issues', () => {
    expect(composeHeadline({ prCount: 0, reviewRequestedCount: 0, issueCount: 0 })).toEqual([
      { kind: "text", text: "Inbox zero" },
    ]);
  });

  it("still shows Inbox zero if reviewRequestedCount is mistakenly > 0 with no PRs (data inconsistency guard)", () => {
    // reviewRequestedCount can only be > 0 when prCount > 0 (review-
    // requested PRs are PRs). If a caller sends an inconsistent
    // value, we still degrade to the empty-state phrasing rather
    // than rendering "0 PRs · 3 needs review · 0 issues".
    expect(composeHeadline({ prCount: 0, reviewRequestedCount: 3, issueCount: 0 })).toEqual([
      { kind: "text", text: "Inbox zero" },
    ]);
  });

  it("renders a single PR segment with singular noun for prCount=1", () => {
    expect(composeHeadline({ prCount: 1, reviewRequestedCount: 0, issueCount: 0 })).toEqual([
      { kind: "count", n: 1, label: "PR", tone: "default" },
    ]);
  });

  it("renders PRs (plural) for prCount>1", () => {
    const segments = composeHeadline({ prCount: 5, reviewRequestedCount: 0, issueCount: 0 });
    expect(segments).toEqual([{ kind: "count", n: 5, label: "PRs", tone: "default" }]);
  });

  it("renders all three segments when everything is present", () => {
    expect(
      composeHeadline({ prCount: 5, reviewRequestedCount: 1, issueCount: 2 }),
    ).toEqual([
      { kind: "count", n: 5, label: "PRs", tone: "default" },
      { kind: "count", n: 1, label: "needs review", tone: "accent" },
      { kind: "count", n: 2, label: "issues", tone: "default" },
    ]);
  });

  it("singularizes 'issue' for issueCount=1", () => {
    const segments = composeHeadline({ prCount: 0, reviewRequestedCount: 0, issueCount: 1 });
    expect(segments).toEqual([{ kind: "count", n: 1, label: "issue", tone: "default" }]);
  });

  it("only the review-requested segment carries the accent tone", () => {
    const segments = composeHeadline({ prCount: 4, reviewRequestedCount: 2, issueCount: 3 });
    const accentSegments = segments.filter(
      (s) => s.kind === "count" && s.tone === "accent",
    );
    expect(accentSegments).toHaveLength(1);
    expect(accentSegments[0]).toEqual({
      kind: "count",
      n: 2,
      label: "needs review",
      tone: "accent",
    });
  });

  it("skips the PR segment when prCount=0 but shows issues", () => {
    expect(composeHeadline({ prCount: 0, reviewRequestedCount: 0, issueCount: 3 })).toEqual([
      { kind: "count", n: 3, label: "issues", tone: "default" },
    ]);
  });
});
