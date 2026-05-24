import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_THRESHOLD,
  groupPRsByRepo,
  selectableItems,
  type DisplayItem,
} from "@/lib/grouping";
import type { PullRequest } from "@/types";

function pr(overrides: Partial<PullRequest> & { url: string; repo: string }): PullRequest {
  return {
    number: 1,
    title: "feat: x",
    url: overrides.url,
    state: "OPEN",
    created_at: "2026-05-24T00:00:00Z",
    repository: { name_with_owner: overrides.repo },
    author: { login: "u", avatar_url: null },
    is_draft: false,
    review_decision: null,
    ci_status: null,
    additions: 1,
    deletions: 0,
    comments: 0,
    deployment_url: null,
  };
}

describe("groupPRsByRepo", () => {
  it("returns an empty array for an empty input", () => {
    expect(groupPRsByRepo([])).toEqual([]);
  });

  it("leaves all PRs loose when no repo hits the threshold", () => {
    const items = groupPRsByRepo([
      pr({ url: "https://x/1", repo: "o/a" }),
      pr({ url: "https://x/2", repo: "o/b" }),
      pr({ url: "https://x/3", repo: "o/c" }),
    ]);
    expect(items.every((i) => i.kind === "pr")).toBe(true);
    expect(items).toHaveLength(3);
  });

  it("groups a repo with exactly threshold PRs", () => {
    const items = groupPRsByRepo(
      [
        pr({ url: "https://x/1", repo: "o/a" }),
        pr({ url: "https://x/2", repo: "o/a" }),
        pr({ url: "https://x/3", repo: "o/a" }),
      ],
      3,
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("group");
    if (items[0].kind === "group") {
      expect(items[0].repo).toBe("o/a");
      expect(items[0].prs).toHaveLength(3);
      expect(items[0].key).toBe("group:o/a");
    }
  });

  it("does NOT group when count is one below threshold", () => {
    const items = groupPRsByRepo(
      [
        pr({ url: "https://x/1", repo: "o/a" }),
        pr({ url: "https://x/2", repo: "o/a" }),
      ],
      3,
    );
    expect(items.every((i) => i.kind === "pr")).toBe(true);
    expect(items).toHaveLength(2);
  });

  it("mixes loose and grouped: only repos at threshold get grouped", () => {
    const items = groupPRsByRepo(
      [
        pr({ url: "https://x/1", repo: "o/a" }),
        pr({ url: "https://x/2", repo: "o/big" }),
        pr({ url: "https://x/3", repo: "o/big" }),
        pr({ url: "https://x/4", repo: "o/big" }),
        pr({ url: "https://x/5", repo: "o/c" }),
      ],
      3,
    );
    expect(items.map((i) => i.kind)).toEqual(["pr", "group", "pr"]);
    const groupItem = items.find((i) => i.kind === "group");
    expect(groupItem && groupItem.kind === "group" && groupItem.repo).toBe("o/big");
  });

  it("preserves the original PR order within a group", () => {
    const items = groupPRsByRepo(
      [
        pr({ url: "https://x/1", repo: "o/a" }),
        pr({ url: "https://x/2", repo: "o/a" }),
        pr({ url: "https://x/3", repo: "o/a" }),
      ],
      3,
    );
    if (items[0].kind === "group") {
      expect(items[0].prs.map((p) => p.url)).toEqual([
        "https://x/1",
        "https://x/2",
        "https://x/3",
      ]);
    }
  });

  it("preserves the original position of interleaved loose PRs (regression test)", () => {
    // Two repos, interleaved, both BELOW threshold so neither groups.
    // Without the two-pass fix, the single-bucket emit reordered to
    // [A1, A2, B1] because each repo's bucket flushed together. The
    // expected behavior is [A1, B1, A2] (the original interleave).
    const items = groupPRsByRepo(
      [
        pr({ url: "https://x/A1", repo: "o/a" }),
        pr({ url: "https://x/B1", repo: "o/b" }),
        pr({ url: "https://x/A2", repo: "o/a" }),
      ],
      3,
    );
    expect(items.map((i) => (i.kind === "pr" ? i.pr.url : i.key))).toEqual([
      "https://x/A1",
      "https://x/B1",
      "https://x/A2",
    ]);
  });

  it("mixes a grouped repo with interleaved loose PRs in the right positions", () => {
    // o/big crosses the threshold; o/a stays loose. Big should appear
    // at the position of its FIRST PR; loose PRs keep their slots.
    const items = groupPRsByRepo(
      [
        pr({ url: "https://x/A1", repo: "o/a" }),
        pr({ url: "https://x/BIG1", repo: "o/big" }),
        pr({ url: "https://x/A2", repo: "o/a" }),
        pr({ url: "https://x/BIG2", repo: "o/big" }),
        pr({ url: "https://x/BIG3", repo: "o/big" }),
      ],
      3,
    );
    expect(items).toHaveLength(3); // A1, group(big), A2
    expect(items[0].kind === "pr" && items[0].pr.url).toBe("https://x/A1");
    expect(items[1].kind === "group" && items[1].repo).toBe("o/big");
    expect(items[2].kind === "pr" && items[2].pr.url).toBe("https://x/A2");
    // The group folds in all 3 big PRs in input order.
    if (items[1].kind === "group") {
      expect(items[1].prs.map((p) => p.url)).toEqual([
        "https://x/BIG1",
        "https://x/BIG2",
        "https://x/BIG3",
      ]);
    }
  });

  it("preserves repo ordering by first-seen index when interleaved", () => {
    const items = groupPRsByRepo(
      [
        // o/b's first PR appears before o/a's, so o/b's group should
        // come first in the output even though o/a is alphabetically first.
        pr({ url: "https://x/1", repo: "o/b" }),
        pr({ url: "https://x/2", repo: "o/a" }),
        pr({ url: "https://x/3", repo: "o/b" }),
        pr({ url: "https://x/4", repo: "o/a" }),
        pr({ url: "https://x/5", repo: "o/b" }),
        pr({ url: "https://x/6", repo: "o/a" }),
      ],
      3,
    );
    expect(items).toHaveLength(2);
    if (items[0].kind === "group" && items[1].kind === "group") {
      expect(items[0].repo).toBe("o/b");
      expect(items[1].repo).toBe("o/a");
    }
  });

  it("uses the configured threshold, not just the default", () => {
    const tinyThreshold = groupPRsByRepo(
      [
        pr({ url: "https://x/1", repo: "o/a" }),
        pr({ url: "https://x/2", repo: "o/a" }),
      ],
      2,
    );
    expect(tinyThreshold).toHaveLength(1);
    expect(tinyThreshold[0].kind).toBe("group");
  });

  it("exposes a sane default threshold", () => {
    expect(DEFAULT_GROUP_THRESHOLD).toBe(3);
  });
});

describe("selectableItems", () => {
  function fixture(): DisplayItem[] {
    return [
      { kind: "pr", key: "https://x/1", pr: pr({ url: "https://x/1", repo: "o/a" }) },
      {
        kind: "group",
        key: "group:o/big",
        repo: "o/big",
        prs: [
          pr({ url: "https://x/2", repo: "o/big" }),
          pr({ url: "https://x/3", repo: "o/big" }),
          pr({ url: "https://x/4", repo: "o/big" }),
        ],
      },
      { kind: "pr", key: "https://x/5", pr: pr({ url: "https://x/5", repo: "o/c" }) },
    ];
  }

  it("skips collapsed group children", () => {
    const out = selectableItems(fixture(), new Set());
    expect(out.map((p) => p.url)).toEqual(["https://x/1", "https://x/5"]);
  });

  it("includes group children when the group is expanded", () => {
    const out = selectableItems(fixture(), new Set(["group:o/big"]));
    expect(out.map((p) => p.url)).toEqual([
      "https://x/1",
      "https://x/2",
      "https://x/3",
      "https://x/4",
      "https://x/5",
    ]);
  });

  it("never includes the group tile itself as a selectable item", () => {
    const out = selectableItems(fixture(), new Set(["group:o/big"]));
    expect(out.some((p) => p.url.startsWith("group:"))).toBe(false);
  });

  it("returns the real PR objects (not URL stubs) so consumers can read deployment_url etc.", () => {
    const out = selectableItems(fixture(), new Set(["group:o/big"]));
    // PR objects carry the full shape: title, repository, etc.
    for (const item of out) {
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("repository");
      expect(item).toHaveProperty("created_at");
    }
  });
});
