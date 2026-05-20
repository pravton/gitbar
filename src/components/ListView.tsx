import { useEffect, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { IssueCard } from "@/components/IssueCard";
import { PRCard } from "@/components/PRCard";
import { FilterPopover } from "@/components/FilterPopover";
import { activeFilterCount, applyFilters, deriveOrgs } from "@/lib/filters";
import { useFilters } from "@/hooks/useFilters";
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

  const orgs = useMemo(() => deriveOrgs(prs), [prs]);
  const filteredPrs = useMemo(
    () => applyFilters(prs, filterState.filters),
    [prs, filterState.filters],
  );
  const filterCount = activeFilterCount(filterState.filters);
  const filteredOut = isPrs ? prs.length - filteredPrs.length : 0;

  const items = isPrs ? filteredPrs : issues;

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
            title={filterCount > 0 ? `${filterCount} filter${filterCount === 1 ? "" : "s"} active` : "Filters"}
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

      {error ? <ErrorBanner error={error} retry={retry} /> : null}
      {!error && partialMessage ? <WarningBanner message={partialMessage} /> : null}
      {isPrs && filterCount > 0 && filteredOut > 0 ? (
        <FilterNotice filteredOut={filteredOut} onReset={filterState.resetFilters} />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
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
            ? filteredPrs.map((pr) => <PRCard key={pr.url} pr={pr} />)
            : issues.map((issue) => <IssueCard key={issue.url} issue={issue} />)}
        </div>
      </div>
    </section>
  );
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
  const heading = errorHeading(error);
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

/** Re-renders once per second until `target` passes. Returns whole seconds. */
function useCountdown(target: Date | null): number | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!target) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
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

function errorHeading(error: GitHubError): string {
  switch (error.kind) {
    case "auth":
      return "Token rejected — reconnect required";
    case "rate_limited":
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
      // Exhaustiveness check: if a new GitHubError kind is added on the Rust
      // side, this branch will start type-checking and force us to handle it.
      const _exhaustive: never = error;
      void _exhaustive;
      return "Unknown error";
    }
  }
}
