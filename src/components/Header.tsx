import { Fragment, useEffect, useRef, useState } from "react";
import {
  AlignJustify,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  CircleHelp,
  type LucideIcon,
  MoreHorizontal,
  RefreshCw,
  Rows3,
  Settings,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Density } from "@/hooks/useDensityMode";
import { composeHeadline, type HeadlineSegment } from "@/lib/headline";
import { cn, timeAgo } from "@/lib/utils";

interface HeaderProps {
  prCount: number;
  /** PRs blocked on the viewer's review. Surfaced as the accent
      segment of the headline ("1 needs review"). */
  reviewRequestedCount: number;
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
  reviewRequestedCount,
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
  const headlineSegments = composeHeadline({
    prCount,
    reviewRequestedCount,
    issueCount,
  });
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
        {/* Left: mood glyph + glanceable headline. v0.2 widget look:
            the row used to be 3-4 icon-and-number chips packed
            together; now it's one readable sentence with the numbers
            weighted up and the labels muted. Mood emoji is also
            22px (vs the previous 18px ~lg) so the brand glyph
            anchors the top-left at the size a real widget would. */}
        <div
          data-tauri-drag-region
          className="flex min-w-0 items-center gap-2.5"
          title={mood.label}
        >
          <span
            aria-hidden
            className="leading-none"
            style={{ fontSize: 22 }}
          >
            {mood.emoji}
          </span>
          <Headline segments={headlineSegments} />
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

/**
 * Renders the segments produced by `composeHeadline`. Count
 * segments weight the number up (semibold, primary color) and
 * mute the label; the optional `accent` tone uses the brand
 * amber for the "needs review" call-out. Plain `text` segments
 * are the empty-state phrasing ("Inbox zero").
 *
 * Each segment is joined by a thin muted middle-dot. The container
 * is `min-w-0 truncate`-safe so a long count list wraps cleanly
 * at narrow widths instead of pushing the right-side actions off
 * the panel.
 */
function Headline({ segments }: { segments: HeadlineSegment[] }) {
  return (
    <div
      data-tauri-drag-region
      className="flex min-w-0 items-center gap-1.5 truncate text-[13px] leading-snug"
    >
      {segments.map((segment, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span
              data-tauri-drag-region
              aria-hidden
              className="text-[var(--text-secondary)]"
            >
              ·
            </span>
          ) : null}
          {segment.kind === "count" ? (
            <span
              data-tauri-drag-region
              className="inline-flex shrink-0 items-baseline gap-1 tabular-nums"
              title={`${segment.n} ${segment.label}`}
            >
              <span
                className={cn(
                  "font-semibold",
                  segment.tone === "accent"
                    ? "text-[var(--accent-on-tint)]"
                    : "text-[var(--text-primary)]",
                )}
              >
                {segment.n}
              </span>
              <span className="text-[var(--text-secondary)]">{segment.label}</span>
            </span>
          ) : (
            <span data-tauri-drag-region className="text-[var(--text-secondary)]">
              {segment.text}
            </span>
          )}
        </Fragment>
      ))}
    </div>
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
