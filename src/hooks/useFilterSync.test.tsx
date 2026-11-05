import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useFilterSync } from "@/hooks/useFilterSync";
import { buildSyncDoc, serializeSyncDoc, type FilterSyncDoc } from "@/lib/filterSync";
import { EMPTY_FILTERS, type FilterPreset } from "@/lib/filters";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const SETTINGS = "gitbar.filters.sync";

const preset = (id: string, at: number): FilterPreset => ({
  id,
  name: id,
  filters: EMPTY_FILTERS,
  updated_at: at,
});
const doc = (presets: FilterPreset[] = []) => buildSyncDoc(EMPTY_FILTERS, 0, presets, {});

/** A fake gist: pull returns `gist.content`, push replaces it. */
function mockGist(initial: FilterSyncDoc | null) {
  const gist = { content: initial && serializeSyncDoc(initial) };
  invokeMock.mockImplementation((cmd: string, args: { payload?: string }) => {
    if (cmd === "gist_sync_pull") return Promise.resolve(gist.content);
    if (cmd === "gist_sync_push") {
      gist.content = args.payload ?? null;
      return Promise.resolve();
    }
    if (cmd === "gist_sync_enable") return Promise.resolve({ login: "alice", gist_id: "g1" });
    return Promise.resolve();
  });
  return gist;
}

const calls = (cmd: string) => invokeMock.mock.calls.filter(([name]) => name === cmd);
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

interface HookProps {
  doc: FilterSyncDoc;
  accounts: string[];
  accountsReady?: boolean;
}

function setup(initial: FilterSyncDoc = doc(), accounts = ["alice"], accountsReady = true) {
  const applyDoc = vi.fn();
  const view = renderHook(
    (props: HookProps) =>
      useFilterSync(props.doc, applyDoc, props.accounts, props.accountsReady ?? true),
    { initialProps: { doc: initial, accounts, accountsReady } as HookProps },
  );
  return { ...view, applyDoc };
}

