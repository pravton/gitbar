import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type FilterSyncDoc,
  mergeSyncDocs,
  parseSyncDoc,
  serializeSyncDoc,
} from "@/lib/filterSync";

const SETTINGS_KEY = "gitbar.filters.sync";
/** How long after a local change to sync, so a burst of edits is one write. */
const PUSH_DEBOUNCE_MS = 5_000;
const PULL_INTERVAL_MS = 10 * 60_000;

/** Stored only while sync is on. Non-secret: Rust holds the token. */
interface SyncSettings {
  /** Fixed at enable time. Switching accounts doesn't move the sync. */
  login: string;
  gistId: string;
}

export type FilterSyncStatus =
  | { kind: "idle"; lastSyncedAt: number | null }
  | { kind: "syncing"; lastSyncedAt: number | null }
  | { kind: "error"; message: string; lastSyncedAt: number | null };

export interface UseFilterSyncResult {
  /** Account sync is bound to; `null` when sync is off. */
  syncLogin: string | null;
  status: FilterSyncStatus;
  enable: () => Promise<void>;
  /** Stops syncing. Leaves the gist on GitHub so re-enabling finds it. */
  disable: () => void;
  syncNow: () => void;
}

/**
 * Opt-in filter sync through a secret gist. Syncs on launch, on enable,
 * 5s after a local change, and every 10 minutes. Every cycle pulls and
 * merges before it writes, so a machine can't overwrite changes it hasn't
 * seen. Failures only reach the status line in Settings: nothing here
 * touches the PR list's loading or error state.
 */
export function useFilterSync(
  doc: FilterSyncDoc,
  applyDoc: (doc: FilterSyncDoc) => void,
  accounts: string[],
  /** Whether `accounts` has loaded; before that, empty means unknown. */
  accountsReady: boolean,
): UseFilterSyncResult {
  const [settings, setSettings] = useState<SyncSettings | null>(readSettings);
  const [status, setStatus] = useState<FilterSyncStatus>({ kind: "idle", lastSyncedAt: null });

  const docRef = useRef(doc);
  docRef.current = doc;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const applyDocRef = useRef(applyDoc);
  applyDocRef.current = applyDoc;
  /** Serialized state both sides were last known to agree on. */
  const lastSyncedRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const rerunRef = useRef(false);

  const updateSettings = useCallback((next: SyncSettings | null) => {
    settingsRef.current = next;
    writeSettings(next);
    setSettings(next);
  }, []);

  const sync = useCallback(async () => {
    const target = settingsRef.current;
    if (!target) return;
    if (runningRef.current) {
      rerunRef.current = true;
      return;
    }
    runningRef.current = true;
    setStatus((prev) => ({ kind: "syncing", lastSyncedAt: prev.lastSyncedAt }));
    const args = { login: target.login, gistId: target.gistId };
    try {
      const raw = await invoke<string | null>("gist_sync_pull", args);
      if (settingsRef.current?.gistId !== target.gistId) return;
      const remote = raw === null ? null : parseSyncDoc(raw);
      // Read local state now, not before the await, to keep any edit made
      // while the pull was in flight.
      const local = docRef.current;
      const merged = remote ? mergeSyncDocs(local, remote, Date.now()) : local;
      const mergedJson = serializeSyncDoc(merged);
      if (mergedJson !== serializeSyncDoc(local)) applyDocRef.current(merged);
      if (remote === null || mergedJson !== serializeSyncDoc(remote)) {
        await invoke("gist_sync_push", { ...args, payload: mergedJson });
      }
      lastSyncedRef.current = mergedJson;
      setStatus({ kind: "idle", lastSyncedAt: Date.now() });
    } catch (err) {
      setStatus((prev) => ({
        kind: "error",
        message: errorMessage(err),
        lastSyncedAt: prev.lastSyncedAt,
      }));
    } finally {
      runningRef.current = false;
      if (rerunRef.current) {
        rerunRef.current = false;
        void sync();
      }
    }
  }, []);

  const enable = useCallback(async () => {
    setStatus((prev) => ({ kind: "syncing", lastSyncedAt: prev.lastSyncedAt }));
    try {
      const target = await invoke<{ login: string; gist_id: string }>("gist_sync_enable", {
        initialPayload: serializeSyncDoc(docRef.current),
      });
      setStatus((prev) => ({ kind: "idle", lastSyncedAt: prev.lastSyncedAt }));
      // The effect below runs the first sync once this lands.
      updateSettings({ login: target.login, gistId: target.gist_id });
    } catch (err) {
      setStatus((prev) => ({
        kind: "error",
        message: errorMessage(err),
        lastSyncedAt: prev.lastSyncedAt,
      }));
    }
  }, [updateSettings]);

  const disable = useCallback(() => {
    lastSyncedRef.current = null;
    updateSettings(null);
    setStatus({ kind: "idle", lastSyncedAt: null });
  }, [updateSettings]);

  const syncNow = useCallback(() => void sync(), [sync]);

  // Launch, enable, and the 10-minute pull.
  const gistId = settings?.gistId ?? null;
  useEffect(() => {
    if (!gistId) return;
    void sync();
    const id = window.setInterval(() => void sync(), PULL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [gistId, sync]);

  // Debounced push after a local change. Checked when the timer fires, so
  // a change that came from applying a merge doesn't start another cycle.
  const serialized = serializeSyncDoc(doc);
  useEffect(() => {
    if (!gistId || serialized === lastSyncedRef.current) return;
    const id = window.setTimeout(() => {
      if (serializeSyncDoc(docRef.current) !== lastSyncedRef.current) void sync();
    }, PUSH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [gistId, serialized, sync]);

  // The sync account was removed, so its token is gone.
  const syncLogin = settings?.login ?? null;
  useEffect(() => {
    if (syncLogin && accountsReady && !accounts.includes(syncLogin)) {
      lastSyncedRef.current = null;
      updateSettings(null);
      setStatus({
        kind: "error",
        message: `Filter sync turned off: @${syncLogin} was removed.`,
        lastSyncedAt: null,
      });
    }
  }, [syncLogin, accounts, accountsReady, updateSettings]);

  return { syncLogin, status, enable, disable, syncNow };
}

function readSettings(): SyncSettings | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<SyncSettings> | null;
    return typeof parsed?.login === "string" && typeof parsed.gistId === "string"
      ? { login: parsed.login, gistId: parsed.gistId }
      : null;
  } catch {
    return null;
  }
}

function writeSettings(settings: SyncSettings | null): void {
  try {
    if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    else localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // Storage blocked: sync just stays on for this session only.
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Filter sync failed.";
}
