import { ChevronDown, ChevronUp, Minus, RefreshCw, Settings, X } from "lucide-react";
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

function rain(count: number) {
  if (count <= 3) return { emoji: "☀️", label: "Clear skies" };
  if (count <= 7) return { emoji: "🌤️", label: "Partly cloudy" };
  if (count <= 15) return { emoji: "🌧️", label: "It's raining" };
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
  const rainState = rain(total);
  const appWindow = getCurrentWindow();

  return (
    <header
      data-tauri-drag-region
      className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3"
    >
      {/* ---- Drag region row (the whole header is draggable) ---- */}
      <div data-tauri-drag-region className="flex items-center justify-between gap-3">
        {/* Left: emoji + counts */}
        <div data-tauri-drag-region className="min-w-0">
          <div data-tauri-drag-region className="flex items-center gap-2">
            <span aria-hidden className="text-base leading-none">{rainState.emoji}</span>
            <h1 className="truncate text-[13px] font-medium">
              {rainState.label} · {prCount} PRs · {issueCount} issues
            </h1>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-[var(--text-secondary)]">
            {draftCount > 0 ? `${draftCount} drafts · ` : ""}
            {updatedAt ? `Updated ${timeAgo(updatedAt.toISOString())}` : "Not updated"}
          </p>
        </div>

        {/* Right: action buttons (excluded from drag) */}
        <div className="no-drag flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh"
            className="icon-button"
            disabled={refreshing}
          >
            <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
          </button>
          <button type="button" onClick={onSettings} title="Settings" className="icon-button">
            <Settings size={15} />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? "Show list" : "Collapse"}
            className="icon-button"
          >
            {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
          <button
            type="button"
            onClick={() => void appWindow.minimize()}
            title="Minimize"
            className="icon-button"
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            onClick={() => void appWindow.hide()}
            title="Hide to tray (use tray menu to quit)"
            className="icon-button"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
