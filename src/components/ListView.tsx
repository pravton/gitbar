import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Filter, Search, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { cn, safeOpen } from "@/lib/utils";
import { IssueCard } from "@/components/IssueCard";
import { PRCard } from "@/components/PRCard";
import { RepoGroupTile } from "@/components/RepoGroupTile";
import { FilterPopover } from "@/components/FilterPopover";
import { activeFilterCount, applyFilters, deriveOrgs, deriveRepos } from "@/lib/filters";
import { groupPRsByRepo, selectableItems as buildSelectable } from "@/lib/grouping";
import type { PrNavItem } from "@/lib/grouping";
import { applySearch } from "@/lib/search";
import type { Density } from "@/hooks/useDensityMode";
import type { UseFiltersResult } from "@/hooks/useFilters";
import { useListSelection } from "@/hooks/useListSelection";
import type { RetryState } from "@/hooks/useGitHubData";
import type { GitHubError, Issue, PullRequest } from "@/types";

type Tab = "prs" | "issues";

/** A keyboard-nav-selectable row. PRs and group tiles come from
    `selectableItems`; issues are wrapped here. The shared `url` is the
    nav key `useListSelection` indexes on. */
type NavItem = PrNavItem | { kind: "issue"; url: string; issue: Issue };

interface ListViewProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  prs: PullRequest[];
  issues: Issue[];
  loading: boolean;
  error: GitHubError | null;
  retry: RetryState | null;
  partialMessage: string | null;
  /** "comfortable" (full card) or "compact" (single-line card). */
  density?: Density;
  /** Filter state, hoisted to App so the Header's review StatTile
      can toggle `reviewRequestedOnly` in sync with this view's
      filter chip / popover. */
  filterState: UseFiltersResult;
  /**
   * Set of currently-expanded group keys. Lifted out of ListView so the
   * header's "Expand/collapse all" item and the `G` keybind can drive
   * it without coupling Header to grouping internals. ListView still
   * owns the grouping computation (it has the filtered PR list); the
   * EXPANSION state lives one layer up.
   */
  expandedGroups?: Set<string>;
  /** Controlled-component setter for `expandedGroups`. Accepts the
      full `Dispatch<SetStateAction>` shape (concrete value OR
      updater function) so consumers can compose with the latest
      state without losing rapid toggles to stale closures. */
  onExpandedGroupsChange?: Dispatch<SetStateAction<Set<string>>>;
  /** Reports the current group keys up to the parent on each render so
      it can drive expand-all / collapse-all without owning the grouping. */
  onGroupKeysChange?: (keys: string[]) => void;
  /** Triggered by the `G` keybind. App provides the actual logic. */
  onToggleAllGroups?: () => void;
  /**
   * Whether the keyboard-shortcut overlay is currently open. Owned by `App`
   * so the header's `?` button and the `?` keybind share a single source.
   */
  helpOpen: boolean;
  onOpenHelp: () => void;
  onCloseHelp: () => void;
  /** Force-refresh trigger for the `R` hotkey. */
  onRefresh: () => void;
  /** Settings overlay opener for the `S` hotkey. */
  onOpenSettings: () => void;
  /** Triggered by the "Reconnect" button on an auth-kind error banner.
      Wipes the keychain entry + on-disk cache and bounces to onboarding.
      Optional so the existing tests that render `<ListView>` directly
      without auth wiring stay green. */
  onReconnect?: () => void;
}

