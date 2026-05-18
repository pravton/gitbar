import { ChevronDown, RefreshCw, Settings } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";

interface StripProps {
  prCount: number;
  draftCount: number;
  issueCount: number;
  updatedAt: Date | null;
  refreshing: boolean;
  isCompact: boolean;
  onRefresh: () => void;
  onSettings: () => void;
  onToggle: () => void;
}

export function Strip({
  prCount,
  draftCount,
  issueCount,
  updatedAt,
  refreshing,
  isCompact,
  onRefresh,
  onSettings,
  onToggle,
}: StripProps) {
  return (
    <section
      data-tauri-drag-region
      onDoubleClick={onToggle}
      className="flex h-screen min-h-12 items-center justify-between gap-3 border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-[var(--text-primary)] shadow-2xl"
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="shrink-0 text-lg leading-none">
          🌤️
        </span>
        <div data-tauri-drag-region className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {prCount} PRs ({draftCount} drafts) · {issueCount} issues
          </p>
          <p className="truncate text-[11px] text-[var(--text-secondary)]">
            {updatedAt ? `Updated ${timeAgo(updatedAt.toISOString())}` : "Not updated"}
          </p>
        </div>
      </div>

      <div className="no-drag flex shrink-0 items-center gap-1">
        <button type="button" onClick={onSettings} title="Settings" className="icon-button">
          <Settings size={15} />
        </button>
        <button type="button" onClick={onRefresh} title="Refresh" className="icon-button" disabled={refreshing}>
          <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          title={isCompact ? "Expand" : "Collapse"}
          className="icon-button"
        >
          <ChevronDown size={16} />
        </button>
      </div>
    </section>
  );
}
