import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useGitHubAuth } from "@/hooks/useGitHubAuth";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const listenMock = listen as unknown as ReturnType<typeof vi.fn>;

const emptyAccounts = { accounts: [], active: null };

// jsdom's localStorage facade in vitest 4 is flaky; install a deterministic
// in-memory shim per test like our other hook suites do.
beforeEach(() => {
  let store: Record<string, string> = {};
  const fake: Storage = {
    get length() {
      return Object.keys(store).length;
    },
    clear: () => {
      store = {};
    },
    getItem: (k: string) => (k in store ? store[k] : null),
    key: (i: number) => Object.keys(store)[i] ?? null,
    removeItem: (k: string) => {
      delete store[k];
    },
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
  };
  vi.stubGlobal("localStorage", fake);
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockResolvedValue(vi.fn());
});

describe("useGitHubAuth", () => {
  it("starts unauthenticated and reports `ready` only after the mount-time check resolves", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_accounts") return Promise.resolve(emptyAccounts);
      return Promise.resolve();
    });

    const { result } = renderHook(() => useGitHubAuth());

    // Synchronously after mount, ready is still false.
    expect(result.current.ready).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.accounts).toEqual([]);
    expect(result.current.activeLogin).toBeNull();
  });

  it("reports authenticated when list_accounts returns an active login", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_accounts"
        ? Promise.resolve({ accounts: ["alice"], active: "alice" })
        : Promise.resolve(),
    );

    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.accounts).toEqual(["alice"]);
    expect(result.current.activeLogin).toBe("alice");
  });

  it("migrates a legacy localStorage token into the new roster via check_auth + add_account", async () => {
    localStorage.setItem("gitbar.githubToken", "ghp_legacy");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "check_auth") return Promise.resolve({ ok: true, login: "alice", message: null });
      if (cmd === "add_account") return Promise.resolve();
      if (cmd === "list_accounts") return Promise.resolve({ accounts: ["alice"], active: "alice" });
      return Promise.resolve();
    });

    renderHook(() => useGitHubAuth());

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("add_account", { login: "alice", token: "ghp_legacy" });
    });
    expect(localStorage.getItem("gitbar.githubToken")).toBeNull();
  });

  it("discards the legacy item when check_auth definitively rejects the legacy token", async () => {
    // `ok: false` comes back only for a GraphQL auth error, so GitHub
    // rejected this PAT outright and no future launch can change that.
    // Keeping it would park a revoked token in plaintext localStorage
    // forever, with no UI to clear it, re-sent to GitHub every launch.
    localStorage.setItem("gitbar.githubToken", "ghp_legacy");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "check_auth") return Promise.resolve({ ok: false, login: null, message: "revoked" });
      if (cmd === "list_accounts") return Promise.resolve(emptyAccounts);
      return Promise.resolve();
    });

    renderHook(() => useGitHubAuth());

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_accounts"));
    expect(invokeMock).not.toHaveBeenCalledWith("add_account", expect.anything());
    expect(localStorage.getItem("gitbar.githubToken")).toBeNull();
  });

  it("keeps the legacy item when check_auth fails for a non-auth reason, so migration can retry", async () => {
    // Network / server failures THROW rather than returning ok: false.
    // Those are transient, so the token has to survive for the next
    // launch to retry with.
    localStorage.setItem("gitbar.githubToken", "ghp_legacy");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "check_auth") return Promise.reject({ kind: "network", message: "offline" });
      if (cmd === "list_accounts") return Promise.resolve(emptyAccounts);
      return Promise.resolve();
    });

    renderHook(() => useGitHubAuth());

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_accounts"));
    expect(invokeMock).not.toHaveBeenCalledWith("add_account", expect.anything());
    expect(localStorage.getItem("gitbar.githubToken")).toBe("ghp_legacy");
  });

  it("addAccount validates via check_auth then persists via add_account", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_accounts") return Promise.resolve(emptyAccounts);
      if (cmd === "check_auth") return Promise.resolve({ ok: true, login: "alice", message: null });
      if (cmd === "add_account") return Promise.resolve();
      return Promise.resolve();
    });

    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));

    // add_account resolves with the fresh AccountsList directly (no
    // separate list_accounts round trip needed on the success path).
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "check_auth") return Promise.resolve({ ok: true, login: "alice", message: null });
      if (cmd === "add_account") return Promise.resolve({ accounts: ["alice"], active: "alice" });
      return Promise.resolve();
    });

    let outcome: Awaited<ReturnType<typeof result.current.addAccount>> | undefined;
    await act(async () => {
      outcome = await result.current.addAccount("ghp_new");
    });

    expect(outcome).toEqual({ ok: true });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.activeLogin).toBe("alice");
  });

  it("addAccount does NOT call add_account when check_auth rejects the token", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_accounts") return Promise.resolve(emptyAccounts);
      if (cmd === "check_auth")
        return Promise.resolve({ ok: false, login: null, message: "Bad credentials" });
      return Promise.resolve();
    });

    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));

    let outcome: Awaited<ReturnType<typeof result.current.addAccount>> | undefined;
    await act(async () => {
      outcome = await result.current.addAccount("ghp_bad");
    });

    expect(outcome).toEqual({ ok: false, error: "Bad credentials" });
    expect(result.current.authError).toBe("Bad credentials");
    expect(result.current.isAuthenticated).toBe(false);
    expect(invokeMock).not.toHaveBeenCalledWith("add_account", expect.anything());
  });

  it("addAccount refuses blank input without hitting Rust", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_accounts" ? Promise.resolve(emptyAccounts) : Promise.resolve(),
    );
    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));
    invokeMock.mockClear();

    let outcome: Awaited<ReturnType<typeof result.current.addAccount>> | undefined;
    await act(async () => {
      outcome = await result.current.addAccount("   ");
    });

    expect(outcome?.ok).toBe(false);
    if (outcome && !outcome.ok) {
      expect(outcome.error).toMatch(/paste a GitHub token/);
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("removeAccount calls remove_account and refreshes the account list", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_accounts"
        ? Promise.resolve({ accounts: ["alice", "bob"], active: "alice" })
        : Promise.resolve(),
    );

    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.activeLogin).toBe("alice"));

    // remove_account resolves with the fresh AccountsList directly.
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "remove_account" ? Promise.resolve({ accounts: ["bob"], active: "bob" }) : Promise.resolve(),
    );

    let outcome: Awaited<ReturnType<typeof result.current.removeAccount>> | undefined;
    await act(async () => {
      outcome = await result.current.removeAccount("alice");
    });

    expect(outcome).toEqual({ ok: true });
    expect(invokeMock).toHaveBeenCalledWith("remove_account", { login: "alice" });
    expect(result.current.accounts).toEqual(["bob"]);
    expect(result.current.activeLogin).toBe("bob");
  });

  it("removeAccount surfaces an error and reconciles state when remove_account fails", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_accounts" ? Promise.resolve({ accounts: ["alice"], active: "alice" }) : Promise.resolve(),
    );
    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.activeLogin).toBe("alice"));

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "remove_account") return Promise.reject(new Error("keychain locked"));
      if (cmd === "list_accounts") return Promise.resolve({ accounts: ["alice"], active: "alice" });
      return Promise.resolve();
    });

    let outcome: Awaited<ReturnType<typeof result.current.removeAccount>> | undefined;
    await act(async () => {
      outcome = await result.current.removeAccount("alice");
    });

    expect(outcome).toEqual({ ok: false, error: "keychain locked" });
    expect(result.current.authError).toMatch(/Failed to remove account/);
    // Reconciled via list_accounts: alice is still there since the removal failed.
    expect(result.current.activeLogin).toBe("alice");
  });

  it("switchAccount calls switch_account and refreshes the active login", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_accounts"
        ? Promise.resolve({ accounts: ["alice", "bob"], active: "alice" })
        : Promise.resolve(),
    );
    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.activeLogin).toBe("alice"));

    // switch_account resolves with the fresh AccountsList directly.
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "switch_account"
        ? Promise.resolve({ accounts: ["alice", "bob"], active: "bob" })
        : Promise.resolve(),
    );

    let outcome: Awaited<ReturnType<typeof result.current.switchAccount>> | undefined;
    await act(async () => {
      outcome = await result.current.switchAccount("bob");
    });

    expect(outcome).toEqual({ ok: true });
    expect(invokeMock).toHaveBeenCalledWith("switch_account", { login: "bob" });
    expect(result.current.activeLogin).toBe("bob");
  });

  it("replaceActiveToken calls replace_active_token without touching the account list", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_accounts" ? Promise.resolve({ accounts: ["alice"], active: "alice" }) : Promise.resolve(),
    );
    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.activeLogin).toBe("alice"));

    invokeMock.mockImplementation((cmd: string) =>
      cmd === "replace_active_token" ? Promise.resolve() : Promise.resolve(),
    );

    let outcome: Awaited<ReturnType<typeof result.current.replaceActiveToken>> | undefined;
    await act(async () => {
      outcome = await result.current.replaceActiveToken("alice", "ghp_rotated");
    });

    expect(outcome).toEqual({ ok: true });
    expect(invokeMock).toHaveBeenCalledWith("replace_active_token", { expectedLogin: "alice", token: "ghp_rotated" });
    // No list_accounts re-fetch expected: same identity, roster unchanged.
  });

  it("replaceActiveToken refuses blank input without hitting Rust", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_accounts" ? Promise.resolve({ accounts: ["alice"], active: "alice" }) : Promise.resolve(),
    );
    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.activeLogin).toBe("alice"));
    invokeMock.mockClear();

    let outcome: Awaited<ReturnType<typeof result.current.replaceActiveToken>> | undefined;
    await act(async () => {
      outcome = await result.current.replaceActiveToken("alice", "   ");
    });

    expect(outcome?.ok).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reacts to a tray-driven account-switched event by re-fetching the account list", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_accounts"
        ? Promise.resolve({ accounts: ["alice", "bob"], active: "alice" })
        : Promise.resolve(),
    );

    let capturedCallback: ((event: { payload: string }) => void) | undefined;
    listenMock.mockImplementation((_event: string, callback: (event: { payload: string }) => void) => {
      capturedCallback = callback;
      return Promise.resolve(vi.fn());
    });

    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.activeLogin).toBe("alice"));
    await waitFor(() => expect(capturedCallback).toBeDefined());

    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_accounts"
        ? Promise.resolve({ accounts: ["alice", "bob"], active: "bob" })
        : Promise.resolve(),
    );

    act(() => {
      capturedCallback?.({ payload: "bob" });
    });

    await waitFor(() => expect(result.current.activeLogin).toBe("bob"));
  });
});
