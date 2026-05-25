import type { Issue, PullRequest } from "@/types";

/**
 * Search across the fields users actually recognize from a card.
 * Case-insensitive; whitespace-trimmed empty query is a no-op
 * (returns the input list unchanged).
 *
 * Two modes:
 *   1. Numeric query (e.g. "42" or "#42") - EXACT number match.
 *      Substring matching on numbers was noisy because "42" hit
 *      "#42", "#421", "#4221", etc. With an exact match the user
 *      gets only the one they meant.
 *   2. Anything else - substring match against repo name and
 *      title.
 *
 * A bare "#" is treated as a no-op (the user is still typing the
 * number) rather than matching every item.
 *
 * Intentionally NOT searching: PR body, author, labels, CI status.
 * Those would broaden matches too much for a compact widget. Easy
 * to extend later if needed.
 */
export function applySearch<T extends PullRequest | Issue>(
  items: T[],
  query: string,
): T[] {
  const trimmed = query.trim();
  if (trimmed === "") return items;
  // The user has typed only "#" so far - they're still composing
  // a number search. Match-nothing would feel broken; match-all
  // would be useless. Treat as a no-op so they see the unfiltered
  // list until they actually type a digit.
  if (trimmed === "#") return items;

  const numericMatch = /^#?(\d+)$/.exec(trimmed);
  if (numericMatch) {
    const wanted = numericMatch[1];
    return items.filter((item) => String(item.number) === wanted);
  }

  const q = trimmed.toLowerCase();
  return items.filter((item) => {
    if (item.repository.name_with_owner.toLowerCase().includes(q)) return true;
    if (item.title.toLowerCase().includes(q)) return true;
    return false;
  });
}
