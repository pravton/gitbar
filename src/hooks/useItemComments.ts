import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GitHubError, ItemComments } from "@/types";

/**
 * Lazy-loaded comments for one PR or issue, same shape as `usePRChecks`:
 * no polling, one Tauri `get_item_comments` call per `fetch()`, cached in
 * module scope by item URL so collapsing and reopening a panel (or a
 * card unmounting as the list reorders) within the TTL is free.
 */
export interface UseItemCommentsResult {
  /** `null` until fetched. */
  data: ItemComments | null;
  /** True once `data` was fetched for the current `revision`. */
  fresh: boolean;
  loading: boolean;
  error: GitHubError | null;
  /** Trigger a fetch. Hits the cache if a fresh entry exists. */
  fetch: () => void;
  /** Force a network call even if the cache is fresh. */
  refetch: () => void;
}

interface CacheEntry {
  fetchedAt: number;
  revision: number | undefined;
  data: ItemComments;
}

const TTL_MS = 30_000;
const cache: Map<string, CacheEntry> = new Map();

/** Exported for tests that need a clean slate between assertions. */
export function _clearItemCommentsCache(): void {
  cache.clear();
}

/**
 * `revision` is the item's comment count from the poll. A cache entry
 * from another revision is stale regardless of age, so opening an item
 * with new comments, or new comments arriving while it's open, refetches.
 */
export function useItemComments(itemUrl: string, revision?: number): UseItemCommentsResult {
  const [data, setData] = useState<ItemComments | null>(() => cache.get(itemUrl)?.data ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<GitHubError | null>(null);

  // Drops a response that lands after the hook moved to another URL.
  const generationRef = useRef(0);

  useEffect(() => {
    setData(cache.get(itemUrl)?.data ?? null);
    setError(null);
    setLoading(false);
  }, [itemUrl]);

  const doFetch = useCallback(
    async (force: boolean) => {
      const hit = cache.get(itemUrl);
      if (!force && hit && hit.revision === revision && Date.now() - hit.fetchedAt < TTL_MS) {
        setData(hit.data);
        return;
      }
      generationRef.current += 1;
      const myGen = generationRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<ItemComments>("get_item_comments", { itemUrl });
        if (myGen !== generationRef.current) return;
        // Defensive against the generic test invoke mock resolving to
        // undefined: treat anything malformed as "no comments".
        const safe: ItemComments =
          result && Array.isArray(result.entries)
            ? {
                ...result,
                threads: Array.isArray(result.threads) ? result.threads : [],
                threads_omitted: result.threads_omitted ?? 0,
              }
            : { entries: [], omitted: 0, threads: [], threads_omitted: 0 };
        cache.set(itemUrl, { fetchedAt: Date.now(), revision, data: safe });
        setData(safe);
      } catch (err) {
        if (myGen !== generationRef.current) return;
        const e = err as GitHubError | undefined;
        if (e && typeof e === "object" && "kind" in e) {
          setError(e);
        } else {
          setError({
            kind: "server",
            message: typeof err === "string" ? err : "Failed to load comments",
          });
        }
      } finally {
        if (myGen === generationRef.current) {
          setLoading(false);
        }
      }
    },
    [itemUrl, revision],
  );

  const fetch = useCallback(() => {
    void doFetch(false);
  }, [doFetch]);

  const refetch = useCallback(() => {
    void doFetch(true);
  }, [doFetch]);

  const fresh = data !== null && cache.get(itemUrl)?.revision === revision;

  return { data, fresh, loading, error, fetch, refetch };
}
