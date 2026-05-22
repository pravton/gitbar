import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-line defense against an uncaught render error from anywhere in
 * the app tree. Without this, a bad `Date`, a corrupted-cache shape,
 * or a third-party plugin throwing during render leaves the user with
 * a blank frameless window: no titlebar, no menu, no obvious way out
 * except quitting from the tray. The boundary catches the error and
 * presents a "Reload" button.
 *
 * Class component because that's still the only way to opt into the
 * `componentDidCatch` / `getDerivedStateFromError` lifecycle. React
 * does not (yet) expose a Hook-based equivalent.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No remote logging by design; just surface to the user-attached
    // devtools / Console.app so a developer reproducing the crash has
    // something to grep.
    console.error("GitBar render crashed:", error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[var(--bg-primary)] p-6 text-center text-[var(--text-primary)]"
        >
          <p className="text-sm font-medium">Something broke.</p>
          <p className="max-w-[280px] text-[11px] text-[var(--text-secondary)]">
            GitBar hit an unexpected error and stopped rendering. Reload to
            recover. If this keeps happening, check Console.app for the
            stack trace.
          </p>
          <button
            type="button"
            onClick={this.reload}
            className="rounded border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-1 text-[11px] font-medium text-[var(--accent)] hover:border-[var(--accent)]"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
