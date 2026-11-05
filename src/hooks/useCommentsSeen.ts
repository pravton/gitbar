import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readSeenCounts, reconcileSeenCounts, writeSeenCounts } from "@/lib/commentsSeen";
import type { SeenCounts } from "@/lib/commentsSeen";
import type { Issue, PullRequest } from "@/types";

export interface UseCommentsSeenInput {
  login: string | null;
  prs: PullRequest[];
  issues: Issue[];
  /** False until the current account's first data has arrived. */
  loaded: boolean;
  /** False while part of the list may be missing (error or partial fetch). */
  complete: boolean;
}

export interface UseCommentsSeenResult {
  /** New-comment count per item URL. Items with none aren't in the map. */
  unread: ReadonlyMap<string, number>;
  /** Record `count` as seen on one item. */
  markSeen: (url: string, count: number) => void;
}

/**
 * Unread comment indicator. Count-based and frontend-only: compares each
 * item's comment count from the regular poll to the count last seen, per
 * account, in localStorage.
 */
export function useCommentsSeen({
  login,
  prs,
  issues,
  loaded,
  complete,
}: UseCommentsSeenInput): UseCommentsSeenResult {
  const [state, setState] = useState(() => loadFor(login));
  // Swap maps during render, not in an effect, so a switch never renders
  // one account's items against the other account's counts.
  let current = state;
  if (state.login !== login) {
    current = loadFor(login);
    setState(current);
  }

  useEffect(() => {
    if (state.login) writeSeenCounts(state.login, state.seen);
  }, [state]);

  // On the commit where the login changes, `prs` and `issues` still hold
  // the previous account's list (useGitHubData clears them in its own
  // effect). Reconciling that would prune this account's record.
  const reconciledLoginRef = useRef(login);
  useEffect(() => {
    if (reconciledLoginRef.current !== login) {
      reconciledLoginRef.current = login;
      return;
    }
    if (!login || !loaded) return;
    const items = [...prs, ...issues];
    setState((prev) => {
      const seen = reconcileSeenCounts(prev.seen, items, complete);
      return seen === prev.seen ? prev : { ...prev, seen };
    });
  }, [login, prs, issues, loaded, complete]);

  const seen = current.seen;
  const unread = useMemo(() => {
    const out = new Map<string, number>();
    for (const { url, comments } of [...prs, ...issues]) {
      const lastSeen = seen[url];
      if (lastSeen !== undefined && comments > lastSeen) out.set(url, comments - lastSeen);
    }
    return out;
  }, [prs, issues, seen]);

  const markSeen = useCallback((url: string, count: number) => {
    setState((prev) =>
      prev.seen[url] === count ? prev : { ...prev, seen: { ...prev.seen, [url]: count } },
    );
  }, []);

  return { unread, markSeen };
}

function loadFor(login: string | null): { login: string | null; seen: SeenCounts } {
  return { login, seen: login ? readSeenCounts(login) : {} };
}
