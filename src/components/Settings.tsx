import { FormEvent, useState } from "react";
import { X } from "lucide-react";

interface SettingsProps {
  token: string;
  onSaveToken: (token: string) => void;
  onClearToken: () => void;
  onClose: () => void;
}

function maskToken(token: string): string {
  if (token.length < 12) {
    return "****";
  }

  return `${token.slice(0, 4)}_****...****${token.slice(-4)}`;
}

export function Settings({ token, onSaveToken, onClearToken, onClose }: SettingsProps) {
  const [nextToken, setNextToken] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (nextToken.trim()) {
      onSaveToken(nextToken);
      setNextToken("");
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
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">GitHub token</h3>
          <p className="mt-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            {maskToken(token)}
          </p>
        </section>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="mb-2 block text-sm text-[var(--text-secondary)]">Replace token</span>
            <input
              value={nextToken}
              onChange={(event) => setNextToken(event.target.value)}
              type="password"
              autoComplete="off"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <button type="submit" className="w-full rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[#08111f]">
            Save token
          </button>
        </form>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Repo filter</h3>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Coming after the v1 tracking panel is stable.</p>
        </section>

        <button
          type="button"
          onClick={onClearToken}
          className="w-full rounded-md border border-[var(--danger)]/60 px-3 py-2 text-sm font-semibold text-[var(--danger)] transition hover:bg-[var(--danger)]/10"
        >
          Clear token
        </button>
      </div>
    </aside>
  );
}
