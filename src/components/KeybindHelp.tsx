import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface KeybindHelpProps {
  open: boolean;
  onClose: () => void;
}

interface Row {
  keys: string[];
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
 * the discoverability gap.
 *
 * Focus management:
 *   - On open, move focus to the close button.
 *   - On close, restore focus to whatever element had it before.
 *   - Tab / Shift+Tab are trapped inside the dialog (only the close
 *     button is interactive; Tab cycles back to it).
 *
 * Backdrop click: closes only the help overlay. We `stopPropagation` on
 * the backdrop's mousedown so an underlying click-outside listener (e.g.
 * FilterPopover) doesn't ALSO fire and close itself.
 */
export function KeybindHelp({ open, onClose }: KeybindHelpProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Defer the focus call so React's commit phase has rendered the
    // button into the DOM by the time we ask for focus.
    queueMicrotask(() => closeButtonRef.current?.focus());
    return () => {
      try {
        previouslyFocused?.focus?.();
      } catch {
        // Element may be unmounted; non-fatal.
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      data-testid="keybind-help-backdrop"
      // Stop the underlying mousedown click-outside detectors (e.g.
      // FilterPopover's) from also reacting to a backdrop click. React's
      // synthetic delegation runs the handler on the root before the
      // event bubbles to document, so this is sufficient.
      onMouseDown={(event) => event.stopPropagation()}
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
        onKeyDown={(event) => {
          // Trap Tab inside the dialog. Only the close button is
          // focusable, so Tab and Shift+Tab both keep focus on it.
          if (event.key === "Tab") {
            event.preventDefault();
            closeButtonRef.current?.focus();
          }
        }}
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
            ref={closeButtonRef}
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
