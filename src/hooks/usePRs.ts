import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PullRequest } from "@/types";

export function usePRs(token: string) {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refetch = useCallback(async () => {
    if (!token) {
      setPrs([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await invoke<PullRequest[]>("get_prs", { token });
      setPrs(result);
      setUpdatedAt(new Date());
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refetch();
    const interval = window.setInterval(() => {
      void refetch();
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [refetch]);

  return { prs, loading, error, updatedAt, refetch };
}
