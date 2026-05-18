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
