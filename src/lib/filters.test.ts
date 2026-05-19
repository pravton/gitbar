import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  ciKey,
  deriveOrgs,
  orgOf,
} from "@/lib/filters";
import type { PullRequest } from "@/types";

function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: "t",
    url: `https://x/${Math.random()}`,
    state: "OPEN",
    created_at: "2025-01-01T00:00:00Z",
    repository: { name_with_owner: "acme/svc" },
    author: { login: "alice", avatar_url: null },
    is_draft: false,
    review_decision: null,
    ci_status: "SUCCESS",
    additions: 0,
    deletions: 0,
    comments: 0,
    deployment_url: null,
    ...overrides,
  };
}

describe("ciKey", () => {
  it.each([
    ["SUCCESS", "success"],
    ["FAILURE", "failure"],
    ["ERROR", "failure"],
    ["PENDING", "pending"],
    ["EXPECTED", "pending"],
    [null, "unknown"],
    ["weird", "unknown"],
  ] as const)("%s -> %s", (input, expected) => {
    expect(ciKey(input)).toBe(expected);
  });
});

describe("orgOf", () => {
  it("returns the owner portion of name_with_owner", () => {
    expect(orgOf(pr({ repository: { name_with_owner: "anthropic/sdk" } }))).toBe("anthropic");
  });
});

describe("applyFilters", () => {
  const fixtures = [
    pr({ is_draft: true, ci_status: "SUCCESS", repository: { name_with_owner: "acme/web" } }),
    pr({ is_draft: false, ci_status: "FAILURE", repository: { name_with_owner: "acme/api" } }),
    pr({
      is_draft: false,
      ci_status: "SUCCESS",
      repository: { name_with_owner: "anthropic/sdk" },
      review_decision: "REVIEW_REQUIRED",
    }),
    pr({ is_draft: false, ci_status: "PENDING", repository: { name_with_owner: "anthropic/web" } }),
  ];

  it("returns everything with the empty filter", () => {
    expect(applyFilters(fixtures, EMPTY_FILTERS)).toHaveLength(4);
  });

  it("filters drafts only", () => {
    const r = applyFilters(fixtures, { ...EMPTY_FILTERS, draft: "drafts" });
    expect(r.map((p) => p.is_draft)).toEqual([true]);
  });

  it("filters published only", () => {
    const r = applyFilters(fixtures, { ...EMPTY_FILTERS, draft: "published" });
    expect(r.every((p) => !p.is_draft)).toBe(true);
    expect(r).toHaveLength(3);
  });

  it("filters by org", () => {
    const r = applyFilters(fixtures, { ...EMPTY_FILTERS, orgs: ["anthropic"] });
    expect(r.map(orgOf)).toEqual(["anthropic", "anthropic"]);
  });

  it("filters by multiple orgs (union)", () => {
    const r = applyFilters(fixtures, { ...EMPTY_FILTERS, orgs: ["acme", "anthropic"] });
    expect(r).toHaveLength(4);
  });

  it("filters by CI status", () => {
    const r = applyFilters(fixtures, { ...EMPTY_FILTERS, ciStatus: ["failure"] });
    expect(r.map((p) => p.ci_status)).toEqual(["FAILURE"]);
  });

  it("filters by review-requested", () => {
    const r = applyFilters(fixtures, { ...EMPTY_FILTERS, reviewRequestedOnly: true });
    expect(r).toHaveLength(1);
    expect(r[0].review_decision).toBe("REVIEW_REQUIRED");
  });

  it("composes filters (AND)", () => {
    const r = applyFilters(fixtures, {
      ...EMPTY_FILTERS,
      draft: "published",
      orgs: ["anthropic"],
      ciStatus: ["success"],
    });
    expect(r).toHaveLength(1);
    expect(r[0].repository.name_with_owner).toBe("anthropic/sdk");
  });
});

describe("activeFilterCount", () => {
  it("counts each non-default filter as one", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, draft: "drafts" })).toBe(1);
    expect(
      activeFilterCount({
        draft: "drafts",
        orgs: ["a"],
        ciStatus: ["success"],
        reviewRequestedOnly: true,
      }),
    ).toBe(4);
  });
});

describe("deriveOrgs", () => {
  it("returns unique owners sorted", () => {
    const fixtures = [
      pr({ repository: { name_with_owner: "z/a" } }),
      pr({ repository: { name_with_owner: "a/b" } }),
      pr({ repository: { name_with_owner: "a/c" } }),
      pr({ repository: { name_with_owner: "m/d" } }),
    ];
    expect(deriveOrgs(fixtures)).toEqual(["a", "m", "z"]);
  });
});
