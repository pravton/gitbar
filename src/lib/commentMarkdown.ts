/**
 * A small, safe markdown subset for the comments panel.
 *
 * GitHub comment bodies are markdown with some inline HTML (bot reviewers
 * such as Codex wrap a shields.io badge in `<sub>` tags). We never render
 * HTML: this module parses the text into a plain token tree that React
 * renders as elements, so nothing from a comment can inject markup.
 * Remote images are blocked by the CSP anyway, so shields.io badges become
 * native pills and other images become links.
 *
 * Supported: fenced code blocks, headings, `code`, **bold**, *italic*,
 * ~~strike~~, [links](url), ![images](url), bare URLs, common entities,
 * and the HTML GitHub bots use (`<a>`, `<img>`, `<code>`, `<pre>`, `<br>`,
 * lists, tables and formatting tags, all converted or stripped). Any
 * other tag is shown as written.
 *
 * No regex lookbehind anywhere: older macOS WebKit rejects it at parse
 * time, which would break the whole bundle.
 */
import { linkify } from "@/lib/linkify";

export type BadgeTone = "danger" | "warning" | "success" | "accent" | "neutral";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "del"; children: Inline[] }
  | { kind: "link"; url: string; children: Inline[] }
  | { kind: "badge"; label: string; tone: BadgeTone; url: string | null }
  | { kind: "image"; alt: string; url: string };

export type Block =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "heading"; children: Inline[] }
  | { kind: "code"; text: string };

// ---------------------------------------------------------------- fences

type Fence = { ch: string; len: number };

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

function fenceOpen(line: string): Fence | null {
  const match = FENCE_OPEN_RE.exec(line);
  if (!match) return null;
  // A backtick fence's info string can't contain backticks.
  if (match[1][0] === "`" && match[2].includes("`")) return null;
  return { ch: match[1][0], len: match[1].length };
}

/** Closed only by the same character, at least as long, nothing after. */
function closesFence(line: string, fence: Fence): boolean {
  const match = FENCE_CLOSE_RE.exec(line);
  return !!match && match[1][0] === fence.ch && match[1].length >= fence.len;
}

// ------------------------------------------------------------- cleaning

/** Tags removed outright; their text content stays. */
const INLINE_TAGS =
  "sub|sup|b|i|strong|em|ins|del|s|small|big|span|kbd|samp|picture|source|font|u|tt|var|mark|abbr|cite|dfn|q|a|g-emoji";
/** Tags that separate blocks: replaced by a line break. */
const BLOCK_TAGS =
  "div|p|details|summary|center|blockquote|dl|dt|dd|ul|ol|table|thead|tbody|tfoot|tr|caption|colgroup|col|hr|br|h[1-6]";
const tagRe = (names: string) => new RegExp(`</?(?:${names})(?:\\s[^<>]*)?/?>`, "gi");
const INLINE_TAG_RE = tagRe(INLINE_TAGS);
const BLOCK_TAG_RE = tagRe(BLOCK_TAGS);
const LI_OPEN_RE = /<li(?:\s[^<>]*)?>/gi;
const LI_CLOSE_RE = /<\/li\s*>/gi;
const CELL_TAG_RE = /<\/?t[dh](?:\s[^<>]*)?>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;
const IMG_TAG_RE = /<img\s[^<>]*>/gi;
const ANY_TAG_RE = /<\/?[a-zA-Z][^<>]*>/g;

/*
 * Everything below has to stay roughly linear: comment bodies are
 * untrusted and parsed on the UI thread. Lazy `[\s\S]*?` scans with no
 * bound, and backreferences over unbounded text, are quadratic on
 * unmatched delimiters (Codex measured 15s on 5,000 backticks). Paired
 * tags and code spans are therefore matched by hand, and every lazy span
 * in the inline regex has an upper bound.
 */

/**
 * Replace each `<tag ...>inner</tag>` with `fn(attrs, inner)`, matching
 * openers left to right with the next closer. Once no closer is left,
 * none can follow, so the scan stops instead of rescanning the rest.
 */
