import { Download } from "lucide-react";
import type { UseAutoUpdaterResult } from "@/hooks/useAutoUpdater";

interface UpdateBannerProps {
  updater: UseAutoUpdaterResult;
}

/**
 * Thin strip surfaced between the header and the list when an update
 * is available. Click → download + install + relaunch (handled by the
 * hook). While installing, the CTA disables and the label flips to
 * "Installing…" so the user knows something is happening.
 *
 * The banner is rendered only for the "available" / "installing"
 * phases. "idle" and "error" produce nothing; silent failure is the
 * right default for auto-update because the user can keep running
 * the version they have.
 */
export function UpdateBanner({ updater }: UpdateBannerProps) {
  if (updater.phase !== "available" && updater.phase !== "installing") {
    return null;
  }

  const installing = updater.phase === "installing";

  return (
    <div
      data-testid="update-banner"
      role="status"
      className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-1.5 text-[11px] text-[var(--accent)]"
    >
      <span className="flex items-center gap-1.5">
        <Download size={12} aria-hidden />
        {installing
          ? "Installing update…"
          : `Update v${updater.version ?? ""} available`}
      </span>
      <button
        type="button"
        onClick={() => void updater.install()}
        disabled={installing}
        className="rounded border border-[var(--accent)]/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide hover:border-[var(--accent)] disabled:opacity-50"
      >
        {installing ? "Installing…" : "Restart to install"}
      </button>
    </div>
  );
}