describe("useFilterSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    invokeMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("does nothing while off", async () => {
    const { result, rerender } = setup();
    await flush();
    rerender({ doc: doc([preset("a", 1)]), accounts: ["alice"] });
    await act(() => vi.advanceTimersByTimeAsync(20 * 60_000));
    expect(result.current.syncLogin).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("on enable, binds to the account and merges with the gist", async () => {
    const gist = mockGist(doc([preset("remote", 2)]));
    const { result, applyDoc } = setup(doc([preset("local", 1)]));
    await act(() => result.current.enable());
    await flush();

    expect(result.current.syncLogin).toBe("alice");
    expect(JSON.parse(localStorage.getItem(SETTINGS)!)).toEqual({ login: "alice", gistId: "g1" });
    const ids = (d: FilterSyncDoc) => d.presets.map((p) => p.id);
    expect(ids(applyDoc.mock.calls[0][0])).toEqual(["local", "remote"]);
    expect(ids(JSON.parse(gist.content!))).toEqual(["local", "remote"]);
    expect(result.current.status).toMatchObject({ kind: "idle" });
  });

  it("surfaces an enable failure and stays off", async () => {
    invokeMock.mockRejectedValue({ kind: "server", message: "needs the gist scope" });
    const { result } = setup();
    await act(() => result.current.enable());
    expect(result.current.syncLogin).toBeNull();
    expect(result.current.status).toMatchObject({ kind: "error", message: "needs the gist scope" });
  });

  it("syncs on launch using the stored account, not writing when already equal", async () => {
    localStorage.setItem(SETTINGS, JSON.stringify({ login: "alice", gistId: "g1" }));
    mockGist(doc());
    const { applyDoc } = setup();
    await flush();
    expect(invokeMock).toHaveBeenCalledWith("gist_sync_pull", { login: "alice", gistId: "g1" });
    expect(calls("gist_sync_push")).toHaveLength(0);
    expect(applyDoc).not.toHaveBeenCalled();
  });

  it("pushes 5s after a local change, once, pulling first", async () => {
    localStorage.setItem(SETTINGS, JSON.stringify({ login: "alice", gistId: "g1" }));
    const gist = mockGist(doc([preset("theirs", 1)]));
    const local = doc([preset("theirs", 1)]);
    const { rerender } = setup(local);
    await flush();
    invokeMock.mockClear();

    rerender({ doc: doc([preset("theirs", 1), preset("a", 2)]), accounts: ["alice"] });
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    rerender({ doc: doc([preset("theirs", 1), preset("a", 2), preset("b", 3)]), accounts: ["alice"] });
    await act(() => vi.advanceTimersByTimeAsync(4_999));
    expect(invokeMock).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(invokeMock.mock.calls.map(([name]) => name)).toEqual([
      "gist_sync_pull",
      "gist_sync_push",
    ]);
    expect(JSON.parse(gist.content!).presets).toHaveLength(3);
  });

  it("doesn't start another cycle after applying a merge", async () => {
    localStorage.setItem(SETTINGS, JSON.stringify({ login: "alice", gistId: "g1" }));
    const remote = doc([preset("theirs", 1)]);
    mockGist(remote);
    const { rerender, applyDoc } = setup(doc());
    await flush();
    expect(applyDoc).toHaveBeenCalledTimes(1);
    invokeMock.mockClear();

    // useFilters applies the merge, so the doc prop comes back changed.
    rerender({ doc: applyDoc.mock.calls[0][0], accounts: ["alice"] });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("pulls every 10 minutes", async () => {
    localStorage.setItem(SETTINGS, JSON.stringify({ login: "alice", gistId: "g1" }));
    mockGist(doc());
    setup();
    await flush();
    invokeMock.mockClear();
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(calls("gist_sync_pull")).toHaveLength(1);
  });

  it("never writes over a gist it can't read", async () => {
    localStorage.setItem(SETTINGS, JSON.stringify({ login: "alice", gistId: "g1" }));
    const gist = { content: '{"version":2,"future":true}' };
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "gist_sync_pull" ? Promise.resolve(gist.content) : Promise.resolve(),
    );
    const { result, applyDoc } = setup(doc([preset("a", 1)]));
    await flush();
    expect(result.current.status).toMatchObject({ kind: "error" });
    expect(calls("gist_sync_push")).toHaveLength(0);
    expect(applyDoc).not.toHaveBeenCalled();
  });

  it("recreates the file when the gist has lost it", async () => {
    localStorage.setItem(SETTINGS, JSON.stringify({ login: "alice", gistId: "g1" }));
    const gist = mockGist(null);
    setup(doc([preset("a", 1)]));
    await flush();
    expect(JSON.parse(gist.content!).presets).toHaveLength(1);
  });

  it("keeps an edit made while the pull was in flight", async () => {
    localStorage.setItem(SETTINGS, JSON.stringify({ login: "alice", gistId: "g1" }));
    let resolvePull!: (raw: string) => void;
    let pushed: string | undefined;
    invokeMock.mockImplementation((cmd: string, args: { payload?: string }) => {
      if (cmd === "gist_sync_pull") {
        return new Promise((resolve) => {
          resolvePull = resolve;
        });
      }
      pushed = args.payload;
      return Promise.resolve();
    });
    const { rerender } = setup(doc());
    await flush();
    rerender({ doc: doc([preset("edit", 5)]), accounts: ["alice"] });
    await act(async () => {
      resolvePull(serializeSyncDoc(doc()));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(JSON.parse(pushed!).presets.map((p: FilterPreset) => p.id)).toEqual(["edit"]);
  });

  it("disable stops syncing and forgets the target", async () => {
    localStorage.setItem(SETTINGS, JSON.stringify({ login: "alice", gistId: "g1" }));
    mockGist(doc());
    const { result } = setup();
    await flush();
    invokeMock.mockClear();
    act(() => result.current.disable());
    await act(() => vi.advanceTimersByTimeAsync(20 * 60_000));
    expect(invokeMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(SETTINGS)).toBeNull();
  });

  it("keeps syncing to the bound account when another account is active", async () => {
    localStorage.setItem(SETTINGS, JSON.stringify({ login: "alice", gistId: "g1" }));
    mockGist(doc());
    setup(doc(), ["alice", "bob"]);
    await flush();
    expect(invokeMock).toHaveBeenCalledWith("gist_sync_pull", { login: "alice", gistId: "g1" });
  });

  it("turns off when the sync account was the last one removed", async () => {
    localStorage.setItem(SETTINGS, JSON.stringify({ login: "alice", gistId: "g1" }));
    mockGist(doc());
    const { result, rerender } = setup();
    await flush();
    invokeMock.mockClear();

    rerender({ doc: doc(), accounts: [] });
    await flush();
    expect(result.current.syncLogin).toBeNull();
    expect(localStorage.getItem(SETTINGS)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(20 * 60_000));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("turns off when the sync account is removed, but not before the roster loads", async () => {
    localStorage.setItem(SETTINGS, JSON.stringify({ login: "alice", gistId: "g1" }));
    mockGist(doc());
    const { result, rerender } = setup(doc(), [], false);
    await flush();
    expect(result.current.syncLogin).toBe("alice");

    rerender({ doc: doc(), accounts: ["bob"], accountsReady: true });
    await flush();
    expect(result.current.syncLogin).toBeNull();
    expect(result.current.status).toMatchObject({ kind: "error", message: expect.stringContaining("@alice") });
    expect(localStorage.getItem(SETTINGS)).toBeNull();
  });
});
