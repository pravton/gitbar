import { Eye } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { cn, timeAgo, truncate } from "@/lib/utils";
import type { PullRequest } from "@/types";

interface PRCardProps {
  pr: PullRequest;
}

function statusTone(pr: PullRequest): "success" | "warning" | "danger" {
  if (pr.ci_status === "FAILURE" || pr.review_decision === "CHANGES_REQUESTED") return "danger";
  if (pr.is_draft || pr.ci_status === "PENDING") return "warning";
  return "success";
}

function ciLabel(status: string | null): string {
  if (status === "SUCCESS") return "CI passing";
  if (status === "FAILURE") return "CI failing";
  if (status === "PENDING" || status === "EXPECTED") return "CI pending";
  return "CI unknown";
}

export function PRCard({ pr }: PRCardProps) {
  const tone = statusTone(pr);
  const repoName = pr.repository.name_with_owner.split("/").at(-1) ?? pr.repository.name_with_owner;
  const reviewRequested = pr.review_decision === "REVIEW_REQUIRED";

  return (
    <button
      type="button"
      onClick={() => void open(pr.url)}
      className="card group w-full text-left"
      title={pr.title}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("status-dot", `status-${tone}`)} />
          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{repoName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--text-secondary)]">
          {reviewRequested ? <Eye size={14} className="text-[var(--accent)]" /> : null}
          <span>{timeAgo(pr.created_at)}</span>
        </div>
      </div>

      <h2 className="mt-2 truncate text-sm font-medium text-[var(--text-primary)]">
        {truncate(pr.title, 100)}
      </h2>
      <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
        #{pr.number} opened by @{pr.author.login}
      </p>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3 text-xs text-[var(--text-secondary)]">
        <span
          className={cn(
            "font-medium",
            tone === "success" && "text-[var(--success)]",
            tone === "warning" && "text-[var(--warning)]",
            tone === "danger" && "text-[var(--danger)]",
          )}
        >
          {ciLabel(pr.ci_status)}
        </span>
        <span>
          <span className="text-[var(--success)]">+{pr.additions}</span>{" "}
          <span className="text-[var(--danger)]">-{pr.deletions}</span>
        </span>
      </div>
    </button>
  );
}
