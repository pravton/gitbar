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
 * Single source of truth for PR + issue data. One `invoke("get_data")` per
 * poll. The Rust side reads the token from its in-memory cache; the frontend
 * never sees or carries the secret.
 *
 * Stale responses (those returning after the hook unmounts or
 * `enabled` flips off) are dropped via a generation counter, so a slow
 * request can never overwrite fresher data.
 */
export function useGitHubData(enabled: boolean): UseGitHubDataResult {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [partialMessage, setPartialMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<GitHubError | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const generationRef = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const doFetch = useCallback(async (force: boolean) => {
    const myGeneration = ++generationRef.current;

    if (!enabledRef.current) {
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
      const result = await invoke<GitHubData>(command);

      if (myGeneration !== generationRef.current) return;
      setPrs(result.prs);
      setIssues(result.issues);
      setPartialMessage(result.partial_message ?? null);
      setUpdatedAt(new Date());
    } catch (rawError) {
      if (myGeneration !== generationRef.current) return;
      setError(normalizeError(rawError));
    } finally {
      if (myGeneration === generationRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const refetch = useCallback(() => doFetch(false), [doFetch]);
  const forceRefresh = useCallback(() => doFetch(true), [doFetch]);

  useEffect(() => {
    if (!enabled) {
      setPrs([]);
      setIssues([]);
      setPartialMessage(null);
      setError(null);
      setLoading(false);
      setUpdatedAt(null);
      generationRef.current++;
      return;
    }

    void refetch();
    const id = window.setInterval(() => void refetch(), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      generationRef.current++;
    };
  }, [enabled, refetch]);

  return { prs, issues, partialMessage, loading, error, updatedAt, refetch, forceRefresh };
}

function normalizeError(raw: unknown): GitHubError {
  if (raw && typeof raw === "object" && "kind" in raw) {
    return raw as GitHubError;
  }
  const message = raw instanceof Error ? raw.message : String(raw);
  return { kind: "network", message };
}
