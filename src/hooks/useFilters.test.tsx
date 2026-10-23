import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFilters } from "@/hooks/useFilters";
import { EMPTY_FILTERS } from "@/lib/filters";

// jsdom in vitest 4 has a flaky localStorage facade; install a minimal in-memory
// one so the hook reliably hits a working backing store.
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

describe("useFilters", () => {
  it("starts from EMPTY_FILTERS when localStorage is empty", () => {
    const { result } = renderHook(() => useFilters());
    expect(result.current.filters).toEqual(EMPTY_FILTERS);
    expect(result.current.presets).toEqual([]);
  });

  it("persists filter changes to localStorage", () => {
    const { result } = renderHook(() => useFilters());
    act(() => {
      result.current.setFilters({ ...EMPTY_FILTERS, draft: "drafts" });
    });
    const raw = localStorage.getItem("gitbar.filters.current");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).draft).toBe("drafts");
  });

  it("re-hydrates filters from localStorage on mount", () => {
    localStorage.setItem(
      "gitbar.filters.current",
      JSON.stringify({ ...EMPTY_FILTERS, orgs: ["acme"] }),
    );
    const { result } = renderHook(() => useFilters());
    expect(result.current.filters.orgs).toEqual(["acme"]);
  });

  it("hydrates a v0.1-shape blob (missing `repos`) without crashing", () => {
    // Simulates an upgrade from a version that didn't have repo
    // allowlist support. Without normalizeFilters, the next call to
    // applyFilters would blow up on `f.repos.length`.
    localStorage.setItem(
      "gitbar.filters.current",
      JSON.stringify({
        draft: "drafts",
        orgs: ["acme"],
        ciStatus: ["failure"],
        reviewRequestedOnly: true,
      }),
    );
    const { result } = renderHook(() => useFilters());
    expect(result.current.filters.repos).toEqual([]);
    expect(result.current.filters.draft).toBe("drafts");
  });

  it("hydrates a legacy preset with a missing `repos` filter", () => {
    localStorage.setItem(
      "gitbar.filters.presets",
      JSON.stringify([
        {
          id: "p1",
          name: "Old",
          filters: { draft: "all", orgs: ["acme"], ciStatus: [], reviewRequestedOnly: false },
        },
      ]),
    );
    const { result } = renderHook(() => useFilters());
    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].filters.repos).toEqual([]);
  });

  it("saves a preset and persists it", () => {
    const { result } = renderHook(() => useFilters());
    act(() => {
      result.current.setFilters({ ...EMPTY_FILTERS, ciStatus: ["failure"] });
    });
    act(() => {
      result.current.savePreset("Red queue");
    });
    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].name).toBe("Red queue");
    expect(result.current.presets[0].filters.ciStatus).toEqual(["failure"]);
    const stored = JSON.parse(localStorage.getItem("gitbar.filters.presets")!);
    expect(stored).toHaveLength(1);
  });

  it("refuses to save a preset with a blank name", () => {
    const { result } = renderHook(() => useFilters());
    let saved;
    act(() => {
      saved = result.current.savePreset("   ");
    });
    expect(saved).toBeNull();
    expect(result.current.presets).toEqual([]);
  });

  it("applies a preset and replaces current filters", () => {
    const { result } = renderHook(() => useFilters());
    // Each act() commit re-renders so the next callback sees the new state.
    act(() => {
      result.current.setFilters({ ...EMPTY_FILTERS, draft: "drafts" });
    });
    act(() => {
      result.current.savePreset("Drafts");
    });
    act(() => {
      result.current.resetFilters();
    });
    const id = result.current.presets[0].id;
    act(() => {
      result.current.applyPreset(id);
    });
    expect(result.current.filters.draft).toBe("drafts");
  });

  it("deletes presets by id", () => {
    const { result } = renderHook(() => useFilters());
    act(() => {
      result.current.savePreset("A");
    });
    act(() => {
      result.current.savePreset("B");
    });
    const ids = result.current.presets.map((p) => p.id);
    act(() => {
      result.current.deletePreset(ids[0]);
    });
    expect(result.current.presets.map((p) => p.name)).toEqual(["B"]);
  });

  it("resetFilters returns to EMPTY_FILTERS", () => {
    const { result } = renderHook(() => useFilters());
    act(() => {
      result.current.setFilters({
        draft: "drafts",
        orgs: ["acme"],
        repos: [],
        ciStatus: ["failure"],
        reviewRequestedOnly: true,
      });
      result.current.resetFilters();
    });
    expect(result.current.filters).toEqual(EMPTY_FILTERS);
  });
});
