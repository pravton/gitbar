import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, FileCode, Loader2, RefreshCw } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { cn, safeOpen, timeAgo } from "@/lib/utils";
import { linkify } from "@/lib/linkify";
import { useItemComments } from "@/hooks/useItemComments";
import type { CommentEntry, ReviewThread } from "@/types";

interface CommentsPanelProps {
  /** PR or issue URL; fed to the Tauri command and the "open" links. */
  itemUrl: string;
}

/**
 * Read-only comments drill-down under a PR or issue card. Lazily fetches
 * the conversation (and, for PRs, submitted reviews and inline review
 * threads) on mount, like `PRChecksPanel`. Bodies are plain text with clickable URLs: no
 * markdown or HTML rendering. Every entry links out to github.com.
 */
export function CommentsPanel({ itemUrl }: CommentsPanelProps) {
  const { data, loading, error, fetch, refetch } = useItemComments(itemUrl);
  const hasConversation = data !== null && (data.entries.length > 0 || data.omitted > 0);
  const hasThreads = data !== null && (data.threads.length > 0 || data.threads_omitted > 0);

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

      {!loading && !error && data !== null && !hasConversation && !hasThreads ? (
        <Empty>No comments yet.</Empty>
      ) : null}

      {data && (hasConversation || hasThreads) ? (
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
          {hasThreads ? (
            <ThreadsSection
              threads={data.threads}
              omitted={data.threads_omitted}
              itemUrl={itemUrl}
              divided={hasConversation}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Inline review threads, unresolved first (the order Rust returns).
 * Each thread starts collapsed to one line: file, line, badges, reply
 * count. Expanding shows its comments with the same row as the
 * conversation.
 */
function ThreadsSection({
  threads,
  omitted,
  itemUrl,
  divided,
}: {
  threads: ReviewThread[];
  omitted: number;
  itemUrl: string;
  divided: boolean;
}) {
  const unresolved = threads.filter((t) => !t.is_resolved).length;
  return (
    <section className={cn(divided && "border-t border-[var(--border)]")}>
      <h3 className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
        Code threads
        <span className="font-mono font-normal normal-case tabular-nums">
          ({unresolved} unresolved of {threads.length})
        </span>
      </h3>
      <ul className="divide-y divide-[var(--border)]">
        {threads.map((thread) => (
          <li key={thread.comments[0].url}>
            <ThreadRow thread={thread} />
          </li>
        ))}
      </ul>
      {omitted > 0 ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            safeOpen(itemUrl, open);
          }}
          className="flex w-full items-center gap-1 border-t border-[var(--border)] px-2 py-1 text-left text-[10px] text-[var(--accent-on-tint)] hover:bg-[var(--overlay-hover)]"
        >
          {omitted} older thread{omitted === 1 ? "" : "s"} on GitHub
          <ExternalLink size={10} aria-hidden />
        </button>
      ) : null}
    </section>
  );
}

function ThreadRow({ thread }: { thread: ReviewThread }) {
  const [expanded, setExpanded] = useState(false);
  const first = thread.comments[0];
  const fileName = thread.path.split("/").at(-1) ?? thread.path;
  const location = thread.line === null ? fileName : `${fileName}:${thread.line}`;
  const replies = thread.comments.length - 1 + thread.omitted;
  return (
    <div className={cn(thread.is_resolved && "opacity-70")}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1.5 text-left hover:bg-[var(--overlay-hover)]"
        title={thread.line === null ? thread.path : `${thread.path}:${thread.line}`}
      >
        {expanded ? (
          <ChevronDown size={10} aria-hidden className="shrink-0 text-[var(--text-secondary)]" />
        ) : (
          <ChevronRight size={10} aria-hidden className="shrink-0 text-[var(--text-secondary)]" />
        )}
        <FileCode size={11} aria-hidden className="shrink-0 text-[var(--text-secondary)]" />
        <span className="truncate font-mono text-[11px] text-[var(--text-primary)]">{location}</span>
        {thread.is_resolved ? <Badge label="resolved" tone="text-[var(--success)] border-[var(--success)]/40" /> : null}
        {thread.is_outdated ? <Badge label="outdated" tone={NEUTRAL_TONE} /> : null}
        <span className="ml-auto shrink-0 text-[10px] text-[var(--text-secondary)]">
          @{first.author.login}
          {replies > 0 ? ` +${replies}` : ""}
        </span>
      </button>
      {expanded ? (
        <div className="ml-4 border-l border-[var(--border)]">
          <ul className="divide-y divide-[var(--border)]">
            {thread.comments.map((entry) => (
              <li key={entry.url}>
                <CommentRow entry={entry} />
              </li>
            ))}
          </ul>
          {thread.omitted > 0 ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                safeOpen(thread.comments.at(-1)?.url ?? first.url, open);
              }}
              className="flex w-full items-center gap-1 px-2 py-1 text-left text-[10px] text-[var(--accent-on-tint)] hover:bg-[var(--overlay-hover)]"
            >
              {thread.omitted} more repl{thread.omitted === 1 ? "y" : "ies"} on GitHub
              <ExternalLink size={10} aria-hidden />
            </button>
          ) : null}
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

const NEUTRAL_TONE = "text-[var(--text-secondary)] border-[var(--border)]";

const REVIEW_LABELS: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "approved", tone: "text-[var(--success)] border-[var(--success)]/40" },
  CHANGES_REQUESTED: {
    label: "changes requested",
    tone: "text-[var(--danger)] border-[var(--danger)]/40",
  },
  COMMENTED: { label: "reviewed", tone: NEUTRAL_TONE },
  DISMISSED: { label: "dismissed", tone: NEUTRAL_TONE },
};

function ReviewBadge({ state }: { state: string }) {
  const known = REVIEW_LABELS[state] ?? {
    label: state.toLowerCase().replace(/_/g, " "),
    tone: NEUTRAL_TONE,
  };
  return <Badge label={known.label} tone={known.tone} />;
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={cn("shrink-0 rounded border px-1 text-[9px] font-medium uppercase", tone)}>
      {label}
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
