import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EMPTY_FILTERS,
  type FilterPreset,
  type PRFilters,
  newPresetId,
  normalizeFilters,
} from "@/lib/filters";
import { buildSyncDoc, type FilterSyncDoc } from "@/lib/filterSync";

const CURRENT_KEY = "gitbar.filters.current";
const PRESETS_KEY = "gitbar.filters.presets";
const SYNC_META_KEY = "gitbar.filters.syncMeta";

/**
 * What filter sync needs on top of the filters themselves. Recorded even
 * while sync is off, so changes made before turning it on merge correctly.
 */
interface SyncMeta {
  /** When `filters` last changed, in ms. 0 if never. */
  updated_at: number;
  /** Deleted preset ids, with when, in ms. */
  deleted: Record<string, number>;
}

function readSyncMeta(): SyncMeta {
  const raw = readJSON<Partial<SyncMeta> | null>(SYNC_META_KEY, null);
  return {
    updated_at: typeof raw?.updated_at === "number" ? raw.updated_at : 0,
    deleted:
      raw?.deleted && typeof raw.deleted === "object"
        ? Object.fromEntries(
            Object.entries(raw.deleted).filter(
              (entry): entry is [string, number] => typeof entry[1] === "number",
            ),
          )
        : {},
  };
}

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
  /** Filters, presets and sync metadata, in the shape filter sync stores. */
  syncDoc: FilterSyncDoc;
  /** Replace all of the above with the result of a sync merge. */
  applySyncDoc: (doc: FilterSyncDoc) => void;
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
      return [
        {
          id: obj.id,
          name: obj.name,
          filters: normalizeFilters(obj.filters),
          ...(typeof obj.updated_at === "number" ? { updated_at: obj.updated_at } : {}),
        },
      ];
    });
  });
  const [syncMeta, setSyncMeta] = useState<SyncMeta>(readSyncMeta);

  useEffect(() => {
    writeJSON(CURRENT_KEY, filters);
  }, [filters]);

  useEffect(() => {
    writeJSON(PRESETS_KEY, presets);
  }, [presets]);

  useEffect(() => {
    writeJSON(SYNC_META_KEY, syncMeta);
  }, [syncMeta]);

  /** Every user-driven change to the current filters goes through here. */
  const changeFilters = useCallback((next: PRFilters) => {
    setFiltersState(next);
    setSyncMeta((prev) => ({ ...prev, updated_at: Date.now() }));
  }, []);

  const setFilters = changeFilters;

  const resetFilters = useCallback(() => {
    changeFilters(EMPTY_FILTERS);
  }, [changeFilters]);

  const savePreset = useCallback(
    (name: string): FilterPreset | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const preset: FilterPreset = {
        id: newPresetId(),
        name: trimmed,
        filters,
        updated_at: Date.now(),
      };
      setPresetsState((prev) => [...prev, preset]);
      return preset;
    },
    [filters],
  );

  const applyPreset = useCallback(
    (id: string) => {
      const preset = presets.find((p) => p.id === id);
      if (preset) changeFilters(preset.filters);
    },
    [presets, changeFilters],
  );

  const deletePreset = useCallback((id: string) => {
    setPresetsState((prev) => prev.filter((p) => p.id !== id));
    setSyncMeta((prev) => ({ ...prev, deleted: { ...prev.deleted, [id]: Date.now() } }));
  }, []);

  const syncDoc = useMemo(
    () => buildSyncDoc(filters, syncMeta.updated_at, presets, syncMeta.deleted),
    [filters, syncMeta, presets],
  );

  const applySyncDoc = useCallback((doc: FilterSyncDoc) => {
    setFiltersState(doc.current);
    setPresetsState(doc.presets);
    setSyncMeta({ updated_at: doc.updated_at, deleted: doc.deleted });
  }, []);

  return useMemo(
    () => ({
      filters,
      setFilters,
      resetFilters,
      presets,
      savePreset,
      applyPreset,
      deletePreset,
      syncDoc,
      applySyncDoc,
    }),
    [
      filters,
      setFilters,
      resetFilters,
      presets,
      savePreset,
      applyPreset,
      deletePreset,
      syncDoc,
      applySyncDoc,
    ],
  );
}
