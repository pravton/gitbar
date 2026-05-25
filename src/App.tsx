import { useCallback, useEffect, useRef, useState } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Header } from "@/components/Header";
import { KeybindHelp } from "@/components/KeybindHelp";
import { ListView } from "@/components/ListView";
import { Onboarding } from "@/components/Onboarding";
import { Settings } from "@/components/Settings";
import { UpdateBanner } from "@/components/UpdateBanner";
import { useAutoUpdater } from "@/hooks/useAutoUpdater";
import { useDensityMode } from "@/hooks/useDensityMode";
import { useGitHubAuth } from "@/hooks/useGitHubAuth";
import { useGitHubData } from "@/hooks/useGitHubData";
import { useReviewRequestNotifier } from "@/hooks/useReviewRequestNotifier";
import { useWindowPersistence } from "@/hooks/useWindowPersistence";

type Tab = "prs" | "issues";

// All of these are CSS / logical pixels, matching tauri.conf.json's
// `width`/`height`/`minWidth`/`minHeight`. The Tauri window APIs report
// sizes in physical pixels, so we convert via the current scale factor
// before comparing or persisting.
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 500;
// Static fallback for the collapsed height. Used only on first paint
// before the ResizeObserver has measured the header. The runtime
// value is `headerHeight + COLLAPSE_TOLERANCE`, recomputed whenever
// the header's content reflows (tiles appearing/disappearing, future
// new rows, etc.) so the collapsed window always exactly contains
// the header without clipping icons.
const COLLAPSED_HEIGHT_FALLBACK = 96;
/** Extra pixels added to the measured header height when sizing
    the collapsed window. Kept at 0 so the window's bottom edge
    sits exactly on the header's `border-b`. `Math.ceil()` on the
    fractional `getBoundingClientRect` reading already absorbs
    Retina subpixel rounding, so no slack is needed in normal
    operation. Bump this if a future header rev introduces an
    outer drop-shadow or other decoration that lives outside the
    border-box. */
const COLLAPSE_TOLERANCE = 0;
// Floor for what we'll persist or restore as an "expanded" size. Used
// in three places (the localStorage validator, the resize listener,
// and the toggle path) so a manual resize, a persisted value, and a
// fresh toggle all converge on the same minimum. `MIN_EXPANDED_WIDTH`
// matches tauri.conf.json's `minWidth: 320`.
const MIN_EXPANDED_WIDTH = 320;
const MIN_EXPANDED_HEIGHT = 320;
// Upper bounds for the remembered expanded size, in LOGICAL pixels.
// A floating GitBar bigger than this is almost certainly state
// corrupted by something like the macOS title-bar zoom (which can
// snap the window to fill the screen). Reject and fall back to
// defaults so a one-off bad save doesn't poison every future
// expand.
const MAX_EXPANDED_WIDTH = 2000;
const MAX_EXPANDED_HEIGHT = 2000;

const EXPANDED_SIZE_KEY = "gitbar.expandedSize";

interface ExpandedSize {
  /** Logical (CSS) pixels. */
  width: number;
  /** Logical (CSS) pixels. */
  height: number;
}

