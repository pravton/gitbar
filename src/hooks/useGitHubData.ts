import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { backoffFor } from "@/lib/backoff";
import type { GitHubData, GitHubError, Issue, PullRequest } from "@/types";

const POLL_INTERVAL_MS = 60_000;

export interface RetryState {
  /** Local time at which the next auto-retry will fire. */
  retryAt: Date;
  /** How many consecutive failures preceded this scheduled retry (1-indexed). */
  attempt: number;
}

export interface UseGitHubDataResult {
  prs: PullRequest[];
  issues: Issue[];
  partialMessage: string | null;
  loading: boolean;
  error: GitHubError | null;
  /** When non-null, the hook is waiting on a scheduled auto-retry. */
  retry: RetryState | null;
  updatedAt: Date | null;
  refetch: () => Promise<void>;
  forceRefresh: () => Promise<void>;
}

/**
 * Single source of truth for PR + issue data. One `invoke("get_data")` per
 * poll. The Rust side reads the token from its in-memory cache; the frontend
 * never sees or carries the secret.
 *
 * On a transient error (network, rate-limited, server), the hook schedules
 * an automatic retry with [`backoffFor`]-derived delay and exposes the
 * scheduled time as `retry.retryAt` so the UI can render a countdown. Auth
 * errors do not auto-retry — they require user action.
 *
 * Stale responses (those returning after the hook unmounts or `enabled`
 * flips off) are dropped via a generation counter, so a slow request can
 * never overwrite fresher data.
 */
export function useGitHubData(enabled: boolean): UseGitHubDataResult {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [partialMessage, setPartialMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<GitHubError | null>(null);
  const [retry, setRetry] = useState<RetryState | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const generationRef = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  /** Consecutive failures across attempts. Resets on success. */
  const failureCountRef = useRef(0);

  const doFetch = useCallback(async (force: boolean) => {
    const myGeneration = ++generationRef.current;

    if (!enabledRef.current) {
      setPrs([]);
      setIssues([]);
      setPartialMessage(null);
      setError(null);
      setRetry(null);
      setLoading(false);
      setUpdatedAt(null);
      failureCountRef.current = 0;
      return;
    }

    setLoading(true);
    // Don't clear `error` here. If a previous attempt failed and we're now
    // in a scheduled retry, the banner + countdown should stay visible
    // through this in-flight attempt. Error state only changes on a
    // definite outcome: success → null, failure → new error.

    try {
      const command = force ? "refresh_cache" : "get_data";
      const result = await invoke<GitHubData>(command);

      if (myGeneration !== generationRef.current) return;
      setPrs(result.prs);
      setIssues(result.issues);
      setPartialMessage(result.partial_message ?? null);
      // Use the Rust-side fetch timestamp when available so a disk-cache
      // hydrate doesn't appear as a brand-new "Updated 0s ago". Falls
      // back to client wall-clock for safety; the data is still fresh
      // from this caller's perspective.
      setUpdatedAt(
        result.last_fetched_at_ms != null
          ? new Date(result.last_fetched_at_ms)
          : new Date(),
      );
      setError(null);
      setRetry(null);
      failureCountRef.current = 0;
    } catch (rawError) {
      if (myGeneration !== generationRef.current) return;
      const err = normalizeError(rawError);
      setError(err);

      const backoff = backoffFor(err, failureCountRef.current);
      if (backoff) {
        failureCountRef.current++;
        setRetry({
          retryAt: new Date(Date.now() + backoff.delaySecs * 1000),
          attempt: failureCountRef.current,
        });
      } else {
        // Non-retryable (auth, partial). Don't keep the retry banner.
        setRetry(null);
        failureCountRef.current = 0;
      }
    } finally {
      if (myGeneration === generationRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const refetch = useCallback(() => doFetch(false), [doFetch]);
  const forceRefresh = useCallback(() => doFetch(true), [doFetch]);

  // Regular poll.
  useEffect(() => {
    if (!enabled) {
      setPrs([]);
      setIssues([]);
      setPartialMessage(null);
      setError(null);
      setRetry(null);
      setLoading(false);
      setUpdatedAt(null);
      generationRef.current++;
      failureCountRef.current = 0;
      return;
    }

    void refetch();
    const id = window.setInterval(() => void refetch(), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      generationRef.current++;
    };
  }, [enabled, refetch]);

  // Scheduled auto-retry. Independent of the regular poll — fires once at
  // `retry.retryAt`, then `doFetch` either succeeds (clears retry) or
  // schedules the next one. The regular 60s poll still ticks alongside;
  // overlap is harmless because the generation counter dedupes results.
  useEffect(() => {
    if (!retry || !enabled) return;
    const msUntilRetry = Math.max(0, retry.retryAt.getTime() - Date.now());
    const id = window.setTimeout(() => void refetch(), msUntilRetry);
    return () => window.clearTimeout(id);
  }, [retry, enabled, refetch]);

  return {
    prs,
    issues,
    partialMessage,
    loading,
    error,
    retry,
    updatedAt,
    refetch,
    forceRefresh,
  };
}

function normalizeError(raw: unknown): GitHubError {
  if (raw && typeof raw === "object" && "kind" in raw) {
    return raw as GitHubError;
  }
  const message = raw instanceof Error ? raw.message : String(raw);
  return { kind: "network", message };
}
