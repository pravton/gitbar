import { FormEvent, useState } from "react";
import { X } from "lucide-react";
import type { UseReviewRequestNotifierResult } from "@/hooks/useReviewRequestNotifier";
import type { AuthResult } from "@/types";

interface SettingsProps {
  onReplaceToken: (token: string) => Promise<AuthResult>;
  onClearToken: () => Promise<AuthResult> | Promise<void> | void;
  notifications: UseReviewRequestNotifierResult;
  onClose: () => void;
}

export function Settings({
  onReplaceToken,
  onClearToken,
  notifications,
  onClose,
}: SettingsProps) {
  const [nextToken, setNextToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!nextToken.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const result = await onReplaceToken(nextToken);
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

  return (
    <aside className="absolute inset-y-0 right-0 z-20 w-full max-w-[340px] overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Settings</h2>
        <button type="button" onClick={onClose} className="icon-button" title="Close settings">
          <X size={15} />
        </button>
      </div>

      <div className="space-y-6 p-4">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            GitHub token
          </h3>
          <p className="mt-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
            Stored in your OS keychain. GitBar can use it but the token value is never visible to this UI.
          </p>
        </section>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="mb-2 block text-sm text-[var(--text-secondary)]">
              Replace token
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
            className="w-full rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[#08111f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save token"}
          </button>
        </form>

        <NotificationsSection notifications={notifications} />

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Repo filter
          </h3>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Coming after the v1 tracking panel is stable.
          </p>
        </section>

        <button
          type="button"
          onClick={() => void onClearToken()}
          className="w-full rounded-md border border-[var(--danger)]/60 px-3 py-2 text-sm font-semibold text-[var(--danger)] transition hover:bg-[var(--danger)]/10"
        >
          Disconnect GitHub
        </button>
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
