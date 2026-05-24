import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDensityMode } from "@/hooks/useDensityMode";

// Match the pattern used in useFilters.test.tsx: jsdom in vitest 4
// has a flaky localStorage facade; install a deterministic in-memory
// one so the hook always sees a working backing store.
beforeEach(() => {
  let store: Record<string, string> = {};
  const fake: Storage = {
    get length() {
      return Object.keys(store).length;
    },
    clear: () => {
      store = {};
    },
    getItem: (k: string) => (k in store ? store[k] : null),
    key: (i: number) => Object.keys(store)[i] ?? null,
    removeItem: (k: string) => {
      delete store[k];
    },
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
  };
  vi.stubGlobal("localStorage", fake);
});

describe("useDensityMode", () => {
  it("defaults to 'comfortable' when localStorage is empty", () => {
    const { result } = renderHook(() => useDensityMode());
    expect(result.current.density).toBe("comfortable");
  });

  it("hydrates from a valid stored value", () => {
    localStorage.setItem("gitbar.density", "compact");
    const { result } = renderHook(() => useDensityMode());
    expect(result.current.density).toBe("compact");
  });

  it("falls back to 'comfortable' for an invalid stored value", () => {
    localStorage.setItem("gitbar.density", "spacious");
    const { result } = renderHook(() => useDensityMode());
    expect(result.current.density).toBe("comfortable");
  });

  it("falls back when the stored value is not a string at all", () => {
    // Direct stub-bypass to simulate corrupted storage. The raw value
    // here is an object literal serialized to "[object Object]",
    // which doesn't match either density literal.
    localStorage.setItem("gitbar.density", "{}");
    const { result } = renderHook(() => useDensityMode());
    expect(result.current.density).toBe("comfortable");
  });

  it("setDensity updates state and persists the new value", () => {
    const { result } = renderHook(() => useDensityMode());
    act(() => {
      result.current.setDensity("compact");
    });
    expect(result.current.density).toBe("compact");
    expect(localStorage.getItem("gitbar.density")).toBe("compact");
  });

  it("toggle flips comfortable -> compact -> comfortable", () => {
    const { result } = renderHook(() => useDensityMode());
    expect(result.current.density).toBe("comfortable");

    act(() => {
      result.current.toggle();
    });
    expect(result.current.density).toBe("compact");
    expect(localStorage.getItem("gitbar.density")).toBe("compact");

    act(() => {
      result.current.toggle();
    });
    expect(result.current.density).toBe("comfortable");
    expect(localStorage.getItem("gitbar.density")).toBe("comfortable");
  });

  it("setDensity is callable repeatedly with the same value (idempotent)", () => {
    const { result } = renderHook(() => useDensityMode());
    act(() => {
      result.current.setDensity("compact");
      result.current.setDensity("compact");
    });
    expect(result.current.density).toBe("compact");
  });

  it("survives a swallow when localStorage.setItem throws", () => {
    // Simulate a quota-exceeded or disabled-storage environment.
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() => useDensityMode());
    // State still flips even if persistence fails (the writeDensity
    // helper swallows the error). The user's preference at runtime
    // works; only next-launch restoration is broken.
    act(() => {
      result.current.setDensity("compact");
    });
    expect(result.current.density).toBe("compact");
    setItemSpy.mockRestore();
  });
});
