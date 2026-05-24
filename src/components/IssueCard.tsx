import type { CSSProperties } from "react";
import { memo } from "react";
import { CircleAlert } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { Density } from "@/hooks/useDensityMode";
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
  /** Layout density. `compact` switches to a single-line row. */
  density?: Density;
}

/** See PRCard for why this is memo-wrapped. */
export const IssueCard = memo(IssueCardImpl);

function IssueCardImpl({ issue, selected = false, density = "comfortable" }: IssueCardProps) {
  const repoName = issue.repository.name_with_owner.split("/").at(-1) ?? issue.repository.name_with_owner;
  const handleClick = () => safeOpen(issue.url, open);

  if (density === "compact") {
    return (
      <button
        type="button"
        onClick={handleClick}
        data-card-url={issue.url}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "card group flex w-full items-center gap-2 px-2 py-1.5 text-left",
          selected && "card-selected",
        )}
        title={`${issue.title}\n#${issue.number} assigned to you${
          issue.labels.length ? `\nLabels: ${issue.labels.map((l) => l.name).join(", ")}` : ""
        }`}
      >
        <CircleAlert size={11} className="shrink-0 text-[var(--warning)]" aria-hidden />
        <span className="shrink-0 max-w-[110px] truncate text-[12px] font-medium text-[var(--text-primary)]">
          {repoName}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-[var(--text-secondary)]">
          #{issue.number}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-primary)]">
          {truncate(issue.title, 80)}
        </span>
        {issue.labels.length > 0 ? (
          <span
            className="shrink-0 font-mono text-[10px] text-[var(--text-secondary)]"
            aria-label={`${issue.labels.length} label${issue.labels.length === 1 ? "" : "s"}`}
            title={issue.labels.map((l) => l.name).join(", ")}
          >
            ·{issue.labels.length}
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-[10px] text-[var(--text-secondary)]">
          {timeAgo(issue.created_at)}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-card-url={issue.url}
      aria-current={selected ? "true" : undefined}
      className={cn("card group w-full text-left", selected && "card-selected")}
      title={issue.title}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* Issue glyph instead of the status-success dot that v0.1
              showed unconditionally; issues don't have a "success"
              state, and the green dot misled the reader into
              skimming for what was working. Matches the icon used
              in the header's issue count. */}
          <CircleAlert size={11} className="shrink-0 text-[var(--warning)]" aria-hidden />
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
                className="label-pill"
                style={{ "--label-hue": `#${color}` } as CSSProperties}
                title={label.name}
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