function replacePaired(
  text: string,
  tag: string,
  fn: (attrs: string, inner: string) => string,
  clean: (text: string) => string = (t) => t,
): string {
  const opener = new RegExp(`<${tag}(\\s[^<>]*)?>`, "gi");
  const lower = text.toLowerCase();
  let out = "";
  let pos = 0;
  for (;;) {
    opener.lastIndex = pos;
    const open = opener.exec(text);
    if (!open) break;
    const innerStart = open.index + open[0].length;
    // `</a` must not match `</abbr>`: the tag name has to end there.
    let close = lower.indexOf(`</${tag}`, innerStart);
    while (close >= 0 && !/[\s>]/.test(lower[close + tag.length + 2] ?? "")) {
      close = lower.indexOf(`</${tag}`, close + 1);
    }
    if (close < 0) break;
    const closeEnd = lower.indexOf(">", close);
    if (closeEnd < 0) break;
    out += clean(text.slice(pos, open.index)) + fn(open[1] ?? "", text.slice(innerStart, close));
    pos = closeEnd + 1;
  }
  return out + clean(text.slice(pos));
}

type CodeSpan = { start: number; end: number; content: string };

/**
 * CommonMark code spans: a backtick run closed by the next run of the
 * same length. Each length keeps a forward-only pointer, so this is
 * linear however many backticks go unmatched.
 */
function findCodeSpans(text: string): CodeSpan[] {
  const runs: { start: number; len: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "`") continue;
    let j = i;
    while (j < text.length && text[j] === "`") j++;
    runs.push({ start: i, len: j - i });
    i = j - 1;
  }
  const byLength = new Map<number, number[]>();
  runs.forEach((run, idx) => {
    const list = byLength.get(run.len);
    if (list) list.push(idx);
    else byLength.set(run.len, [idx]);
  });
  const pointer = new Map<number, number>();
  const spans: CodeSpan[] = [];
  let k = 0;
  while (k < runs.length) {
    const run = runs[k];
    const list = byLength.get(run.len) ?? [];
    let p = pointer.get(run.len) ?? 0;
    while (p < list.length && list[p] <= k) p++;
    pointer.set(run.len, p);
    if (p >= list.length) {
      k++;
      continue;
    }
    const close = runs[list[p]];
    let content = text.slice(run.start + run.len, close.start).replace(/\n/g, " ");
    if (content.length > 2 && content.startsWith(" ") && content.endsWith(" ") && content.trim()) {
      content = content.slice(1, -1);
    }
    spans.push({ start: run.start, end: close.start + close.len, content });
    k = list[p] + 1;
  }
  return spans;
}

/**
 * Turn the HTML GitHub bots use into markdown or plain text, outside
 * code. Fenced code and code spans are kept exactly as written.
 */
