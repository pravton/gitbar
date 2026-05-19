import { FormEvent, useState } from "react";
import { ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { AuthResult } from "@/types";

interface OnboardingProps {
  checking: boolean;
  error: string | null;
  onConnect: (token: string) => Promise<AuthResult>;
}

export function Onboarding({ checking, error, onConnect }: OnboardingProps) {
  const [token, setToken] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onConnect(token);
  };

  return (
    <main className="flex h-screen flex-col justify-between bg-[var(--bg-primary)] p-5 text-[var(--text-primary)]">
      <div>
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--text-secondary)]">GitBar</p>
            <h1 className="mt-1 text-2xl font-semibold">Connect GitHub</h1>
          </div>
          <span className="rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-sm text-[var(--accent)]">
            v1
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
              Personal access token
            </span>
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              type="password"
              autoComplete="off"
              placeholder="ghp_..."
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>

          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

          <button
            type="submit"
            disabled={checking || token.trim().length === 0}
            className="w-full rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#08111f] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {checking ? "Checking..." : "Connect"}
          </button>
        </form>
      </div>

      <div className="space-y-3 text-sm text-[var(--text-secondary)]">
        <p>Minimum scopes: repo, read:org.</p>
        <button
          type="button"
          onClick={() => void open("https://github.com/settings/tokens")}
          className="inline-flex items-center gap-2 text-[var(--accent)] hover:underline"
        >
          Create a token
          <ExternalLink size={14} />
        </button>
      </div>
    </main>
  );
}
