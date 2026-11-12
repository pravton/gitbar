import { describe, expect, it } from "vitest";
import { cleanCommentBody, parseCommentBody, parseInline, shieldsBadge } from "./commentMarkdown";

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
