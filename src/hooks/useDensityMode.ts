import { useCallback, useState } from "react";

export type Density = "comfortable" | "compact";

const STORAGE_KEY = "gitbar.density";
const DEFAULT_DENSITY: Density = "comfortable";

function readDensity(): Density {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "comfortable" || raw === "compact") {
      return raw;
    }
  } catch {
    // localStorage unavailable; fall through
  }
  return DEFAULT_DENSITY;
}

function writeDensity(value: Density): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // storage full or unavailable; non-fatal
  }
}

/**
 * Card density preference for the PR/Issue list.
 *
 * - `comfortable` (default): the full ~4-line card; CI pill, deploy
 *   link, additions/deletions, etc. Best for low-volume lists where
 *   the user wants to see everything at a glance.
 * - `compact`: single-line card; status dot, repo + number, title,
 *   time. Best for high-volume lists where you'd rather fit more
 *   rows per screen than per-row detail.
 *
 * Persisted to localStorage so the choice survives launches. The
 * `toggle` callback flips between the two modes; consumers that
 * want to set a specific mode can use `setDensity` directly.
 */
export interface UseDensityModeResult {
  density: Density;
  setDensity: (value: Density) => void;
  toggle: () => void;
}

export function useDensityMode(): UseDensityModeResult {
  const [density, setDensityState] = useState<Density>(() => readDensity());

  const setDensity = useCallback((value: Density) => {
    setDensityState(value);
    writeDensity(value);
  }, []);

  const toggle = useCallback(() => {
    setDensityState((prev) => {
      const next: Density = prev === "comfortable" ? "compact" : "comfortable";
      writeDensity(next);
      return next;
    });
  }, []);

  return { density, setDensity, toggle };
}
