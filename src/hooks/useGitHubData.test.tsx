import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useGitHubData } from "@/hooks/useGitHubData";
import type { GitHubData, GitHubError, PullRequest } from "@/types";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

function ok(prs: GitHubData["prs"] = [], issues: GitHubData["issues"] = []): GitHubData {
  return { prs, issues, partial_message: null };
}

function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: "feat: x",
    url: "https://x/1",
    state: "OPEN",
    created_at: "2025-01-01T00:00:00Z",
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

beforeEach(() => {
  invokeMock.mockReset();
});

describe("useGitHubData", () => {
  it("does not fetch when disabled", async () => {
    const { result } = renderHook(() => useGitHubData(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("fetches once on mount and populates prs + issues", async () => {
    invokeMock.mockResolvedValueOnce(ok([pr()], []));

    const { result } = renderHook(() => useGitHubData(true));

    await waitFor(() => expect(result.current.prs.length).toBe(1));
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_data");
    expect(result.current.error).toBeNull();
    expect(result.current.updatedAt).not.toBeNull();
  });

  it("surfaces typed errors", async () => {
    const err: GitHubError = { kind: "auth", message: "bad token" };
    invokeMock.mockRejectedValueOnce(err);

    const { result } = renderHook(() => useGitHubData(true));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toEqual(err);
  });

  it("drops stale responses when `enabled` toggles mid-flight", async () => {
    // First call resolves slowly; before it resolves, enabled flips off and
    // back on, kicking a new fetch with fresh data. The old request must
    // not be allowed to overwrite the new data.
    let resolveOld!: (value: GitHubData) => void;
    const oldPromise = new Promise<GitHubData>((resolve) => {
      resolveOld = resolve;
    });
    invokeMock
      .mockReturnValueOnce(oldPromise)
      .mockResolvedValueOnce(ok([pr({ number: 99, url: "https://x/99", title: "fresh" })]));

    const { result, rerender } = renderHook(({ enabled }) => useGitHubData(enabled), {
      initialProps: { enabled: true },
    });

    rerender({ enabled: false });
    rerender({ enabled: true });

    await waitFor(() => expect(result.current.prs.length).toBe(1));
    expect(result.current.prs[0].number).toBe(99);

    // Old request finally resolves; must NOT overwrite.
    act(() => {
      resolveOld(ok([pr({ number: 1, url: "https://x/1", title: "stale" })]));
    });

    await waitFor(() => expect(result.current.prs[0].number).toBe(99));
  });

  it("forceRefresh routes through refresh_cache", async () => {
    invokeMock.mockResolvedValue(ok());
    const { result } = renderHook(() => useGitHubData(true));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.forceRefresh();
    });

    expect(invokeMock).toHaveBeenLastCalledWith("refresh_cache");
  });

  it("normalizes non-structured errors to network kind", async () => {
    invokeMock.mockRejectedValueOnce("boom");
    const { result } = renderHook(() => useGitHubData(true));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toEqual({ kind: "network", message: "boom" });
  });
});
