import { describe, expect, it } from "vitest";
import { pickReadableTextColor } from "@/lib/contrast";

describe("pickReadableTextColor", () => {
  it("returns black for GitHub's light-blue 'enhancement' label", () => {
    expect(pickReadableTextColor("a2eeef")).toBe("#000000");
  });

  it("returns black for pale labels (the user's reported regression case)", () => {
    expect(pickReadableTextColor("c5def5")).toBe("#000000");
  });

  it("returns white for very dark backgrounds", () => {
    expect(pickReadableTextColor("0a0a0a")).toBe("#ffffff");
    expect(pickReadableTextColor("000000")).toBe("#ffffff");
  });

  it("returns black for very light backgrounds", () => {
    expect(pickReadableTextColor("ffffff")).toBe("#000000");
    expect(pickReadableTextColor("f0f0f0")).toBe("#000000");
  });

  it("returns black for mid-gray (#7f7f7f) — WCAG-correct fix", () => {
    // YIQ picks white for mid-gray, but black actually has higher contrast.
    expect(pickReadableTextColor("7f7f7f")).toBe("#000000");
    expect(pickReadableTextColor("808080")).toBe("#000000");
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

  it("returns white for saturated dark colors", () => {
    // good-first-issue purple, documentation deep blue — both dark enough
    // that white text is unambiguously the higher-contrast choice.
    expect(pickReadableTextColor("7057ff")).toBe("#ffffff");
    expect(pickReadableTextColor("0075ca")).toBe("#ffffff");
  });

  it("picks the mathematically-higher contrast color even when GitHub disagrees", () => {
    // GitHub renders white on its `help wanted` teal (#008672), but black
    // actually has the higher WCAG contrast ratio (4.66 vs 4.51). We're a
    // utility — we report the math, not GitHub's branding choice.
    expect(pickReadableTextColor("008672")).toBe("#000000");
  });

  it("returns black for pale yellow (previously unreadable white-on-pale)", () => {
    expect(pickReadableTextColor("fef2c0")).toBe("#000000");
  });
});