export function cleanCommentBody(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  let fence: Fence | null = null;
  const flushProse = () => {
    if (prose.length > 0) out.push(cleanProse(prose.join("\n")));
    prose = [];
  };
  for (const line of lines) {
    if (fence === null) {
      const opened = fenceOpen(line);
      if (opened) {
        flushProse();
        fence = opened;
        out.push(line);
      } else {
        prose.push(line);
      }
    } else {
      out.push(line);
      if (closesFence(line, fence)) fence = null;
    }
  }
  flushProse();
  return out
    .join("\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanProse(text: string): string {
  // `<pre>` becomes a fence; everything else is cleaned around code spans.
  return replacePaired(
    text,
    "pre",
    (_, inner) => {
      const code = decodeEntities(inner.replace(ANY_TAG_RE, "")).replace(/^\n+/, "").trimEnd();
      const fence = "`".repeat(Math.max(3, longestRun(code, "`") + 1));
      return `\n\n${fence}\n${code}\n${fence}\n\n`;
    },
    cleanAroundCodeSpans,
  );
}

function cleanAroundCodeSpans(text: string): string {
  let out = "";
  let last = 0;
  for (const span of findCodeSpans(text)) {
    out += cleanHtml(text.slice(last, span.start)) + text.slice(span.start, span.end);
    last = span.end;
  }
  return out + cleanHtml(text.slice(last));
}

function cleanHtml(text: string): string {
  let out = text.replace(HTML_COMMENT_RE, "");
  out = out.replace(IMG_TAG_RE, (tag) => {
    const src = attr(tag, "src");
    const alt = attr(tag, "alt") ?? "";
    if (!src || !isHttp(src)) return alt;
    return `![${alt.replace(/[[\]]/g, "")}](${escapeDest(src)})`;
  });
  out = replacePaired(out, "a", (attrs, inner) => {
    const href = attr(attrs, "href");
    const label = inner.trim();
    if (!href || !isHttp(href)) return label;
    return `[${label || href}](${escapeDest(href)})`;
  });
  out = out
    .replace(LI_OPEN_RE, "\n- ")
    .replace(LI_CLOSE_RE, "\n")
    .replace(CELL_TAG_RE, " ")
    .replace(BLOCK_TAG_RE, "\n")
    .replace(INLINE_TAG_RE, "");
  // Last, so a decoded `&lt;img&gt;` inside `<code>` is never read as a tag.
  return replacePaired(out, "code", (_, inner) => codeSpan(decodeEntities(inner.replace(ANY_TAG_RE, ""))));
}

function codeSpan(code: string): string {
  if (!code) return "";
  const ticks = "`".repeat(longestRun(code, "`") + 1);
  const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
  return `${ticks}${pad}${code}${pad}${ticks}`;
}

function longestRun(text: string, ch: string): number {
  let best = 0;
  let run = 0;
  for (const c of text) {
    run = c === ch ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "") : null;
}

const isHttp = (url: string) => /^https?:\/\//i.test(url);
/** Keep a URL inside `(...)`: no spaces, no unbalanced parens. */
const escapeDest = (url: string) =>
  url.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{1,31});/gi, (whole, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

// --------------------------------------------------------------- blocks

const HEADING_OPEN_RE = /^ {0,3}#{1,6}(?=[ \t]|$)/;

/**
 * ATX heading text, or null. A closing `#` run is dropped only when
 * whitespace comes before it, so `# Support C#` keeps its `#`. Done by
 * hand: an anchored `[ \t]+#+$` regex is quadratic on long space runs.
 */
function headingText(line: string): string | null {
  const open = HEADING_OPEN_RE.exec(line);
  if (!open) return null;
  let text = line.slice(open[0].length).trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  if (end === 0) return "";
  if (end < text.length && /[ \t]/.test(text[end - 1])) text = text.slice(0, end).trimEnd();
  return text;
}

/** Parse an already cleaned body into blocks. */
export function parseCommentBody(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.split("\n");
  let para: string[] = [];
  const flushPara = () => {
    const text = para.join("\n").trim();
    if (text) blocks.push({ kind: "paragraph", children: parseInline(text) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = fenceOpen(line);
    if (fence) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !closesFence(lines[i], fence)) {
        code.push(lines[i]);
        i++;
      }
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = headingText(line);
    if (heading !== null) {
      flushPara();
      if (heading) blocks.push({ kind: "heading", children: parseInline(heading) });
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

// --------------------------------------------------------------- inline

// `(url)` part of a link or image: http(s) only, no spaces, one level of
// balanced parens, optional title. Bounded, like every span below.
const dest = (group: string) =>
  String.raw`\(\s*(?<${group}>https?:\/\/[^\s()\uE000]{0,2048}(?:\([^\s()\uE000]{0,512}\)[^\s()\uE000]{0,512}){0,4})(?:\s+"[^"\n]{0,256}")?\s*\)`;
const INLINE_SOURCE = [
  String.raw`\[!\[(?<lImgAlt>[^\]]{0,512})\]${dest("lImgUrl")}\]${dest("lImgHref")}`,
  String.raw`!\[(?<imgAlt>[^\]]{0,512})\]${dest("imgUrl")}`,
  String.raw`\[(?<linkText>[^\]]{1,1000})\]${dest("linkUrl")}`,
  String.raw`(?<url>https?:\/\/[^\s<>()[\]"'\x60\uE000]+)`,
  String.raw`(?<strongMark>\*\*|__)(?=[^\s*_])(?<strongText>[\s\S]{0,1000}?[^\s\\])\k<strongMark>(?!\w)`,
  String.raw`~~(?=\S)(?<delText>[\s\S]{0,1000}?\S)~~`,
  String.raw`\*(?=[^\s*])(?<emText>[^*\n]{0,500}?[^\s*])\*(?![\w*])`,
  String.raw`_(?=[^\s_])(?<em2Text>[^_\n]{0,500}?[^\s_])_(?![\w_])`,
].join("|");

/**
 * Emphasis can't open right after a letter, digit, `_`, `*`, `/` or `\`,
 * so `snake_case`, `__init__.py` paths and `src/**\/*.ts` globs stay as
 * written. Checked by hand because lookbehind is off limits.
 */
const NO_EMPHASIS_AFTER = /[\p{L}\p{N}_*/\\]/u;

// Code spans are cut out first and stood in for by these private-use
// markers, so emphasis and links can wrap code but never reach into it.
const MARK_OPEN = "\uE000";
const MARK_CLOSE = "\uE001";
const MARK_RE = /\uE000(\d+)\uE001/g;

export function parseInline(text: string): Inline[] {
  const clean = text.replace(/[\uE000\uE001]/g, "");
  const codes: string[] = [];
  let masked = "";
  let last = 0;
  for (const span of findCodeSpans(clean)) {
    masked += clean.slice(last, span.start) + MARK_OPEN + codes.length + MARK_CLOSE;
    codes.push(span.content);
    last = span.end;
  }
  masked += clean.slice(last);
  return parseMasked(masked, codes, true);
}

function parseMasked(text: string, codes: string[], autolink: boolean): Inline[] {
  const re = new RegExp(INLINE_SOURCE, "g");
  const out: Inline[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const g = match.groups ?? {};
    const emphasis =
      g.strongText !== undefined ||
      g.delText !== undefined ||
      g.emText !== undefined ||
      g.em2Text !== undefined;
    if (emphasis && start > 0 && NO_EMPHASIS_AFTER.test(text[start - 1])) {
      re.lastIndex = start + 1;
      continue;
    }
    // Inside a link's text a URL stays text, so links never nest.
    if (g.url !== undefined && !autolink) continue;
    if (start > last) pushText(out, text.slice(last, start), codes);
    last = start + match[0].length;
    if (g.lImgUrl !== undefined) {
      out.push(imageOrBadge(unmask(g.lImgAlt, codes), g.lImgUrl, g.lImgHref));
    } else if (g.imgUrl !== undefined) {
      out.push(imageOrBadge(unmask(g.imgAlt, codes), g.imgUrl, null));
    } else if (g.linkUrl !== undefined) {
      out.push({ kind: "link", url: g.linkUrl, children: parseMasked(g.linkText, codes, false) });
    } else if (g.url !== undefined) {
      for (const segment of linkify(match[0])) {
        if (segment.kind === "text") pushText(out, segment.text, codes);
        else out.push({ kind: "link", url: segment.url, children: [{ kind: "text", text: segment.url }] });
      }
    } else if (g.strongText !== undefined) {
      out.push({ kind: "strong", children: parseMasked(g.strongText, codes, autolink) });
    } else if (g.delText !== undefined) {
      out.push({ kind: "del", children: parseMasked(g.delText, codes, autolink) });
    } else if (g.emText !== undefined) {
      out.push({ kind: "em", children: parseMasked(g.emText, codes, autolink) });
    } else if (g.em2Text !== undefined) {
      out.push({ kind: "em", children: parseMasked(g.em2Text, codes, autolink) });
    }
  }
  if (last < text.length) pushText(out, text.slice(last), codes);
  return out;
}

/** Plain text with code markers turned back into code nodes. */
function pushText(out: Inline[], text: string, codes: string[]) {
  let last = 0;
  for (const match of text.matchAll(MARK_RE)) {
    const start = match.index ?? 0;
    if (start > last) pushPlain(out, text.slice(last, start));
    out.push({ kind: "code", text: codes[Number(match[1])] ?? "" });
    last = start + match[0].length;
  }
  if (last < text.length) pushPlain(out, text.slice(last));
}

function pushPlain(out: Inline[], text: string) {
  const decoded = decodeEntities(text);
  const prev = out[out.length - 1];
  if (prev?.kind === "text") prev.text += decoded;
  else out.push({ kind: "text", text: decoded });
}

/** Alt text with code markers turned back into their source text. */
function unmask(text: string, codes: string[]): string {
  return text.replace(MARK_RE, (_, idx: string) => codes[Number(idx)] ?? "");
}

function imageOrBadge(alt: string, url: string, href: string | null): Inline {
  const badge = shieldsBadge(url);
  if (badge) return { kind: "badge", label: badge.label || alt, tone: badge.tone, url: href };
  // Remote images can't load under the CSP; link to the image, or to
  // where a linked image points.
  return { kind: "image", alt: alt.trim() || "image", url: href ?? url };
}

// --------------------------------------------------------------- badges

/**
 * `https://img.shields.io/badge/<label>-<message>-<color>` (label optional).
 * In each part `--` is a literal dash, `__` a literal underscore and `_` a
 * space.
 */
export function shieldsBadge(url: string): { label: string; tone: BadgeTone } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "img.shields.io") return null;
  const match = /^\/badge\/(.+)$/.exec(parsed.pathname);
  if (!match) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[1]).replace(/\.(svg|png)$/, "");
  } catch {
    return null;
  }
  const parts = splitShieldsPath(path);
  if (parts.length < 2) return null;
  const color = parts[parts.length - 1];
  const text = parts.slice(0, -1).filter(Boolean).join(": ");
  return { label: text, tone: toneFor(color) };
}

/** Split on single `-`, decoding `--`, `__` and `_` in each part. */
function splitShieldsPath(path: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    const next = path[i + 1];
    if ((ch === "-" || ch === "_") && next === ch) {
      current += ch;
      i++;
    } else if (ch === "-") {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch === "_" ? " " : ch;
    }
  }
  parts.push(current.trim());
  return parts;
}

