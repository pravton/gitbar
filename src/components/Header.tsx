import { forwardRef, useEffect, useRef, useState } from "react";
import {
  AlignJustify,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  CircleAlert,
  CircleHelp,
  Eye,
  GitPullRequest,
  type LucideIcon,
  MoreHorizontal,
  RefreshCw,
  Rows3,
  Settings,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sparkline } from "@/components/Sparkline";
import type { Density } from "@/hooks/useDensityMode";
import { cn, timeAgo } from "@/lib/utils";
import type { HistorySample } from "@/types";

export type Tab = "prs" | "issues";

interface HeaderProps {
  prCount: number;
  /** PRs blocked on the viewer's review. Surfaced as its own stat
      tile so the most actionable signal has a stable place to land. */
  reviewRequestedCount: number;
  issueCount: number;
  updatedAt: Date | null;
  refreshing: boolean;
  /** No fetch has succeeded yet: the tiles show a placeholder, not a false 0. */
  countsUnknown?: boolean;
  collapsed: boolean;
  density: Density;
  /** Which list is currently active. Drives the active-tile highlight. */
  activeTab: Tab;
  /** True iff the `reviewRequestedOnly` filter dimension is on.
      Drives the active state of the review StatTile and which
      filter the PR + Review tile clicks set. */
  reviewFilterOn: boolean;
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
  onTabChange: (tab: Tab) => void;
  /** Fired by the PR StatTile in addition to onTabChange("prs").
      App uses it to clear the `reviewRequestedOnly` filter so the
      tile's count matches what the user sees in the list. */
  onPRTileClick: () => void;
  /** Fired by the Review StatTile in addition to onTabChange("prs").
      App uses it to toggle `reviewRequestedOnly` (set if currently
      off, clear if currently on). */
  onReviewTileClick: () => void;
  /** 24-hour ring buffer of count samples. Each tile pulls its own
      series out of this. Empty during cold start (until the first
      refresh lands) at which point the tiles render without their
      sparklines. */
  history: HistorySample[];
}

function moodEmoji(total: number): { emoji: string; label: string } {
  if (total <= 3) return { emoji: "☀️", label: "Clear skies" };
  if (total <= 7) return { emoji: "🌤️", label: "Partly cloudy" };
  if (total <= 15) return { emoji: "🌧️", label: "It's raining" };
  return { emoji: "⛈️", label: "Storm" };
}

export const Header = forwardRef<HTMLElement, HeaderProps>(function Header(
  {
    prCount,
    reviewRequestedCount,
    issueCount,
    updatedAt,
    refreshing,
    countsUnknown = false,
    collapsed,
    density,
    activeTab,
    reviewFilterOn,
    hasGroups,
    allGroupsExpanded,
    onRefresh,
    onSettings,
    onHelp,
    onToggleDensity,
    onToggleAllGroups,
    onToggleCollapsed,
    onTabChange,
    onPRTileClick,
    onReviewTileClick,
    history,
  },
  ref,
) {
  const total = prCount + issueCount;
  const mood = moodEmoji(total);
  const appWindow = getCurrentWindow();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape close the kebab menu. Registered only when the
  // menu is open so we don't have a permanent document-level listener.
  // Escape listens on window in the capture phase, ahead of every document
  // listener, so it closes only the menu: not Settings underneath it, and not
  // ListView's selection or comments panels.
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
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

  const updatedLabel = updatedAt ? `Updated ${timeAgo(updatedAt.toISOString())}` : "Updated never";

  // Tile click handlers. Each tile does up to three things:
  //   1. Switch to its associated tab.
  //   2. Toggle / clear the `reviewRequestedOnly` filter so the
  //      view matches the tile's count (PR tile clears it, Review
  //      tile toggles it, Issues tile leaves it alone).
  //   3. If the panel is collapsed, expand it so the user can see
  //      the result of (1)+(2).
  //
  // Header-level double-click was tried but conflicts with macOS's
  // built-in title-bar double-click action (zoom / minimize, set in
  // System Settings -> Desktop & Dock). Since `data-tauri-drag-region`
  // marks the element as a title-bar surface at the OS level, the OS
  // action fires in addition to any JS handler and there's no portable
  // way to suppress it. The chevron button stays the dedicated toggle.
  const expandIfCollapsed = () => {
    if (collapsed) onToggleCollapsed();
  };
  const onPRTile = () => {
    onTabChange("prs");
    onPRTileClick();
    expandIfCollapsed();
  };
  const onReviewTile = () => {
    onTabChange("prs");
    onReviewTileClick();
    expandIfCollapsed();
  };
  const onIssuesTile = () => {
    onTabChange("issues");
    expandIfCollapsed();
  };

  return (
    <header
      ref={ref}
      data-tauri-drag-region
      className="shrink-0 border-b border-[var(--border)] px-3 py-2"
    >
      {/* Row 1: identity. Mood emoji + label only; counts have
          moved into the tile strip below so the numbers aren't
          duplicated against the tabs. Subtitle "Updated Xs ago"
          previously below the chips is now a tooltip on the
          refresh button. */}
      <div data-tauri-drag-region className="flex items-center justify-between gap-2">
        <div
          data-tauri-drag-region
          className="flex min-w-0 items-center gap-2"
          title={mood.label}
        >
          <span
            aria-hidden
            className="leading-none"
            style={{ fontSize: 22 }}
          >
            {mood.emoji}
          </span>
          <span
            data-tauri-drag-region
            className="truncate text-[12px] text-[var(--text-secondary)]"
          >
            {mood.label}
          </span>
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
            title={`Refresh (R) · ${updatedLabel}`}
            aria-label={`Refresh. ${updatedLabel}`}
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
                className="absolute top-full right-0 z-50 mt-1 min-w-[200px] rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] py-1 text-[12px] shadow-lg"
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

      {/* Row 2: stat tile strip. Always three tiles on one row, whatever the
          counts or window width, so a count reaching 0 can't remove a row and
          move the list, and the review tile can't vanish while its filter is
          on. A count of 0 is dimmed. Below 384px there's no room for the
          sparklines; StatTile drops them. */}
      <div className="no-drag mt-2 grid grid-cols-3 gap-1.5">
        <StatTile
          icon={GitPullRequest}
          count={prCount}
          unknown={countsUnknown}
          label="PRs"
          active={activeTab === "prs" && !reviewFilterOn}
          onClick={onPRTile}
          tone="default"
          trend={history.map((s) => s.pr_count)}
        />
        <StatTile
          icon={Eye}
          count={reviewRequestedCount}
          unknown={countsUnknown}
          label="review"
          active={activeTab === "prs" && reviewFilterOn}
          onClick={onReviewTile}
          tone="accent"
          trend={history.map((s) => s.review_requested)}
        />
        <StatTile
          icon={CircleAlert}
          count={issueCount}
          unknown={countsUnknown}
          label="issues"
          active={activeTab === "issues"}
          onClick={onIssuesTile}
          tone="default"
          trend={history.map((s) => s.issue_count)}
        />
      </div>
    </header>
  );
});

