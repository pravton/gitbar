import { useCallback, useEffect, useRef, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  diffNewReviewRequests,
  notificationBodyFor,
} from "@/lib/notifications";
import type { PullRequest } from "@/types";

const ENABLED_KEY = "gitbar.notifications.reviewRequested.enabled";
const SEEN_KEY = "gitbar.notifications.reviewRequested.seen";

export type NotificationPermission = "default" | "granted" | "denied";

export interface UseReviewRequestNotifierResult {
  /** Whether the user has opted in via the Settings toggle. */
  enabled: boolean;
  /** OS-level permission state, mirrored locally so the UI can warn. */
  permission: NotificationPermission;
  /** Flip user opt-in; on enable, also requests OS permission if needed. */
  setEnabled: (next: boolean) => Promise<void>;
}

/**
 * Watch `prs` for newly review-requested entries and fire OS notifications.
 *
 * The hook is intentionally side-effect-only with no useful return value
 * beyond the opt-in toggle: it doesn't expose what was notified, doesn't
 * track history, doesn't dedupe across app launches beyond a localStorage
 * persisted set. It just turns "this PR newly needs your review" into
 * "macOS shows a banner".
 *
 * State persisted to localStorage:
 *   - `gitbar.notifications.reviewRequested.enabled`: "true" | "false"
 *   - `gitbar.notifications.reviewRequested.seen`: JSON array of PR URLs
 *     we've already notified about. Carried across launches so a relaunch
 *     doesn't re-notify for every PR that's still review-requested.
 *
 * Note: the OS keychain is for *secrets* — this preference is per-machine
 * and not a secret, so localStorage is the right home.
 */
export function useReviewRequestNotifier(
  prs: PullRequest[],
): UseReviewRequestNotifierResult {
  const [enabled, setEnabledState] = useState<boolean>(() =>
    readEnabled(),
  );
  const [permission, setPermission] = useState<NotificationPermission>("default");

  // Persisted "already notified" set lives in a ref so the diffing pass
  // doesn't trigger re-renders. We re-read it once on mount and write
  // through on every change.
  const seenRef = useRef<Set<string>>(new Set(readSeen()));

  // Mirror the current `prs` in a ref so `setEnabled` can read the
  // *latest* list without needing to be inside the render dependencies.
  const prsRef = useRef<PullRequest[]>(prs);
  prsRef.current = prs;

  // Probe OS permission on mount and whenever the window regains focus.
  // Without the focus re-probe, a user who follows the "open System
  // Settings → Notifications → GitBar to grant" hint would come back to a
  // UI that still says "denied" until they restart the app. Focus fires
  // when they switch back from System Settings.
  useEffect(() => {
    const probe = async () => {
      try {
        const granted = await isPermissionGranted();
        setPermission((current) => {
          // Don't downgrade an explicit "denied" the user just received from
          // requestPermission(). The probe only tells us "is permission
          // currently granted"; if not, we can't tell "default" from "denied"
          // — so preserve a known denial.
          if (current === "denied" && !granted) return "denied";
          return granted ? "granted" : "default";
        });
      } catch {
        // Plugin unavailable in this build target; treat as default.
      }
    };
    void probe();
    window.addEventListener("focus", probe);
    return () => window.removeEventListener("focus", probe);
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    if (next) {
      // Ask for OS permission. If the user denies, keep the toggle on but
      // surface `permission === "denied"` so the UI can explain.
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          const result = await requestPermission();
          granted = result === "granted";
        }
        setPermission(granted ? "granted" : "denied");
      } catch (err) {
        console.error("notification permission probe failed:", err);
        setPermission("denied");
      }

      // Seed the seen-set with everything currently review-requested so
      // flipping the toggle doesn't fire a banner per existing PR. The
      // user opted in to "notify me on NEW ones from now"; the current
      // backlog is the baseline, not a stream of fresh events.
      const baseline = new Set(
        prsRef.current
          .filter((p) => p.review_requested)
          .map((p) => p.url),
      );
      seenRef.current = baseline;
      writeSeen(baseline);
    }
    setEnabledState(next);
    writeEnabled(next);
  }, []);

  // The main effect: every time `prs` updates AND we're enabled AND we
  // have permission, diff and notify.
  //
  // Run unconditionally on `prs.length === 0` too, so the seen-set drops
  // entries when the list becomes empty (transiently or otherwise). The
  // diff helper handles empty input correctly — newPrs = [], nextSeen
  // = empty — and we want that empty state persisted, not stale URLs left
  // behind that would suppress a future re-request notification.
  useEffect(() => {
    if (!enabled || permission !== "granted") return;

    const { newPrs, nextSeen } = diffNewReviewRequests(prs, seenRef.current);

    for (const pr of newPrs) {
      try {
        sendNotification({
          title: "Review requested",
          body: notificationBodyFor(pr),
        });
      } catch (err) {
        console.error("sendNotification failed:", err);
      }
    }

    // Persist regardless of whether anything fired — the set tracks the
    // current review-requested state, including drop-outs.
    seenRef.current = nextSeen;
    writeSeen(nextSeen);
  }, [prs, enabled, permission]);

  return { enabled, permission, setEnabled };
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeEnabled(value: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, value ? "true" : "false");
  } catch {
    // Storage unavailable — accept the loss.
  }
}

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

function writeSeen(value: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...value]));
  } catch {
    // Best-effort.
  }
}
