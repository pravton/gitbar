import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { UnreadBadge } from "@/components/UnreadBadge";
import { cn } from "@/lib/utils";

interface CommentsToggleProps {
  /** The PR or issue URL its panel is keyed by. */
  itemUrl: string;
  count: number;
  unread: number;
  open: boolean;
  onToggle: () => void;
}

/**
 * Card footer control for the comments panel, directly above where the panel
 * opens. The chevron matches the CI pill beside it, so both read as "this
 * expands". A PR can have a review and no comments, hence "Reviews" at zero.
 */
export function CommentsToggle({ itemUrl, count, unread, open, onToggle }: CommentsToggleProps) {
  const noun = `comment${count === 1 ? "" : "s"}`;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      aria-expanded={open}
      aria-controls={`${itemUrl}-comments`}
      title={`${count} ${noun}${unread > 0 ? `, ${unread} new` : ""}. ${
        open ? "Hide" : "Show"
      } comments (C)`}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-medium whitespace-nowrap hover:border-[var(--accent)]/60 hover:text-[var(--text-primary)]",
        open && "border-[var(--accent)]/60 text-[var(--accent-on-tint)]",
      )}
    >
      <Chevron size={10} aria-hidden />
      <MessageSquare size={11} aria-hidden />
      {count > 0 ? `${count} ${noun}` : "Reviews"}
      <UnreadBadge count={unread} />
    </button>
  );
}
