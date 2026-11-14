/**
 * Split text into plain-text and URL segments so bare `http(s)://` links
 * can render as clickable without rendering any HTML (keeps the strict
 * CSP and avoids an XSS surface). Used by `commentMarkdown.ts` to trim
 * sentence punctuation off bare URLs.
 */
export type TextSegment = { kind: "text"; text: string } | { kind: "url"; url: string };

const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/g;
// Punctuation that usually ends a sentence rather than the URL.
const TRAILING_PUNCT = ".,;:!?";

/** Strip trailing punctuation with a loop: `/[.,]+$/` is quadratic on long runs. */
function trimTrailingPunct(url: string): string {
  let end = url.length;
  while (end > 0 && TRAILING_PUNCT.includes(url[end - 1])) end--;
  return url.slice(0, end);
}

export function linkify(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const url = trimTrailingPunct(raw);
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push({ kind: "url", url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
