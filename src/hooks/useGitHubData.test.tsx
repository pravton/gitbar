import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useGitHubData } from "@/hooks/useGitHubData";
import type { GitHubData, GitHubError, PullRequest } from "@/types";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

function ok(prs: GitHubData["prs"] = [], issues: GitHubData["issues"] = []): GitHubData {
  return { prs, issues, partial_message: null, last_fetched_at_ms: null, history: [] };
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

  it("uses the Rust-side last_fetched_at_ms for updatedAt (disk-hydrate accuracy)", async () => {
    // Backend returns a wall-clock timestamp 5 minutes in the past — as
    // it would after hydrating from disk on a cold launch. The hook
    // must use that, not Date.now(), so the UI's "Updated X ago"
    // reflects real age.
    const fiveMinAgo = Date.now() - 5 * 60_000;
    invokeMock.mockResolvedValueOnce({
      prs: [],
      issues: [],
      partial_message: null,
      last_fetched_at_ms: fiveMinAgo,
      history: [],
    } as GitHubData);

    const { result } = renderHook(() => useGitHubData(true));
    await waitFor(() => expect(result.current.updatedAt).not.toBeNull());

    expect(result.current.updatedAt?.getTime()).toBe(fiveMinAgo);
  });

  it("falls back to client wall-clock when last_fetched_at_ms is null", async () => {
    invokeMock.mockResolvedValueOnce(ok());
    const { result } = renderHook(() => useGitHubData(true));
    await waitFor(() => expect(result.current.updatedAt).not.toBeNull());
    // We don't assert an exact value (real-time test), but it should be
    // within a few seconds of "now" — not e.g. epoch.
    const driftMs = Math.abs((result.current.updatedAt as Date).getTime() - Date.now());
    expect(driftMs).toBeLessThan(2000);
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

  it("schedules a retry on transient (network) errors", async () => {
    // Freeze Date so the retryAt assertion is deterministic. Only stub Date,
    // not setTimeout/setInterval, so renderHook + waitFor still drive real
    // microtask scheduling against the rejected invoke().
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-19T10:00:00Z"));

    try {
      invokeMock.mockRejectedValueOnce({ kind: "network", message: "offline" });
      const { result } = renderHook(() => useGitHubData(true));
      await waitFor(() => expect(result.current.retry).not.toBeNull());
      expect(result.current.retry?.attempt).toBe(1);
      // First failure → exactly 2s delay per the backoff schedule.
      expect(result.current.retry?.retryAt.toISOString()).toBe(
        "2026-05-19T10:00:02.000Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT schedule a retry on auth errors", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "auth", message: "bad token" });
    const { result } = renderHook(() => useGitHubData(true));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.retry).toBeNull();
  });

  it("clears retry state on a successful refresh", async () => {
    invokeMock
      .mockRejectedValueOnce({ kind: "network", message: "offline" })
      .mockResolvedValueOnce(ok());

    const { result } = renderHook(() => useGitHubData(true));
    await waitFor(() => expect(result.current.retry).not.toBeNull());

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.retry).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("keeps the previous error visible while a retry attempt is in flight", async () => {
    // First call fails → error + retry are set. Second call (the retry)
    // is slow; while it's in flight, the previous error must NOT be
    // cleared. The user otherwise sees the banner flicker on every retry.
    let resolveRetry!: (value: GitHubData) => void;
    const retryPromise = new Promise<GitHubData>((resolve) => {
      resolveRetry = resolve;
    });
    const firstError = { kind: "network" as const, message: "offline" };
    invokeMock
      .mockRejectedValueOnce(firstError)
      .mockReturnValueOnce(retryPromise);

    const { result } = renderHook(() => useGitHubData(true));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toEqual(firstError);

    // Trigger the retry manually so we can observe the in-flight state.
    let retryCall: Promise<void>;
    act(() => {
      retryCall = result.current.refetch();
    });

    // Loading flipped on; error is STILL the previous one (banner stays up).
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.error).toEqual(firstError);

    // Resolve the retry successfully → error clears.
    await act(async () => {
      resolveRetry(ok());
      await retryCall;
    });
    expect(result.current.error).toBeNull();
  });
});
