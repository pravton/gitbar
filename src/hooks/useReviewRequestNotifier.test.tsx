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

  it("does NOT fire on enable for PRs that were already review-requested (seeds baseline)", async () => {
    // The user already has 2 review-requested PRs when they flip the toggle.
    // We do NOT want a banner per PR in the current backlog — only future
    // transitions into the state should notify.
    const existing = [
      pr({ url: "https://x/1", title: "first" }),
      pr({ url: "https://x/2", title: "second" }),
    ];

    const { result, rerender } = renderHook(
      ({ prs }) => useReviewRequestNotifier(prs),
      { initialProps: { prs: existing } },
    );
    await waitFor(() => expect(result.current.permission).toBe("granted"));

    await act(async () => {
      await result.current.setEnabled(true);
    });
    rerender({ prs: existing });

    // No banner for the existing backlog.
    await new Promise((r) => setTimeout(r, 0));
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("fires a notification when a NEW PR enters review-requested after enable", async () => {
    const existing = [pr({ url: "https://x/1", title: "first" })];

    const { result, rerender } = renderHook(
      ({ prs }) => useReviewRequestNotifier(prs),
      { initialProps: { prs: existing } },
    );
    await waitFor(() => expect(result.current.permission).toBe("granted"));

    await act(async () => {
      await result.current.setEnabled(true);
    });
    rerender({ prs: existing });
    // Baseline seeded; no banner yet.
    await new Promise((r) => setTimeout(r, 0));
    expect(sendNotificationMock).not.toHaveBeenCalled();

    // Now a second PR comes in review-requested.
    rerender({
      prs: [...existing, pr({ url: "https://x/2", title: "second" })],
    });

    await waitFor(() => expect(sendNotificationMock).toHaveBeenCalledTimes(1));
    const call = sendNotificationMock.mock.calls[0][0];
    expect(call.body).toContain("second");
  });

  it("does not re-notify on subsequent polls of the same PR", async () => {
    // Start empty so enable seeds an empty baseline. Then a PR arrives
    // (one notification) and reappears across polls (no further notifications).
    const newPr = pr({ url: "https://x/1" });

    const { result, rerender } = renderHook(
      ({ prs }) => useReviewRequestNotifier(prs),
      { initialProps: { prs: [] as PullRequest[] } },
    );

    await waitFor(() => expect(result.current.permission).toBe("granted"));
    await act(async () => {
      await result.current.setEnabled(true);
    });

    // First time the PR appears post-enable.
    rerender({ prs: [newPr] });
    await waitFor(() => expect(sendNotificationMock).toHaveBeenCalledTimes(1));

    // Subsequent polls return the same PR; should NOT fire again.
    rerender({ prs: [{ ...newPr }] });
    rerender({ prs: [{ ...newPr }] });
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

  it("re-probes permission on window focus (handles user granting via System Settings)", async () => {
    // User starts in 'denied'; flips to 'granted' in System Settings while
    // the app is still open; switches back → window focus event → re-probe
    // should pick up the change.
    isPermissionGrantedMock.mockResolvedValueOnce(false); // initial mount
    isPermissionGrantedMock.mockResolvedValueOnce(true); // after focus

    const { result } = renderHook(() => useReviewRequestNotifier([]));
    await waitFor(() => expect(result.current.permission).toBe("default"));

    // Simulate the user returning from System Settings.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(result.current.permission).toBe("granted"));
  });

  it("re-probe does not downgrade an explicit 'denied' (set by setEnabled)", async () => {
    // User toggles on → OS prompt → denies → permission = "denied".
    // A window focus probe that returns "not granted" must not flip it to
    // "default", losing the explicit denial signal the UI uses to show the
    // System Settings hint.
    isPermissionGrantedMock.mockResolvedValue(false);
    requestPermissionMock.mockResolvedValue("denied");

    const { result } = renderHook(() => useReviewRequestNotifier([]));
    await waitFor(() => expect(result.current.permission).toBe("default"));

    await act(async () => {
      await result.current.setEnabled(true);
    });
    expect(result.current.permission).toBe("denied");

    // Refocus the window — probe runs, still returns false.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    // Still 'denied', not downgraded to 'default'.
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.permission).toBe("denied");
  });

  it("clears the seen-set when prs becomes empty (so re-requests later still notify)", async () => {
    // Enable with one PR present → baseline seeds with that URL. PR list
    // then drops to empty (e.g. transiently). The seen-set should clear
    // accordingly; localStorage should reflect the empty state.
    const target = pr({ url: "https://x/1" });

    const { result, rerender } = renderHook(
      ({ prs }) => useReviewRequestNotifier(prs),
      { initialProps: { prs: [target] } },
    );
    await waitFor(() => expect(result.current.permission).toBe("granted"));
    await act(async () => {
      await result.current.setEnabled(true);
    });
    // Baseline seeded with x/1.
    expect(
      JSON.parse(
        localStorage.getItem("gitbar.notifications.reviewRequested.seen") ?? "[]",
      ),
    ).toEqual(["https://x/1"]);

    // List goes empty.
    rerender({ prs: [] });
    await new Promise((r) => setTimeout(r, 0));

    // Seen-set is empty now — wouldn't have caught this with the old
    // `prs.length === 0` early-return guard.
    expect(
      JSON.parse(
        localStorage.getItem("gitbar.notifications.reviewRequested.seen") ?? "[]",
      ),
    ).toEqual([]);

    // Same PR reappears later → fires a banner (would have been silently
    // suppressed if the seen-set hadn't cleaned up).
    rerender({ prs: [target] });
    await waitFor(() => expect(sendNotificationMock).toHaveBeenCalledTimes(1));
  });

  it("drops PRs from `seen` once they leave review-requested state", async () => {
    // Start empty → seed baseline empty → PR arrives (fires once) →
    // transitions out → comes back (fires again because it left the
    // seen-set when it stopped being review-requested).
    const target = pr({ url: "https://x/1" });

    const { result, rerender } = renderHook(
      ({ prs }) => useReviewRequestNotifier(prs),
      { initialProps: { prs: [] as PullRequest[] } },
    );
    await waitFor(() => expect(result.current.permission).toBe("granted"));
    await act(async () => {
      await result.current.setEnabled(true);
    });

    // PR appears review-requested for the first time → fires.
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
