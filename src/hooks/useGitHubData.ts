import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GitHubData, GitHubError, Issue, PullRequest } from "@/types";

const POLL_INTERVAL_MS = 60_000;

export interface UseGitHubDataResult {
  prs: PullRequest[];
  issues: Issue[];
  partialMessage: string | null;
  loading: boolean;
  error: GitHubError | null;
  updatedAt: Date | null;
  refetch: () => Promise<void>;
  forceRefresh: () => Promise<void>;
}

/**
 * Single source of truth for PR + issue data. One `invoke("get_data")` per poll,
 * which collapses the previous 4-concurrent-fetch-on-mount race onto one call.
 *
 * Stale responses (those returning after the token has changed or the hook has
 * unmounted) are dropped via a generation counter, so a slow request can never
 * overwrite fresher data.
 */
export function useGitHubData(token: string): UseGitHubDataResult {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [partialMessage, setPartialMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<GitHubError | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const generationRef = useRef(0);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const doFetch = useCallback(
    async (force: boolean) => {
      const myGeneration = ++generationRef.current;
      const captured = tokenRef.current;

      if (!captured) {
        // Any in-flight request from a previous token is now stale (its
        // generation is already < myGeneration). Make sure transient UI state
        // doesn't strand here either — without this, `loading` could stay true
        // forever because the in-flight request's finally block targets the
        // old generation and bails out.
        setPrs([]);
        setIssues([]);
        setPartialMessage(null);
        setError(null);
        setLoading(false);
        setUpdatedAt(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const command = force ? "refresh_cache" : "get_data";
        const result = await invoke<GitHubData>(command, { token: captured });

        if (myGeneration !== generationRef.current) return; // stale
        setPrs(result.prs);
        setIssues(result.issues);
        setPartialMessage(result.partial_message ?? null);
        setUpdatedAt(new Date());
      } catch (rawError) {
        if (myGeneration !== generationRef.current) return; // stale
        setError(normalizeError(rawError));
      } finally {
        if (myGeneration === generationRef.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  const refetch = useCallback(() => doFetch(false), [doFetch]);
  const forceRefresh = useCallback(() => doFetch(true), [doFetch]);

  useEffect(() => {
    if (!token) {
      setPrs([]);
      setIssues([]);
      setPartialMessage(null);
      setError(null);
      generationRef.current++;
      return;
    }

    void refetch();
    const id = window.setInterval(() => void refetch(), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      generationRef.current++; // invalidate any in-flight response
    };
  }, [token, refetch]);

  return { prs, issues, partialMessage, loading, error, updatedAt, refetch, forceRefresh };
}

function normalizeError(raw: unknown): GitHubError {
  if (raw && typeof raw === "object" && "kind" in raw) {
    return raw as GitHubError;
  }
  const message = raw instanceof Error ? raw.message : String(raw);
  return { kind: "network", message };
}
