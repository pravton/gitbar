import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleHelp,
  FilePenLine,
  GitPullRequest,
  Minus,
  RefreshCw,
  Settings,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn, timeAgo } from "@/lib/utils";

interface HeaderProps {
  prCount: number;
  draftCount: number;
  issueCount: number;
  updatedAt: Date | null;
  refreshing: boolean;
  collapsed: boolean;
  onRefresh: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onToggleCollapsed: () => void;
}

function moodEmoji(total: number): { emoji: string; label: string } {
  if (total <= 3) return { emoji: "☀️", label: "Clear skies" };
  if (total <= 7) return { emoji: "🌤️", label: "Partly cloudy" };
  if (total <= 15) return { emoji: "🌧️", label: "It's raining" };
  return { emoji: "⛈️", label: "Storm" };
}

export function Header({
  prCount,
  draftCount,
  issueCount,
  updatedAt,
  refreshing,
  collapsed,
  onRefresh,
  onSettings,
  onHelp,
  onToggleCollapsed,
}: HeaderProps) {
  const total = prCount + issueCount;
  const mood = moodEmoji(total);
  const appWindow = getCurrentWindow();

  return (
    <header
      data-tauri-drag-region
      className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2"
    >
      <div data-tauri-drag-region className="flex items-center justify-between gap-2">
        {/* Left: mood + count chips. Scales to ~240px without truncation. */}
        <div
          data-tauri-drag-region
          className="flex min-w-0 items-center gap-2"
          title={mood.label}
        >
          <span aria-hidden className="mr-0.5 text-lg leading-none">
            {mood.emoji}
          </span>
          <CountChip
            icon={GitPullRequest}
            count={prCount}
            singular="open PR"
            color="var(--accent)"
          />
          <CountChip
            icon={CircleAlert}
            count={issueCount}
            singular="open issue"
            color="var(--warning)"
          />
          {draftCount > 0 ? (
            <CountChip
              icon={FilePenLine}
              count={draftCount}
              singular="draft PR"
              color="var(--text-secondary)"
            />
          ) : null}
        </div>

        {/* Right: actions (excluded from drag) */}
        <div className="no-drag flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh (R)"
            className="icon-button"
            disabled={refreshing}
          >
            <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
          </button>
          <button type="button" onClick={onSettings} title="Settings (S)" className="icon-button">
            <Settings size={14} />
          </button>
          <button
            type="button"
            onClick={onHelp}
            title="Keyboard shortcuts (?)"
            aria-label="Show keyboard shortcuts"
            className="icon-button"
          >
            <CircleHelp size={14} />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? "Show list" : "Collapse"}
            className="icon-button"
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          <button
            type="button"
            onClick={() => void appWindow.minimize()}
            title="Minimize"
            className="icon-button"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            onClick={() => void appWindow.hide()}
            title="Hide to tray (use tray menu to quit)"
            className="icon-button"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <p
        data-tauri-drag-region
        className="mt-1 truncate text-[11px] text-[var(--text-secondary)]"
      >
        <span className="text-[var(--text-primary)]">{mood.label}</span>
        {updatedAt ? (
          <>
            <span aria-hidden> · </span>
            {timeAgo(updatedAt.toISOString())}
          </>
        ) : null}
      </p>
    </header>
  );
}

interface CountChipProps {
  icon: typeof GitPullRequest;
  count: number;
  /** Singular noun phrase, e.g. "open PR". A trailing `s` is appended when count != 1. */
  singular: string;
  color: string;
}

function CountChip({ icon: Icon, count, singular, color }: CountChipProps) {
  const label = `${singular}${count === 1 ? "" : "s"}`;
  return (
    <span
      data-tauri-drag-region
      title={`${count} ${label}`}
      className="inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium tabular-nums"
      style={{ color }}
    >
      <Icon size={14} aria-hidden />
      <span>{count}</span>
    </span>
  );
}
