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
    // Typing "42" must match ONLY #42, never #421 or #4221. This
    // was a real bug: a previous substring-only implementation
    // matched every number whose digits contained the needle.
    const items = [
      pr({ url: "https://x/1", number: 42 }),
      pr({ url: "https://x/2", number: 421 }),
      pr({ url: "https://x/3", number: 4221 }),
    ];
    expect(applySearch(items, "42").map((p) => p.number)).toEqual([42]);
    expect(applySearch(items, "#42").map((p) => p.number)).toEqual([42]);
  });

  it("treats a bare '#' as a no-op (user still composing)", () => {
    const items = [
      pr({ url: "https://x/1", number: 1 }),
      pr({ url: "https://x/2", number: 2 }),
    ];
    expect(applySearch(items, "#")).toBe(items);
  });

  it("does not treat a non-numeric query as a number match", () => {
    // A query like "feat42" looks partly numeric but is not, so it
    // should fall through to substring matching on title / repo
    // (and miss when neither contains the literal "feat42").
    const items = [pr({ url: "https://x/1", number: 42, title: "do thing" })];
    expect(applySearch(items, "feat42")).toEqual([]);
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
