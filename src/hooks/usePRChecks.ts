import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CheckRun, GitHubError } from "@/types";

/**
 * Lazy-loaded CI check runs for a single PR. Unlike `useGitHubData`,
 * this hook does NOT poll: it fires one Tauri `get_pr_checks` call when
 * `fetch()` is invoked (typically on a click), and caches the result in
 * module scope keyed by PR URL so reopening the same expansion within
 * the TTL is free.
 *
 * Why module-level cache instead of state: multiple PRCards mount and
 * unmount as the list reorders; a per-hook cache would discard data the
 * moment a card scrolls off. A `Map<url, { fetchedAt, runs }>` survives
 * those churns and keeps reopen-after-collapse instant.
 */
export interface UsePRChecksResult {
  /** The check runs, oldest started_at last. `null` until fetched. */
  runs: CheckRun[] | null;
  loading: boolean;
  error: GitHubError | null;
  /** Trigger a fetch. Hits the cache if a fresh entry exists. */
  fetch: () => void;
  /** Force a network call even if the cache is fresh. */
  refetch: () => void;
}

interface CacheEntry {
  fetchedAt: number;
  runs: CheckRun[];
}

const TTL_MS = 30_000;
const cache: Map<string, CacheEntry> = new Map();

/**
 * Wipe a single PR's entry (used by the "refetch" path). Exported for
 * tests that need a clean slate between assertions.
 */
export function _clearPRChecksCache(): void {
  cache.clear();
}

export function usePRChecks(prUrl: string): UsePRChecksResult {
  const [runs, setRuns] = useState<CheckRun[] | null>(() => {
    const hit = cache.get(prUrl);
    return hit ? hit.runs : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<GitHubError | null>(null);

  // A generation counter drops responses from a previous prUrl if the
  // component reuses the hook for a different PR mid-flight. Unlikely
  // here (PRCards are memoized per url), but the cost is tiny.
  const generationRef = useRef(0);

  // If the prUrl changes (or first mounts to a cached URL), reset
  // visible state to the cache hit so we don't show a stale fetched
  // list from a previous PR.
  useEffect(() => {
    const hit = cache.get(prUrl);
    setRuns(hit ? hit.runs : null);
    setError(null);
    setLoading(false);
  }, [prUrl]);

  const doFetch = useCallback(
    async (force: boolean) => {
      const now = Date.now();
      const hit = cache.get(prUrl);
      if (!force && hit && now - hit.fetchedAt < TTL_MS) {
        // Fresh enough; surface the cached value without a round-trip.
        setRuns(hit.runs);
        return;
      }
      generationRef.current += 1;
      const myGen = generationRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<CheckRun[]>("get_pr_checks", { prUrl });
        if (myGen !== generationRef.current) return;
        // Defensive: Rust returns `Vec<CheckRun>`, so this should always be
        // an array, but tests inject a generic invoke mock that resolves
        // to undefined. Treat anything non-array as an empty list rather
        // than letting `.length` throw downstream.
        const safe = Array.isArray(result) ? result : [];
        cache.set(prUrl, { fetchedAt: Date.now(), runs: safe });
        setRuns(safe);
      } catch (err) {
        if (myGen !== generationRef.current) return;
        // Tauri serializes our typed enum; treat anything else as a
        // generic server error so the UI always gets something to show.
        const e = err as GitHubError | undefined;
        if (e && typeof e === "object" && "kind" in e) {
          setError(e);
        } else {
          setError({
            kind: "server",
            message: typeof err === "string" ? err : "Failed to load checks",
          });
        }
      } finally {
        if (myGen === generationRef.current) {
          setLoading(false);
        }
      }
    },
    [prUrl],
  );

  const fetch = useCallback(() => {
    void doFetch(false);
  }, [doFetch]);

  const refetch = useCallback(() => {
    void doFetch(true);
  }, [doFetch]);

  return { runs, loading, error, fetch, refetch };
}
