import { describe, expect, it } from "vitest";
import stylesheet from "./index.css?raw";

/** Top-level statements of a stylesheet, with comments removed. */
function topLevelBlocks(css: string): { prelude: string; body: string }[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: { prelude: string; body: string }[] = [];
  let index = 0;
  while (index < source.length) {
    const start = index;
    while (index < source.length && source[index] !== "{" && source[index] !== ";") index += 1;
    const prelude = source.slice(start, index).trim();
    if (source[index] === ";" || index >= source.length) {
      index += 1;
      if (prelude) blocks.push({ prelude, body: "" });
      continue;
    }
    const open = index;
    let depth = 0;
    do {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      index += 1;
    } while (depth > 0 && index < source.length);
    blocks.push({ prelude, body: source.slice(open + 1, index - 1) });
  }
  return blocks;
}

const AT_RULES_WITHOUT_ELEMENT_STYLES = /^@(import|source|font-face|theme|layer)\b/;

/**
 * Tokens may stay unlayered: `:root`, and `:root` inside a color-scheme
 * query. Anything else unlayered beats every Tailwind utility on the same
 * element whatever its specificity, which once cancelled colors and font
 * sizes on about 30 controls.
 */
function unlayeredRules(css: string): string[] {
  return topLevelBlocks(css).flatMap(({ prelude, body }) => {
    if (AT_RULES_WITHOUT_ELEMENT_STYLES.test(prelude) || prelude === ":root") return [];
    if (prelude.startsWith("@media")) {
      return topLevelBlocks(body)
        .map((inner) => inner.prelude)
        .filter((selector) => selector !== ":root");
    }
    return [prelude];
  });
}

describe("index.css cascade layers", () => {
  it("keeps every rule except design tokens inside a layer", () => {
    expect(stylesheet).toContain("@layer components");
    expect(unlayeredRules(stylesheet)).toEqual([]);
  });

  it("detects unlayered rules, including inside a media query", () => {
    const css = `
      @import "tailwindcss";
      :root { --a: 1; }
      @media (prefers-color-scheme: light) { :root { --a: 2; } .card { padding: 0; } }
      @layer components { .ok { color: red; } }
      button { color: inherit; }
    `;
    expect(unlayeredRules(css)).toEqual([".card", "button"]);
  });
});
