import { useEffect } from "react";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

const WINDOW_KEY = "gitbar.windowState";

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
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
  } catch {
    // storage full or unavailable
  }
}

export function useWindowPersistence() {
  useEffect(() => {
    const appWindow = getCurrentWindow();

    // Delay: let the Tauri window fully initialize before touching APIs
    const initTimer = window.setTimeout(async () => {
      // Restore saved position
      const saved = readWindowState();
      if (saved) {
        try {
          await appWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
          // Only restore size after position settles
          await new Promise((r) => setTimeout(r, 50));
          await appWindow.setSize(new PhysicalSize(saved.width, saved.height));
        } catch {
          // window not ready yet, ignore
        }
      }

      // Persist on move/resize
      let disposed = false;

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
      setCleanup(() => {
        disposed = true;
        movedUnlisten?.();
        resizedUnlisten?.();
      });
    }, 150);

    let setCleanup: (fn: () => void) => void = () => {};

    return () => {
      clearTimeout(initTimer);
      // setCleanup is called by the init when listeners are registered
    };
  }, []);
}
