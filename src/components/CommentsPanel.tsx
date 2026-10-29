import { useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { cn, safeOpen, timeAgo } from "@/lib/utils";
import { linkify } from "@/lib/linkify";
import { useItemComments } from "@/hooks/useItemComments";
import type { CommentEntry } from "@/types";

interface CommentsPanelProps {
  /** PR or issue URL; fed to the Tauri command and the "open" links. */
  itemUrl: string;
}

/**
 * Read-only comments drill-down under a PR or issue card. Lazily fetches
 * the conversation (and, for PRs, submitted reviews) on mount, like
 * `PRChecksPanel`. Bodies are plain text with clickable URLs: no
 * markdown or HTML rendering. Every entry links out to github.com.
 */
export function CommentsPanel({ itemUrl }: CommentsPanelProps) {
  const { data, loading, error, fetch, refetch } = useItemComments(itemUrl);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <div className="mt-2 rounded border border-[var(--border)] bg-[var(--bg-primary)]/40">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-2 py-1.5">
        <span className="text-[10px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
          Comments
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            refetch();
          }}
          disabled={loading}
          className="icon-button"
          title="Refresh comments"
          aria-label="Refresh comments"
        >
          <RefreshCw size={11} className={cn(loading && "animate-spin")} aria-hidden />
        </button>
      </div>

      {loading && data === null ? (
        <Empty>
          <Loader2 size={12} className="animate-spin" aria-hidden /> Loading comments…
        </Empty>
      ) : null}

      {error ? (
        <Empty tone="danger">
          {error.message || `Couldn't load comments (${error.kind}).`}
        </Empty>
      ) : null}

      {!loading && !error && data !== null && data.entries.length === 0 ? (
        <Empty>No comments yet.</Empty>
      ) : null}

      {data && (data.entries.length > 0 || data.omitted > 0) ? (
        <div className="max-h-80 overflow-y-auto">
          {data.omitted > 0 ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                safeOpen(itemUrl, open);
              }}
              className="flex w-full items-center gap-1 border-b border-[var(--border)] px-2 py-1 text-left text-[10px] text-[var(--accent-on-tint)] hover:bg-[var(--overlay-hover)]"
            >
              {data.omitted} earlier on GitHub
              <ExternalLink size={10} aria-hidden />
            </button>
          ) : null}
          <ul className="divide-y divide-[var(--border)]">
            {data.entries.map((entry) => (
              <li key={entry.url}>
                <CommentRow entry={entry} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Bodies longer than this start collapsed behind "Show more". */
const COLLAPSE_AT_CHARS = 400;

function CommentRow({ entry }: { entry: CommentEntry }) {
  const body = entry.body.trim();
  const long = body.length > COLLAPSE_AT_CHARS;
  const [expanded, setExpanded] = useState(false);
  const shown = long && !expanded ? `${body.slice(0, COLLAPSE_AT_CHARS).trimEnd()}…` : body;

  return (
    <div className="px-2 py-1.5">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          safeOpen(entry.url, open);
        }}
        className="flex w-full min-w-0 items-center gap-1.5 text-left hover:underline"
        title={`Open on GitHub\n${entry.url}`}
      >
        <span className="truncate text-[11px] font-medium text-[var(--text-primary)]">
          @{entry.author.login}
        </span>
        {entry.review_state ? <ReviewBadge state={entry.review_state} /> : null}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--text-secondary)]">
          {timeAgo(entry.created_at)}
        </span>
      </button>
      {shown ? (
        <p className="mt-0.5 text-[11px] break-words whitespace-pre-wrap text-[var(--text-secondary)]">
          <LinkifiedText text={shown} />
        </p>
      ) : null}
      {long ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="mt-0.5 text-[10px] text-[var(--accent-on-tint)] hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((segment, idx) =>
        segment.kind === "text" ? (
          <span key={idx}>{segment.text}</span>
        ) : (
          <a
            key={idx}
            href={segment.url}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              safeOpen(segment.url, open);
            }}
            className="text-[var(--accent-on-tint)] underline"
          >
            {segment.url}
          </a>
        ),
      )}
    </>
  );
}

const REVIEW_LABELS: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "approved", tone: "text-[var(--success)] border-[var(--success)]/40" },
  CHANGES_REQUESTED: {
    label: "changes requested",
    tone: "text-[var(--danger)] border-[var(--danger)]/40",
  },
  COMMENTED: { label: "reviewed", tone: "text-[var(--text-secondary)] border-[var(--border)]" },
  DISMISSED: { label: "dismissed", tone: "text-[var(--text-secondary)] border-[var(--border)]" },
};

function ReviewBadge({ state }: { state: string }) {
  const known = REVIEW_LABELS[state] ?? {
    label: state.toLowerCase().replace(/_/g, " "),
    tone: "text-[var(--text-secondary)] border-[var(--border)]",
  };
  return (
    <span className={cn("shrink-0 rounded border px-1 text-[9px] font-medium uppercase", known.tone)}>
      {known.label}
    </span>
  );
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
