/**
 * Per-account record of how many comments the user has seen on each PR
 * or issue, stored as `{ [itemUrl]: count }`. Kept per login so switching
 * accounts doesn't mark the other account's items read.
 */
export type SeenCounts = Record<string, number>;

const KEY_PREFIX = "gitbar.comments.seen.";

export function readSeenCounts(login: string): SeenCounts {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY_PREFIX + login) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    );
  } catch {
    return {};
  }
}

export function writeSeenCounts(login: string, seen: SeenCounts): void {
  try {
    localStorage.setItem(KEY_PREFIX + login, JSON.stringify(seen));
  } catch {
    // Storage full or blocked: the indicator just resets next launch.
  }
}

export function clearSeenCounts(login: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + login);
  } catch {
    // Nothing to clean up if storage is blocked.
  }
}

/**
 * Bring the record in line with the current list. Items not seen before
 * start at their current count, which covers first run too (no wall of
 * dots). A count that dropped (a deleted comment) follows it down so the
 * next new comment still registers. Items that left the list are pruned,
 * but only when `complete`: after a partial fetch, missing doesn't mean
 * gone. Returns `seen` itself when nothing changed.
 */
export function reconcileSeenCounts(
  seen: SeenCounts,
  items: ReadonlyArray<{ url: string; comments: number }>,
  complete: boolean,
): SeenCounts {
  const next: SeenCounts = complete ? {} : { ...seen };
  for (const { url, comments } of items) {
    next[url] = Math.min(seen[url] ?? comments, comments);
  }
  const keys = Object.keys(next);
  const unchanged =
    keys.length === Object.keys(seen).length && keys.every((url) => seen[url] === next[url]);
  return unchanged ? seen : next;
}
