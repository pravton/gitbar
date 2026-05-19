import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useGitHubAuth } from "@/hooks/useGitHubAuth";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

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
});

describe("useGitHubAuth", () => {
  it("starts unauthenticated and reports `ready` only after the mount-time check resolves", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "has_token") return Promise.resolve(false);
      return Promise.resolve();
    });

    const { result } = renderHook(() => useGitHubAuth());

    // Synchronously after mount, ready is still false.
    expect(result.current.ready).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("reports authenticated when has_token returns true", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "has_token" ? Promise.resolve(true) : Promise.resolve(),
    );

    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
  });

  it("migrates a legacy localStorage token into Rust on mount", async () => {
    localStorage.setItem("gitbar.githubToken", "ghp_legacy");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "save_token") return Promise.resolve();
      if (cmd === "has_token") return Promise.resolve(true);
      return Promise.resolve();
    });

    renderHook(() => useGitHubAuth());

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("save_token", { token: "ghp_legacy" });
    });
    expect(localStorage.getItem("gitbar.githubToken")).toBeNull();
  });

  it("does not migrate when save_token fails (keeps legacy so user can retry)", async () => {
    localStorage.setItem("gitbar.githubToken", "ghp_legacy");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "save_token") return Promise.reject(new Error("keychain unavailable"));
      if (cmd === "has_token") return Promise.resolve(false);
      return Promise.resolve();
    });

    renderHook(() => useGitHubAuth());

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("has_token"));
    expect(localStorage.getItem("gitbar.githubToken")).toBe("ghp_legacy");
  });

  it("checkToken validates via check_auth then persists via save_token", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "has_token") return Promise.resolve(false);
      if (cmd === "check_auth") return Promise.resolve({ ok: true, login: "alice", message: null });
      if (cmd === "save_token") return Promise.resolve();
      return Promise.resolve();
    });

    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));

    let outcome: Awaited<ReturnType<typeof result.current.checkToken>> | undefined;
    await act(async () => {
      outcome = await result.current.checkToken("ghp_new");
    });

    expect(outcome).toEqual({ ok: true });
    expect(invokeMock).toHaveBeenCalledWith("check_auth", { token: "ghp_new" });
    expect(invokeMock).toHaveBeenCalledWith("save_token", { token: "ghp_new" });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("checkToken does NOT save when check_auth rejects the token", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "has_token") return Promise.resolve(false);
      if (cmd === "check_auth")
        return Promise.resolve({ ok: false, login: null, message: "Bad credentials" });
      return Promise.resolve();
    });

    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));

    let outcome: Awaited<ReturnType<typeof result.current.checkToken>> | undefined;
    await act(async () => {
      outcome = await result.current.checkToken("ghp_bad");
    });

    expect(outcome).toEqual({ ok: false, error: "Bad credentials" });
    expect(result.current.authError).toBe("Bad credentials");
    expect(result.current.isAuthenticated).toBe(false);
    expect(invokeMock).not.toHaveBeenCalledWith("save_token", expect.anything());
  });

  it("checkToken refuses blank input without hitting Rust", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "has_token" ? Promise.resolve(false) : Promise.resolve(),
    );
    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));
    invokeMock.mockClear();

    let outcome: Awaited<ReturnType<typeof result.current.checkToken>> | undefined;
    await act(async () => {
      outcome = await result.current.checkToken("   ");
    });

    expect(outcome?.ok).toBe(false);
    if (outcome && !outcome.ok) {
      expect(outcome.error).toMatch(/paste a GitHub token/);
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("clearToken calls Rust clear_token and flips isAuthenticated false on success", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "has_token") return Promise.resolve(true);
      if (cmd === "clear_token") return Promise.resolve();
      return Promise.resolve();
    });

    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.clearToken();
    });

    expect(invokeMock).toHaveBeenCalledWith("clear_token");
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("clearToken does NOT flip isAuthenticated when clear_token fails; reconciles via has_token", async () => {
    let hasTokenCalls = 0;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "has_token") {
        hasTokenCalls++;
        // First call (mount) → true. Second call (reconcile after failure) → still true.
        return Promise.resolve(true);
      }
      if (cmd === "clear_token") return Promise.reject(new Error("keychain locked"));
      return Promise.resolve();
    });

    const { result } = renderHook(() => useGitHubAuth());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    let outcome: Awaited<ReturnType<typeof result.current.clearToken>> | undefined;
    await act(async () => {
      outcome = await result.current.clearToken();
    });

    expect(outcome).toEqual({ ok: false, error: "keychain locked" });
    expect(result.current.authError).toMatch(/Failed to disconnect/);
    // isAuthenticated must NOT flip false — token still in keychain.
    expect(result.current.isAuthenticated).toBe(true);
    // has_token was called twice: once on mount, once for the post-failure reconcile.
    expect(hasTokenCalls).toBeGreaterThanOrEqual(2);
  });
});
