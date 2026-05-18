import { ChevronUp, Minus, RefreshCw, Settings, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn, timeAgo } from "@/lib/utils";

interface HeaderProps {
  prCount: number;
  issueCount: number;
  updatedAt: Date | null;
  refreshing: boolean;
  onRefresh: () => void;
  onSettings: () => void;
  onToggleCompact: () => void;
}

function rain(count: number) {
  if (count <= 3) return { emoji: "☀️", label: "Clear" };
  if (count <= 7) return { emoji: "🌤️", label: "Light" };
  if (count <= 15) return { emoji: "🌧️", label: "It's raining" };
  return { emoji: "⛈️", label: "Storm" };
}

export function Header({ prCount, issueCount, updatedAt, refreshing, onRefresh, onSettings, onToggleCompact }: HeaderProps) {
  const total = prCount + issueCount;
  const rainState = rain(total);
  const appWindow = getCurrentWindow();

  return (
    <header data-tauri-drag-region className="border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3">
      <div data-tauri-drag-region className="flex items-center justify-between gap-3">
        <div data-tauri-drag-region className="min-w-0">
          <div data-tauri-drag-region className="flex items-center gap-2">
            <span aria-hidden>{rainState.emoji}</span>
            <h1 className="truncate text-sm font-semibold">{rainState.label}</h1>
          </div>
          <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
            {prCount} PRs · {issueCount} issues · {updatedAt ? `Updated ${timeAgo(updatedAt.toISOString())}` : "Not updated"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
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
          <button type="button" onClick={onToggleCompact} title="Collapse" className="icon-button">
            <ChevronUp size={16} />
          </button>
          <button type="button" onClick={() => void appWindow.minimize()} title="Minimize" className="icon-button">
            <Minus size={15} />
          </button>
          <button type="button" onClick={() => void appWindow.close()} title="Close" className="icon-button danger">
            <X size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
