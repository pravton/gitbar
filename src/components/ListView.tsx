import { cn } from "@/lib/utils";
import { IssueCard } from "@/components/IssueCard";
import { PRCard } from "@/components/PRCard";
import type { GitHubError, Issue, PullRequest } from "@/types";

type Tab = "prs" | "issues";

interface ListViewProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  prs: PullRequest[];
  issues: Issue[];
  loading: boolean;
  error: GitHubError | null;
  partialMessage: string | null;
}

export function ListView({
  activeTab,
  onTabChange,
  prs,
  issues,
  loading,
  error,
  partialMessage,
}: ListViewProps) {
  const isPrs = activeTab === "prs";
  const items = isPrs ? prs : issues;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex border-b border-[var(--border)] bg-[var(--bg-primary)] px-3 pt-3">
        <TabButton active={isPrs} label="PRs" count={prs.length} onClick={() => onTabChange("prs")} />
        <TabButton
          active={!isPrs}
          label="Issues"
          count={issues.length}
          onClick={() => onTabChange("issues")}
        />
      </div>

      {error ? <ErrorBanner error={error} /> : null}
      {!error && partialMessage ? <WarningBanner message={partialMessage} /> : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading && items.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--text-secondary)]">
            Loading GitHub items...
          </p>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--text-secondary)]">
            {isPrs ? "No open PRs 🎉" : "No issues assigned"}
          </p>
        ) : null}

        <div className="space-y-2">
          {isPrs
            ? prs.map((pr) => <PRCard key={pr.url} pr={pr} />)
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
        "flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition",
        active
          ? "border-[var(--accent)] text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
      )}
    >
      {label}
      <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
        {count}
      </span>
    </button>
  );
}

function ErrorBanner({ error }: { error: GitHubError }) {
  const heading = errorHeading(error);
  return (
    <div
      data-testid="error-banner"
      className="mx-4 mt-3 rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]"
    >
      <p className="font-semibold">{heading}</p>
      <p className="mt-0.5 text-xs opacity-80">{error.message}</p>
    </div>
  );
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
  }
}
