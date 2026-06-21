import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trailingDebounce } from "@/lib/debounce";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("trailingDebounce", () => {
  it("does not call fn before the delay elapses", () => {
    const fn = vi.fn();
    const debounced = trailingDebounce(fn, 200);
    debounced();
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls fn exactly once after the delay", () => {
    const fn = vi.fn();
    const debounced = trailingDebounce(fn, 200);
    debounced();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("coalesces a rapid burst into a single trailing call with the LAST args", () => {
    // The whole point of this helper for window-drag persistence: an
    // onMoved storm should collapse into one localStorage write at the
    // final position, not dozens.
    const fn = vi.fn();
    const debounced = trailingDebounce<[number]>(fn, 200);
    debounced(1);
    vi.advanceTimersByTime(50);
    debounced(2);
    vi.advanceTimersByTime(50);
    debounced(3);
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it("each call resets the timer (no early fire mid-burst)", () => {
    const fn = vi.fn();
    const debounced = trailingDebounce(fn, 200);
    debounced();
    vi.advanceTimersByTime(150);
    debounced();
    vi.advanceTimersByTime(150);
    // 300ms total elapsed but timer was reset at the 150ms mark; only
    // 150ms has elapsed since the last call, so fn must not have fired.
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50); // now 200ms since the last call
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel() aborts a pending call", () => {
    const fn = vi.fn();
    const debounced = trailingDebounce(fn, 200);
    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it("cancel() is safe to call when nothing is pending (idempotent)", () => {
    const fn = vi.fn();
    const debounced = trailingDebounce(fn, 200);
    expect(() => debounced.cancel()).not.toThrow();
    debounced();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    // Cancel after firing must also be a no-op.
    expect(() => debounced.cancel()).not.toThrow();
  });

  it("a subsequent call after cancel still schedules normally", () => {
    const fn = vi.fn();
    const debounced = trailingDebounce(fn, 200);
    debounced();
    debounced.cancel();
    debounced(); // fresh call — should fire after the next 200ms
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
