import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AuthCheck } from "@/types";

const TOKEN_KEY = "gitbar.githubToken";

export function useGitHubAuth() {
  const [token, setTokenState] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    setTokenState(localStorage.getItem(TOKEN_KEY) ?? "");
  }, []);

  const setToken = (nextToken: string) => {
    const trimmed = nextToken.trim();
    localStorage.setItem(TOKEN_KEY, trimmed);
    setTokenState(trimmed);
    setAuthError(null);
  };

  const clearToken = () => {
    localStorage.removeItem(TOKEN_KEY);
    setTokenState("");
    setAuthError(null);
  };

  const checkToken = async (candidate: string): Promise<boolean> => {
    const trimmed = candidate.trim();
    if (!trimmed) {
      setAuthError("Please paste a GitHub token first.");
      return false;
    }

    setChecking(true);
    setAuthError(null);

    try {
      const result = await invoke<AuthCheck>("check_auth", { token: trimmed });
      if (!result.ok) {
        setAuthError(result.message ?? "GitHub rejected this token.");
        return false;
      }

      setToken(candidate);
      return true;
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : error instanceof Error
            ? error.message
            : String(error);
      setAuthError(message);
      return false;
    } finally {
      setChecking(false);
    }
  };

  return useMemo(
    () => ({
      token,
      setToken,
      clearToken,
      checkToken,
      checking,
      authError,
      isAuthenticated: token.length > 0,
    }),
    [authError, checking, token],
  );
}
