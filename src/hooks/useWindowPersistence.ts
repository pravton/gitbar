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
