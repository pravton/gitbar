import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EMPTY_FILTERS,
  type FilterPreset,
  type PRFilters,
  newPresetId,
  normalizeFilters,
} from "@/lib/filters";

const CURRENT_KEY = "gitbar.filters.current";
const PRESETS_KEY = "gitbar.filters.presets";

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable — accept the loss
  }
}

export interface UseFiltersResult {
  filters: PRFilters;
  setFilters: (next: PRFilters) => void;
  resetFilters: () => void;
  presets: FilterPreset[];
  savePreset: (name: string) => FilterPreset | null;
  applyPreset: (id: string) => void;
  deletePreset: (id: string) => void;
}

export function useFilters(): UseFiltersResult {
  const [filters, setFiltersState] = useState<PRFilters>(() =>
    // normalizeFilters defends against the v0.1/v0.2 shape that didn't
    // include `repos`, and against any other corruption a hand-edited
    // localStorage might introduce. The next write upgrades the blob.
    normalizeFilters(readJSON<unknown>(CURRENT_KEY, EMPTY_FILTERS)),
  );
  const [presets, setPresetsState] = useState<FilterPreset[]>(() => {
    const raw = readJSON<unknown[]>(PRESETS_KEY, []);
    if (!Array.isArray(raw)) return [];
    // Same migration applies to preset filter blobs, otherwise an
    // existing preset from v0.1 would apply with `repos: undefined` and
    // blow up in applyFilters.
    return raw.flatMap((entry): FilterPreset[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const obj = entry as Partial<FilterPreset>;
      if (typeof obj.id !== "string" || typeof obj.name !== "string") return [];
      return [{ id: obj.id, name: obj.name, filters: normalizeFilters(obj.filters) }];
    });
  });

  useEffect(() => {
    writeJSON(CURRENT_KEY, filters);
  }, [filters]);

  useEffect(() => {
    writeJSON(PRESETS_KEY, presets);
  }, [presets]);

  const setFilters = useCallback((next: PRFilters) => {
    setFiltersState(next);
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(EMPTY_FILTERS);
  }, []);

  const savePreset = useCallback(
    (name: string): FilterPreset | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const preset: FilterPreset = {
        id: newPresetId(),
        name: trimmed,
        filters,
      };
      setPresetsState((prev) => [...prev, preset]);
      return preset;
    },
    [filters],
  );

  const applyPreset = useCallback(
    (id: string) => {
      const preset = presets.find((p) => p.id === id);
      if (preset) setFiltersState(preset.filters);
    },
    [presets],
  );

  const deletePreset = useCallback((id: string) => {
    setPresetsState((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return useMemo(
    () => ({ filters, setFilters, resetFilters, presets, savePreset, applyPreset, deletePreset }),
    [filters, setFilters, resetFilters, presets, savePreset, applyPreset, deletePreset],
  );
}
