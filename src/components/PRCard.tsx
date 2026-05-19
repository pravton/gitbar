import { Eye, ExternalLink, MessageSquare } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { cn, timeAgo, truncate } from "@/lib/utils";
import type { PullRequest } from "@/types";

interface PRCardProps {
  pr: PullRequest;
}

type Tone = "success" | "warning" | "danger";

function ciTone(status: string | null): Tone {
  if (status === "SUCCESS") return "success";
  if (status === "FAILURE" || status === "ERROR") return "danger";
  return "warning";
}

function ciLabel(status: string | null): string {
  if (status === "SUCCESS") return "CI passing";
  if (status === "FAILURE" || status === "ERROR") return "CI failing";
  if (status === "PENDING" || status === "EXPECTED") return "CI pending";
  return "CI unknown";
}

// Overall PR tone for the dot at the top of the card (combines CI, draft, review).
function prTone(pr: PullRequest): Tone {
  if (pr.ci_status === "FAILURE" || pr.ci_status === "ERROR" || pr.review_decision === "CHANGES_REQUESTED") {
    return "danger";
  }
  if (pr.is_draft || pr.ci_status === "PENDING") return "warning";
  if (pr.ci_status === "SUCCESS") return "success";
  return "warning";
}

export function PRCard({ pr }: PRCardProps) {
  const overall = prTone(pr);
  const ci = ciTone(pr.ci_status);
  const repoName = pr.repository.name_with_owner.split("/").at(-1) ?? pr.repository.name_with_owner;
  const reviewRequested = pr.review_decision === "REVIEW_REQUIRED";

  const openPr = (event: React.MouseEvent) => {
    event.preventDefault();
    void open(pr.url);
  };
  const openDeployment = (event: React.MouseEvent) => {
    event.preventDefault();
    if (pr.deployment_url) void open(pr.deployment_url);
  };

  return (
    <article className="card group w-full" title={pr.title}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("status-dot", `status-${overall}`)} />
          <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{repoName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--text-secondary)]">
          {reviewRequested ? <Eye size={12} className="text-[var(--accent)]" /> : null}
          {pr.comments > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 tabular-nums"
              title={`${pr.comments} comment${pr.comments === 1 ? "" : "s"}`}
            >
              <MessageSquare size={11} aria-hidden />
              {pr.comments}
            </span>
          ) : null}
          <span>{timeAgo(pr.created_at)}</span>
        </div>
      </div>

      <a
        href={pr.url}
        onClick={openPr}
        className="mt-2 block truncate text-[13px] font-medium text-[var(--text-primary)] outline-none hover:text-[var(--accent)] focus-visible:underline focus-visible:underline-offset-2"
      >
        {truncate(pr.title, 100)}
      </a>
      <p className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
        #{pr.number} opened by @{pr.author.login}
      </p>

      <div className="mt-3 flex min-w-0 items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5 text-[11px] text-[var(--text-secondary)]">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("ci-pill", `ci-pill-${ci}`, "shrink-0")}>
            <span className={cn("status-dot", `status-${ci}`)} aria-hidden />
            {ciLabel(pr.ci_status)}
          </span>
          {pr.deployment_url ? (
            <a
              href={pr.deployment_url}
              onClick={openDeployment}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)] hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/10"
              title={`Open deployment: ${pr.deployment_url}`}
            >
              <ExternalLink size={10} aria-hidden />
              Deploy
            </a>
          ) : null}
        </div>
        <span className="shrink-0 tabular-nums">
          <span className="text-[var(--success)]">+{pr.additions}</span>{" "}
          <span className="text-[var(--danger)]">-{pr.deletions}</span>
        </span>
      </div>
    </article>
  );
}
