import { describe, expect, it } from "vitest";
import {
  blocksLength,
  cleanCommentBody,
  parseCommentBody,
  parseInline,
  shieldsBadge,
  stripTags,
  truncateBlocks,
} from "./commentMarkdown";

describe("cleanCommentBody", () => {
  it("strips formatting tags and HTML comments, keeps their text", () => {
    expect(cleanCommentBody("<sub><b>hi</b></sub><!-- hidden --> there")).toBe("hi there");
  });

  it("turns <br> into a newline and <img> into markdown", () => {
    expect(cleanCommentBody('a<br/>b <img alt="Logo" src="https://e.com/l.png">')).toBe(
      "a\nb ![Logo](https://e.com/l.png)",
    );
  });

  it("leaves unknown tags as text", () => {
    expect(cleanCommentBody("<script>x</script>")).toBe("<script>x</script>");
  });

  it("does not touch code spans or fenced code", () => {
    const body = "use `<sub>` here\n```html\n<b>keep</b>\n<!-- me -->\n```\n<b>strip</b>";
    expect(cleanCommentBody(body)).toBe("use `<sub>` here\n```html\n<b>keep</b>\n<!-- me -->\n```\nstrip");
  });

  it("can't reassemble a tag from nested markup in <code> or <pre>", () => {
    for (const body of [
      "<code><scr<foo>ipt>x</code>",
      "<code><<foo>script></code>",
      "<code><scr<b>ipt>x</code>",
      "<pre><scr<foo>ipt>alert(1)</pre>",
      "<pre><<foo>script>alert(1)</pre>",
      "<code><<<foo>script></code>",
      "<pre><<<<foo>a<<<!x</pre>",
    ]) {
      expect(cleanCommentBody(body), body).not.toMatch(/<[a-zA-Z/!?]/);
    }
  });

  it("keeps code that is escaped on purpose, and a bare `<`", () => {
    expect(cleanCommentBody("<code>&lt;script&gt; a < 1</code>")).toBe("`<script> a < 1`");
  });

  it("drops an unterminated HTML comment", () => {
    expect(cleanCommentBody("text <!-- never closed")).toBe("text");
  });
});

describe("parseCommentBody", () => {
  it("splits paragraphs, headings and fenced code", () => {
    const blocks = parseCommentBody("## Title\n\npara one\nline two\n\n```\ncode **not bold**\n```\nafter");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "code", "paragraph"]);
    expect(blocks[2]).toEqual({ kind: "code", text: "code **not bold**" });
  });

  it("treats an unclosed fence as code to the end", () => {
    expect(parseCommentBody("```\nlet x = 1;")).toEqual([{ kind: "code", text: "let x = 1;" }]);
  });
});

describe("parseInline", () => {
  it("parses bold, italic, strike and code", () => {
    expect(parseInline("**b** *i* _u_ ~~s~~ `c`")).toEqual([
      { kind: "strong", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "em", children: [{ kind: "text", text: "i" }] },
      { kind: "text", text: " " },
      { kind: "em", children: [{ kind: "text", text: "u" }] },
      { kind: "text", text: " " },
      { kind: "del", children: [{ kind: "text", text: "s" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "c" },
    ]);
  });

  it("leaves snake_case and lone asterisks alone", () => {
    expect(parseInline("snake_case_name and 2 * 3 * 4")).toEqual([
      { kind: "text", text: "snake_case_name and 2 * 3 * 4" },
    ]);
  });

  it("does not parse markdown inside code", () => {
    expect(parseInline("`**x**`")).toEqual([{ kind: "code", text: "**x**" }]);
  });

  it("parses links, with formatting in the label", () => {
    expect(parseInline("[**go**](https://e.com/a_(b))")).toEqual([
      { kind: "link", url: "https://e.com/a_(b)", children: [{ kind: "strong", children: [{ kind: "text", text: "go" }] }] },
    ]);
  });

  it("only links http(s) URLs", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ kind: "text", text: "[x](javascript:alert(1))" }]);
  });

  it("links bare URLs", () => {
    expect(parseInline("see https://e.com/x.")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", url: "https://e.com/x", children: [{ kind: "text", text: "https://e.com/x" }] },
      { kind: "text", text: "." },
    ]);
  });

  it("turns a shields.io image into a badge, linked when wrapped", () => {
    expect(parseInline("![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)")).toEqual([
      { kind: "badge", label: "P1", tone: "warning", url: null },
    ]);
    expect(
      parseInline("[![build](https://img.shields.io/badge/build-passing-brightgreen)](https://ci.example/run)"),
    ).toEqual([{ kind: "badge", label: "build: passing", tone: "success", url: "https://ci.example/run" }]);
  });

  it("turns other images into a link to the image", () => {
    expect(parseInline("![shot](https://e.com/s.png)")).toEqual([
      { kind: "image", alt: "shot", url: "https://e.com/s.png" },
    ]);
  });
});

const render = (body: string) => parseCommentBody(cleanCommentBody(body));

