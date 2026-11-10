import { useCallback, useState } from "react";

/** Logins that turned off the "GitHub is hiding N PRs" warning, as a JSON
    array. Per account: knowing one org hides items from one token says
    nothing about another account's token. */
const STORAGE_KEY = "gitbar.hiddenItemsWarningOff";

function readOff(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === "string"));
    }
  } catch {
    // unreadable or unavailable storage: show the warning
  }
  return new Set();
}

function writeOff(off: ReadonlySet<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...off]));
  } catch {
    // storage full or unavailable; the choice lasts this session only
  }
}

export interface UseHiddenItemsWarningResult {
  /** Whether the active account wants the warning. True with no account. */
  shown: boolean;
  setShown: (shown: boolean) => void;
}

/**
 * Whether to show the banner for results GitHub withholds from the active
 * account's token (usually an organization's SAML SSO). Someone who knows
 * and doesn't care can turn it off from the banner, and back on in Settings.
 */
export function useHiddenItemsWarning(login: string | null): UseHiddenItemsWarningResult {
  const [off, setOff] = useState<ReadonlySet<string>>(() => readOff());

  const setShown = useCallback(
    (shown: boolean) => {
      if (login === null) return;
      setOff((prev) => {
        if (prev.has(login) === !shown) return prev;
        const next = new Set(prev);
        if (shown) next.delete(login);
        else next.add(login);
        writeOff(next);
        return next;
      });
    },
    [login],
  );

  return { shown: login === null || !off.has(login), setShown };
}
