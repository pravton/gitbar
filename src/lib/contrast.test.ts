import { describe, expect, it } from "vitest";
import { pickReadableTextColor } from "@/lib/contrast";

describe("pickReadableTextColor", () => {
  it("returns black for the light-blue GitHub 'enhancement' label", () => {
    // #a2eeef — the actual GitHub default for 'enhancement'
    expect(pickReadableTextColor("a2eeef")).toBe("#000000");
  });

  it("returns black for pale labels (the user's reported regression case)", () => {
    expect(pickReadableTextColor("c5def5")).toBe("#000000");
  });

  it("returns white for GitHub's red 'bug' label", () => {
    expect(pickReadableTextColor("d73a49")).toBe("#ffffff");
  });

  it("returns black for pure white", () => {
    expect(pickReadableTextColor("ffffff")).toBe("#000000");
  });

  it("returns white for pure black", () => {
    expect(pickReadableTextColor("000000")).toBe("#ffffff");
  });

  it("accepts a leading '#'", () => {
    expect(pickReadableTextColor("#ffffff")).toBe("#000000");
  });

  it("expands 3-digit shorthand", () => {
    expect(pickReadableTextColor("fff")).toBe("#000000");
    expect(pickReadableTextColor("000")).toBe("#ffffff");
  });

  it("falls back to white on invalid input", () => {
    expect(pickReadableTextColor("not-hex")).toBe("#ffffff");
    expect(pickReadableTextColor("")).toBe("#ffffff");
    expect(pickReadableTextColor("zzzzzz")).toBe("#ffffff");
  });

  it("handles common pale colors that previously rendered as white-on-white", () => {
    // GitHub's 'documentation', 'good first issue', 'help wanted' all use pale tints
    expect(pickReadableTextColor("0075ca")).toBe("#ffffff"); // documentation (deeper blue)
    expect(pickReadableTextColor("7057ff")).toBe("#ffffff"); // good first issue
    expect(pickReadableTextColor("008672")).toBe("#ffffff"); // help wanted
    expect(pickReadableTextColor("fef2c0")).toBe("#000000"); // pale yellow — was unreadable
  });
});
