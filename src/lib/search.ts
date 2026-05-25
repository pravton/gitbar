import type { Issue, PullRequest } from "@/types";

/**
 * Substring search across the fields users actually recognize from
 * a card. Case-insensitive; whitespace-trimmed empty query is a
 * no-op (returns the input list unchanged).
 *
 * Matched fields (per item):
 *   - repository.name_with_owner (e.g. "pravton/gitbar")
 *   - title
 *   - #<number> (e.g. "#137" — matches both the number with and
 *     without the leading "#" so the user can type either).
 *
 * Intentionally NOT searching: PR body, author, labels, CI status.
 * Those would broaden matches too much for a compact widget — the
 * user wants "find the PR called 'foo'" or "everything from
 * cypher-evolution", not full-text grep. Easy to extend later.
 */
export function applySearch<T extends PullRequest | Issue>(
  items: T[],
  query: string,
): T[] {
  const trimmed = query.trim();
  if (trimmed === "") return items;
  const q = trimmed.toLowerCase();
  const numericNeedle = q.replace(/^#/, "");
  return items.filter((item) => {
    if (item.repository.name_with_owner.toLowerCase().includes(q)) return true;
    if (item.title.toLowerCase().includes(q)) return true;
    if (String(item.number) === numericNeedle) return true;
    if (`#${item.number}`.toLowerCase().includes(q)) return true;
    return false;
  });
}
