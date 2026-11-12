/**
 * Split text into plain-text and URL segments so bare `http(s)://` links
 * can render as clickable without rendering any HTML (keeps the strict
 * CSP and avoids an XSS surface). Used by `commentMarkdown.ts` for the
 * plain-text runs between markdown tokens.
 */
export type TextSegment = { kind: "text"; text: string } | { kind: "url"; url: string };

const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/g;
// Punctuation that usually ends a sentence rather than the URL.
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;

export function linkify(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const url = raw.replace(TRAILING_PUNCT_RE, "");
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push({ kind: "url", url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
