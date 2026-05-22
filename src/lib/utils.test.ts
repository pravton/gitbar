import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { cn, safeOpen, timeAgo, truncate } from "@/lib/utils";

describe("cn", () => {
  it("joins truthy class names with spaces", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("returns an empty string when everything is falsy", () => {
    expect(cn(false, null, undefined)).toBe("");
  });
});

describe("timeAgo", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T12:00:00Z"));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("formats seconds", () => {
    expect(timeAgo(new Date("2026-05-18T11:59:30Z").toISOString())).toBe("30s ago");
  });
  it("formats minutes", () => {
    expect(timeAgo(new Date("2026-05-18T11:30:00Z").toISOString())).toBe("30m ago");
  });
  it("formats hours", () => {
    expect(timeAgo(new Date("2026-05-18T08:00:00Z").toISOString())).toBe("4h ago");
  });
  it("formats days", () => {
    expect(timeAgo(new Date("2026-05-15T12:00:00Z").toISOString())).toBe("3d ago");
  });
  it("formats weeks", () => {
    expect(timeAgo(new Date("2026-05-04T12:00:00Z").toISOString())).toBe("2w ago");
  });
  it("clamps future timestamps to 0 seconds", () => {
    expect(timeAgo(new Date("2026-05-18T12:01:00Z").toISOString())).toBe("0s ago");
  });
  it("returns 'unknown' for invalid input", () => {
    expect(timeAgo("not a date")).toBe("unknown");
  });
});

describe("truncate", () => {
  it("leaves short strings alone", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });
  it("truncates and appends ellipsis when over the limit", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
    expect(truncate("hello world", 8).length).toBe(8);
  });
  it("handles max=1 by keeping just the ellipsis", () => {
    expect(truncate("hello", 1)).toBe("…");
  });
});

describe("safeOpen", () => {
  it("dispatches https URLs", () => {
    const impl = vi.fn().mockResolvedValue(undefined);
    expect(safeOpen("https://github.com/o/r/pull/1", impl)).toBe(true);
    expect(impl).toHaveBeenCalledWith("https://github.com/o/r/pull/1");
  });

  it("dispatches http URLs (local dev servers etc.)", () => {
    const impl = vi.fn().mockResolvedValue(undefined);
    expect(safeOpen("http://localhost:3000", impl)).toBe(true);
    expect(impl).toHaveBeenCalledOnce();
  });

  it("rejects file:// URLs", () => {
    const impl = vi.fn();
    expect(safeOpen("file:///etc/passwd", impl)).toBe(false);
    expect(impl).not.toHaveBeenCalled();
  });

  it("rejects javascript: URLs", () => {
    const impl = vi.fn();
    expect(safeOpen("javascript:alert(1)", impl)).toBe(false);
    expect(impl).not.toHaveBeenCalled();
  });

  it("rejects mailto:/tel: URLs (GitBar only opens web links)", () => {
    const impl = vi.fn();
    expect(safeOpen("mailto:foo@example.com", impl)).toBe(false);
    expect(safeOpen("tel:+15555550100", impl)).toBe(false);
    expect(impl).not.toHaveBeenCalled();
  });

  it("rejects unparseable input", () => {
    const impl = vi.fn();
    expect(safeOpen("not a url", impl)).toBe(false);
    expect(impl).not.toHaveBeenCalled();
  });

  it("rejects null/undefined/empty", () => {
    const impl = vi.fn();
    expect(safeOpen(null, impl)).toBe(false);
    expect(safeOpen(undefined, impl)).toBe(false);
    expect(safeOpen("", impl)).toBe(false);
    expect(impl).not.toHaveBeenCalled();
  });
});
