import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCommentsSeen } from "@/hooks/useCommentsSeen";
import type { UseCommentsSeenInput } from "@/hooks/useCommentsSeen";
import { readSeenCounts, writeSeenCounts } from "@/lib/commentsSeen";
import type { Issue, PullRequest } from "@/types";

const pr = (url: string, comments: number) => ({ url, comments }) as PullRequest;
const issue = (url: string, comments: number) => ({ url, comments }) as Issue;

function input(overrides: Partial<UseCommentsSeenInput> = {}): UseCommentsSeenInput {
  return { login: "alice", prs: [], issues: [], loaded: true, complete: true, ...overrides };
}

describe("useCommentsSeen", () => {
  beforeEach(() => localStorage.clear());

  it("seeds everything as seen on first run, then flags new comments", () => {
    const { result, rerender } = renderHook((props) => useCommentsSeen(props), {
      initialProps: input({ prs: [pr("p", 3)], issues: [issue("i", 1)] }),
    });
    expect(result.current.unread.size).toBe(0);
    expect(readSeenCounts("alice")).toEqual({ p: 3, i: 1 });

    rerender(input({ prs: [pr("p", 5)], issues: [issue("i", 1)] }));
    expect(result.current.unread.get("p")).toBe(2);
    expect(result.current.unread.has("i")).toBe(false);
    // Still recorded at the last seen count.
    expect(readSeenCounts("alice").p).toBe(3);
  });

  it("clears unread on markSeen and persists it", () => {
    writeSeenCounts("alice", { p: 1 });
    const { result } = renderHook((props) => useCommentsSeen(props), {
      initialProps: input({ prs: [pr("p", 4)] }),
    });
    expect(result.current.unread.get("p")).toBe(3);
    act(() => result.current.markSeen("p", 4));
    expect(result.current.unread.size).toBe(0);
    expect(readSeenCounts("alice").p).toBe(4);
  });

  it("shows comments added while the app was closed", () => {
    writeSeenCounts("alice", { p: 1 });
    const { result } = renderHook((props) => useCommentsSeen(props), {
      initialProps: input({ prs: [pr("p", 2)] }),
    });
    expect(result.current.unread.get("p")).toBe(1);
  });

  it("prunes items that left the list only when the data is complete", () => {
    writeSeenCounts("alice", { kept: 1, gone: 2 });
    const { rerender } = renderHook((props) => useCommentsSeen(props), {
      initialProps: input({ prs: [pr("kept", 1)], complete: false }),
    });
    expect(readSeenCounts("alice")).toEqual({ kept: 1, gone: 2 });
    rerender(input({ prs: [pr("kept", 1)], complete: true }));
    expect(readSeenCounts("alice")).toEqual({ kept: 1 });
  });

  it("does nothing until data has loaded", () => {
    writeSeenCounts("alice", { p: 1 });
    renderHook((props) => useCommentsSeen(props), {
      initialProps: input({ loaded: false }),
    });
    expect(readSeenCounts("alice")).toEqual({ p: 1 });
  });

  it("keeps accounts separate across a switch, with the old list still in props", () => {
    writeSeenCounts("bob", { b: 1 });
    const alicePrs = [pr("a", 2)];
    const { result, rerender } = renderHook((props) => useCommentsSeen(props), {
      initialProps: input({ prs: alicePrs }),
    });

    // The commit where the login changes: useGitHubData hasn't cleared
    // alice's list yet. It must not prune bob's record or seed into it.
    rerender(input({ login: "bob", prs: alicePrs }));
    expect(readSeenCounts("bob")).toEqual({ b: 1 });
    expect(result.current.unread.size).toBe(0);

    // useGitHubData clears, then bob's data arrives.
    rerender(input({ login: "bob", loaded: false }));
    expect(readSeenCounts("bob")).toEqual({ b: 1 });
    rerender(input({ login: "bob", prs: [pr("b", 3)] }));
    expect(result.current.unread.get("b")).toBe(2);
    expect(readSeenCounts("alice")).toEqual({ a: 2 });
  });

  it("stores nothing without an active account", () => {
    renderHook((props) => useCommentsSeen(props), {
      initialProps: input({ login: null, prs: [pr("p", 1)] }),
    });
    expect(localStorage.length).toBe(0);
  });
});
