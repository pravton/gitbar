import { useCallback, useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterPhase = "idle" | "checking" | "available" | "installing" | "error";

export interface UseAutoUpdaterResult {
  phase: UpdaterPhase;
  /** Version string of the pending update, populated when phase === "available". */
  version: string | null;
  /** Last error surfaced from check() or downloadAndInstall(). */
  error: string | null;
  /**
   * Trigger the download + install + relaunch sequence. Safe to call only
   * when phase === "available"; otherwise a no-op.
   */
  install: () => Promise<void>;
}

/**
 * Wraps `@tauri-apps/plugin-updater` for the rendering layer.
 *
 * Runs `check()` once on mount. Auto-update is non-critical (failure
 * just means "user keeps running this build"), so we swallow errors
 * into `phase = "error"` rather than throwing. The banner stays
 * hidden, the rest of the app continues working. The endpoint URL
 * and signing pubkey are configured in `tauri.conf.json`; Rust does
 * the actual HTTPS fetch.
 *
 * `install()` runs only after `check()` has surfaced an update,
 * because the underlying `Update` handle is held in module state.
 */
export function useAutoUpdater(): UseAutoUpdaterResult {
  const [phase, setPhase] = useState<UpdaterPhase>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase("checking");
    setError(null);

    (async () => {
      try {
        const result = await check();
        if (cancelled) return;
        if (result) {
          setUpdate(result);
          setVersion(result.version);
          setPhase("available");
        } else {
          setPhase("idle");
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(async () => {
    if (!update) return;
    setPhase("installing");
    setError(null);
    try {
      await update.downloadAndInstall();
      // relaunch swaps the process; it never resolves on success, but we
      // keep the phase set so a synchronous-throwing path still surfaces.
      await relaunch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [update]);

  return { phase, version, error, install };
}