function toneFor(color: string): BadgeTone {
  const c = color.toLowerCase();
  if (["red", "critical", "crimson"].includes(c)) return "danger";
  if (["orange", "yellow", "important", "yellowgreen", "amber"].includes(c)) return "warning";
  if (["green", "brightgreen", "success"].includes(c)) return "success";
  if (["blue", "informational", "blueviolet", "lightblue"].includes(c)) return "accent";
  return "neutral";
}

// ----------------------------------------------------------- truncation

function inlineLength(node: Inline): number {
  switch (node.kind) {
    case "text":
    case "code":
      return node.text.length;
    case "badge":
      return node.label.length;
    case "image":
      return node.alt.length;
    default:
      return node.children.reduce((sum, child) => sum + inlineLength(child), 0);
  }
}

/** Visible characters in parsed blocks: what the collapse limit counts. */
export function blocksLength(blocks: Block[]): number {
  return blocks.reduce(
    (sum, block) =>
      sum + (block.kind === "code" ? block.text.length : block.children.reduce((s, c) => s + inlineLength(c), 0)),
    0,
  );
}

const ELLIPSIS: Inline = { kind: "text", text: "…" };

/**
 * Keep the first `max` visible characters. Cutting the parsed tree (not
 * the source) means a cut never leaves half a link or a stray `**`.
 */
