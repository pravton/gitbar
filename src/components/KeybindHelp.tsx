import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface KeybindHelpProps {
  open: boolean;
  onClose: () => void;
}

interface Row {
  /** Visual key chord — multi-key combos passed as a tuple. */
  keys: string[];
  /** What pressing it does. */
  label: string;
}

const ROWS: Row[] = [
  { keys: ["↑", "↓"], label: "Move selection (also k / j)" },
  { keys: ["Enter"], label: "Open the selected PR or issue" },
  { keys: ["D"], label: "Open the selected PR's deploy URL" },
  { keys: ["⌘1", "⌘2"], label: "Switch between PRs and Issues" },
  { keys: ["/"], label: "Open the filter popover" },
  { keys: ["?"], label: "Show this help" },
  { keys: ["Esc"], label: "Close popover / overlay, or clear selection" },
];

/**
 * Modal cheat sheet for the keyboard shortcuts. Triggered by `?`. Solves
 * the discoverability gap — keyboard nav exists, but without this overlay
 * a user only learns about it from the README.
 *
 * Keys inside an input element don't open this (the ListView keydown
 * handler swallows them via its `isTypingInInput` check), so a user
 * typing `?` in the preset-name field gets a literal `?`.
 */
export function KeybindHelp({ open, onClose }: KeybindHelpProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog when it opens so Escape (handled at the
  // ListView level) and Tab keep working naturally.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      data-testid="keybind-help-backdrop"
      onClick={onClose}
      className="absolute inset-0 z-40 flex items-center justify-center bg-[#0d1117]/80 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keybind-help-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        data-testid="keybind-help"
        className="w-[280px] max-w-[90%] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-3 shadow-2xl outline-none"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2
            id="keybind-help-title"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
          >
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="icon-button"
            title="Close (Esc)"
            aria-label="Close keyboard shortcuts"
          >
            <X size={13} />
          </button>
        </div>
        <ul className="space-y-1.5">
          {ROWS.map((row) => (
            <li
              key={row.label}
              className="flex items-center justify-between gap-3 text-[11px]"
            >
              <span className="flex shrink-0 items-center gap-1">
                {row.keys.map((key, idx) => (
                  <span key={`${row.label}-${idx}`} className="kbd">
                    {key}
                  </span>
                ))}
              </span>
              <span className="text-right text-[var(--text-secondary)]">
                {row.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
