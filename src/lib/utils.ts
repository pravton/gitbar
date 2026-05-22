export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function timeAgo(dateStr: string): string {
  const timestamp = new Date(dateStr).getTime();
  if (Number.isNaN(timestamp)) {
    return "unknown";
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks}w ago`;
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) {
    return str;
  }

  return `${str.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Wraps `@tauri-apps/plugin-shell`'s `open` with a same-process
 * scheme check. The Tauri capability scope already restricts the
 * shell-open command at the IPC layer: `tauri.conf.json` sets
 * `plugins.shell.open` to `"https?://.+"`, and the plugin auto-
 * wraps that with `^...$` before compiling the regex (see
 * `tauri-plugin-shell`'s `open_scope` in src/lib.rs), so the
 * effective allowlist is the anchored `^https?://.+$`. This JS-
 * side parse is defense-in-depth: a bad URL is rejected at the
 * call site (with a console warning) instead of becoming a silent
 * IPC error.
 *
 * Every dynamic URL we hand to `open()` originates from GitHub's
 * GraphQL response (PR/issue URLs, deploy URLs). Trusting the wire
 * unconditionally is the wrong default; a single field-injection
 * bug upstream would otherwise become a `shell.open("file:///…")`.
 *
 * Returns a boolean indicating whether the URL was dispatched. Most
 * callers fire-and-forget; the return value is there for tests.
 */
export function safeOpen(
  url: string | null | undefined,
  openImpl: (target: string) => Promise<unknown>,
): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.warn("safeOpen: rejected unparseable URL", url);
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    console.warn(
      "safeOpen: refusing to open non-http(s) URL",
      parsed.protocol,
      url,
    );
    return false;
  }
  void openImpl(url);
  return true;
}
