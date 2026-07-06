/**
 * Trailing-edge debounce.
 *
 * Returns a function that delays calling `fn` until `ms` milliseconds have
 * passed since the most recent invocation. Each call resets the timer.
 * A burst of N rapid calls produces exactly ONE eventual call to `fn`,
 * with the arguments of the LAST call in the burst, fired `ms` after
 * that last call. Call `.cancel()` on the returned function to abort a
 * pending invocation; safe to call when nothing is pending.
 *
 * The use case it was built for is window-drag persistence: `onMoved`
 * fires dozens of times per second during a drag, but the final position
 * is only meaningful after the user lets go. With this helper, only the
 * trailing position survives.
 */
export interface DebouncedFunction<TArgs extends unknown[]> {
  (...args: TArgs): void;
  /** Cancel any pending invocation. Idempotent. */
  cancel: () => void;
}

export function trailingDebounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): DebouncedFunction<TArgs> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = ((...args: TArgs): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as DebouncedFunction<TArgs>;

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}
