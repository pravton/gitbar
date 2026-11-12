import { type FilterPreset, type PRFilters, normalizeFilters } from "@/lib/filters";

/**
 * What the sync gist holds. `updated_at` dates `current`; each preset
 * carries its own. `deleted` is tombstones: preset id to when, in ms.
 */
export interface FilterSyncDoc {
  version: 1;
  updated_at: number;
  current: PRFilters;
  presets: FilterPreset[];
  deleted: Record<string, number>;
}

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Canonical form: presets in a stable order, tombstone keys sorted. Two
 * machines holding the same data serialize to the same string, which is
 * how a sync cycle knows there's nothing to write.
 */
export function buildSyncDoc(
  current: PRFilters,
  updatedAt: number,
  presets: FilterPreset[],
  deleted: Record<string, number>,
): FilterSyncDoc {
  return {
    version: 1,
    updated_at: updatedAt,
    current,
    presets: [...presets].sort(
      (a, b) => (a.updated_at ?? 0) - (b.updated_at ?? 0) || a.id.localeCompare(b.id),
    ),
    deleted: Object.fromEntries(
      Object.entries(deleted).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

export function serializeSyncDoc(doc: FilterSyncDoc): string {
  return JSON.stringify(doc);
}

/**
 * Parse a gist's content. The gist is editable outside GitBar, so nothing
 * in it is trusted. Throws rather than degrading: writing a merge based
 * on a misread document would overwrite the good data in it.
 */
export function parseSyncDoc(raw: string): FilterSyncDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The sync gist isn't valid JSON, so sync left it alone.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("The sync gist isn't in a format GitBar understands, so sync left it alone.");
  }
  const doc = parsed as Partial<Record<keyof FilterSyncDoc, unknown>>;
  if (doc.version !== 1) {
    throw new Error(
      typeof doc.version === "number" && doc.version > 1
        ? "The sync gist was written by a newer GitBar. Update this copy to keep syncing."
        : "The sync gist isn't in a format GitBar understands, so sync left it alone.",
    );
  }
  // The containers must have the right shape. Normalizing a missing or
  // wrong `current` into empty filters would let a broken gist with a
  // newer timestamp wipe this machine's filters, then overwrite the gist.
  const isRecord = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value);
  if (
    !isRecord(doc.current) ||
    (doc.presets !== undefined && !Array.isArray(doc.presets)) ||
    (doc.deleted !== undefined && !isRecord(doc.deleted))
  ) {
    throw new Error("The sync gist isn't in a format GitBar understands, so sync left it alone.");
  }
  const presets = Array.isArray(doc.presets)
    ? doc.presets.flatMap((entry: unknown): FilterPreset[] => {
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
      })
    : [];
  const deleted =
    typeof doc.deleted === "object" && doc.deleted !== null && !Array.isArray(doc.deleted)
      ? Object.fromEntries(
          Object.entries(doc.deleted).filter(
            (entry): entry is [string, number] => typeof entry[1] === "number",
          ),
        )
      : {};
  return buildSyncDoc(
    normalizeFilters(doc.current),
    typeof doc.updated_at === "number" ? doc.updated_at : 0,
    presets,
    deleted,
  );
}

/**
 * Merge a machine's state with the gist's. Presets merge by id, newest
 * wins; `current` is whole-object, newest wins. Every tie goes to the
 * gist, including two machines with undated filters. If ties went to
 * local, those machines would each overwrite the other forever instead
 * of settling. A deletion beats a preset saved at or before it.
 */
export function mergeSyncDocs(
  local: FilterSyncDoc,
  remote: FilterSyncDoc,
  now: number,
): FilterSyncDoc {
  const presetsById = new Map(local.presets.map((preset) => [preset.id, preset]));
  for (const preset of remote.presets) {
    const mine = presetsById.get(preset.id);
    if (!mine || (preset.updated_at ?? 0) >= (mine.updated_at ?? 0)) {
      presetsById.set(preset.id, preset);
    }
  }

  const deleted: Record<string, number> = {};
  for (const [id, at] of [...Object.entries(local.deleted), ...Object.entries(remote.deleted)]) {
    if (now - at <= TOMBSTONE_TTL_MS) deleted[id] = Math.max(at, deleted[id] ?? 0);
  }
  for (const [id, at] of Object.entries(deleted)) {
    const preset = presetsById.get(id);
    if (preset && (preset.updated_at ?? 0) <= at) presetsById.delete(id);
  }

  const remoteCurrentWins = remote.updated_at >= local.updated_at;
  return buildSyncDoc(
    remoteCurrentWins ? remote.current : local.current,
    Math.max(local.updated_at, remote.updated_at),
    [...presetsById.values()],
    deleted,
  );
}
