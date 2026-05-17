import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Issue } from "@/types";

export function useIssues(token: string) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refetch = useCallback(async () => {
    if (!token) {
      setIssues([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await invoke<Issue[]>("get_issues", { token });
      setIssues(result);
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

  return { issues, loading, error, updatedAt, refetch };
}
