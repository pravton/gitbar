import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AccountsList, AuthCheck, AuthResult } from "@/types";

/**
 * Pre-v0.2 the PAT lived in localStorage under this key. On first launch of a
 * version that stores the PAT in the OS keychain, we migrate the value over
 * and delete the legacy entry. After migration this key is never read again.
 */
const LEGACY_TOKEN_KEY = "gitbar.githubToken";

/**
 * Multi-account: holds N known GitHub logins, each with its own PAT in the
 * OS keychain, and tracks which one is active. The hook never sees the
 * actual token strings: it only carries logins (usernames, not secret) and
 * whether an account is configured. Callers that need to talk to GitHub
 * call `invoke("get_data")` etc.; Rust reads the active account's token
 * from its in-memory cache without it ever crossing the IPC boundary.
 */
export function useGitHubAuth() {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [activeLogin, setActiveLogin] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  /** Set to true once mount-time bookkeeping (migration + list_accounts) finishes. */
  const [ready, setReady] = useState(false);

  const applyAccountsList = useCallback((list: AccountsList) => {
    setAccounts(list.accounts);
    setActiveLogin(list.active);
  }, []);

  /**
   * Re-fetch the account list from Rust. Used on mount, on a tray-driven
   * switch (there's no local promise to read a fresh value from), and to
   * reconcile after a mutating command fails, since a partial failure on
   * the Rust side can still have changed persisted state. Mutating
   * commands that SUCCEED don't need this: they already return the
   * resulting `AccountsList` directly, so callers apply that instead of
   * paying for a second IPC round trip.
   */
  const refreshAccounts = useCallback(async () => {
    try {
      applyAccountsList(await invoke<AccountsList>("list_accounts"));
    } catch (error) {
      console.error("list_accounts failed:", error);
    }
  }, [applyAccountsList]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // Silent migration: a legacy localStorage token (pre-v0.2) becomes
      // the first account in the new roster. `add_account` needs a login,
      // which `check_auth` supplies.
      //
      // Drop the legacy key on a definitive rejection too, not just on
      // success. `client::check_auth` only returns `ok: false` for a
      // GraphQL auth error; network and server failures come back as a
      // thrown error caught below, leaving the key in place to retry. So
      // `ok: false` means GitHub rejected this PAT outright and no
      // future launch can change that. Keeping it stored would park a
      // revoked token in plaintext localStorage forever, with no UI to
      // clear it, re-sent to GitHub on every single launch.
      try {
        const legacy = localStorage.getItem(LEGACY_TOKEN_KEY)?.trim();
        if (legacy) {
          const check = await invoke<AuthCheck>("check_auth", { token: legacy });
          if (check.ok && check.login) {
            await invoke("add_account", { login: check.login, token: legacy });
            localStorage.removeItem(LEGACY_TOKEN_KEY);
          } else if (!check.ok) {
            localStorage.removeItem(LEGACY_TOKEN_KEY);
          }
        }
      } catch (error) {
        console.error("token migration failed:", error);
      }

      try {
        const list = await invoke<AccountsList>("list_accounts");
        if (!cancelled) applyAccountsList(list);
      } catch (error) {
        console.error("list_accounts failed:", error);
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [applyAccountsList]);

  // Tray-driven switches happen entirely in Rust: the webview has no
  // other way to learn about them, since there's no frontend-awaited
  // command promise the way there is for a Settings-driven switch.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void listen<string>("account-switched", () => {
      void refreshAccounts();
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refreshAccounts]);

  /** Validate a candidate token, then add it as a new account and switch to it. */
  const addAccount = useCallback(async (candidate: string): Promise<AuthResult> => {
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
      if (!result.ok || !result.login) {
        const error = result.message ?? "GitHub rejected this token.";
        setAuthError(error);
        return { ok: false, error };
      }

      // add_account re-verifies login/token server-side and returns the
      // resulting list directly, so no separate list_accounts call is
      // needed on this path.
      applyAccountsList(await invoke<AccountsList>("add_account", { login: result.login, token: trimmed }));
      return { ok: true };
    } catch (rawError) {
      const error = errorMessage(rawError);
      setAuthError(error);
      // Rust's add_account can persist a partial change (e.g. the roster
      // write succeeds but activation fails) before returning an error;
      // reconcile so the UI reflects whatever actually landed.
      await refreshAccounts();
      return { ok: false, error };
    } finally {
      setChecking(false);
    }
  }, [applyAccountsList, refreshAccounts]);

  /**
   * Remove an account. If it was active, Rust picks another known account
   * to become active, or logs out entirely if none remain: reflected here
   * via the returned `AccountsList`, not decided client-side.
   */
  const removeAccount = useCallback(async (login: string): Promise<AuthResult> => {
    try {
      applyAccountsList(await invoke<AccountsList>("remove_account", { login }));
      setAuthError(null);
      return { ok: true };
    } catch (rawError) {
      const error = errorMessage(rawError);
      setAuthError(`Failed to remove account: ${error}`);
      // Reconcile so the UI matches whatever the roster actually holds.
      await refreshAccounts();
      return { ok: false, error };
    }
  }, [applyAccountsList, refreshAccounts]);

  /** Switch the active account to an already-known login. */
  const switchAccount = useCallback(async (login: string): Promise<AuthResult> => {
    try {
      applyAccountsList(await invoke<AccountsList>("switch_account", { login }));
      setAuthError(null);
      return { ok: true };
    } catch (rawError) {
      const error = errorMessage(rawError);
      setAuthError(`Failed to switch account: ${error}`);
      // Reconcile: a partial failure (roster updated, activation didn't)
      // can still have changed persisted state even though this threw.
      await refreshAccounts();
      return { ok: false, error };
    }
  }, [applyAccountsList, refreshAccounts]);

  /**
   * Rotate the active account's stored token in place (e.g. after
   * regenerating a PAT on GitHub). Same identity, so this doesn't touch
   * the roster or clear cached data, unlike `switchAccount`/`addAccount`,
   * which do. `expectedLogin` should be the login captured when the
   * caller started this action (not read live at submit time): Rust
   * verifies it still matches the active account and refuses otherwise,
   * so a switch that happens mid-edit can't silently misdirect the
   * rotated token to a different account.
   */
  const replaceActiveToken = useCallback(async (expectedLogin: string, candidate: string): Promise<AuthResult> => {
    const trimmed = candidate.trim();
    if (!trimmed) {
      const error = "Please paste a GitHub token first.";
      return { ok: false, error };
    }
    try {
      await invoke("replace_active_token", { expectedLogin, token: trimmed });
      return { ok: true };
    } catch (rawError) {
      return { ok: false, error: errorMessage(rawError) };
    }
  }, []);

  return useMemo(
    () => ({
      isAuthenticated: activeLogin !== null,
      ready,
      checking,
      authError,
      accounts,
      activeLogin,
      addAccount,
      removeAccount,
      switchAccount,
      replaceActiveToken,
    }),
    [
      accounts,
      activeLogin,
      addAccount,
      authError,
      checking,
      ready,
      removeAccount,
      replaceActiveToken,
      switchAccount,
    ],
  );
}

function errorMessage(raw: unknown): string {
  if (raw && typeof raw === "object" && "message" in raw) {
    return String((raw as { message: unknown }).message);
  }
  if (raw instanceof Error) return raw.message;
  return String(raw);
}
