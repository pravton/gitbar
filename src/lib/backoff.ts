import type { GitHubError } from "@/types";

/**
 * Decide how to handle a fetch failure.
 *
 *   - `auth` and `partial` never retry — the former requires a user action
 *     (re-paste the PAT), the latter already represents partial success and
 *     the next poll will re-attempt anyway.
 *   - `rate_limited` retries after the server's `retry_after_secs` if
 *     present, otherwise falls back to exponential backoff.
 *   - `network` and `server` retry on exponential backoff.
 *
 * The returned `delaySecs` is the delay until the next attempt. `null` means
 * "do not auto-retry — leave the user with the banner".
 */
export function backoffFor(
  error: GitHubError,
  consecutiveFailures: number,
): { delaySecs: number } | null {
  switch (error.kind) {
    case "auth":
    case "partial":
      return null;
    case "rate_limited":
      if (typeof error.retry_after_secs === "number" && error.retry_after_secs > 0) {
        // Add 1s jitter on top of the server's hint so we don't bash the
        // boundary if the clock is slightly skewed.
        return { delaySecs: error.retry_after_secs + 1 };
      }
      return { delaySecs: exponential(consecutiveFailures) };
    case "network":
    case "server":
      return { delaySecs: exponential(consecutiveFailures) };
    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Exponential backoff capped at 60s.
 *
 *   attempt=0 → 2s   (first failure, retry quickly)
 *   attempt=1 → 4s
 *   attempt=2 → 8s
 *   attempt=3 → 16s
 *   attempt=4 → 32s
 *   attempt=5+ → 60s (cap)
 */
function exponential(consecutiveFailures: number): number {
  const clamped = Math.max(0, Math.min(consecutiveFailures, 5));
  return Math.min(60, 2 ** (clamped + 1));
}
