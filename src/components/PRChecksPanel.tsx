import { useEffect } from "react";
import { CheckCircle2, Circle, ExternalLink, Loader2, RefreshCw, SkipForward, XCircle } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { cn, safeOpen, timeAgo } from "@/lib/utils";
import { usePRChecks } from "@/hooks/usePRChecks";
import type { CheckRun } from "@/types";

interface PRChecksPanelProps {
  /** PR URL the checks belong to; fed to the Tauri command. */
  prUrl: string;
}

/**
 * Drill-down panel that lives under a PRCard's CI pill. Lazily fetches
 * the latest commit's CI check runs on mount (effect, not render) so
 * the network call only happens when the user actually expands.
 *
 * Layout: one row per check run with a status glyph, the job name,
 * its workflow ('CI / build'), duration or time-ago, and a click-to-
 * open link to the job log on github.com.
 */
export function PRChecksPanel({ prUrl }: PRChecksPanelProps) {
  const { runs, loading, error, fetch, refetch } = usePRChecks(prUrl);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <div className="mt-2 rounded border border-[var(--border)] bg-[var(--bg-primary)]/40">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Checks
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            refetch();
          }}
          disabled={loading}
          className="icon-button"
          title="Refresh checks"
          aria-label="Refresh checks"
        >
          <RefreshCw size={11} className={cn(loading && "animate-spin")} aria-hidden />
        </button>
      </div>

      {loading && runs === null ? (
        <Empty>
          <Loader2 size={12} className="animate-spin" aria-hidden /> Loading checks…
        </Empty>
      ) : null}

      {error ? (
        <Empty tone="danger">
          {error.message || `Couldn't load checks (${error.kind}).`}
        </Empty>
      ) : null}

      {!loading && !error && runs !== null && runs.length === 0 ? (
        <Empty>No CI checks reported for this PR yet.</Empty>
      ) : null}

      {runs && runs.length > 0 ? (
        <ul className="divide-y divide-[var(--border)]">
          {runs.map((run, idx) => (
            <li key={`${run.url}:${run.name}:${idx}`}>
              <CheckRunRow run={run} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CheckRunRow({ run }: { run: CheckRun }) {
  const tone = runTone(run);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        safeOpen(run.url, open);
      }}
      className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-[hsla(0,0%,100%,0.03)]"
      title={`${runLabel(run)} — ${run.name}\n${run.url}`}
    >
      <RunIcon tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[11px] font-medium text-[var(--text-primary)]">
            {run.name}
          </span>
          {run.workflow_name ? (
            <span className="shrink-0 truncate font-mono text-[10px] text-[var(--text-secondary)]">
              {run.workflow_name}
            </span>
          ) : null}
        </div>
        <div className="font-mono text-[10px] text-[var(--text-secondary)]">
          {runMetaText(run)}
        </div>
      </div>
      <ExternalLink size={10} className="shrink-0 text-[var(--text-secondary)]" aria-hidden />
    </button>
  );
}

type RunTone = "success" | "danger" | "warning" | "neutral" | "info";

/** Map the raw GraphQL status/conclusion enums to a visual tone. */
function runTone(run: CheckRun): RunTone {
  if (run.status !== "COMPLETED") return "info"; // QUEUED / IN_PROGRESS / WAITING / PENDING / REQUESTED
  switch (run.conclusion) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "TIMED_OUT":
    case "STARTUP_FAILURE":
      return "danger";
    case "CANCELLED":
    case "SKIPPED":
    case "STALE":
      return "neutral";
    case "NEUTRAL":
    case "ACTION_REQUIRED":
      return "warning";
    default:
      return "neutral";
  }
}

function runLabel(run: CheckRun): string {
  if (run.status !== "COMPLETED") {
    // Soften the screaming-snake-case for the tooltip.
    return run.status.toLowerCase().replace(/_/g, " ");
  }
  if (!run.conclusion) return "completed";
  return run.conclusion.toLowerCase().replace(/_/g, " ");
}

function runMetaText(run: CheckRun): string {
  if (run.status !== "COMPLETED") {
    return run.started_at ? `running, started ${timeAgo(run.started_at)}` : "queued";
  }
  if (run.started_at && run.completed_at) {
    const ms = Date.parse(run.completed_at) - Date.parse(run.started_at);
    if (Number.isFinite(ms) && ms >= 0) {
      return `${runLabel(run)} · ${formatDuration(ms)}`;
    }
  }
  return runLabel(run);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function RunIcon({ tone }: { tone: RunTone }) {
  const cls = cn(
    "shrink-0",
    tone === "success" && "text-[var(--success)]",
    tone === "danger" && "text-[var(--danger)]",
    tone === "warning" && "text-[var(--warning)]",
    tone === "info" && "text-[var(--accent)]",
    tone === "neutral" && "text-[var(--text-secondary)]",
  );
  if (tone === "success") return <CheckCircle2 size={12} className={cls} aria-hidden />;
  if (tone === "danger") return <XCircle size={12} className={cls} aria-hidden />;
  if (tone === "warning") return <Circle size={12} className={cls} aria-hidden />;
  if (tone === "info") return <Loader2 size={12} className={cn(cls, "animate-spin")} aria-hidden />;
  return <SkipForward size={12} className={cls} aria-hidden />;
}

function Empty({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "danger";
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-1 px-2 py-2 text-[11px]",
        tone === "danger" ? "text-[var(--danger)]" : "text-[var(--text-secondary)]",
      )}
    >
      {children}
    </p>
  );
}
