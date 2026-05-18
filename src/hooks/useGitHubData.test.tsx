import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useGitHubData } from "@/hooks/useGitHubData";
import type { GitHubData, GitHubError } from "@/types";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

function ok(prs: GitHubData["prs"] = [], issues: GitHubData["issues"] = []): GitHubData {
  return { prs, issues, partial_message: null };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("useGitHubData", () => {
  it("does not fetch when token is empty", async () => {
    const { result } = renderHook(() => useGitHubData(""));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("fetches once on mount and populates prs + issues", async () => {
    invokeMock.mockResolvedValueOnce(
      ok(
        [
          {
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
          },
        ],
        [],
      ),
    );

    const { result } = renderHook(() => useGitHubData("tok"));

    await waitFor(() => expect(result.current.prs.length).toBe(1));
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_data", { token: "tok" });
    expect(result.current.error).toBeNull();
    expect(result.current.updatedAt).not.toBeNull();
  });

  it("surfaces typed errors", async () => {
    const err: GitHubError = { kind: "auth", message: "bad token" };
    invokeMock.mockRejectedValueOnce(err);

    const { result } = renderHook(() => useGitHubData("tok"));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toEqual(err);
  });

  it("drops stale responses when the token changes mid-flight", async () => {
    // First call resolves slowly with old data; before it resolves, token changes
    // and a second call resolves with new data. Final state must be new data.
    let resolveOld!: (value: GitHubData) => void;
    const oldPromise = new Promise<GitHubData>((resolve) => {
      resolveOld = resolve;
    });
    invokeMock
      .mockReturnValueOnce(oldPromise)
      .mockResolvedValueOnce(
        ok([
          {
            number: 99,
            title: "fresh",
            url: "https://x/99",
            state: "OPEN",
            created_at: "2025-03-01T00:00:00Z",
            repository: { name_with_owner: "o/r" },
            author: { login: "u", avatar_url: null },
            is_draft: false,
            review_decision: null,
            ci_status: null,
            additions: 0,
            deletions: 0,
          },
        ]),
      );

    const { result, rerender } = renderHook(({ token }) => useGitHubData(token), {
      initialProps: { token: "old" },
    });

    // Switch token mid-flight (this bumps the generation).
    rerender({ token: "new" });

    // Wait for the new fetch to populate.
    await waitFor(() => expect(result.current.prs.length).toBe(1));
    expect(result.current.prs[0].number).toBe(99);

    // Now the *old* request finally resolves. It must NOT overwrite.
    act(() => {
      resolveOld(
        ok([
          {
            number: 1,
            title: "stale",
            url: "https://x/1",
            state: "OPEN",
            created_at: "2025-01-01T00:00:00Z",
            repository: { name_with_owner: "o/r" },
            author: { login: "u", avatar_url: null },
            is_draft: false,
            review_decision: null,
            ci_status: null,
            additions: 0,
            deletions: 0,
          },
        ]),
      );
    });

    // Give microtasks a chance to settle, then re-assert.
    await waitFor(() => expect(result.current.prs[0].number).toBe(99));
  });

  it("forceRefresh routes through refresh_cache", async () => {
    invokeMock.mockResolvedValue(ok());
    const { result } = renderHook(() => useGitHubData("tok"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.forceRefresh();
    });

    expect(invokeMock).toHaveBeenLastCalledWith("refresh_cache", { token: "tok" });
  });

  it("normalizes non-structured errors to network kind", async () => {
    invokeMock.mockRejectedValueOnce("boom");
    const { result } = renderHook(() => useGitHubData("tok"));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toEqual({ kind: "network", message: "boom" });
  });
});
