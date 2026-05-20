import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface ListSelection<T> {
  /** The currently selected item, or null if nothing is selected. */
  selectedItem: T | null;
  /** Key (URL) of the selected item, or null. */
  selectedKey: string | null;
  /** Select a specific key. Clears selection if null. */
  select: (key: string | null) => void;
  /** Move selection to the next item, wrapping at the end. */
  selectNext: () => void;
  /** Move selection to the previous item, wrapping at the start. */
  selectPrev: () => void;
  /** Clear the selection. */
  clear: () => void;
}

/**
 * Tracks "which list item is selected" by URL key, not by index.
 *
 * Indexing by URL means a refresh that reorders or adds items doesn't
 * randomly snap selection to a different PR — the same URL stays selected
 * if it's still in the list. If the selected URL drops out (filtered, PR
 * closed, etc.), selection clears.
 *
 * Wraparound on next/prev keeps arrow-key navigation flowing — pressing
 * Down at the last item lands you on the first item. Common pattern in
 * compact list UIs.
 */
export function useListSelection<T extends { url: string }>(
  items: T[],
): ListSelection<T> {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Keep the latest items list in a ref so the callbacks below don't need
  // to depend on `items` (which would re-create them every render and
  // invalidate any consumer-level memoization).
  const itemsRef = useRef<T[]>(items);
  itemsRef.current = items;

  // If the selected URL drops out of the visible list, clear selection.
  useEffect(() => {
    if (selectedKey === null) return;
    if (!items.some((item) => item.url === selectedKey)) {
      setSelectedKey(null);
    }
  }, [items, selectedKey]);

  const select = useCallback((key: string | null) => {
    setSelectedKey(key);
  }, []);

  const clear = useCallback(() => setSelectedKey(null), []);

  const selectNext = useCallback(() => {
    const current = itemsRef.current;
    if (current.length === 0) return;
    setSelectedKey((prev) => {
      if (prev === null) return current[0].url;
      const idx = current.findIndex((item) => item.url === prev);
      if (idx === -1) return current[0].url;
      const next = (idx + 1) % current.length;
      return current[next].url;
    });
  }, []);

  const selectPrev = useCallback(() => {
    const current = itemsRef.current;
    if (current.length === 0) return;
    setSelectedKey((prev) => {
      if (prev === null) return current[current.length - 1].url;
      const idx = current.findIndex((item) => item.url === prev);
      if (idx === -1) return current[current.length - 1].url;
      const next = (idx - 1 + current.length) % current.length;
      return current[next].url;
    });
  }, []);

  const selectedItem = useMemo<T | null>(
    () =>
      selectedKey === null
        ? null
        : items.find((item) => item.url === selectedKey) ?? null,
    [items, selectedKey],
  );

  // Memoize the returned object so consumers that put it in a useEffect
  // dep array don't see a "new selection" identity every render. The
  // callback identities (select/selectNext/...) are already stable from
  // their own useCallback, so the only things that legitimately change
  // are selectedKey and the (recomputed-by-find) selectedItem.
  return useMemo(
    () => ({ selectedItem, selectedKey, select, selectNext, selectPrev, clear }),
    [selectedItem, selectedKey, select, selectNext, selectPrev, clear],
  );
}
