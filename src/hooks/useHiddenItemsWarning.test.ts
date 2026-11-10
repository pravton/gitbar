import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { clearHiddenItemsWarning, useHiddenItemsWarning } from "@/hooks/useHiddenItemsWarning";

describe("useHiddenItemsWarning", () => {
  it("is on by default", () => {
    const { result } = renderHook(() => useHiddenItemsWarning("alice"));
    expect(result.current.shown).toBe(true);
  });

  it("remembers the choice per account", () => {
    const { result, rerender } = renderHook(({ login }) => useHiddenItemsWarning(login), {
      initialProps: { login: "alice" as string | null },
    });
    act(() => result.current.setShown(false));
    expect(result.current.shown).toBe(false);

    rerender({ login: "bob" });
    expect(result.current.shown).toBe(true);

    const relaunched = renderHook(() => useHiddenItemsWarning("alice"));
    expect(relaunched.result.current.shown).toBe(false);
    act(() => relaunched.result.current.setShown(true));
    expect(renderHook(() => useHiddenItemsWarning("alice")).result.current.shown).toBe(true);
  });

  it("starts on again for an account that was removed", () => {
    const { result } = renderHook(() => useHiddenItemsWarning("alice"));
    act(() => result.current.setShown(false));
    clearHiddenItemsWarning("alice");
    expect(renderHook(() => useHiddenItemsWarning("alice")).result.current.shown).toBe(true);
  });

  it("ignores a change with no account", () => {
    const { result } = renderHook(() => useHiddenItemsWarning(null));
    act(() => result.current.setShown(false));
    expect(result.current.shown).toBe(true);
    expect(localStorage.length).toBe(0);
  });
});
