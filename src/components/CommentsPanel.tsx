import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ExternalLink, FileCode, Loader2, RefreshCw, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { cn, safeOpen, timeAgo } from "@/lib/utils";
import {
  cleanCommentBody,
  parseCommentBody,
  type BadgeTone,
  type Inline,
} from "@/lib/commentMarkdown";
import { useIsVisible } from "@/hooks/useIsVisible";
import { useItemComments } from "@/hooks/useItemComments";
import type { CommentEntry, ItemComments, ReviewThread } from "@/types";

interface CommentsPanelProps {
  /** PR or issue URL; fed to the Tauri command and the "open" links. */
  itemUrl: string;
  /** The item's comment count from the poll; refetches when it changes. */
  revision?: number;
  /** New comments on the item, to mark in the list. */
  unreadCount?: number;
  /** Called once this revision's comments have loaded and can be seen. */
  onSeen?: () => void;
  onClose?: () => void;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function panelSummary(data: ItemComments | null): string {
  if (!data) return "Comments";
  const comments = data.entries.length + data.omitted;
  const threads = data.threads.length + data.threads_omitted;
  const unresolved = data.threads.filter((t) => !t.is_resolved).length;
  const parts: string[] = [];
  if (comments > 0) parts.push(plural(comments, "comment"));
  if (unresolved > 0) parts.push(plural(unresolved, "unresolved thread"));
  else if (threads > 0) parts.push(plural(threads, "code thread"));
  return parts.join(" · ") || "Comments";
}

/**
 * Which comments to mark as new. GitHub gives a count, not which ones, so
 * this takes the most recent that many, skipping reviews with no text to
 * read. It can be off when a count includes something the panel doesn't list.
 */
function newestUrls(data: ItemComments | null, count: number): ReadonlySet<string> {
  if (!data || count <= 0) return new Set();
  const newestFirst = [...data.entries, ...data.threads.flatMap((t) => t.comments)]
    .filter((entry) => entry.body.trim() !== "")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return new Set(newestFirst.slice(0, count).map((entry) => entry.url));
}

/**
 * Read-only comments drill-down under a PR or issue card. Lazily fetches
 * the conversation (and, for PRs, submitted reviews and inline review
 * threads) on mount, like `PRChecksPanel`. Bodies are plain text with clickable URLs: no
 * markdown or HTML rendering. Every entry links out to github.com.
 */
export function CommentsPanel({
  itemUrl,
  revision,
  unreadCount = 0,
  onSeen,
  onClose,
}: CommentsPanelProps) {
  const { data, fresh, loading, error, fetch, refetch } = useItemComments(itemUrl, revision);
  const hasConversation = data !== null && (data.entries.length > 0 || data.omitted > 0);
  const hasThreads = data !== null && (data.threads.length > 0 || data.threads_omitted > 0);

  useEffect(() => {
    fetch();
  }, [fetch]);

  // Marking seen zeroes the unread count, so hold on to it for the markers.
  const [newCount, setNewCount] = useState(unreadCount);
  useEffect(() => {
    if (unreadCount > 0) setNewCount(unreadCount);
  }, [unreadCount]);
  const newUrls = useMemo(() => newestUrls(data, newCount), [data, newCount]);

  const rootRef = useRef<HTMLDivElement>(null);
  const visible = useIsVisible(rootRef);
  useEffect(() => {
    if (fresh && visible) onSeen?.();
  }, [fresh, visible, onSeen]);

  // Open threads need attention, so they go above the conversation and
  // resolved ones below it.
  const openThreads = data?.threads.filter((t) => !t.is_resolved) ?? [];
  const resolvedThreads = data?.threads.filter((t) => t.is_resolved) ?? [];
  const omittedThreads = data?.threads_omitted ?? 0;

  return (
    <div ref={rootRef} className="mt-2 rounded border border-[var(--border)] bg-[var(--bg-primary)]/40">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-2 py-1.5">
        <span className="truncate text-[11px] font-medium text-[var(--text-primary)]">
          {panelSummary(data)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
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
          {onClose ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
              className="icon-button"
              title="Close comments (Esc)"
              aria-label="Close comments"
            >
              <X size={11} aria-hidden />
            </button>
          ) : null}
        </div>
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
        <div className="max-h-80 divide-y divide-[var(--border)] overflow-y-auto">
          {openThreads.length > 0 ? (
            <ThreadsSection
              title="Unresolved threads"
              threads={openThreads}
              newUrls={newUrls}
            />
          ) : null}
          {hasConversation ? (
            <section>
              {hasThreads ? <h3 className={SECTION_HEADING}>Conversation</h3> : null}
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
                    <CommentRow entry={entry} isNew={newUrls.has(entry.url)} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {resolvedThreads.length > 0 ? (
            <ThreadsSection title="Resolved threads" threads={resolvedThreads} newUrls={newUrls} />
          ) : null}
          {omittedThreads > 0 ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                safeOpen(itemUrl, open);
              }}
              className="flex w-full items-center gap-1 px-2 py-1 text-left text-[10px] text-[var(--accent-on-tint)] hover:bg-[var(--overlay-hover)]"
            >
              {omittedThreads} older thread{omittedThreads === 1 ? "" : "s"} on GitHub
              <ExternalLink size={10} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const SECTION_HEADING =
  "flex items-center gap-1 px-2 py-1 text-[10px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase";

const NEW_TONE = "text-[var(--accent-on-tint)] border-[var(--accent)]/50";

/**
 * One group of inline review threads. Each thread starts collapsed to one line (file, line, badges, reply
 * count) unless it holds a new comment. Expanding shows its comments with
 * the same row as the conversation.
 */
function ThreadsSection({
  title,
  threads,
  newUrls,
}: {
  title: string;
  threads: ReviewThread[];
  newUrls: ReadonlySet<string>;
}) {
  return (
    <section>
      <h3 className={SECTION_HEADING}>
        {title}
        <span className="font-mono font-normal normal-case tabular-nums">({threads.length})</span>
      </h3>
      <ul className="divide-y divide-[var(--border)]">
        {threads.map((thread) => (
          <li key={thread.comments[0].url}>
            <ThreadRow thread={thread} newUrls={newUrls} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ThreadRow({ thread, newUrls }: { thread: ReviewThread; newUrls: ReadonlySet<string> }) {
  const hasNew = thread.comments.some((entry) => newUrls.has(entry.url));
  const [expanded, setExpanded] = useState(hasNew);
  // Cached data can render first, so a new comment may only show up in an
  // already mounted row. Reacting to the change leaves a manual collapse alone.
  useEffect(() => {
    if (hasNew) setExpanded(true);
  }, [hasNew]);
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
        {hasNew ? <Badge label="new" tone={NEW_TONE} /> : null}
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
                <CommentRow entry={entry} isNew={newUrls.has(entry.url)} />
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

/** Bodies longer than this start collapsed behind "Show full comment". */
const COLLAPSE_AT_CHARS = 400;

function CommentRow({ entry, isNew }: { entry: CommentEntry; isNew: boolean }) {
  // Strip HTML noise first so the collapse length counts what is shown.
  const body = useMemo(() => cleanCommentBody(entry.body), [entry.body]);
  const long = body.length > COLLAPSE_AT_CHARS;
  const [expanded, setExpanded] = useState(false);
  const shown = long && !expanded ? `${body.slice(0, COLLAPSE_AT_CHARS).trimEnd()}…` : body;

  return (
    <div className="px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[11px] font-medium text-[var(--text-primary)]">
          @{entry.author.login}
        </span>
        {isNew ? <Badge label="new" tone={NEW_TONE} /> : null}
        {entry.review_state ? <ReviewBadge state={entry.review_state} /> : null}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--text-secondary)]">
          {timeAgo(entry.created_at)}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            safeOpen(entry.url, open);
          }}
          className="-m-1 shrink-0 rounded p-1 text-[var(--text-secondary)] hover:text-[var(--accent-on-tint)]"
          title={`Open on GitHub\n${entry.url}`}
          aria-label={`Open @${entry.author.login}'s comment on GitHub`}
        >
          <ExternalLink size={11} aria-hidden />
        </button>
      </div>
      {shown ? (
        <div className="mt-0.5 space-y-1 text-[11px] break-words text-[var(--text-secondary)]">
          <CommentBody text={shown} />
        </div>
      ) : null}
      {long ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-expanded={expanded}
          className="mt-0.5 text-[10px] text-[var(--accent-on-tint)] hover:underline"
        >
          {expanded ? "Collapse" : "Show full comment"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Renders the safe markdown subset from `commentMarkdown.ts` as React
 * elements. No HTML from the comment is ever inserted.
 */
function CommentBody({ text }: { text: string }) {
  const blocks = useMemo(() => parseCommentBody(text), [text]);
  return (
    <>
      {blocks.map((block, idx) => {
        if (block.kind === "code") {
          return (
            <pre
              key={idx}
              className="overflow-x-auto rounded bg-[var(--overlay-fill)] px-1.5 py-1 font-mono text-[10px] whitespace-pre text-[var(--text-primary)]"
            >
              {block.text}
            </pre>
          );
        }
        if (block.kind === "heading") {
          return (
            <p key={idx} className="font-semibold whitespace-pre-wrap text-[var(--text-primary)]">
              <InlineNodes nodes={block.children} />
            </p>
          );
        }
        return (
          <p key={idx} className="whitespace-pre-wrap">
            <InlineNodes nodes={block.children} />
          </p>
        );
      })}
    </>
  );
}

const BADGE_TONES: Record<BadgeTone, string> = {
  danger: "text-[var(--danger)] border-[var(--danger)]/40",
  warning: "text-[var(--warning)] border-[var(--warning)]/40",
  success: "text-[var(--success)] border-[var(--success)]/40",
  accent: "text-[var(--accent-on-tint)] border-[var(--accent)]/40",
  neutral: "text-[var(--text-secondary)] border-[var(--border)]",
};

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, idx) => {
        switch (node.kind) {
          case "text":
            return <span key={idx}>{node.text}</span>;
          case "code":
            return (
              <code
                key={idx}
                className="rounded bg-[var(--overlay-fill)] px-0.5 font-mono text-[10px] text-[var(--text-primary)]"
              >
                {node.text}
              </code>
            );
          case "strong":
            return (
              <strong key={idx} className="font-semibold text-[var(--text-primary)]">
                <InlineNodes nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={idx}>
                <InlineNodes nodes={node.children} />
              </em>
            );
          case "del":
            return (
              <del key={idx}>
                <InlineNodes nodes={node.children} />
              </del>
            );
          case "link":
            return (
              <ExternalAnchor key={idx} url={node.url}>
                <InlineNodes nodes={node.children} />
              </ExternalAnchor>
            );
          case "image":
            return (
              <ExternalAnchor key={idx} url={node.url}>
                [image: {node.alt}]
              </ExternalAnchor>
            );
          case "badge": {
            const pill = (
              <span
                className={cn(
                  "mx-0.5 inline-block rounded border px-1 align-middle text-[9px] leading-[14px] font-semibold",
                  BADGE_TONES[node.tone],
                )}
              >
                {node.label}
              </span>
            );
            return node.url ? (
              <ExternalAnchor key={idx} url={node.url} plain>
                {pill}
              </ExternalAnchor>
            ) : (
              <span key={idx}>{pill}</span>
            );
          }
        }
      })}
    </>
  );
}

function ExternalAnchor({
  url,
  plain = false,
  children,
}: {
  url: string;
  plain?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={url}
      title={url}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        safeOpen(url, open);
      }}
      className={plain ? undefined : "text-[var(--accent-on-tint)] underline"}
    >
      {children}
    </a>
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
