import { useEffect } from "react";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

const WINDOW_KEY = "gitbar.windowState";

// Sanity bounds, in PHYSICAL pixels (matching the units we save).
// A panel outside these is almost certainly corrupted state from a
// runaway resize event (the macOS title-bar zoom incident is one
// known cause). Pre-flight checking here keeps a bad persisted
// value from rendering the window invisible / off-screen on the
// next launch.
const MIN_PHYSICAL_DIM = 60;
// Caps a 5K external display (5120 px wide). Anything beyond this
// in either dimension is corruption, not legitimate window state.
const MAX_PHYSICAL_DIM = 6000;
// Position can be slightly negative (window straddling two monitors,
// top-edge under the menu bar by a few pixels), but values beyond
// these are off the visible desktop on any plausible setup.
const MIN_POSITION = -3000;
const MAX_POSITION = 10000;

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isReasonable(state: WindowState): boolean {
  if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) return false;
  if (!Number.isFinite(state.width) || !Number.isFinite(state.height)) return false;
  if (state.width < MIN_PHYSICAL_DIM || state.width > MAX_PHYSICAL_DIM) return false;
  if (state.height < MIN_PHYSICAL_DIM || state.height > MAX_PHYSICAL_DIM) return false;
  if (state.x < MIN_POSITION || state.x > MAX_POSITION) return false;
  if (state.y < MIN_POSITION || state.y > MAX_POSITION) return false;
  return true;
}

function readWindowState(): WindowState | null {
  try {
    const raw = localStorage.getItem(WINDOW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    if (
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      typeof parsed.width === "number" &&
      typeof parsed.height === "number"
    ) {
      const state = parsed as WindowState;
      if (!isReasonable(state)) {
        // Drop the corrupted entry so the next legitimate save
        // doesn't get layered on top of bad data.
        try {
          localStorage.removeItem(WINDOW_KEY);
        } catch {
          // non-fatal
        }
        return null;
      }
      return state;
    }
  } catch {
    // corrupted data
  }
  return null;
}

function writeWindowState(state: WindowState) {
  try {
    localStorage.setItem(WINDOW_KEY, JSON.stringify(state));
  } catch {
    // storage full or unavailable
  }
}

export function useWindowPersistence() {
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let movedCleanup: (() => void) | undefined;
    let resizedCleanup: (() => void) | undefined;
    let disposed = false;

    const initTimer = window.setTimeout(async () => {
      // Restore last known position/size
      const saved = readWindowState();
      if (saved) {
        try {
          await appWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
          await new Promise((r) => setTimeout(r, 50));
          await appWindow.setSize(new PhysicalSize(saved.width, saved.height));
        } catch {
          // window not ready, ignore
        }
      }

      if (disposed) return;

      // Persist on move/resize
      const persist = async () => {
        if (disposed) return;
        try {
          const position = await appWindow.outerPosition();
          const size = await appWindow.outerSize();
          if (!position || !size) return;
          writeWindowState({
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
          });
        } catch {
          // API unavailable
        }
      };

      try {
        movedCleanup = await appWindow.onMoved(persist);
        resizedCleanup = await appWindow.onResized(persist);
      } catch {
        // can't register listeners
      }
    }, 150);

    return () => {
      disposed = true;
      clearTimeout(initTimer);
      movedCleanup?.();
      resizedCleanup?.();
    };
  }, []);
}
