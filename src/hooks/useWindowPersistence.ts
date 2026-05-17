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
  const raw = localStorage.getItem(WINDOW_KEY);
  if (!raw) {
    return null;
  }

  try {
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
    return null;
  }

  return null;
}

function writeWindowState(state: WindowState) {
  localStorage.setItem(WINDOW_KEY, JSON.stringify(state));
}

export function useWindowPersistence() {
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;

    const restore = async () => {
      const saved = readWindowState();
      if (!saved) {
        return;
      }

      await appWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
      await appWindow.setSize(new PhysicalSize(saved.width, saved.height));
    };

    const persist = async () => {
      const [position, size] = await Promise.all([appWindow.outerPosition(), appWindow.outerSize()]);
      writeWindowState({
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      });
    };

    void restore();

    const unsubscribers = Promise.all([appWindow.onMoved(persist), appWindow.onResized(persist)]);

    return () => {
      disposed = true;
      void unsubscribers.then((items) => {
        if (disposed) {
          items.forEach((unsubscribe) => unsubscribe());
        }
      });
    };
  }, []);
}