describe("review findings on #94", () => {
  it("keeps the URL of an HTML link, and of a linked badge", () => {
    expect(parseInline(cleanCommentBody('<a href="https://vercel.com/x/abc">Inspect</a>'))).toEqual([
      { kind: "link", url: "https://vercel.com/x/abc", children: [{ kind: "text", text: "Inspect" }] },
    ]);
    expect(
      parseInline(cleanCommentBody('<a href="https://ci.example/r"><img src="https://img.shields.io/badge/ci-ok-green" alt="ci"></a>')),
    ).toEqual([{ kind: "badge", label: "ci: ok", tone: "success", url: "https://ci.example/r" }]);
    // `</abbr>` must not close an `<a>`.
    expect(cleanCommentBody('<a href="https://e.com/x">see <abbr>A</abbr> here</a>')).toBe("[see A here](https://e.com/x)");
    // Non-http hrefs keep only their text.
    expect(cleanCommentBody('<a href="javascript:alert(1)">x</a>')).toBe("x");
  });

  it("closes a fence only with a matching, at least as long run", () => {
    const body = "````md\n```js\ninner <b>keep</b>\n```\n````\nafter";
    expect(render(body)).toEqual([
      { kind: "code", text: "```js\ninner <b>keep</b>\n```" },
      { kind: "paragraph", children: [{ kind: "text", text: "after" }] },
    ]);
    expect(render("```\na\n```js\nb\n```")).toEqual([{ kind: "code", text: "a\n```js\nb" }]);
  });

  it("never nests a link inside a link", () => {
    expect(parseInline("[https://a.com](https://b.com)")).toEqual([
      { kind: "link", url: "https://b.com", children: [{ kind: "text", text: "https://a.com" }] },
    ]);
  });

  it("keeps block tags apart", () => {
    expect(cleanCommentBody("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n\n- two");
    expect(cleanCommentBody("<table><tr><td>a.ts</td><td>90%</td></tr></table>")).toBe("a.ts 90%");
    expect(cleanCommentBody("<details><summary>Title</summary>body</details>")).toBe("Title\nbody");
  });

  it("does not bold dunder names, globs or URL parts", () => {
    // Space-delimited `__init__` bolds on GitHub too; intraword never does.
    expect(parseInline("call obj__init__ and src/**/*.ts and lib/**/*.js")).toEqual([
      { kind: "text", text: "call obj__init__ and src/**/*.ts and lib/**/*.js" },
    ]);
    expect(parseInline("https://x.com/__init__.py")).toEqual([
      { kind: "link", url: "https://x.com/__init__.py", children: [{ kind: "text", text: "https://x.com/__init__.py" }] },
    ]);
  });

  it("keeps a trailing # that is part of the heading text", () => {
    expect(render("# Support C#")).toEqual([{ kind: "heading", children: [{ kind: "text", text: "Support C#" }] }]);
    expect(render("## Title ##")).toEqual([{ kind: "heading", children: [{ kind: "text", text: "Title" }] }]);
    expect(render("#hashtag")).toEqual([{ kind: "paragraph", children: [{ kind: "text", text: "#hashtag" }] }]);
  });

  it("parses emphasis right after another token", () => {
    expect(parseInline("`code`*note*")).toEqual([
      { kind: "code", text: "code" },
      { kind: "em", children: [{ kind: "text", text: "note" }] },
    ]);
    expect(parseInline("[x](https://a.com)*see*")[1]).toEqual({ kind: "em", children: [{ kind: "text", text: "see" }] });
  });

  it("emphasis wraps code but never reaches into it", () => {
    expect(parseInline("**fix `a**b`**")).toEqual([
      { kind: "strong", children: [{ kind: "text", text: "fix " }, { kind: "code", text: "a**b" }] },
    ]);
  });

  it("protects multi-backtick code spans from tag stripping", () => {
    expect(cleanCommentBody("`` <details> `` and <b>x</b>")).toBe("`` <details> `` and x");
    expect(parseInline("`` <details> ``")).toEqual([{ kind: "code", text: "<details>" }]);
  });

  it("keeps whitespace inside fenced and <pre> code exactly", () => {
    const code = "-  old  \n+  new  \n\n\n\nend";
    expect(render("```diff\n" + code + "\n```")).toEqual([{ kind: "code", text: code }]);
    expect(render("<pre>" + code + "</pre>")).toEqual([{ kind: "code", text: code }]);
    // Only the one newline after <pre> goes; edge whitespace stays.
    expect(render("<pre>value  </pre>")).toEqual([{ kind: "code", text: "value  " }]);
    expect(render("<pre>\n\n  x\n\n</pre>")).toEqual([{ kind: "code", text: "\n  x\n\n" }]);
    // Prose still gets tidied.
    expect(cleanCommentBody("\n\na  \n\n\n\nb\n\n")).toBe("a\n\nb");
  });

  it("turns <code> and <pre> into code", () => {
    expect(parseInline(cleanCommentBody("Bump <code>foo</code> to <code>&lt;2&gt;</code>"))).toEqual([
      { kind: "text", text: "Bump " },
      { kind: "code", text: "foo" },
      { kind: "text", text: " to " },
      { kind: "code", text: "<2>" },
    ]);
    expect(render("<pre><code>a &amp;&amp; b ``` c\nd\n</code></pre>")).toEqual([
      { kind: "code", text: "a && b ``` c\nd\n" },
    ]);
    // A decoded `<img>` inside <code> stays text.
    expect(cleanCommentBody('<code>&lt;img src="https://e.com/x"&gt;</code>')).toBe('`<img src="https://e.com/x">`');
  });

  it("decodes entities in text", () => {
    expect(parseInline("a &amp; b &lt;c&gt; &#39;d&#x27; &bogus;")).toEqual([
      { kind: "text", text: "a & b <c> 'd' &bogus;" },
    ]);
  });
});

describe("truncateBlocks", () => {
  it("cuts visible text, never markup", () => {
    const blocks = render("intro [a long link label](https://e.com/x) and **bold words**");
    expect(blocksLength(blocks)).toBe("intro a long link label and bold words".length);
    expect(truncateBlocks(blocks, 12)).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "intro " },
          { kind: "link", url: "https://e.com/x", children: [{ kind: "text", text: "a long…" }] },
        ],
      },
    ]);
  });

  it("returns short bodies unchanged and marks a cut at a block edge", () => {
    const blocks = render("one\n\ntwo");
    expect(truncateBlocks(blocks, 10)).toBe(blocks);
    expect(truncateBlocks(blocks, 3)).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "one" }] },
      { kind: "paragraph", children: [{ kind: "text", text: "…" }] },
    ]);
  });
});

