import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  canAddRepoToAllowlist,
  ciKey,
  deriveOrgs,
  deriveRepos,
  isValidRepoSlug,
  normalizeFilters,
  orgOf,
  repoAllowlistHas,
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
    review_requested: false,
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
      review_requested: true,
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

  it("filters by repo allowlist (owner/name)", () => {
    const r = applyFilters(fixtures, { ...EMPTY_FILTERS, repos: ["anthropic/sdk"] });
    expect(r).toHaveLength(1);
    expect(r[0].repository.name_with_owner).toBe("anthropic/sdk");
  });

  it("filters by multiple repos (union)", () => {
    const r = applyFilters(fixtures, {
      ...EMPTY_FILTERS,
      repos: ["acme/web", "anthropic/web"],
    });
    expect(r.map((p) => p.repository.name_with_owner).sort()).toEqual([
      "acme/web",
      "anthropic/web",
    ]);
  });

  it("matches repo allowlist entries case-insensitively", () => {
    const r = applyFilters(fixtures, { ...EMPTY_FILTERS, repos: ["Anthropic/SDK"] });
    expect(r).toHaveLength(1);
    expect(r[0].repository.name_with_owner).toBe("anthropic/sdk");
  });

  it("filters by CI status", () => {
    const r = applyFilters(fixtures, { ...EMPTY_FILTERS, ciStatus: ["failure"] });
    expect(r.map((p) => p.ci_status)).toEqual(["FAILURE"]);
  });

  it("filters by review-requested", () => {
    const r = applyFilters(fixtures, { ...EMPTY_FILTERS, reviewRequestedOnly: true });
    expect(r).toHaveLength(1);
    expect(r[0].review_requested).toBe(true);
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
        repos: ["a/b"],
        ciStatus: ["success"],
        reviewRequestedOnly: true,
      }),
    ).toBe(5);
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

describe("deriveRepos", () => {
  it("returns unique owner/name pairs sorted", () => {
    const fixtures = [
      pr({ repository: { name_with_owner: "z/a" } }),
      pr({ repository: { name_with_owner: "a/b" } }),
      pr({ repository: { name_with_owner: "a/b" } }), // dup
      pr({ repository: { name_with_owner: "a/c" } }),
    ];
    expect(deriveRepos(fixtures)).toEqual(["a/b", "a/c", "z/a"]);
  });
});

describe("isValidRepoSlug", () => {
  it.each([
    ["owner/name", true],
    ["a/b", true],
    ["org-name/repo.name_v2", true],
    ["a/.dotfile", true], // leading dot allowed, e.g. `owner/.github`, dotfiles repos
    ["a/.github", true],
    ["-owner/name", false], // owner can't lead with a hyphen
    ["owner-/name", false], // owner can't trail with a hyphen
    ["a--b/name", false], // owner can't have consecutive hyphens
    ["/name", false],
    ["owner/", false],
    ["owner", false],
    ["owner/name/extra", false],
    ["", false],
    ["with space/name", false],
  ])("%s -> %s", (input, expected) => {
    expect(isValidRepoSlug(input)).toBe(expected);
  });
});

describe("repoAllowlistHas", () => {
  it("matches case-insensitively", () => {
    expect(repoAllowlistHas(["Acme/Web"], "acme/web")).toBe(true);
    expect(repoAllowlistHas(["acme/web"], "Acme/Web")).toBe(true);
    expect(repoAllowlistHas(["acme/web"], "acme/api")).toBe(false);
  });
});

describe("canAddRepoToAllowlist", () => {
  it("rejects invalid slugs and case-insensitive duplicates", () => {
    expect(canAddRepoToAllowlist([], "acme/web")).toBe(true);
    expect(canAddRepoToAllowlist(["acme/web"], "Acme/Web")).toBe(false);
    expect(canAddRepoToAllowlist([], "not valid")).toBe(false);
    expect(canAddRepoToAllowlist([], "  acme/web  ")).toBe(true);
  });
});

describe("normalizeFilters", () => {
  it("backfills missing keys to defaults", () => {
    // Simulates a v0.1/v0.2 persisted blob that didn't yet have `repos`.
    const old = { draft: "all", orgs: ["acme"], ciStatus: [], reviewRequestedOnly: false };
    expect(normalizeFilters(old).repos).toEqual([]);
  });

  it("drops invalid repo slugs from the persisted list", () => {
    const out = normalizeFilters({
      ...EMPTY_FILTERS,
      repos: ["valid/repo", "bad slug", "", 123 as unknown as string],
    });
    expect(out.repos).toEqual(["valid/repo"]);
  });

  it("returns EMPTY_FILTERS for non-object input", () => {
    expect(normalizeFilters(null)).toEqual(EMPTY_FILTERS);
    expect(normalizeFilters("garbage")).toEqual(EMPTY_FILTERS);
  });

  it("drops unknown ciStatus values", () => {
    const out = normalizeFilters({
      ...EMPTY_FILTERS,
      ciStatus: ["success", "made-up"],
    });
    expect(out.ciStatus).toEqual(["success"]);
  });
});