/**
 * One stat tile in the header row. Three of these sit side by
 * side (PRs, Review, Issues) and act as the primary "glanceable
 * summary" of the panel. Each tile is a click target that routes
 * to the relevant list / view.
 *
 * Visual:
 *   default state -> subtle hairline border, neutral text
 *   active        -> accent border + accent-tinted bg, accent number
 *   tone=accent   -> review-requested tile; number colored amber
 *                    regardless of active state so the most
 *                    actionable signal stays visually distinct
 *
 * This shape is intentionally extensible. Future "Actions",
 * "Agents", "CI failures" tiles would be additional StatTile
 * instances dropped into the same strip.
 */
interface StatTileProps {
  icon: LucideIcon;
  count: number;
  /** Show a placeholder instead of `count`, which isn't known yet. */
  unknown: boolean;
  label: string;
  active: boolean;
  onClick: () => void;
  /** "accent" highlights the count itself in amber (used for the
      review-requested tile). "default" is neutral. */
  tone: "default" | "accent";
  /** 24-hour series of this tile's count. Rendered as a sparkline
      pushed to the right edge of the tile. Empty or <2 samples =
      no sparkline (cold start; the tile renders count + label
      only). */
  trend: number[];
}

function StatTile({
  icon: Icon,
  count,
  unknown,
  label,
  active,
  onClick,
  tone,
  trend,
}: StatTileProps) {
  const accentNumber = tone === "accent" && count > 0;
  const dimmed = (unknown || count === 0) && !active;
  return (
    <button
      type="button"
      onClick={onClick}
      title={unknown ? `${label}: not loaded yet` : `${count} ${label}`}
      className={cn(
        // The parent grid owns the width. `min-w-0` lets the tile take its
        // third of a narrow window; the label truncates if it ever has to.
        "flex min-w-0 items-center gap-1 rounded-md border px-2 py-1.5 transition outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
        active
          ? "border-[var(--accent)]/40 bg-[var(--accent)]/10"
          : "border-[var(--border)] bg-transparent hover:border-[var(--text-secondary)]/50 hover:bg-[var(--overlay-hover)]",
      )}
    >
      <Icon
        size={12}
        className={cn(
          "shrink-0",
          active || accentNumber ? "text-[var(--accent)]" : "text-[var(--text-secondary)]",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "shrink-0 leading-none font-semibold tabular-nums",
          accentNumber || active
            ? "text-[var(--accent-on-tint)]"
            : dimmed
              ? "text-[var(--text-secondary)]"
              : "text-[var(--text-primary)]",
        )}
        style={{ fontSize: 13 }}
      >
        {unknown ? "\u2013" : count}
      </span>
      <span className="min-w-0 truncate text-[11px] text-[var(--text-secondary)]">
        {label}
      </span>
      <Sparkline
        values={trend}
        width={24}
        height={12}
        className={cn(
          "ml-auto hidden shrink-0 min-[384px]:block",
          active || accentNumber
            ? "text-[var(--accent)]/70"
            : "text-[var(--text-secondary)]/60",
        )}
      />
    </button>
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
