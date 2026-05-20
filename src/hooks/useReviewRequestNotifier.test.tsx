import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useReviewRequestNotifier } from "@/hooks/useReviewRequestNotifier";
import type { PullRequest } from "@/types";

const isPermissionGrantedMock = isPermissionGranted as unknown as ReturnType<typeof vi.fn>;
const requestPermissionMock = requestPermission as unknown as ReturnType<typeof vi.fn>;
const sendNotificationMock = sendNotification as unknown as ReturnType<typeof vi.fn>;

function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: "feat: x",
    url: "https://github.com/o/r/pull/1",
    state: "OPEN",
    created_at: "2025-01-01T00:00:00Z",
    repository: { name_with_owner: "o/r" },
    author: { login: "u", avatar_url: null },
    is_draft: false,
    review_decision: "REVIEW_REQUIRED",
    ci_status: null,
    additions: 0,
    deletions: 0,
    comments: 0,
    deployment_url: null,
    ...overrides,
  };
}

beforeEach(() => {
  // jsdom localStorage facade is flaky; replace with an in-memory shim.
  let store: Record<string, string> = {};
  const fake: Storage = {
    get length() {
      return Object.keys(store).length;
    },
    clear: () => {
      store = {};
    },
    getItem: (k) => (k in store ? store[k] : null),
    key: (i) => Object.keys(store)[i] ?? null,
    removeItem: (k) => {
      delete store[k];
    },
    setItem: (k, v) => {
      store[k] = String(v);
    },
  };
  vi.stubGlobal("localStorage", fake);

  isPermissionGrantedMock.mockReset().mockResolvedValue(true);
  requestPermissionMock.mockReset().mockResolvedValue("granted");
  sendNotificationMock.mockReset();
});

describe("useReviewRequestNotifier", () => {
  it("defaults to disabled and does NOT fire notifications until enabled", async () => {
    const { result } = renderHook(({ prs }) => useReviewRequestNotifier(prs), {
      initialProps: { prs: [pr({ url: "https://x/1" })] },
    });

    await waitFor(() => expect(result.current.permission).toBe("granted"));
    expect(result.current.enabled).toBe(false);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("fires notifications for newly review-requested PRs once enabled", async () => {
    const initialPrs = [pr({ url: "https://x/1", title: "first" })];

    const { result, rerender } = renderHook(
      ({ prs }) => useReviewRequestNotifier(prs),
      { initialProps: { prs: initialPrs } },
    );

    await waitFor(() => expect(result.current.permission).toBe("granted"));

    await act(async () => {
      await result.current.setEnabled(true);
    });

    // Re-render with the same PR list — now that enabled is true the
    // effect runs and notifies.
    rerender({ prs: initialPrs });

    await waitFor(() => expect(sendNotificationMock).toHaveBeenCalledTimes(1));
    const call = sendNotificationMock.mock.calls[0][0];
    expect(call.title).toBe("Review requested");
    expect(call.body).toContain("first");
  });

  it("does not re-notify on subsequent polls of the same PR", async () => {
    const samePr = pr({ url: "https://x/1" });

    const { result, rerender } = renderHook(
      ({ prs }) => useReviewRequestNotifier(prs),
      { initialProps: { prs: [samePr] } },
    );

    await waitFor(() => expect(result.current.permission).toBe("granted"));
    await act(async () => {
      await result.current.setEnabled(true);
    });

    rerender({ prs: [samePr] });
    await waitFor(() => expect(sendNotificationMock).toHaveBeenCalledTimes(1));

    // Subsequent polls return the same PR; should NOT fire again.
    rerender({ prs: [{ ...samePr }] });
    rerender({ prs: [{ ...samePr }] });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("ignores PRs that aren't review-requested", async () => {
    const prs = [
      pr({ url: "https://x/1", review_decision: "APPROVED" }),
      pr({ url: "https://x/2", review_decision: null }),
    ];
    const { result, rerender } = renderHook(
      ({ prs }) => useReviewRequestNotifier(prs),
      { initialProps: { prs } },
    );

    await waitFor(() => expect(result.current.permission).toBe("granted"));
    await act(async () => {
      await result.current.setEnabled(true);
    });
    rerender({ prs });

    // Give the effect a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("requests OS permission when toggled on; surfaces denial", async () => {
    isPermissionGrantedMock.mockResolvedValue(false);
    requestPermissionMock.mockResolvedValue("denied");

    const { result } = renderHook(() => useReviewRequestNotifier([]));
    await waitFor(() => expect(result.current.permission).toBe("default"));

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(requestPermissionMock).toHaveBeenCalled();
    expect(result.current.permission).toBe("denied");
    expect(result.current.enabled).toBe(true);
  });

  it("persists enabled flag to localStorage", async () => {
    const { result } = renderHook(() => useReviewRequestNotifier([]));
    await waitFor(() => expect(result.current.permission).toBe("granted"));
    await act(async () => {
      await result.current.setEnabled(true);
    });
    expect(localStorage.getItem("gitbar.notifications.reviewRequested.enabled")).toBe(
      "true",
    );
  });

  it("re-hydrates enabled + seen state from localStorage", async () => {
    localStorage.setItem("gitbar.notifications.reviewRequested.enabled", "true");
    localStorage.setItem(
      "gitbar.notifications.reviewRequested.seen",
      JSON.stringify(["https://x/1"]),
    );

    // The PR is already in `seen`, so it should NOT trigger a notification.
    const { result } = renderHook(() =>
      useReviewRequestNotifier([pr({ url: "https://x/1" })]),
    );

    await waitFor(() => expect(result.current.enabled).toBe(true));
    // Effect runs after permission resolves — give it a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("drops PRs from `seen` once they leave review-requested state", async () => {
    // Initial: PR is review-requested → notify → seen contains URL.
    const target = pr({ url: "https://x/1" });

    const { result, rerender } = renderHook(
      ({ prs }) => useReviewRequestNotifier(prs),
      { initialProps: { prs: [target] } },
    );
    await waitFor(() => expect(result.current.permission).toBe("granted"));
    await act(async () => {
      await result.current.setEnabled(true);
    });
    rerender({ prs: [target] });
    await waitFor(() => expect(sendNotificationMock).toHaveBeenCalledTimes(1));

    // PR transitions to APPROVED → drops from seen.
    rerender({ prs: [{ ...target, review_decision: "APPROVED" }] });
    await new Promise((r) => setTimeout(r, 0));

    // PR comes back to REVIEW_REQUIRED → should notify again.
    rerender({ prs: [target] });
    await waitFor(() => expect(sendNotificationMock).toHaveBeenCalledTimes(2));
  });
});
