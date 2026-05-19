import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AuthCheck, AuthResult } from "@/types";

/**
 * Pre-v0.2 the PAT lived in localStorage under this key. On first launch of a
 * version that stores the PAT in the OS keychain, we migrate the value over
 * and delete the legacy entry. After migration this key is never read again.
 */
const LEGACY_TOKEN_KEY = "gitbar.githubToken";

/**
 * The hook no longer holds the actual token string. The PAT is stored in the
 * OS keychain via Rust; the frontend tracks only whether one is configured.
 * Callers that need to talk to GitHub call `invoke("get_data")` etc. — the
 * Rust side reads the token from its in-memory cache without it ever
 * crossing the IPC boundary.
 */
export function useGitHubAuth() {
  const [isAuthenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  /** Set to true once mount-time bookkeeping (migration + has_token) finishes. */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // Silent migration: lift the legacy localStorage token into the
      // keychain on first launch under the new architecture. If save fails
      // (no keychain access, etc.) we keep the legacy item so the user can
      // retry on next launch rather than losing their token.
      try {
        const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
        if (legacy && legacy.trim()) {
          await invoke("save_token", { token: legacy });
          localStorage.removeItem(LEGACY_TOKEN_KEY);
        }
      } catch (error) {
        console.error("token migration failed:", error);
      }

      try {
        const present = await invoke<boolean>("has_token");
        if (!cancelled) setAuthenticated(present);
      } catch (error) {
        console.error("has_token failed:", error);
        if (!cancelled) setAuthenticated(false);
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Validate a candidate token and, on success, persist it via Rust. */
  const checkToken = useCallback(async (candidate: string): Promise<AuthResult> => {
    const trimmed = candidate.trim();
    if (!trimmed) {
      const error = "Please paste a GitHub token first.";
      setAuthError(error);
      return { ok: false, error };
    }

    setChecking(true);
    setAuthError(null);

    try {
      const result = await invoke<AuthCheck>("check_auth", { token: trimmed });
      if (!result.ok) {
        const error = result.message ?? "GitHub rejected this token.";
        setAuthError(error);
        return { ok: false, error };
      }

      await invoke("save_token", { token: trimmed });
      setAuthenticated(true);
      return { ok: true };
    } catch (rawError) {
      const error = errorMessage(rawError);
      setAuthError(error);
      return { ok: false, error };
    } finally {
      setChecking(false);
    }
  }, []);

  /** Replace the currently stored token. Same flow as initial onboarding. */
  const replaceToken = checkToken;

  /**
   * Forget the stored token. Only flips `isAuthenticated` to false on
   * success — if the Rust delete fails, the token is still in the keychain
   * and we reconcile UI state by re-checking `has_token` so a stale "true"
   * doesn't get hidden behind a false UI.
   */
  const clearToken = useCallback(async (): Promise<AuthResult> => {
    try {
      await invoke("clear_token");
      setAuthenticated(false);
      setAuthError(null);
      return { ok: true };
    } catch (rawError) {
      const error = errorMessage(rawError);
      setAuthError(`Failed to disconnect: ${error}`);
      // Reconcile so the UI matches whatever the keychain actually holds.
      try {
        const present = await invoke<boolean>("has_token");
        setAuthenticated(present);
      } catch {
        // Best-effort. Leave state alone if the probe also fails.
      }
      return { ok: false, error };
    }
  }, []);

  return useMemo(
    () => ({
      isAuthenticated,
      ready,
      checking,
      authError,
      checkToken,
      replaceToken,
      clearToken,
    }),
    [authError, checking, checkToken, clearToken, isAuthenticated, ready, replaceToken],
  );
}

function errorMessage(raw: unknown): string {
  if (raw && typeof raw === "object" && "message" in raw) {
    return String((raw as { message: unknown }).message);
  }
  if (raw instanceof Error) return raw.message;
  return String(raw);
}