export function ListView({
  activeTab,
  onTabChange,
  prs,
  issues,
  loading,
  error,
  retry,
  partialMessage,
  density = "comfortable",
  filterState,
  expandedGroups: expandedGroupsProp,
  onExpandedGroupsChange,
  onGroupKeysChange,
  onToggleAllGroups,
  helpOpen,
  onOpenHelp,
  onCloseHelp,
  onRefresh,
  onOpenSettings,
  onReconnect,
}: ListViewProps) {
  const isPrs = activeTab === "prs";
  const [filterOpen, setFilterOpen] = useState(false);

  // Search query. ONE state, shared across both tabs - typing in
  // the PR view and switching to Issues keeps the query in place
  // so the user doesn't have to retype it to scan the same string
  // in the other list. Replaces the tab strip's previous role of
  // "switch the list view" (switching now happens via the StatTile
  // strip in the header) and gives back the row of vertical space
  // as a typed-search affordance. Tied to a ref'd input so the `F`
  // key (next iteration) can focus it from anywhere.
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const orgs = useMemo(() => deriveOrgs(prs), [prs]);
  const repos = useMemo(() => deriveRepos(prs), [prs]);
  const filteredPrs = useMemo(
    () => applyFilters(prs, filterState.filters),
    [prs, filterState.filters],
  );
  const filterCount = activeFilterCount(filterState.filters);
  const filteredOut = isPrs ? prs.length - filteredPrs.length : 0;

  // Search is applied AFTER the filter chips. Matches case-
  // insensitive substring against repo (owner/name), title, and
  // `#N` so a user can type any of the things they'd recognize
  // from the card. Trimmed empty input is a no-op (returns the
  // input list unchanged).
  const searchedPrs = useMemo(
    () => applySearch(filteredPrs, searchQuery),
    [filteredPrs, searchQuery],
  );
  const searchedIssues = useMemo(
    () => applySearch(issues, searchQuery),
    [issues, searchQuery],
  );

  // PR list goes through groupPRsByRepo: 3+ PRs from the same repo
  // collapse into one tile. Issues skip the grouping (issue lists are
  // usually smaller and span more repos; grouping them adds visual
  // weight without saving space).
  const prDisplayItems = useMemo(() => groupPRsByRepo(searchedPrs), [searchedPrs]);

  // Expansion state can be controlled by the parent (App owns it so
  // the header menu's "Expand all / Collapse all" item works) or, in
  // the test render-from-scratch path, fall back to local state.
  // Per-session in both cases; not persisted to localStorage.
  const [localExpanded, setLocalExpanded] = useState<Set<string>>(() => new Set());
  const expandedGroups = expandedGroupsProp ?? localExpanded;
  const setExpandedGroups = onExpandedGroupsChange ?? setLocalExpanded;
  // Functional update so rapid back-to-back toggles (or two
  // simultaneous chevron clicks across different groups inside a
  // React batched-update window) can't drop changes by computing
  // from a stale `expandedGroups` closure.
  const toggleGroup = useCallback(
    (key: string) => {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    },
    [setExpandedGroups],
  );

  // Report the current group keys up so the parent can drive expand-
  // all / collapse-all. Effect-after-render with a memoized key list
  // avoids the parent see-saw that an inline call during render would
  // trigger.
  const groupKeys = useMemo(
    () =>
      prDisplayItems.filter((item) => item.kind === "group").map((item) => item.key),
    [prDisplayItems],
  );
  useEffect(() => {
    onGroupKeysChange?.(groupKeys);
  }, [groupKeys, onGroupKeysChange]);

  // Items fed to useListSelection: visible-and-selectable only, wrapped
  // in a small nav-entry shape (`{ kind, url, … }`) so a single keydown
  // handler can branch on kind. For PRs, collapsed-group children are
  // skipped but the group TILE is selectable (Enter toggles it); for
  // issues we wrap each Issue. The wrappers still carry the real PR /
  // Issue object so keybinds like `D` (open deploy URL) read the right
  // fields off selection.selectedItem.
  const items: NavItem[] = useMemo(() => {
    if (isPrs) {
      return buildSelectable(prDisplayItems, expandedGroups);
    }
    return searchedIssues.map((issue) => ({ kind: "issue", url: issue.url, issue }));
  }, [isPrs, prDisplayItems, expandedGroups, searchedIssues]);
  const selection = useListSelection(items);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Distinct from `items`: how many *visible* rows the user actually
  // sees. With grouping, a collapsed 3-PR group renders one tile but
  // contributes zero selectable items; using `items.length` for the
  // empty-state check would show "No open PRs" right next to a
  // rendered group tile. `prDisplayItems.length` is the right
  // denominator (count of top-level display items, groups + loose PRs).
  const displayCount = isPrs ? prDisplayItems.length : searchedIssues.length;

  // Mirror `selection` into a ref so the document-level keydown effect
  // doesn't need it in its dep array. Without this, every poll that
  // returns a fresh `items` array recomputes `useListSelection`'s memo,
  // propagates a new `selection` identity, and forces us to detach +
  // re-attach the document keydown listener on every refresh tick.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Document-level keyboard nav. Handles arrow keys, Enter, D (deploy),
  // Cmd+1/2 (tab switch), `/` (open filter), `?` (open help), Esc (back
  // out of whatever overlay state is open).
  //
  // While the help overlay is open, *only* Esc has effect. Other keys are
  // inert so the user can't accidentally fire shortcuts off a cheat sheet.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const selection = selectionRef.current;
      // Escape unwinds overlay state regardless of focused element. It
      // intentionally fires BEFORE the isTypingInInput check — otherwise
      // typing in the filter popover's preset-name input would trap the
      // user (no way to dismiss the popover with the keyboard once we
      // consolidated Esc here and dropped FilterPopover's own listener).
      if (event.key === "Escape") {
        if (helpOpen) {
          onCloseHelp();
        } else if (filterOpen) {
          setFilterOpen(false);
        } else if (!isTypingInInput(event.target)) {
          // Don't clobber a text-input cursor with a "clear selection"
          // when the user pressed Esc inside an input that isn't backed
          // by an overlay (defensive — not currently reachable).
          selection.clear();
        }
        return;
      }

      if (isTypingInInput(event.target)) return;

      // Help is open → swallow everything else so the cheat sheet doesn't
      // act as a remote control for the underlying list.
      if (helpOpen) return;

      // Tab switching: Cmd-1 (PRs) / Cmd-2 (Issues).
      if (event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey) {
        if (event.key === "1") {
          event.preventDefault();
          onTabChange("prs");
          return;
        }
        if (event.key === "2") {
          event.preventDefault();
          onTabChange("issues");
          return;
        }
      }

      // Most keys below are unmodified.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case "ArrowDown":
        case "j":
          event.preventDefault();
          selection.selectNext();
          return;
        case "ArrowUp":
        case "k":
          event.preventDefault();
          selection.selectPrev();
          return;
        case "Enter": {
          const sel = selection.selectedItem;
          if (!sel) return;
          event.preventDefault();
          // Enter on a group tile expands/collapses it instead of
          // opening a URL (a group has no single URL to open). Enter on
          // a PR or issue opens its URL.
          if (sel.kind === "group") {
            toggleGroup(sel.url);
          } else {
            safeOpen(sel.url, open);
          }
          return;
        }
        case "d":
        case "D": {
          const sel = selection.selectedItem;
          if (isPrs && sel?.kind === "pr" && hasDeploy(sel.pr)) {
            event.preventDefault();
            safeOpen(sel.pr.deployment_url, open);
          }
          return;
        }
        case "/":
          if (isPrs) {
            event.preventDefault();
            setFilterOpen(true);
          }
          return;
        case "?":
          event.preventDefault();
          onOpenHelp();
          return;
        case "r":
        case "R":
          event.preventDefault();
          onRefresh();
          return;
        case "s":
        case "S":
          event.preventDefault();
          onOpenSettings();
          return;
        case "g":
        case "G":
          // Only relevant when grouping is active (i.e. there's at
          // least one repo group). If the parent didn't wire the
          // callback (test render, no groups), this is inert.
          if (onToggleAllGroups) {
            event.preventDefault();
            onToggleAllGroups();
          }
          return;
        default:
          return;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    filterOpen,
    helpOpen,
    isPrs,
    onCloseHelp,
    onOpenHelp,
    onOpenSettings,
    onRefresh,
    onTabChange,
    onToggleAllGroups,
    toggleGroup,
    // `selection` deliberately not in deps; read via selectionRef inside
    // the handler so a fresh `selection` identity per poll doesn't
    // detach + re-attach the listener.
  ]);

  // Keep the selected card visible. Looks up the rendered card via
  // `data-card-url` so we don't have to thread refs through every child.
  useEffect(() => {
    if (!selection.selectedKey) return;
    const root = scrollRef.current;
    if (!root) return;
    const escaped = cssEscape(selection.selectedKey);
    const el = root.querySelector(`[data-card-url="${escaped}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selection.selectedKey]);

  return (
    <section className="relative flex min-h-0 flex-1 flex-col">
      {/* Search row. Replaces the old tab strip + filter button row
          since the StatTile strip in the header now drives tab
          switching. Search applies to whichever tab is active
          (PRs or Issues) and matches against repo, title, and #N.
          The filter chip only shows on the PRs tab (issues don't
          have the chip-based filter today). */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-2">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 text-[var(--text-secondary)]"
            aria-hidden
          />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              // Esc semantics inside the search input:
              //   - non-empty query: clear it, keep focus so the user
              //     can type again immediately.
              //   - empty query: blur to release focus, letting the
              //     document-level keydown handler take over.
              // stopPropagation prevents ListView's bubble-phase
              // Esc from also firing (which would try to clear the
              // list selection on the same keystroke).
              if (event.key === "Escape") {
                event.stopPropagation();
                if (searchQuery) {
                  event.preventDefault();
                  setSearchQuery("");
                } else {
                  event.currentTarget.blur();
                }
              }
            }}
            placeholder={isPrs ? "Search PRs…" : "Search issues…"}
            aria-label={isPrs ? "Search PRs" : "Search issues"}
            className="w-full rounded-md border border-transparent bg-[hsla(0,0%,100%,0.04)] py-1 pl-7 pr-7 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none transition focus:border-[var(--accent)]/40 focus:bg-[hsla(0,0%,100%,0.06)]"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
              className="absolute right-1 flex h-5 w-5 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
              aria-label="Clear search"
              title="Clear (Esc)"
            >
              <X size={11} />
            </button>
          ) : null}
        </div>
        {isPrs ? (
          <button
            type="button"
            onClick={() => setFilterOpen((open) => !open)}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1 rounded-md border px-1.5 transition",
              filterCount > 0
                ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent-on-tint)]"
                : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]/50 hover:text-[var(--text-primary)]",
            )}
            aria-label={filterCount > 0 ? `Filters (${filterCount} active)` : "Filters"}
            title={filterCount > 0 ? `${filterCount} filter${filterCount === 1 ? "" : "s"} active` : "Filters (/)"}
          >
            <Filter size={11} />
            {filterCount > 0 ? (
              <span className="text-[10px] font-semibold leading-none tabular-nums">
                {filterCount}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {filterOpen ? (
        <FilterPopover
          filters={filterState.filters}
          orgs={orgs}
          repos={repos}
          presets={filterState.presets}
          onChange={filterState.setFilters}
          onReset={filterState.resetFilters}
          onSavePreset={(name) => {
            filterState.savePreset(name);
          }}
          onApplyPreset={filterState.applyPreset}
          onDeletePreset={filterState.deletePreset}
          onClose={() => setFilterOpen(false)}
        />
      ) : null}

      {error ? <ErrorBanner error={error} retry={retry} onReconnect={onReconnect} /> : null}
      {!error && partialMessage ? <WarningBanner message={partialMessage} /> : null}
      {isPrs && filterCount > 0 && filteredOut > 0 ? (
        <FilterNotice filteredOut={filteredOut} onReset={filterState.resetFilters} />
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading && displayCount === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--text-secondary)]">
            Loading GitHub items...
          </p>
        ) : null}

        {!loading && !error && displayCount === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--text-secondary)]">
            {searchQuery.trim()
              ? `No ${isPrs ? "PRs" : "issues"} match "${searchQuery.trim()}".`
              : isPrs
                ? filterCount > 0
                  ? "No PRs match your filters."
                  : "No open PRs 🎉"
                : "No issues assigned"}
          </p>
        ) : null}

        <div className={cn(density === "compact" ? "space-y-0.5" : "space-y-2")}>
          {isPrs
            ? prDisplayItems.map((item) => {
                if (item.kind === "pr") {
                  return (
                    <PRCard
                      key={item.key}
                      pr={item.pr}
                      density={density}
                      selected={selection.selectedKey === item.key}
                    />
                  );
                }
                return (
                  <RepoGroupTile
                    key={item.key}
                    group={item}
                    expanded={expandedGroups.has(item.key)}
                    onToggle={() => toggleGroup(item.key)}
                    density={density}
                    selected={selection.selectedKey === item.key}
                    selectedChildKey={selection.selectedKey}
                  />
                );
              })
            : searchedIssues.map((issue) => (
                <IssueCard
                  key={issue.url}
                  issue={issue}
                  density={density}
                  selected={selection.selectedKey === issue.url}
                />
              ))}
        </div>
      </div>
    </section>
  );
}

function isTypingInInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function hasDeploy(
  pr: PullRequest,
): pr is PullRequest & { deployment_url: string } {
  return typeof pr.deployment_url === "string" && pr.deployment_url.length > 0;
}

/**
 * `CSS.escape` polyfill-ish — older WKWebViews / jsdom test envs don't
 * always have it. PR/issue URLs are HTTPS so they contain `:` and `/`
 * which need escaping in CSS attribute selectors.
 */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

interface TabButtonProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

// Tabs no longer carry a count badge: the StatTile strip in the
// header is the single source of truth for "how many PRs / issues."
// The tab strip now just signals "which list view is active."
function TabButton({ active, label, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-b-2 px-3 py-1.5 text-[13px] font-medium transition",
        active
          ? "border-[var(--accent)] text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
      )}
    >
      {label}
    </button>
  );
}

function ErrorBanner({
  error,
  retry,
  onReconnect,
}: {
  error: GitHubError;
  retry: RetryState | null;
  /** Wired by App to wipe the keychain + bounce to onboarding. Only the
      auth-kind banner exposes this as a button — the user has to
      explicitly opt in to losing their stored PAT (previously we did
      this automatically, which permanently deleted good tokens on
      transient 401s). */
  onReconnect?: () => void;
}) {
  const heading = errorHeading(error, retry !== null);
  const countdown = useCountdown(retry?.retryAt ?? null);
  const showReconnect = error.kind === "auth" && typeof onReconnect === "function";

  return (
    <div
      data-testid="error-banner"
      className="mx-4 mt-3 rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]"
    >
      <p className="font-semibold">{heading}</p>
      <p className="mt-0.5 text-xs opacity-80">{error.message}</p>
      {retry && countdown !== null ? (
        <p
          className="mt-1 text-xs opacity-80"
          data-testid="error-banner-retry"
        >
          {countdown <= 0 ? "Retrying…" : `Retrying in ${countdown}s`}
        </p>
      ) : null}
      {showReconnect ? (
        <button
          type="button"
          onClick={onReconnect}
          data-testid="error-banner-reconnect"
          className="mt-2 inline-flex items-center rounded border border-[var(--danger)]/50 bg-[var(--danger)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/25"
        >
          Reconnect
        </button>
      ) : null}
    </div>
  );
}

/**
 * Re-renders once per second until `target` passes, then stops.
 */
function useCountdown(target: Date | null): number | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!target) return;
    if (target.getTime() <= Date.now()) return;
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      if (target.getTime() <= Date.now()) {
        window.clearInterval(id);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [target]);
  if (!target) return null;
  return Math.max(0, Math.ceil((target.getTime() - Date.now()) / 1000));
}

function WarningBanner({ message }: { message: string }) {
  return (
    <div
      data-testid="warning-banner"
      className="mx-4 mt-3 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--warning)]"
    >
      {message}
    </div>
  );
}

function FilterNotice({ filteredOut, onReset }: { filteredOut: number; onReset: () => void }) {
  return (
    <div
      data-testid="filter-notice"
      className="mx-4 mt-3 flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
    >
      <span>
        {filteredOut} PR{filteredOut === 1 ? "" : "s"} hidden by filters
      </span>
      <button
        type="button"
        onClick={onReset}
        className="text-[var(--accent)] hover:underline"
      >
        Clear
      </button>
    </div>
  );
}

function errorHeading(error: GitHubError, hasActiveRetry: boolean): string {
  switch (error.kind) {
    case "auth":
      return "Token rejected — reconnect required";
    case "rate_limited":
      if (hasActiveRetry) return "Rate limited by GitHub";
      return error.retry_after_secs
        ? `Rate limited — retry in ${error.retry_after_secs}s`
        : "Rate limited by GitHub";
    case "network":
      return "Network error";
    case "server":
      return "GitHub error";
    case "partial":
      return "Partial results";
    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      return "Unknown error";
    }
  }
}
