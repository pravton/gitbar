import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
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
          className="flex min-w-0 items-center gap-1"
          title={mood.label}
        >
          <span aria-hidden className="mr-1 text-base leading-none">
            {mood.emoji}
          </span>
          <CountChip icon={GitPullRequest} count={prCount} label="open PRs" />
          <CountChip icon={CircleAlert} count={issueCount} label="open issues" />
          {draftCount > 0 ? (
            <CountChip
              icon={FilePenLine}
              count={draftCount}
              label="draft PRs"
              muted
            />
          ) : null}
        </div>

        {/* Right: actions (excluded from drag) */}
        <div className="no-drag flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh"
            className="icon-button"
            disabled={refreshing}
          >
            <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
          </button>
          <button type="button" onClick={onSettings} title="Settings" className="icon-button">
            <Settings size={14} />
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
        className="mt-1 truncate text-[10px] text-[var(--text-secondary)]"
      >
        {updatedAt ? `Updated ${timeAgo(updatedAt.toISOString())}` : "Not updated"}
      </p>
    </header>
  );
}

interface CountChipProps {
  icon: typeof GitPullRequest;
  count: number;
  label: string;
  muted?: boolean;
}

function CountChip({ icon: Icon, count, label, muted = false }: CountChipProps) {
  return (
    <span
      data-tauri-drag-region
      title={`${count} ${label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        muted ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]",
      )}
    >
      <Icon size={11} aria-hidden />
      <span className="tabular-nums">{count}</span>
    </span>
  );
}
