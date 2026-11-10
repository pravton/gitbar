import { useCallback, useState } from "react";

/** Set to "1" for a login that turned off the "GitHub is hiding N PRs"
    warning. Per account: one org hiding items from one token says nothing
    about another account's token. */
const KEY_PREFIX = "gitbar.hiddenItemsWarningOff.";

function isOff(login: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + login) === "1";
  } catch {
    return false; // unavailable storage: show the warning
  }
}

function writeOff(login: string, off: boolean): void {
  try {
    if (off) localStorage.setItem(KEY_PREFIX + login, "1");
    else localStorage.removeItem(KEY_PREFIX + login);
  } catch {
    // storage full or unavailable; non-fatal
  }
}

/** Forget a removed account's choice, so adding it back starts with the
    warning on. */
export function clearHiddenItemsWarning(login: string): void {
  writeOff(login, false);
}

export interface UseHiddenItemsWarningResult {
  /** Whether the active account wants the warning. True with no account. */
  shown: boolean;
  setShown: (shown: boolean) => void;
}

/**
 * Whether to show the banner for results GitHub withholds from the active
 * account's token because of an organization's SAML SSO. Someone who knows
 * and doesn't care can turn it off from the banner, and back on in Settings.
 */
export function useHiddenItemsWarning(login: string | null): UseHiddenItemsWarningResult {
  // Storage is the source of truth; this only re-renders after a change.
  const [, setVersion] = useState(0);

  const setShown = useCallback(
    (shown: boolean) => {
      if (login === null) return;
      writeOff(login, !shown);
      setVersion((v) => v + 1);
    },
    [login],
  );

  return { shown: login === null || !isOff(login), setShown };
}
