import { FormEvent, useState } from "react";
import { X } from "lucide-react";

interface SettingsProps {
  onReplaceToken: (token: string) => Promise<boolean>;
  onClearToken: () => Promise<void> | void;
  onClose: () => void;
}

export function Settings({ onReplaceToken, onClearToken, onClose }: SettingsProps) {
  const [nextToken, setNextToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!nextToken.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const ok = await onReplaceToken(nextToken);
      if (ok) {
        setNextToken("");
      } else {
        setError("GitHub rejected this token.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="absolute inset-y-0 right-0 z-20 w-full max-w-[340px] border-l border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl">
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
            Stored in the macOS keychain. GitBar can use it but the token
            value is never visible to this UI.
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
