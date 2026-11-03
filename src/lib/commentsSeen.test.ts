import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSeenCounts,
  readSeenCounts,
  reconcileSeenCounts,
  writeSeenCounts,
} from "@/lib/commentsSeen";

describe("commentsSeen storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips per login and clears one login only", () => {
    writeSeenCounts("alice", { a: 1 });
    writeSeenCounts("bob", { b: 2 });
    expect(readSeenCounts("alice")).toEqual({ a: 1 });
    clearSeenCounts("alice");
    expect(readSeenCounts("alice")).toEqual({});
    expect(readSeenCounts("bob")).toEqual({ b: 2 });
  });

  it("ignores corrupt or malformed values", () => {
    localStorage.setItem("gitbar.comments.seen.alice", "{not json");
    expect(readSeenCounts("alice")).toEqual({});
    localStorage.setItem("gitbar.comments.seen.alice", "[1]");
    expect(readSeenCounts("alice")).toEqual({});
    localStorage.setItem("gitbar.comments.seen.alice", '{"a":"x","b":3}');
    expect(readSeenCounts("alice")).toEqual({ b: 3 });
  });
});

describe("reconcileSeenCounts", () => {
  it("seeds unknown items at their current count", () => {
    expect(reconcileSeenCounts({}, [{ url: "a", comments: 5 }], true)).toEqual({ a: 5 });
  });

  it("leaves a raised count unread and follows a lowered one down", () => {
    const seen = { up: 2, down: 9 };
    const out = reconcileSeenCounts(
      seen,
      [
        { url: "up", comments: 4 },
        { url: "down", comments: 3 },
      ],
      true,
    );
    expect(out).toEqual({ up: 2, down: 3 });
  });

  it("prunes missing items only when the data is complete", () => {
    const seen = { kept: 1, gone: 2 };
    const items = [{ url: "kept", comments: 1 }];
    expect(reconcileSeenCounts(seen, items, true)).toEqual({ kept: 1 });
    expect(reconcileSeenCounts(seen, items, false)).toBe(seen);
  });

  it("returns the same object when nothing changed", () => {
    const seen = { a: 1 };
    expect(reconcileSeenCounts(seen, [{ url: "a", comments: 3 }], true)).toBe(seen);
  });
});
