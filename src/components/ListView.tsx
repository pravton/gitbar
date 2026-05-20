import { useEffect, useMemo, useRef, useState } from "react";
import { Filter } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { cn } from "@/lib/utils";
import { IssueCard } from "@/components/IssueCard";
import { PRCard } from "@/components/PRCard";
import { FilterPopover } from "@/components/FilterPopover";
import { KeybindHelp } from "@/components/KeybindHelp";
import { activeFilterCount, applyFilters, deriveOrgs } from "@/lib/filters";
import { useFilters } from "@/hooks/useFilters";
import { useListSelection } from "@/hooks/useListSelection";
import type { RetryState } from "@/hooks/useGitHubData";
import type { GitHubError, Issue, PullRequest } from "@/types";

type Tab = "prs" | "issues";

interface ListViewProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  prs: PullRequest[];
  issues: Issue[];
  loading: boolean;
  error: GitHubError | null;
  retry: RetryState | null;
  partialMessage: string | null;
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
}: ListViewProps) {
  const isPrs = activeTab === "prs";
  const filterState = useFilters();
  const [filterOpen, setFilterOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const orgs = useMemo(() => deriveOrgs(prs), [prs]);
  const filteredPrs = useMemo(
    () => applyFilters(prs, filterState.filters),
    [prs, filterState.filters],
  );
  const filterCount = activeFilterCount(filterState.filters);
  const filteredOut = isPrs ? prs.length - filteredPrs.length : 0;

  const items: (PullRequest | Issue)[] = isPrs ? filteredPrs : issues;
  const selection = useListSelection(items);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Document-level keyboard nav. Handles arrow keys, Enter, D (deploy),
  // Cmd+1/2 (tab switch), `/` (open filter), `?` (open help), Esc (back
  // out of whatever overlay state is open).
  //
  // While the help overlay is open, *only* Esc has effect. Other keys are
  // inert so the user can't accidentally fire shortcuts off a cheat sheet.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTypingInInput(event.target)) return;

      // Escape unwinds overlays in precedence order: help → filter
      // popover → clear selection. Always handled, regardless of whether
      // the help overlay is open.
      if (event.key === "Escape") {
        if (helpOpen) {
          setHelpOpen(false);
        } else if (filterOpen) {
          setFilterOpen(false);
        } else {
          selection.clear();
        }
        return;
      }

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
        case "Enter":
          if (selection.selectedItem) {
            event.preventDefault();
            void open(selection.selectedItem.url);
          }
          return;
        case "d":
        case "D":
          if (isPrs && isPullRequestWithDeploy(selection.selectedItem)) {
            event.preventDefault();
            void open(selection.selectedItem.deployment_url);
          }
          return;
        case "/":
          if (isPrs) {
            event.preventDefault();
            setFilterOpen(true);
          }
          return;
        case "?":
          event.preventDefault();
          setHelpOpen(true);
          return;
        default:
          return;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [filterOpen, helpOpen, isPrs, onTabChange, selection]);

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
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-primary)] px-3 pt-3">
        <div className="flex">
          <TabButton active={isPrs} label="PRs" count={prs.length} onClick={() => onTabChange("prs")} />
          <TabButton
            active={!isPrs}
            label="Issues"
            count={issues.length}
            onClick={() => onTabChange("issues")}
          />
        </div>
        {isPrs ? (
          <button
            type="button"
            onClick={() => setFilterOpen((open) => !open)}
            className={cn(
              "mb-2 flex h-5 items-center gap-1 rounded border px-1.5 transition",
              filterCount > 0
                ? "border-[var(--accent)]/70 bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border)] hover:text-[var(--text-primary)]",
            )}
            aria-label={filterCount > 0 ? `Filters (${filterCount} active)` : "Filters"}
            title={filterCount > 0 ? `${filterCount} filter${filterCount === 1 ? "" : "s"} active` : "Filters (/)"}
          >
            <Filter size={10} />
            {filterCount > 0 ? (
              <span className="text-[9px] font-semibold leading-none tabular-nums">
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

      <KeybindHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      {error ? <ErrorBanner error={error} retry={retry} /> : null}
      {!error && partialMessage ? <WarningBanner message={partialMessage} /> : null}
      {isPrs && filterCount > 0 && filteredOut > 0 ? (
        <FilterNotice filteredOut={filteredOut} onReset={filterState.resetFilters} />
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading && items.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--text-secondary)]">
            Loading GitHub items...
          </p>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--text-secondary)]">
            {isPrs
              ? filterCount > 0
                ? "No PRs match your filters."
                : "No open PRs 🎉"
              : "No issues assigned"}
          </p>
        ) : null}

        <div className="space-y-2">
          {isPrs
            ? filteredPrs.map((pr) => (
                <PRCard
                  key={pr.url}
                  pr={pr}
                  selected={selection.selectedKey === pr.url}
                />
              ))
            : issues.map((issue) => (
                <IssueCard
                  key={issue.url}
                  issue={issue}
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

function isPullRequestWithDeploy(
  item: PullRequest | Issue | null,
): item is PullRequest & { deployment_url: string } {
  if (!item) return false;
  return (
    "deployment_url" in item &&
    typeof item.deployment_url === "string" &&
    item.deployment_url.length > 0
  );
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
  count: number;
  onClick: () => void;
}

function TabButton({ active, label, count, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-[13px] font-medium transition",
        active
          ? "border-[var(--accent)] text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
      )}
    >
      {label}
      <span className="rounded-full bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--text-secondary)]">
        {count}
      </span>
    </button>
  );
}

function ErrorBanner({
  error,
  retry,
}: {
  error: GitHubError;
  retry: RetryState | null;
}) {
  const heading = errorHeading(error, retry !== null);
  const countdown = useCountdown(retry?.retryAt ?? null);

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
