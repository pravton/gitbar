import { memo } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { pickReadableTextColor } from "@/lib/contrast";
import { cn, safeOpen, timeAgo, truncate } from "@/lib/utils";
import type { Issue } from "@/types";

/**
 * GitHub returns label colors as bare 3- or 6-char hex (no leading `#`).
 * Anything else is suspect data we shouldn't interpolate into a CSS
 * value. Returns the original color when valid; a neutral fallback
 * otherwise so the label name still renders.
 */
const HEX_COLOR_RE = /^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
function safeLabelColor(raw: string): string {
  return HEX_COLOR_RE.test(raw) ? raw : "8b949e";
}

interface IssueCardProps {
  issue: Issue;
  /** Renders the keyboard-nav selection ring. Defaults to false. */
  selected?: boolean;
}

/** See PRCard for why this is memo-wrapped. */
export const IssueCard = memo(IssueCardImpl);

function IssueCardImpl({ issue, selected = false }: IssueCardProps) {
  const repoName = issue.repository.name_with_owner.split("/").at(-1) ?? issue.repository.name_with_owner;

  return (
    <button
      type="button"
      onClick={() => safeOpen(issue.url, open)}
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
      <p className="mt-1 font-mono text-[11px] text-[var(--text-secondary)]">#{issue.number} assigned to you</p>

      {issue.labels.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {issue.labels.slice(0, 4).map((label) => {
            const color = safeLabelColor(label.color);
            return (
              <span
                key={`${issue.url}-${label.name}`}
                className="max-w-[120px] truncate rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: `#${color}`,
                  color: pickReadableTextColor(color),
                }}
              >
                {label.name}
              </span>
            );
          })}
        </div>
      ) : null}
    </button>
  );
}
