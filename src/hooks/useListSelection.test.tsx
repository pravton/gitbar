import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListSelection } from "@/hooks/useListSelection";

type Item = { url: string };
const items = (...urls: string[]): Item[] => urls.map((url) => ({ url }));

describe("useListSelection", () => {
  it("starts with no selection", () => {
    const { result } = renderHook(() => useListSelection(items("a", "b", "c")));
    expect(result.current.selectedKey).toBeNull();
    expect(result.current.selectedItem).toBeNull();
  });

  it("selectNext from null lands on the first item", () => {
    const { result } = renderHook(() => useListSelection(items("a", "b", "c")));
    act(() => result.current.selectNext());
    expect(result.current.selectedKey).toBe("a");
  });

  it("selectPrev from null lands on the LAST item (so Up at the top wraps sensibly)", () => {
    const { result } = renderHook(() => useListSelection(items("a", "b", "c")));
    act(() => result.current.selectPrev());
    expect(result.current.selectedKey).toBe("c");
  });

  it("selectNext wraps from last to first", () => {
    const { result } = renderHook(() => useListSelection(items("a", "b", "c")));
    act(() => result.current.select("c"));
    act(() => result.current.selectNext());
    expect(result.current.selectedKey).toBe("a");
  });

  it("selectPrev wraps from first to last", () => {
    const { result } = renderHook(() => useListSelection(items("a", "b", "c")));
    act(() => result.current.select("a"));
    act(() => result.current.selectPrev());
    expect(result.current.selectedKey).toBe("c");
  });

  it("selection survives a list change that still contains the URL", () => {
    const { result, rerender } = renderHook(({ list }) => useListSelection(list), {
      initialProps: { list: items("a", "b", "c") },
    });
    act(() => result.current.select("b"));
    expect(result.current.selectedKey).toBe("b");

    // Reorder + add an item. `b` is still present.
    rerender({ list: items("x", "b", "a", "c") });
    expect(result.current.selectedKey).toBe("b");
    expect(result.current.selectedItem?.url).toBe("b");
  });

  it("clears selection when the selected URL drops out of the list", () => {
    const { result, rerender } = renderHook(({ list }) => useListSelection(list), {
      initialProps: { list: items("a", "b", "c") },
    });
    act(() => result.current.select("b"));

    // Filter removes `b`.
    rerender({ list: items("a", "c") });
    expect(result.current.selectedKey).toBeNull();
  });

  it("select(null) and clear() both null the selection", () => {
    const { result } = renderHook(() => useListSelection(items("a", "b")));
    act(() => result.current.select("a"));
    act(() => result.current.select(null));
    expect(result.current.selectedKey).toBeNull();

    act(() => result.current.select("b"));
    act(() => result.current.clear());
    expect(result.current.selectedKey).toBeNull();
  });

  it("does nothing on selectNext/Prev when the list is empty", () => {
    const { result } = renderHook(() => useListSelection(items()));
    act(() => result.current.selectNext());
    expect(result.current.selectedKey).toBeNull();
    act(() => result.current.selectPrev());
    expect(result.current.selectedKey).toBeNull();
  });

  it("if selected URL is missing from a fresh items list, next/prev start fresh", () => {
    const { result, rerender } = renderHook(({ list }) => useListSelection(list), {
      initialProps: { list: items("a", "b", "c") },
    });
    act(() => result.current.select("z")); // not in the list
    rerender({ list: items("a", "b", "c") });
    // The auto-clear effect runs because "z" isn't in the list.
    expect(result.current.selectedKey).toBeNull();

    // selectNext from cleared state goes to the first item.
    act(() => result.current.selectNext());
    expect(result.current.selectedKey).toBe("a");
  });
});
