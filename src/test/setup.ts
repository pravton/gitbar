import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  if (typeof window !== "undefined" && typeof window.localStorage?.clear === "function") {
    window.localStorage.clear();
  }
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => {
  const noop = vi.fn();
  const offFn = vi.fn();
  const windowApi = {
    setSize: vi.fn().mockResolvedValue(undefined),
    setPosition: vi.fn().mockResolvedValue(undefined),
    outerSize: vi.fn().mockResolvedValue({ width: 400, height: 500 }),
    outerPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
    onMoved: vi.fn().mockResolvedValue(offFn),
    onResized: vi.fn().mockResolvedValue(offFn),
    minimize: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
    setFocus: vi.fn().mockResolvedValue(undefined),
    set_always_on_top: noop,
  };
  return {
    getCurrentWindow: vi.fn(() => windowApi),
  };
});

vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalSize: class {
    constructor(public width: number, public height: number) {}
  },
  PhysicalPosition: class {
    constructor(public x: number, public y: number) {}
  },
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  sendNotification: vi.fn(),
}));

// Default: no update available. Individual tests override with
// mockResolvedValueOnce({...}) to simulate one.
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
  exit: vi.fn().mockResolvedValue(undefined),
}));

// jsdom doesn't implement scrollIntoView; the keyboard-nav effect calls it
// whenever selection changes. Stub it to no-op so tests don't throw.
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}
