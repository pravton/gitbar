import { useEffect } from "react";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";

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
          // Skip position restore if the saved coords aren't on any
          // currently-attached monitor. Common cause: user docked
          // GitBar on an external display, then quit / unplugged.
          // On next launch with only the laptop screen attached, the
          // saved x/y points into nowhere and the window opens
          // off-screen (invisible to the user). Falling back to the
          // OS default position is much better than a ghost window.
          let restorePosition = true;
          try {
            const monitors = await availableMonitors();
            const inset = 40; // px of overlap required to call it "visible"
            const visible = monitors.some((m) => {
              const left = m.position.x;
              const top = m.position.y;
              const right = left + m.size.width;
              const bottom = top + m.size.height;
              return (
                saved.x + saved.width > left + inset &&
                saved.x < right - inset &&
                saved.y + saved.height > top + inset &&
                saved.y < bottom - inset
              );
            });
            if (!visible) {
              restorePosition = false;
              // Forget the bad position so subsequent launches don't
              // keep hitting this same fallback path.
              try {
                localStorage.removeItem(WINDOW_KEY);
              } catch {
                // non-fatal
              }
            }
          } catch {
            // availableMonitors unavailable in this environment;
            // fall through and trust the saved position.
          }

          if (restorePosition) {
            await appWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
            await new Promise((r) => setTimeout(r, 50));
          }
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
