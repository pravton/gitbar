import { useEffect, useRef, useState } from "react";
import {
  AlignJustify,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  CircleAlert,
  CircleHelp,
  FilePenLine,
  GitPullRequest,
  type LucideIcon,
  MoreHorizontal,
  RefreshCw,
  Rows3,
  Settings,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Density } from "@/hooks/useDensityMode";
import { cn, timeAgo } from "@/lib/utils";

interface HeaderProps {
  prCount: number;
  draftCount: number;
  issueCount: number;
  updatedAt: Date | null;
  refreshing: boolean;
  collapsed: boolean;
  density: Density;
  /** True iff at least one repo group is being rendered. Drives the
      visibility of the "Expand/collapse all groups" menu item. */
  hasGroups: boolean;
  /** True iff every known repo group is currently expanded. Drives
      the menu item's label (expand vs collapse). */
  allGroupsExpanded: boolean;
  onRefresh: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onToggleDensity: () => void;
  onToggleAllGroups: () => void;
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
  density,
  hasGroups,
  allGroupsExpanded,
  onRefresh,
  onSettings,
  onHelp,
  onToggleDensity,
  onToggleAllGroups,
  onToggleCollapsed,
}: HeaderProps) {
  const total = prCount + issueCount;
  const mood = moodEmoji(total);
  const appWindow = getCurrentWindow();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape close the kebab menu. Registered only when the
  // menu is open so we don't have a permanent document-level listener.
  // Escape uses stopImmediatePropagation so ListView's selection-clear
  // handler doesn't also fire on the same keystroke.
  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <header
      data-tauri-drag-region
      className="shrink-0 border-b border-[var(--border)] px-3 py-2"
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

        {/* Right: actions (excluded from drag).
         *
         * Layout principle: frequent + window-control on the strip,
         * rare actions inside the kebab. Visible left-to-right is
         * Refresh, kebab, Collapse, Hide. Four icons total, down
         * from six. Settings and Help moved into the kebab; Minimize
         * was dropped because for a frameless always-on-top panel
         * it's effectively a worse Hide (the dock representation is
         * hard to restore without the tray menu).
         */}
        <div className="no-drag flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh (R)"
            aria-label="Refresh"
            className="icon-button"
            disabled={refreshing}
          >
            <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
          </button>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              title="More"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="icon-button"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen ? (
              <div
                role="menu"
                data-testid="header-menu"
                className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] py-1 text-[12px] shadow-lg"
              >
                {/* Section 1: View. Layout-affecting toggles that
                    change how items are presented. Hidden items here
                    (no groups, etc.) leave the section intact; if all
                    items in a section were hidden we'd drop the
                    separator too, but that's not currently reachable
                    because "Compact view" is always visible. */}
                <MenuItem
                  icon={density === "compact" ? Rows3 : AlignJustify}
                  label={density === "compact" ? "Comfortable view" : "Compact view"}
                  hint=""
                  onSelect={() => {
                    setMenuOpen(false);
                    onToggleDensity();
                  }}
                />
                {hasGroups ? (
                  <MenuItem
                    icon={allGroupsExpanded ? ChevronsDownUp : ChevronsUpDown}
                    label={allGroupsExpanded ? "Collapse all groups" : "Expand all groups"}
                    hint="G"
                    onSelect={() => {
                      setMenuOpen(false);
                      onToggleAllGroups();
                    }}
                  />
                ) : null}
                <MenuSeparator />
                {/* Section 2: App. Modal actions that swap the
                    primary surface. */}
                <MenuItem
                  icon={Settings}
                  label="Settings"
                  hint="S"
                  onSelect={() => {
                    setMenuOpen(false);
                    onSettings();
                  }}
                />
                <MenuSeparator />
                {/* Section 3: Help. Reference-only actions. */}
                <MenuItem
                  icon={CircleHelp}
                  label="Keyboard shortcuts"
                  hint="?"
                  onSelect={() => {
                    setMenuOpen(false);
                    onHelp();
                  }}
                />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? "Show list" : "Collapse"}
            aria-label={collapsed ? "Show list" : "Collapse"}
            className="icon-button"
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          <button
            type="button"
            onClick={() => void appWindow.hide()}
            title="Hide to tray (use tray menu to quit)"
            aria-label="Hide to tray"
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
  icon: LucideIcon;
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

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  /** Keybind hint rendered right-aligned, e.g. "S" or "?". Empty string
      omits the kbd glyph entirely (used by items without a hotkey). */
  hint: string;
  onSelect: () => void;
}

function MenuItem({ icon: Icon, label, hint, onSelect }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
    >
      <span className="flex items-center gap-2">
        <Icon size={13} aria-hidden />
        {label}
      </span>
      {hint ? <span className="kbd">{hint}</span> : null}
    </button>
  );
}

/** Thin divider between sections of the kebab menu. `role="separator"`
    so screen readers announce the grouping boundary; the visual is a
    1px line in the panel-border tint. */
function MenuSeparator() {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className="my-1 h-px bg-[var(--border)]"
    />
  );
}