describe("stripTags", () => {
  it("removes whole tags and keeps their text", () => {
    expect(stripTags("a<b>b</b><span class=x>c</span>")).toBe("abc");
  });

  it("drops every `<` in a run before a tag start (CodeQL alert 6)", () => {
    expect(stripTags("<<<foo>a")).toBe("a");
    expect(stripTags("<<<a")).toBe("a");
    expect(stripTags("<</x")).toBe("/x");
  });

  it("keeps a `<` that can't open markup", () => {
    expect(stripTags("a < 1 && b <= 2 <")).toBe("a < 1 && b <= 2 <");
  });

  it("never leaves a tag start, whatever the input", () => {
    // Seeded so a failure is reproducible.
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const alphabet = ["<", "<", ">", "/", "!", "?", "a", "B", " ", "-"];
    for (let n = 0; n < 5000; n++) {
      const len = 1 + Math.floor(rand() * 24);
      const input = Array.from({ length: len }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
      expect(stripTags(input), input).not.toMatch(/<[a-zA-Z/!?]/);
    }
  });
});

describe("untrusted input stays fast", () => {
  const cases: [string, string][] = [
    ["unmatched backticks", "`".repeat(5000) + "x" + "``a".repeat(5000)],
    ["backtick runs of every length", Array.from({ length: 300 }, (_, i) => "`".repeat(i + 1) + "x").join(" ")],
    ["asterisks", "*a ".repeat(20000)],
    ["double asterisks", "**a ".repeat(20000)],
    ["underscores", "_a ".repeat(20000)],
    ["tildes", "~~a ".repeat(20000)],
    ["open brackets", "[a](https://".repeat(5000)],
    ["image openers", "![a](https://e.com/".repeat(5000)],
    ["unclosed anchors", '<a href="https://e.com">x '.repeat(5000)],
    ["unclosed code tags", "<code>x ".repeat(10000)],
    ["unclosed pre tags", "<pre>x ".repeat(10000)],
    ["nested tag starts in code", "<code>" + "<".repeat(30000) + "a".repeat(30000) + "</code>"],
    ["unclosed tags in pre", "<pre>" + "<a ".repeat(20000) + "</pre>"],
    // GitHub bodies go up to 65,536 characters.
    ["spaces before hashes", "# " + " ".repeat(65000) + "x"],
    ["trailing spaces", "a" + " ".repeat(65000) + "b\n"],
    ["url punctuation", "https://e.com/" + ".".repeat(65000) + "x"],
    ["entities", "&" + "a".repeat(60000)],
  ];
  it.each(cases)("%s", (_, body) => {
    const started = performance.now();
    const blocks = render(body);
    truncateBlocks(blocks, 400);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("shieldsBadge", () => {
  it("decodes dashes, underscores and spaces", () => {
    expect(shieldsBadge("https://img.shields.io/badge/a--b_c__d-red")).toEqual({ label: "a-b c_d", tone: "danger" });
  });

  it("ignores other hosts and malformed paths", () => {
    expect(shieldsBadge("https://example.com/badge/P2-yellow")).toBeNull();
    expect(shieldsBadge("https://img.shields.io/github/stars/x")).toBeNull();
    expect(shieldsBadge("not a url")).toBeNull();
  });
});
