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
 * ~~strike~~, [links](url), ![images](url), bare URLs, and harmless
 * formatting tags (stripped). Anything else is shown as written.
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

/**
 * Formatting tags GitHub allows in comments that carry no meaning we can
 * show here. They are removed; their text content stays. Any other tag is
 * left as literal text.
 */
const STRIPPED_TAGS =
  "sub|sup|b|i|strong|em|ins|del|s|small|big|span|div|p|kbd|samp|details|summary|picture|source|a|center|font|u|tt|var|mark|abbr|cite|dfn|q|blockquote|dl|dt|dd|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|caption|colgroup|col|hr|h[1-6]";
const STRIPPED_TAG_RE = new RegExp(`</?(?:${STRIPPED_TAGS})(?:\\s[^<>]*)?/?>`, "gi");
const BR_RE = /<br\s*\/?>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;
const IMG_TAG_RE = /<img\s[^<>]*?>/gi;
const ATTR_RE = (name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");

const FENCE_RE = /^ {0,3}(```|~~~)/;

/**
 * Remove HTML comments and formatting tags outside code, and turn `<img>`
 * into markdown image syntax. Code fences and inline code are kept as is.
 */
export function cleanCommentBody(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flushProse = () => {
    if (prose.length > 0) out.push(cleanProse(prose.join("\n")));
    prose = [];
  };
  for (const line of lines) {
    const marker = FENCE_RE.exec(line)?.[1];
    if (fence === null) {
      if (marker) {
        flushProse();
        fence = marker;
        out.push(line);
      } else {
        prose.push(line);
      }
    } else {
      out.push(line);
      if (marker === fence) fence = null;
    }
  }
  flushProse();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanProse(text: string): string {
  // Split on inline code so its contents stay literal.
  return text
    .split(/(`[^`\n]*`)/)
    .map((part, idx) => {
      if (idx % 2 === 1) return part;
      return part
        .replace(HTML_COMMENT_RE, "")
        .replace(IMG_TAG_RE, (tag) => {
          const src = attr(tag, "src");
          if (!src) return "";
          return `![${attr(tag, "alt") ?? "image"}](${src})`;
        })
        .replace(BR_RE, "\n")
        .replace(STRIPPED_TAG_RE, "");
    })
    .join("");
}

function attr(tag: string, name: string): string | null {
  const match = ATTR_RE(name).exec(tag);
  return match ? (match[1] ?? match[2] ?? null) : null;
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
    const marker = FENCE_RE.exec(line)?.[1];
    if (marker) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && FENCE_RE.exec(lines[i])?.[1] !== marker) {
        code.push(lines[i]);
        i++;
      }
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ kind: "heading", children: parseInline(heading[1]) });
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

// `(url)` part of a link or image: no spaces, balanced one level of parens.
const DEST = String.raw`\(\s*(https?:\/\/[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+"[^"]*")?\s*\)`;
const INLINE_RE = new RegExp(
  [
    String.raw`(?<code>\x60+)(?<codeText>[\s\S]*?[^\x60])\k<code>(?!\x60)`,
    String.raw`\[!\[(?<lImgAlt>[^\]]*)\]${DEST.replace("(https", "(?<lImgUrl>https")}\]${DEST.replace("(https", "(?<lImgHref>https")}`,
    String.raw`!\[(?<imgAlt>[^\]]*)\]${DEST.replace("(https", "(?<imgUrl>https")}`,
    String.raw`\[(?<linkText>[^\]]+)\]${DEST.replace("(https", "(?<linkUrl>https")}`,
    // No lookbehind: older macOS WebKit rejects it at parse time.
    String.raw`(?<strongMark>\*\*|__)(?=\S)(?<strongText>[\s\S]*?\S)\k<strongMark>`,
    String.raw`~~(?=\S)(?<delText>[\s\S]*?\S)~~`,
    String.raw`(?<emPre>^|[^\w*])\*(?=[^\s*])(?<emText>[^*\n]*?[^\s*])\*(?![\w*])`,
    String.raw`(?<em2Pre>^|[^\w_])_(?=[^\s_])(?<em2Text>[^_\n]*?[^\s_])_(?![\w_])`,
  ].join("|"),
  "g",
);

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const start = match.index ?? 0;
    if (start > last) pushText(out, text.slice(last, start));
    last = start + match[0].length;
    const g = match.groups ?? {};
    if (g.code !== undefined) {
      out.push({ kind: "code", text: g.codeText.trim() || g.codeText });
    } else if (g.lImgUrl !== undefined) {
      out.push(imageOrBadge(g.lImgAlt, g.lImgUrl, g.lImgHref));
    } else if (g.imgUrl !== undefined) {
      out.push(imageOrBadge(g.imgAlt, g.imgUrl, null));
    } else if (g.linkUrl !== undefined) {
      out.push({ kind: "link", url: g.linkUrl, children: parseInline(g.linkText) });
    } else if (g.strongText !== undefined) {
      out.push({ kind: "strong", children: parseInline(g.strongText) });
    } else if (g.delText !== undefined) {
      out.push({ kind: "del", children: parseInline(g.delText) });
    } else if (g.emText !== undefined) {
      if (g.emPre) pushText(out, g.emPre);
      out.push({ kind: "em", children: parseInline(g.emText) });
    } else if (g.em2Text !== undefined) {
      if (g.em2Pre) pushText(out, g.em2Pre);
      out.push({ kind: "em", children: parseInline(g.em2Text) });
    }
  }
  if (last < text.length) pushText(out, text.slice(last));
  return out;
}

/** Plain text, with bare URLs turned into links. */
function pushText(out: Inline[], text: string) {
  for (const segment of linkify(text)) {
    if (segment.kind === "text") out.push({ kind: "text", text: segment.text });
    else out.push({ kind: "link", url: segment.url, children: [{ kind: "text", text: segment.url }] });
  }
}

function imageOrBadge(alt: string, url: string, href: string | null): Inline {
  const badge = shieldsBadge(url);
  if (badge) return { kind: "badge", label: badge.label || alt, tone: badge.tone, url: href };
  // Remote images can't load under the CSP; show a link to the image or
  // to where the linked image points.
  return { kind: "image", alt: alt.trim() || "image", url: href ?? url };
}

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
