import { describe, expect, it } from "vitest";
import { linkify } from "@/lib/linkify";

describe("linkify", () => {
  it("returns a single text segment when there is no URL", () => {
    expect(linkify("just words")).toEqual([{ kind: "text", text: "just words" }]);
  });

  it("splits out http and https URLs", () => {
    expect(linkify("see https://a.dev/x and http://b.dev")).toEqual([
      { kind: "text", text: "see " },
      { kind: "url", url: "https://a.dev/x" },
      { kind: "text", text: " and " },
      { kind: "url", url: "http://b.dev" },
    ]);
  });

  it("leaves sentence punctuation outside the URL", () => {
    expect(linkify("Fixed in https://a.dev/pr/1.")).toEqual([
      { kind: "text", text: "Fixed in " },
      { kind: "url", url: "https://a.dev/pr/1" },
      { kind: "text", text: "." },
    ]);
  });

  it("extracts the URL from a markdown link without its brackets", () => {
    expect(linkify("[docs](https://a.dev/docs)")).toEqual([
      { kind: "text", text: "[docs](" },
      { kind: "url", url: "https://a.dev/docs" },
      { kind: "text", text: ")" },
    ]);
  });

  it("ignores non-http schemes", () => {
    expect(linkify("javascript:alert(1) file:///etc")).toEqual([
      { kind: "text", text: "javascript:alert(1) file:///etc" },
    ]);
  });
});
