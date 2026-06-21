import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import {
  isValidRepoSlug,
  type CiKey,
  type DraftMode,
  type FilterPreset,
  type PRFilters,
} from "@/lib/filters";

interface FilterPopoverProps {
  filters: PRFilters;
  orgs: string[];
  /** Repos derived from the currently visible PR list. Used as
      autocomplete suggestions when the user is adding to the allowlist;
      the allowlist itself in `filters.repos` is independent of this. */
  repos: string[];
  presets: FilterPreset[];
  onChange: (next: PRFilters) => void;
  onReset: () => void;
  onSavePreset: (name: string) => void;
  onApplyPreset: (id: string) => void;
  onDeletePreset: (id: string) => void;
  onClose: () => void;
}

const DRAFT_OPTIONS: { value: DraftMode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "drafts", label: "Drafts" },
];

const CI_OPTIONS: { value: CiKey; label: string }[] = [
  { value: "success", label: "Passing" },
  { value: "pending", label: "Pending" },
  { value: "failure", label: "Failing" },
  { value: "unknown", label: "Unknown" },
];

export function FilterPopover({
  filters,
  orgs,
  repos,
  presets,
  onChange,
  onReset,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
  onClose,
}: FilterPopoverProps) {
  const [presetName, setPresetName] = useState("");
  const [repoEntry, setRepoEntry] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Click-outside to close. Escape handling is delegated to ListView so
  // there's a single source of truth for keyboard-driven overlay state
  // (help → filter → clear selection precedence). If FilterPopover also
  // listened for Esc, both handlers would fire on the same key press and
  // a help → filter Esc-cascade would jump two layers at once.
  useEffect(() => {
    const handleDocClick = (event: MouseEvent) => {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handleDocClick);
    return () => {
      document.removeEventListener("mousedown", handleDocClick);
    };
  }, [onClose]);

  // Move focus into the popover on open so keyboard users land inside
  // and can immediately interact (otherwise focus stays on whatever
  // element was active before `/` was pressed, usually the document
  // body). Restore focus on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    queueMicrotask(() => closeButtonRef.current?.focus());
    return () => {
      try {
        previouslyFocused?.focus?.();
      } catch {
        // Element may be unmounted; non-fatal.
      }
    };
  }, []);

  const toggleOrg = (org: string) => {
    onChange({
      ...filters,
      orgs: filters.orgs.includes(org)
        ? filters.orgs.filter((o) => o !== org)
        : [...filters.orgs, org],
    });
  };

  const addRepo = (slug: string) => {
    const trimmed = slug.trim();
    if (!isValidRepoSlug(trimmed)) return;
    if (filters.repos.includes(trimmed)) return;
    onChange({ ...filters, repos: [...filters.repos, trimmed] });
    setRepoEntry("");
  };

  const removeRepo = (slug: string) => {
    onChange({ ...filters, repos: filters.repos.filter((r) => r !== slug) });
  };

  // Suggestions = repos visible in the current list MINUS ones already on
  // the allowlist MINUS ones that don't substring-match what the user is
  // typing. Capped at 6 so the dropdown can't push the rest of the
  // popover off-screen.
  const repoSuggestions = useMemo(() => {
    const query = repoEntry.trim().toLowerCase();
    if (!query) return [];
    return repos
      .filter((r) => !filters.repos.includes(r))
      .filter((r) => r.toLowerCase().includes(query))
      .slice(0, 6);
  }, [repos, filters.repos, repoEntry]);

  const repoEntryValid = isValidRepoSlug(repoEntry.trim()) && !filters.repos.includes(repoEntry.trim());

  const toggleCi = (ci: CiKey) => {
    onChange({
      ...filters,
      ciStatus: filters.ciStatus.includes(ci)
        ? filters.ciStatus.filter((c) => c !== ci)
        : [...filters.ciStatus, ci],
    });
  };

  const handleSavePreset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!presetName.trim()) return;
    onSavePreset(presetName);
    setPresetName("");
  };

  return (
    // Non-modal: focus moves into the popover on open and restores on
    // close, but Tab can leave (and Esc closes via ListView's keydown
    // chain). Deliberately NO `aria-modal="true"` — that would lie to
    // assistive tech about whether background content is inert.
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="PR filters"
      tabIndex={-1}
      className="absolute right-2 top-9 z-30 w-56 max-w-[calc(100%-1rem)] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-2 shadow-2xl outline-none"
      style={{ fontSize: 11 }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Filters
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Reset
          </button>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="icon-button"
            title="Close (Esc)"
            aria-label="Close filters"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      <Section label="Draft">
        <div className="flex flex-wrap gap-1">
          {DRAFT_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              active={filters.draft === opt.value}
              onClick={() => onChange({ ...filters, draft: opt.value })}
            >
              {opt.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section label="CI status">
        <div className="flex flex-wrap gap-1">
          {CI_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              active={filters.ciStatus.includes(opt.value)}
              onClick={() => toggleCi(opt.value)}
            >
              {opt.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section label="Review requested">
        <Chip
          active={filters.reviewRequestedOnly}
          onClick={() =>
            onChange({ ...filters, reviewRequestedOnly: !filters.reviewRequestedOnly })
          }
        >
          Waiting on me
        </Chip>
      </Section>

      <Section label={`Organization${orgs.length ? ` (${orgs.length})` : ""}`}>
        {orgs.length === 0 ? (
          <p className="text-[10px] text-[var(--text-secondary)]">No PRs to derive orgs from.</p>
        ) : (
          <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {orgs.map((org) => (
              <Chip
                key={org}
                active={filters.orgs.includes(org)}
                onClick={() => toggleOrg(org)}
              >
                {org}
              </Chip>
            ))}
          </div>
        )}
      </Section>

      <Section
        label={`Repos${filters.repos.length ? ` (${filters.repos.length})` : ""}`}
      >
        {filters.repos.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {filters.repos.map((slug) => (
              <button
                key={slug}
                type="button"
                onClick={() => removeRepo(slug)}
                className="filter-chip"
                data-active="true"
                title={`Remove ${slug}`}
              >
                {slug}
                <X size={9} aria-hidden className="ml-1 inline-block align-text-bottom" />
              </button>
            ))}
          </div>
        ) : (
          <p className="mb-1.5 text-[10px] text-[var(--text-secondary)]">
            Allowlist is empty. Add an <code>owner/name</code> to filter.
          </p>
        )}
        <div className="relative">
          <input
            value={repoEntry}
            onChange={(event) => setRepoEntry(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (repoEntryValid) addRepo(repoEntry);
              }
            }}
            placeholder="owner/name"
            aria-label="Add repo to allowlist"
            list="repo-allowlist-suggestions"
            // Match the preset-name input styling, plus a guarded right-
            // padding so the chevron-like Add button doesn't overlap text.
            className="w-full min-w-0 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-1.5 py-1 pr-12 text-[10px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={() => repoEntryValid && addRepo(repoEntry)}
            disabled={!repoEntryValid}
            // Inset button: positioned inside the input. Mirrors the
            // preset "Save" affordance below so a user who's added an
            // org with the chip pattern doesn't have to context-switch.
            className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-text)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add
          </button>
          {repoSuggestions.length > 0 ? (
            <ul className="absolute left-0 right-0 top-full z-10 mt-0.5 max-h-32 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg-secondary)] py-0.5 shadow-lg">
              {repoSuggestions.map((slug) => (
                <li key={slug}>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      // mousedown not click so the input blur doesn't
                      // race the suggestion selection.
                      event.preventDefault();
                      addRepo(slug);
                    }}
                    className="w-full truncate px-1.5 py-1 text-left text-[10px] text-[var(--text-primary)] hover:bg-[var(--accent)]/10"
                  >
                    {slug}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Section>

      <div className="mt-2 border-t border-[var(--border)] pt-2">
        <h4 className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Presets
        </h4>
        {presets.length === 0 ? (
          <p className="mb-1.5 text-[10px] text-[var(--text-secondary)]">No presets yet.</p>
        ) : (
          <ul className="mb-1.5 space-y-1">
            {presets.map((preset) => (
              <li
                key={preset.id}
                className="flex items-center justify-between rounded border border-[var(--border)] bg-[var(--bg-primary)] px-1.5 py-1"
              >
                <button
                  type="button"
                  onClick={() => onApplyPreset(preset.id)}
                  className="flex-1 truncate text-left text-[10px] text-[var(--text-primary)] hover:text-[var(--accent)]"
                  title={`Apply "${preset.name}"`}
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  onClick={() => onDeletePreset(preset.id)}
                  className="icon-button danger ml-1"
                  title="Delete preset"
                >
                  <Trash2 size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleSavePreset} className="flex gap-1">
          <input
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Save current filters as…"
            // min-w-0 lets this flex-1 input shrink below its placeholder's
            // intrinsic width; without it the input's default min-width:auto
            // keeps it wide and shoves the Save button past the popover edge.
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-1.5 py-1 text-[10px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={!presetName.trim()}
            className="shrink-0 rounded bg-[var(--accent)] px-2 py-1 text-[10px] font-semibold text-[var(--accent-text)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save
          </button>
        </form>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {label}
      </p>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className="filter-chip" data-active={active}>
      {children}
    </button>
  );
}
