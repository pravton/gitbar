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
