import { open } from "@tauri-apps/plugin-shell";
import { pickReadableTextColor } from "@/lib/contrast";
import { cn, timeAgo, truncate } from "@/lib/utils";
import type { Issue } from "@/types";

interface IssueCardProps {
  issue: Issue;
  /** Renders the keyboard-nav selection ring. Defaults to false. */
  selected?: boolean;
}

export function IssueCard({ issue, selected = false }: IssueCardProps) {
  const repoName = issue.repository.name_with_owner.split("/").at(-1) ?? issue.repository.name_with_owner;

  return (
    <button
      type="button"
      onClick={() => void open(issue.url)}
      data-card-url={issue.url}
      aria-current={selected ? "true" : undefined}
      className={cn("card group w-full text-left", selected && "card-selected")}
      title={issue.title}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="status-dot status-success" />
          <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{repoName}</span>
        </div>
        <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">{timeAgo(issue.created_at)}</span>
      </div>

      <h2 className="mt-2 truncate text-[13px] font-medium text-[var(--text-primary)]">
        {truncate(issue.title, 100)}
      </h2>
      <p className="mt-1 text-[11px] text-[var(--text-secondary)]">#{issue.number} assigned to you</p>

      {issue.labels.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {issue.labels.slice(0, 4).map((label) => (
            <span
              key={`${issue.url}-${label.name}`}
              className="max-w-[120px] truncate rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: `#${label.color}`,
                color: pickReadableTextColor(label.color),
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  );
}
