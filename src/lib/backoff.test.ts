import { describe, expect, it } from "vitest";
import { backoffFor } from "@/lib/backoff";
import type { GitHubError } from "@/types";

describe("backoffFor", () => {
  it("returns null for auth errors (user must act)", () => {
    const err: GitHubError = { kind: "auth", message: "bad token" };
    expect(backoffFor(err, 0)).toBeNull();
    expect(backoffFor(err, 5)).toBeNull();
  });

  it("returns null for partial errors", () => {
    const err: GitHubError = { kind: "partial", message: "some queries failed" };
    expect(backoffFor(err, 0)).toBeNull();
  });

  it("honors retry_after_secs for rate_limited", () => {
    const err: GitHubError = {
      kind: "rate_limited",
      message: "slow down",
      retry_after_secs: 42,
    };
    expect(backoffFor(err, 0)).toEqual({ delaySecs: 43 });
  });

  it("falls back to exponential for rate_limited without retry_after_secs", () => {
    const err: GitHubError = {
      kind: "rate_limited",
      message: "slow down",
      retry_after_secs: null,
    };
    expect(backoffFor(err, 0)).toEqual({ delaySecs: 2 });
    expect(backoffFor(err, 3)).toEqual({ delaySecs: 16 });
  });

  it("uses exponential backoff for network errors", () => {
    const err: GitHubError = { kind: "network", message: "offline" };
    expect(backoffFor(err, 0)).toEqual({ delaySecs: 2 });
    expect(backoffFor(err, 1)).toEqual({ delaySecs: 4 });
    expect(backoffFor(err, 2)).toEqual({ delaySecs: 8 });
    expect(backoffFor(err, 3)).toEqual({ delaySecs: 16 });
    expect(backoffFor(err, 4)).toEqual({ delaySecs: 32 });
  });

  it("caps exponential backoff at 60s", () => {
    const err: GitHubError = { kind: "network", message: "offline" };
    expect(backoffFor(err, 5)).toEqual({ delaySecs: 60 });
    expect(backoffFor(err, 10)).toEqual({ delaySecs: 60 });
    expect(backoffFor(err, 100)).toEqual({ delaySecs: 60 });
  });

  it("treats server errors with exponential backoff (same as network)", () => {
    const err: GitHubError = { kind: "server", message: "500" };
    expect(backoffFor(err, 0)).toEqual({ delaySecs: 2 });
    expect(backoffFor(err, 4)).toEqual({ delaySecs: 32 });
  });
});
