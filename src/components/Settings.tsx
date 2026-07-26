import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { UseReviewRequestNotifierResult } from "@/hooks/useReviewRequestNotifier";
import type { AuthResult } from "@/types";

interface SettingsProps {
  accounts: string[];
  activeLogin: string | null;
  onAddAccount: (token: string) => Promise<AuthResult>;
  onRemoveAccount: (login: string) => Promise<AuthResult>;
  onSwitchAccount: (login: string) => Promise<AuthResult>;
  onReplaceActiveToken: (expectedLogin: string, token: string) => Promise<AuthResult>;
  notifications: UseReviewRequestNotifierResult;
  onClose: () => void;
}

export function Settings({
  accounts,
  activeLogin,
  onAddAccount,
  onRemoveAccount,
  onSwitchAccount,
  onReplaceActiveToken,
  notifications,
  onClose,
}: SettingsProps) {
  const [nextToken, setNextToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [rotateToken, setRotateToken] = useState("");
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  // Snapshot, not the live `activeLogin` prop: captures which account the
  // rotate form was opened for. If the active account changes while this
  // panel is still open (e.g. a tray-driven switch), `activeLogin` below
  // updates but `rotateForLogin` doesn't, so the mismatch is detectable
  // and the form can refuse to submit against the wrong account instead
  // of silently rotating whichever account happens to be active at
  // submit time.
  const [rotateForLogin] = useState(activeLogin);
  const rotateTargetChanged = rotateForLogin !== null && rotateForLogin !== activeLogin;

  // Modal focus management: focus the close button on open, trap Tab
  // inside the panel (no escape into the underlying list), restore
  // focus on unmount, close on Escape. Mirrors KeybindHelp's pattern.
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    queueMicrotask(() => closeButtonRef.current?.focus());
    // Capture-phase so this fires BEFORE ListView's bubble-phase
    // keydown handler. Without capture, ListView's Esc branch would
    // clear the list selection on the same keypress that closes
    // Settings, which is unwanted side-effect noise.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      try {
        previouslyFocused?.focus?.();
      } catch {
        // Element may be unmounted; non-fatal.
      }
    };
  }, [onClose]);

  const handleAddAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!nextToken.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const result = await onAddAccount(nextToken);
      if (result.ok) {
        setNextToken("");
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAccount = async (login: string) => {
    setRemoving(login);
    try {
      const result = await onRemoveAccount(login);
      if (!result.ok) setError(result.error);
    } finally {
      setRemoving(null);
    }
  };

  const handleSwitchAccount = async (login: string) => {
    setSwitching(login);
    try {
      const result = await onSwitchAccount(login);
      if (!result.ok) setError(result.error);
    } finally {
      setSwitching(null);
    }
  };

  const handleRotateToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rotateToken.trim() || !rotateForLogin || rotateTargetChanged) return;

    setRotating(true);
    setRotateError(null);
    try {
      const result = await onReplaceActiveToken(rotateForLogin, rotateToken);
      if (result.ok) {
        setRotateToken("");
      } else {
        setRotateError(result.error);
      }
    } catch (err) {
      setRotateError(err instanceof Error ? err.message : String(err));
    } finally {
      setRotating(false);
    }
  };

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onKeyDown={(event) => {
        // Trap Tab inside the dialog. When Tab would leave the panel
        // (Shift+Tab from the close button, or Tab from the last
        // focusable child), cycle back inside.
        if (event.key !== "Tab" || !panelRef.current) return;
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      className="absolute inset-y-0 right-0 z-20 w-full max-w-[340px] overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl outline-none"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 id="settings-title" className="text-sm font-semibold text-[var(--text-primary)]">Settings</h2>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="icon-button"
          title="Close settings (Esc)"
          aria-label="Close settings"
        >
          <X size={15} />
        </button>
      </div>

      <div className="space-y-6 p-4">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Accounts
          </h3>
          <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
            PATs stored in your OS keychain, never visible to this UI. GitBar fetches data as whichever account is active: switch here, or from the tray menu.
          </p>

          {accounts.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {accounts.map((login) => {
                const isActive = login === activeLogin;
                return (
                  <li
                    key={login}
                    className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--text-primary)]">
                      {isActive ? (
                        <Check size={13} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />
                      ) : null}
                      <span className="truncate">{login}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {isActive ? (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--accent)]">
                          Active
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleSwitchAccount(login)}
                          disabled={switching === login}
                          className="text-[11px] font-medium text-[var(--accent)] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {switching === login ? "Switching…" : "Switch"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleRemoveAccount(login)}
                        disabled={removing === login}
                        aria-label={`Remove ${login}`}
                        title={`Remove ${login}`}
                        className="icon-button danger h-6 w-6"
                      >
                        <X size={13} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
              No accounts connected.
            </p>
          )}
        </section>

        <form onSubmit={handleAddAccount} className="space-y-3">
          <label className="block">
            <span className="mb-2 block text-sm text-[var(--text-secondary)]">
              Add account
            </span>
            <input
              value={nextToken}
              onChange={(event) => setNextToken(event.target.value)}
              type="password"
              autoComplete="off"
              placeholder="ghp_..."
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
          <button
            type="submit"
            disabled={saving || !nextToken.trim()}
            className="w-full rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-text)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Connecting…" : "Connect"}
          </button>
        </form>

        {rotateForLogin ? (
          <form onSubmit={handleRotateToken} className="space-y-2">
            <label className="block">
              <span className="mb-2 block text-[11px] text-[var(--text-secondary)]">
                Rotate token for <span className="text-[var(--text-primary)]">{rotateForLogin}</span>. Replaces it in place without switching accounts or losing cached data.
              </span>
              <input
                value={rotateToken}
                onChange={(event) => setRotateToken(event.target.value)}
                type="password"
                autoComplete="off"
                placeholder="ghp_..."
                disabled={rotateTargetChanged}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            {rotateTargetChanged ? (
              <p className="text-xs text-[var(--warning)]">
                Active account changed to {activeLogin} since this panel opened. Close and reopen Settings to rotate its token.
              </p>
            ) : rotateError ? (
              <p className="text-xs text-[var(--danger)]">{rotateError}</p>
            ) : null}
            <button
              type="submit"
              disabled={rotating || !rotateToken.trim() || rotateTargetChanged}
              className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {rotating ? "Rotating…" : "Rotate token"}
            </button>
          </form>
        ) : null}

        <NotificationsSection notifications={notifications} />

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Repo filter
          </h3>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Coming after the v1 tracking panel is stable.
          </p>
        </section>
      </div>
    </aside>
  );
}

function NotificationsSection({
  notifications,
}: {
  notifications: UseReviewRequestNotifierResult;
}) {
  const { enabled, permission, setEnabled } = notifications;

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        Notifications
      </h3>
      <label className="mt-2 flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2">
        <span className="text-sm text-[var(--text-primary)]">
          New review requests
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => void setEnabled(event.target.checked)}
          aria-label="Notify on new review-requested PRs"
          className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
        />
      </label>
      {enabled && permission === "denied" ? (
        <p className="mt-2 text-[11px] text-[var(--warning)]">
          OS permission denied. Open System Settings → Notifications → GitBar to grant.
        </p>
      ) : null}
      {!enabled ? (
        <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
          Fires a banner when a new PR is waiting on your review. Off by default.
        </p>
      ) : null}
    </section>
  );
}