export function truncateBlocks(blocks: Block[], max: number): Block[] {
  if (blocksLength(blocks) <= max) return blocks;
  const out: Block[] = [];
  let budget = max;
  for (const block of blocks) {
    if (block.kind === "code") {
      if (block.text.length <= budget) {
        out.push(block);
        budget -= block.text.length;
        continue;
      }
      out.push({ kind: "code", text: `${block.text.slice(0, budget).trimEnd()}…` });
      return out;
    }
    const cut = truncateInlines(block.children, budget);
    out.push({ ...block, children: cut.nodes });
    if (cut.cut) return out;
    budget -= cut.used;
  }
  // Every kept block fit exactly; mark that more follows.
  out.push({ kind: "paragraph", children: [ELLIPSIS] });
  return out;
}

function truncateInlines(nodes: Inline[], budget: number): { nodes: Inline[]; used: number; cut: boolean } {
  const out: Inline[] = [];
  let used = 0;
  for (const node of nodes) {
    const length = inlineLength(node);
    if (used + length <= budget) {
      out.push(node);
      used += length;
      continue;
    }
    const room = budget - used;
    if (node.kind === "text") {
      out.push({ kind: "text", text: `${node.text.slice(0, room).trimEnd()}…` });
    } else if (node.kind === "code") {
      if (room > 0) out.push({ kind: "code", text: node.text.slice(0, room) });
      out.push(ELLIPSIS);
    } else if ("children" in node) {
      out.push({ ...node, children: truncateInlines(node.children, room).nodes });
    } else {
      out.push(ELLIPSIS);
    }
    return { nodes: out, used: budget, cut: true };
  }
  return { nodes: out, used, cut: false };
}