function readExpandedSize(): ExpandedSize {
  try {
    const raw = localStorage.getItem(EXPANDED_SIZE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ExpandedSize>;
      if (
        typeof parsed.width === "number" &&
        typeof parsed.height === "number" &&
        Number.isFinite(parsed.width) &&
        Number.isFinite(parsed.height) &&
        parsed.width >= MIN_EXPANDED_WIDTH &&
        parsed.height >= MIN_EXPANDED_HEIGHT &&
        parsed.width <= MAX_EXPANDED_WIDTH &&
        parsed.height <= MAX_EXPANDED_HEIGHT
      ) {
        return { width: parsed.width, height: parsed.height };
      }
      // Out-of-range value; drop the key so the next legitimate
      // save isn't layered on top of corrupted state.
      try {
        localStorage.removeItem(EXPANDED_SIZE_KEY);
      } catch {
        // non-fatal
      }
    }
  } catch {
    // corrupted or unavailable; fall through to default
  }
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

function writeExpandedSize(size: ExpandedSize): void {
  try {
    localStorage.setItem(EXPANDED_SIZE_KEY, JSON.stringify(size));
  } catch {
    // storage full or unavailable; non-fatal
  }
}

export default function App() {
  useWindowPersistence();
  const [collapsed, setCollapsed] = useState(false);
  // Mirror `collapsed` into a ref so the header-resize effect above
  // can read the current state without listing it as a dep (which
  // would cause the resize effect to re-run on every toggle).
  // Seed from localStorage so a cold start while the persisted window
  // state is collapsed still has a sensible expand target. The ref is
  // kept in sync with manual resizes via the onResized effect below,
  // so dragging the window taller while expanded sticks across a
  // collapse/expand cycle.
  const expandedSize = useRef<ExpandedSize>(readExpandedSize());
  const togglingRef = useRef(false);

  const auth = useGitHubAuth();
  const [activeTab, setActiveTab] = useState<Tab>("prs");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Hoisted here (was in ListView) so the Header's "?" button can open the
  // overlay too, and the `?` keybind in ListView shares the same source.
  const [helpOpen, setHelpOpen] = useState(false);
  const data = useGitHubData(auth.isAuthenticated);
  const notifier = useReviewRequestNotifier(data.prs);
  const updater = useAutoUpdater();
  const densityMode = useDensityMode();

  // Live header height. The header's content can grow/shrink (no
  // tiles render when all counts are 0; the tile strip lights up
  // when a count becomes > 0; future rows could change it too). The
  // collapsed window size has to track that so the user never sees
  // half-clipped icons when they hit the chevron. Refs mirror the
  // numeric values into the imperative event handlers below without
  // forcing them to re-bind whenever the header reflows.
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState<number>(COLLAPSED_HEIGHT_FALLBACK - COLLAPSE_TOLERANCE);
  const collapsedHeight = Math.ceil(headerHeight) + COLLAPSE_TOLERANCE;
  const collapsedThreshold = collapsedHeight + 10;
  const collapsedHeightRef = useRef(collapsedHeight);
  collapsedHeightRef.current = collapsedHeight;
  const collapsedThresholdRef = useRef(collapsedThreshold);
  collapsedThresholdRef.current = collapsedThreshold;

  // Watch the header's bounding box. `border-box` matches the
  // window's interior (the same content box we want to fit inside
  // a collapsed window).
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const next = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (Number.isFinite(next) && next > 0) {
          setHeaderHeight(next);
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // If the header GROWS while the window is currently collapsed,
  // re-issue setSize so the window expands just enough to keep the
  // header fully visible. Shrinks are left alone (otherwise the
  // user would see the panel snap closed when an empty inbox hides
  // the tile strip, which would be jarring).
  const collapsedRef = useRef(false);
  collapsedRef.current = collapsed;
  useEffect(() => {
    if (!collapsedRef.current) return;
    void (async () => {
      try {
        const appWindow = getCurrentWindow();
        const sf = await appWindow.scaleFactor();
        const outer = (await appWindow.outerSize()).toLogical(sf);
        if (outer.height < collapsedHeight) {
          await appWindow.setSize(
            new LogicalSize(outer.width, collapsedHeight),
          );
        }
      } catch (err) {
        console.warn("collapse-resize on header change failed:", err);
      }
    })();
  }, [collapsedHeight]);

  // Repo-grouping expansion state. Lifted out of ListView so the
  // kebab menu in Header (and the `G` keybind) can drive
  // expand-all / collapse-all without coupling Header to ListView
  // internals. `knownGroupKeys` is populated by ListView via the
  // `onGroupKeysChange` callback so this layer can synthesize the
  // "all known groups" set without owning the filter / grouping
  // logic itself.
  //
  // Tab gating: grouping only applies to PRs (Issues skip groupBy).
  // ListView's `prDisplayItems` is computed from the FILTERED PR
  // list regardless of which tab is active, so it can still report
  // group keys while the user is on the Issues tab. We gate the
  // derived `hasGroups` / `allGroupsExpanded` on `activeTab` here
  // so the Header doesn't show "Expand all groups" (and the `G`
  // keybind stays inert) while viewing Issues.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [knownGroupKeys, setKnownGroupKeys] = useState<string[]>([]);
  const isPrsTab = activeTab === "prs";
  const hasGroups = isPrsTab && knownGroupKeys.length > 0;
  const allGroupsExpanded =
    hasGroups && knownGroupKeys.every((k) => expandedGroups.has(k));
  const toggleAllGroups = useCallback(() => {
    if (!isPrsTab) return;
    setExpandedGroups((prev) => {
      const everyOn =
        knownGroupKeys.length > 0 && knownGroupKeys.every((k) => prev.has(k));
      return everyOn ? new Set() : new Set(knownGroupKeys);
    });
  }, [isPrsTab, knownGroupKeys]);

  // Stable handlers passed down to ListView. ListView installs a
  // document-level keydown listener whose deps include these callbacks;
  // without useCallback the listener rebinds on every App render (which
  // happens on every poll tick, every loading flip, etc.).
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  // Depend on `data.forceRefresh` (stable; the hook wraps it in
  // useCallback), not `data` itself — `data` is a new object every render
  // and would defeat the memoization.
  const forceRefresh = useCallback(() => {
    void data.forceRefresh();
  }, [data.forceRefresh]);

  // Hold `auth` in a ref so this effect's deps are just the trigger
  // (the auth-error kind + the isAuthenticated boolean). Previously
  // depending on the whole `auth` object re-ran this on every render
  // where `authError` flipped, racing with onboarding submissions.
  const authRef = useRef(auth);
  authRef.current = auth;
  useEffect(() => {
    if (data.error?.kind === "auth" && auth.isAuthenticated) {
      void authRef.current.clearToken();
    }
  }, [data.error?.kind, auth.isAuthenticated]);

  // Keep the `collapsed` boolean (which drives the chevron direction) in
  // sync with the *actual* OS window height. Tauri's window APIs report
  // PhysicalSize, but `COLLAPSED_THRESHOLD` is in logical (CSS) pixels.
  // On a 2x Retina display, comparing physical against logical without
  // converting was the matte-display toggle bug: a window clamped to
  // minHeight 60 CSS = 120 physical, so we never crossed the 70-physical
  // threshold and never flipped `collapsed` true.
  //
  // We also use this effect to update `expandedSize` whenever the user
  // drags-resizes the window while expanded, so collapse/expand cycles
  // remember the height they manually chose.
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cleanup: (() => void) | undefined;
    let disposed = false;

    void (async () => {
      try {
        const sf = await appWindow.scaleFactor();
        const initial = await appWindow.outerSize();
        const initialLogical = initial.toLogical(sf);
        if (!disposed)
          setCollapsed(initialLogical.height <= collapsedThresholdRef.current);

        const unlisten = await appWindow.onResized(async ({ payload }) => {
          // Wrap the handler body so a rejected scaleFactor() (or any
          // other async failure mid-resize) becomes a console warning
          // instead of an unhandled promise rejection that surfaces in
          // devtools and breaks every subsequent resize event.
          try {
            // Re-read scale factor each time: it can change when the
            // window moves between displays with different DPIs.
            const liveSf = await appWindow.scaleFactor();
            const logical = payload.toLogical(liveSf);
            const isCollapsed = logical.height <= collapsedThresholdRef.current;
            setCollapsed(isCollapsed);
            // While expanded, remember the size so a later collapse +
            // expand restores to whatever the user dragged it to. While
            // collapsed, the small height is by definition not what we
            // want to remember as the "expanded" size.
            if (!isCollapsed) {
              const remembered = {
                width: Math.max(logical.width, MIN_EXPANDED_WIDTH),
                height: Math.max(logical.height, MIN_EXPANDED_HEIGHT),
              };
              expandedSize.current = remembered;
              writeExpandedSize(remembered);
            }
          } catch (err) {
            console.warn("onResized handler failed:", err);
          }
        });

        // Race: the effect could be cleaned up (App unmounted, e.g. in
        // tests, or React Strict Mode's mount/unmount/mount cycle)
        // before this point. If so, the assignment to `cleanup` happens
        // after the cleanup function has already returned, leaving the
        // listener attached. Detect and unlisten immediately.
        if (disposed) {
          unlisten();
        } else {
          cleanup = unlisten;
        }
      } catch {
        // Tauri window API not ready; non-fatal.
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  // Issue setSize and let the `onResized` effect above be the sole writer
  // of `collapsed`. Single source of truth: the chevron always reflects
  // the actual OS window height, whether the change came from this button,
  // a manual edge-drag, or a persisted-size restore. `togglingRef` still
  // guards a rapid double-click from racing two resize calls.
  //
  // All math is in logical (CSS) pixels. `outerSize` returns physical;
  // we convert via the current scale factor before storing or comparing.
  // `setSize(new LogicalSize(...))` lets Tauri apply the right physical
  // size for the display we're on (the Retina display is 2x, external
  // monitors are usually 1x), which was the matte-display toggle bug.
  const toggleCollapsed = async () => {
    if (togglingRef.current) return;
    togglingRef.current = true;

    try {
      const appWindow = getCurrentWindow();
      const sf = await appWindow.scaleFactor();
      if (collapsed) {
        const { width, height } = expandedSize.current;
        await appWindow.setSize(new LogicalSize(width, height));
      } else {
        const current = (await appWindow.outerSize()).toLogical(sf);
        const remembered = {
          width: Math.max(current.width, MIN_EXPANDED_WIDTH),
          height: Math.max(current.height, MIN_EXPANDED_HEIGHT),
        };
        expandedSize.current = remembered;
        writeExpandedSize(remembered);
        // Measure the header live at click time instead of trusting the
        // last `ResizeObserver` snapshot. This avoids a class of races
        // where the header's content reflowed (e.g. a count flipped
        // from 0 to N and the tile strip appeared) one tick before the
        // user hit the chevron, but state / refs haven't caught up yet.
        // `getBoundingClientRect` reports the live laid-out height in
        // CSS pixels, which is what `LogicalSize` wants.
        const measured =
          headerRef.current?.getBoundingClientRect().height ?? headerHeight;
        const target = Math.ceil(measured) + COLLAPSE_TOLERANCE;
        await appWindow.setSize(new LogicalSize(current.width, target));
      }
    } catch (err) {
      console.error("toggleCollapsed failed:", err);
    } finally {
      togglingRef.current = false;
    }
  };

  // Hold the auth gate until the mount-time check completes; otherwise we
  // flash the onboarding screen for a frame before the keychain lookup
  // settles.
  if (!auth.ready) {
    return null;
  }

  if (!auth.isAuthenticated) {
    return (
      <Onboarding
        checking={auth.checking}
        error={auth.authError}
        onConnect={auth.checkToken}
      />
    );
  }

  // Surfaced separately in the header headline ("X needs review")
  // because it's the single most actionable signal for the user.
  const reviewRequestedCount = data.prs.filter(
    (pr) => pr.review_decision === "REVIEW_REQUIRED",
  ).length;

  return (
    <div
      className="relative overflow-hidden text-[var(--text-primary)]"
      style={{
        height: "100vh",
        background: "var(--panel-surface)",
        borderRadius: "var(--panel-radius)",
        // Inset highlight on the top edge sells the "raised" feel; the
        // outer drop-shadow gives the panel its float. macOS applies
        // its own subtle drop-shadow on the window itself, so we only
        // add the inset; doubling shadows would feel heavy.
        boxShadow:
          "inset 0 1px 0 hsla(0, 0%, 100%, 0.06), inset 0 0 0 1px hsla(0, 0%, 100%, 0.04)",
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col" style={{ height: "100%" }}>
        <Header
          ref={headerRef}
          prCount={data.prs.length}
          reviewRequestedCount={reviewRequestedCount}
          issueCount={data.issues.length}
          updatedAt={data.updatedAt}
          refreshing={data.loading}
          collapsed={collapsed}
          density={densityMode.density}
          activeTab={activeTab}
          hasGroups={hasGroups}
          allGroupsExpanded={allGroupsExpanded}
          onRefresh={forceRefresh}
          onSettings={openSettings}
          onHelp={openHelp}
          onToggleDensity={densityMode.toggle}
          onToggleAllGroups={toggleAllGroups}
          onTabChange={setActiveTab}
          onToggleCollapsed={toggleCollapsed}
        />
        <UpdateBanner updater={updater} />
        {/*
         * Always render ListView. When collapsed, the OS window is sized
         * to the live measured header height and the outer wrapper's
         * overflow-hidden clips the list naturally, so we never end up in
         * the bad state where React
         * is "collapsed" but the window is full size and the body is blank.
         * Filter state, scroll position, and tab selection also survive
         * collapse/expand instead of resetting.
         */}
        <ListView
          activeTab={activeTab}
          onTabChange={setActiveTab}
          prs={data.prs}
          issues={data.issues}
          loading={data.loading}
          error={data.error}
          retry={data.retry}
          partialMessage={data.partialMessage}
          density={densityMode.density}
          expandedGroups={expandedGroups}
          onExpandedGroupsChange={setExpandedGroups}
          onGroupKeysChange={setKnownGroupKeys}
          onToggleAllGroups={toggleAllGroups}
          helpOpen={helpOpen}
          onOpenHelp={openHelp}
          onCloseHelp={closeHelp}
          onRefresh={forceRefresh}
          onOpenSettings={openSettings}
        />
      </div>

      {settingsOpen && (
        <Settings
          onReplaceToken={auth.replaceToken}
          onClearToken={auth.clearToken}
          notifications={notifier}
          onClose={closeSettings}
        />
      )}

      <KeybindHelp open={helpOpen} onClose={closeHelp} />
    </div>
  );
}
