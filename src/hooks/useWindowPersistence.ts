import { useEffect } from "react";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

const WINDOW_KEY = "gitbar.windowState";
export const WINDOW_WIDTH_KEY = "gitbar-window-width";
export const WINDOW_HEIGHT_KEY = "gitbar-window-height";
const COMPACT_KEY = "gitbar-window-compact";

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isCompact?: boolean;
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
      return parsed as WindowState;
    }
  } catch {
    // corrupted localStorage entry
  }
  return null;
}

function writeWindowState(state: WindowState) {
  try {
    localStorage.setItem(WINDOW_KEY, JSON.stringify(state));
    if (!state.isCompact) {
      localStorage.setItem(WINDOW_WIDTH_KEY, String(state.width));
      localStorage.setItem(WINDOW_HEIGHT_KEY, String(state.height));
    }
    localStorage.setItem(COMPACT_KEY, String(Boolean(state.isCompact)));
  } catch {
    // storage full or unavailable
  }
}

export function readInitialCompact(): boolean {
  try {
    const compact = localStorage.getItem(COMPACT_KEY);
    if (compact !== null) return compact === "true";

    return readWindowState()?.isCompact === true;
  } catch {
    return false;
  }
}

export function readExpandedSize(): { width: number; height: number } {
  const fallback = readWindowState();
  const fallbackWidth = fallback?.width ?? 400;
  const fallbackHeight = fallback?.height ?? 500;

  try {
    const width = Number(localStorage.getItem(WINDOW_WIDTH_KEY));
    const height = Number(localStorage.getItem(WINDOW_HEIGHT_KEY));

    return {
      width: Number.isFinite(width) && width >= 280 ? width : fallbackWidth,
      height: Number.isFinite(height) && height >= 320 ? height : fallbackHeight,
    };
  } catch {
    return { width: fallbackWidth, height: fallbackHeight };
  }
}

export function writeExpandedSize(width: number, height: number) {
  try {
    localStorage.setItem(WINDOW_WIDTH_KEY, String(Math.max(280, Math.round(width))));
    localStorage.setItem(WINDOW_HEIGHT_KEY, String(Math.max(320, Math.round(height))));
  } catch {
    // storage full or unavailable
  }
}

export function writeCompactState(isCompact: boolean) {
  try {
    localStorage.setItem(COMPACT_KEY, String(isCompact));
    const saved = readWindowState();
    if (saved) {
      localStorage.setItem(WINDOW_KEY, JSON.stringify({ ...saved, isCompact }));
    }
  } catch {
    // storage full or unavailable
  }
}

export function useWindowPersistence(isCompact: boolean) {
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cleanup: (() => void) | undefined;
    let disposed = false;

    // Delay: let the Tauri window fully initialize before touching APIs
    const initTimer = window.setTimeout(async () => {
      // Restore saved position
      const saved = readWindowState();
      if (saved) {
        try {
          await appWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
          // Only restore size after position settles
          await new Promise((r) => setTimeout(r, 50));
          const expandedSize = readExpandedSize();
          await appWindow.setSize(
            new PhysicalSize(
              isCompact ? expandedSize.width : saved.width,
              isCompact ? 56 : saved.height,
            ),
          );
        } catch {
          // window not ready yet, ignore
        }
      }

      // Persist on move/resize
      const persist = async () => {
        try {
          const position = await appWindow.outerPosition();
          const size = await appWindow.outerSize();
          if (!position || !size) return;

          writeWindowState({
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            isCompact,
          });
        } catch {
          // API not available in this environment
        }
      };

      let movedUnlisten: (() => void) | undefined;
      let resizedUnlisten: (() => void) | undefined;

      try {
        movedUnlisten = await appWindow.onMoved(persist);
        resizedUnlisten = await appWindow.onResized(persist);
      } catch {
        // listeners can't be registered, skip persistence
        return;
      }

      // Check we haven't been cleaned up while setting up
      if (disposed) {
        movedUnlisten?.();
        resizedUnlisten?.();
      }

      // Store unlisteners for cleanup
      cleanup = () => {
        disposed = true;
        movedUnlisten?.();
        resizedUnlisten?.();
      };
    }, 150);

    return () => {
      disposed = true;
      clearTimeout(initTimer);
      cleanup?.();
    };
  }, [isCompact]);
}
