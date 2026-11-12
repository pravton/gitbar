import { describe, expect, it } from "vitest";
import {
  buildSyncDoc,
  mergeSyncDocs,
  parseSyncDoc,
  serializeSyncDoc,
  type FilterSyncDoc,
} from "@/lib/filterSync";
import { EMPTY_FILTERS, type FilterPreset, type PRFilters } from "@/lib/filters";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const drafts: PRFilters = { ...EMPTY_FILTERS, draft: "drafts" };
const published: PRFilters = { ...EMPTY_FILTERS, draft: "published" };

function preset(id: string, updatedAt?: number, name = id): FilterPreset {
  return {
    id,
    name,
    filters: EMPTY_FILTERS,
    ...(updatedAt === undefined ? {} : { updated_at: updatedAt }),
  };
}

function doc(overrides: Partial<Omit<FilterSyncDoc, "version">> = {}): FilterSyncDoc {
  return buildSyncDoc(
    overrides.current ?? EMPTY_FILTERS,
    overrides.updated_at ?? 0,
    overrides.presets ?? [],
    overrides.deleted ?? {},
  );
}

describe("mergeSyncDocs", () => {
  it("takes whichever current filters are newer", () => {
    const local = doc({ current: drafts, updated_at: 5 });
    const remote = doc({ current: published, updated_at: 9 });
    expect(mergeSyncDocs(local, remote, NOW)).toMatchObject({ current: published, updated_at: 9 });
    expect(mergeSyncDocs(remote, local, NOW)).toMatchObject({ current: published, updated_at: 9 });
  });

  it("adopts the gist's filters over a machine that never changed its own", () => {
    const merged = mergeSyncDocs(doc(), doc({ current: drafts, updated_at: 5 }), NOW);
    expect(merged.current).toEqual(drafts);
  });

  it("unions presets by id, newest version winning", () => {
    const local = doc({ presets: [preset("a", 1), preset("both", 2, "old")] });
    const remote = doc({ presets: [preset("b", 1), preset("both", 3, "new")] });
    const merged = mergeSyncDocs(local, remote, NOW);
    expect(merged.presets.map((p) => p.id).sort()).toEqual(["a", "b", "both"]);
    expect(merged.presets.find((p) => p.id === "both")?.name).toBe("new");
  });

  it("removes a preset deleted on the other machine, in either direction", () => {
    const withPreset = doc({ presets: [preset("a", NOW - 2)] });
    const deleted = doc({ deleted: { a: NOW - 1 } });
    expect(mergeSyncDocs(withPreset, deleted, NOW).presets).toEqual([]);
    expect(mergeSyncDocs(deleted, withPreset, NOW).presets).toEqual([]);
    expect(mergeSyncDocs(withPreset, deleted, NOW).deleted).toEqual({ a: NOW - 1 });
  });

  it("keeps a preset saved after its tombstone", () => {
    const merged = mergeSyncDocs(
      doc({ presets: [preset("a", 20)] }),
      doc({ deleted: { a: 10 } }),
      NOW,
    );
    expect(merged.presets.map((p) => p.id)).toEqual(["a"]);
  });

  it("deletes an undated pre-sync preset", () => {
    const merged = mergeSyncDocs(doc({ presets: [preset("old")] }), doc({ deleted: { old: NOW - 1 } }), NOW);
    expect(merged.presets).toEqual([]);
  });

  it("expires tombstones after 30 days", () => {
    const merged = mergeSyncDocs(
      doc({ deleted: { stale: NOW - 31 * DAY, fresh: NOW - 29 * DAY } }),
      doc(),
      NOW,
    );
    expect(Object.keys(merged.deleted)).toEqual(["fresh"]);
  });

  it("doesn't apply an expired tombstone", () => {
    const merged = mergeSyncDocs(
      doc({ presets: [preset("a", NOW - 40 * DAY)] }),
      doc({ deleted: { a: NOW - 31 * DAY } }),
      NOW,
    );
    expect(merged.presets.map((p) => p.id)).toEqual(["a"]);
    expect(merged.deleted).toEqual({});
  });

  it("settles when two machines tie, instead of overwriting each other", () => {
    // Both undated, as after upgrading two machines with different filters.
    let a = doc({ current: drafts });
    const b = doc({ current: published });
    // A wrote first; B pulls, and the gist's copy wins the tie.
    let gist = a;
    const merged = mergeSyncDocs(b, gist, NOW);
    expect(serializeSyncDoc(merged)).toBe(serializeSyncDoc(gist));
    // A's next cycle changes nothing either.
    a = mergeSyncDocs(a, gist, NOW);
    gist = a;
    expect(serializeSyncDoc(mergeSyncDocs(a, gist, NOW))).toBe(serializeSyncDoc(gist));
  });

  it("converges regardless of merge order", () => {
    const a = doc({ current: drafts, updated_at: 7, presets: [preset("x", 1)], deleted: { y: 3 } });
    const b = doc({ current: published, updated_at: 2, presets: [preset("y", 1), preset("z", 4)] });
    expect(serializeSyncDoc(mergeSyncDocs(a, b, NOW))).toBe(
      serializeSyncDoc(mergeSyncDocs(b, a, NOW)),
    );
  });
});

describe("parseSyncDoc", () => {
  it("round-trips", () => {
    const original = doc({
      current: drafts,
      updated_at: 3,
      presets: [preset("b", 2), preset("a", 1)],
      deleted: { z: 1, c: 2 },
    });
    const text = serializeSyncDoc(original);
    expect(serializeSyncDoc(parseSyncDoc(text))).toBe(text);
  });

  it("sanitizes what's inside an otherwise valid document", () => {
    const parsed = parseSyncDoc(
      JSON.stringify({
        version: 1,
        updated_at: "soon",
        current: { draft: "nonsense", repos: ["ok/repo", "../bad"] },
        presets: [{ id: "a", name: "A", filters: null }, { id: 3 }, null, "x"],
        deleted: { a: "later", b: 2 },
      }),
    );
    expect(parsed.updated_at).toBe(0);
    expect(parsed.current).toEqual({ ...EMPTY_FILTERS, repos: ["ok/repo"] });
    expect(parsed.presets).toEqual([{ id: "a", name: "A", filters: EMPTY_FILTERS }]);
    expect(parsed.deleted).toEqual({ b: 2 });
  });

  it("refuses documents it can't trust rather than merging over them", () => {
    expect(() => parseSyncDoc("{not json")).toThrow(/valid JSON/);
    expect(() => parseSyncDoc("[]")).toThrow(/format/);
    expect(() => parseSyncDoc('{"presets":[]}')).toThrow(/format/);
    expect(() => parseSyncDoc('{"version":2}')).toThrow(/newer GitBar/);
  });

  it("refuses a document whose containers have the wrong shape", () => {
    const base = { version: 1, updated_at: 9e15, current: EMPTY_FILTERS, presets: [], deleted: {} };
    for (const broken of [
      { ...base, current: undefined },
      { ...base, current: null },
      { ...base, current: [] },
      { ...base, presets: {} },
      { ...base, deleted: [] },
      { ...base, deleted: null },
    ]) {
      expect(() => parseSyncDoc(JSON.stringify(broken))).toThrow(/format/);
    }
    // Missing presets and tombstones are fine: nothing to merge.
    expect(parseSyncDoc(JSON.stringify({ version: 1, updated_at: 1, current: EMPTY_FILTERS })).presets).toEqual([]);
  });
});
