/** Dot and "+N" for comments added since the user last saw an item. */
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[10px] font-semibold text-[var(--accent-on-tint)] tabular-nums"
      aria-label={`${count} new comment${count === 1 ? "" : "s"}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />+{count}
    </span>
  );
}
