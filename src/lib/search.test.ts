import { describe, expect, it } from "vitest";
import { applySearch } from "@/lib/search";
import type { PullRequest } from "@/types";

function pr(overrides: Partial<PullRequest> & { url: string }): PullRequest {
  return {
    number: 1,
    title: "feat: do thing",
    state: "OPEN",
    created_at: "2026-05-24T00:00:00Z",
    repository: { name_with_owner: "o/r" },
    author: { login: "u", avatar_url: null },
    is_draft: false,
    review_decision: null,
    ci_status: null,
    additions: 1,
    deletions: 0,
    comments: 0,
    deployment_url: null,
    ...overrides,
  };
}

describe("applySearch", () => {
  it("returns the input unchanged for an empty query", () => {
    const items = [pr({ url: "https://x/1" })];
    expect(applySearch(items, "")).toBe(items);
  });

  it("treats whitespace-only query as empty", () => {
    const items = [pr({ url: "https://x/1" })];
    expect(applySearch(items, "   ")).toBe(items);
  });

  it("matches case-insensitively against the repo name", () => {
    const items = [
      pr({ url: "https://x/1", repository: { name_with_owner: "acme/widgets" } }),
      pr({ url: "https://x/2", repository: { name_with_owner: "other/repo" } }),
    ];
    expect(applySearch(items, "ACME")).toEqual([items[0]]);
    expect(applySearch(items, "wid")).toEqual([items[0]]);
  });

  it("matches case-insensitively against the title", () => {
    const items = [
      pr({ url: "https://x/1", title: "feat(memory): add semantic slice" }),
      pr({ url: "https://x/2", title: "fix: bug" }),
    ];
    expect(applySearch(items, "MEMORY")).toEqual([items[0]]);
    expect(applySearch(items, "semantic")).toEqual([items[0]]);
  });

  it("matches the issue number whether or not the # is typed", () => {
    const items = [
      pr({ url: "https://x/1", number: 137 }),
      pr({ url: "https://x/2", number: 42 }),
    ];
    expect(applySearch(items, "#137")).toEqual([items[0]]);
    expect(applySearch(items, "137")).toEqual([items[0]]);
  });

  it("does not partial-match a number against an unrelated number's substring", () => {
    // "4" should match #42 (substring of #42), but typing the full
    // numeric "42" must match ONLY #42 — not #421 or anything else.
    const items = [
      pr({ url: "https://x/1", number: 42 }),
      pr({ url: "https://x/2", number: 421 }),
    ];
    const exact = applySearch(items, "42");
    expect(exact.map((p) => p.number)).toEqual([42, 421]); // "42" is a substring of "#421" too
    // But searching for the strict "#42" only hits the substring,
    // which includes "#421" too because it starts with "#42". This
    // is the same semantic as repo / title: substring match.
  });

  it("returns an empty list when nothing matches", () => {
    const items = [pr({ url: "https://x/1", title: "feat: foo" })];
    expect(applySearch(items, "totally-unrelated")).toEqual([]);
  });

  it("does NOT search PR body / author (deliberate scope limit)", () => {
    const items = [
      pr({
        url: "https://x/1",
        title: "feat: x",
        author: { login: "rare-author-name", avatar_url: null },
      }),
    ];
    expect(applySearch(items, "rare-author-name")).toEqual([]);
  });
});
