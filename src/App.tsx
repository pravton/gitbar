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
import { useGitHubAuth } from "@/hooks/useGitHubAuth";
import { useGitHubData } from "@/hooks/useGitHubData";
import { useReviewRequestNotifier } from "@/hooks/useReviewRequestNotifier";
import { useWindowPersistence } from "@/hooks/useWindowPersistence";

type Tab = "prs" | "issues";

// All of these are CSS / logical pixels, matching tauri.conf.json's
// `width`/`height`/`minWidth`/`minHeight`. The Tauri window APIs report
// sizes in physical pixels, so we convert via the current scale factor
// before comparing or persisting.
const COLLAPSED_HEIGHT = 60;
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 500;
const COLLAPSED_THRESHOLD = COLLAPSED_HEIGHT + 10;
// Floor for what we'll persist or restore as an "expanded" size. Used
// in three places (the localStorage validator, the resize listener,
// and the toggle path) so a manual resize, a persisted value, and a
// fresh toggle all converge on the same minimum. `MIN_EXPANDED_WIDTH`
// matches tauri.conf.json's `minWidth: 320`.
const MIN_EXPANDED_WIDTH = 320;
const MIN_EXPANDED_HEIGHT = 320;

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
        parsed.height >= MIN_EXPANDED_HEIGHT
      ) {
        return { width: parsed.width, height: parsed.height };
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

  useEffect(() => {
    if (data.error?.kind === "auth" && auth.isAuthenticated) {
      void auth.clearToken();
    }
  }, [data.error, auth]);

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
        if (!disposed) setCollapsed(initialLogical.height <= COLLAPSED_THRESHOLD);

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
            const isCollapsed = logical.height <= COLLAPSED_THRESHOLD;
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
        await appWindow.setSize(new LogicalSize(current.width, COLLAPSED_HEIGHT));
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

  const draftCount = data.prs.filter((pr) => pr.is_draft).length;

  return (
    <div
      className="relative overflow-hidden border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl"
      style={{ height: "100vh" }}
    >
      <div className="flex min-h-0 flex-1 flex-col" style={{ height: "100%" }}>
        <Header
          prCount={data.prs.length}
          draftCount={draftCount}
          issueCount={data.issues.length}
          updatedAt={data.updatedAt}
          refreshing={data.loading}
          collapsed={collapsed}
          onRefresh={forceRefresh}
          onSettings={openSettings}
          onHelp={openHelp}
          onToggleCollapsed={toggleCollapsed}
        />
        <UpdateBanner updater={updater} />
        {/*
         * Always render ListView. When collapsed, the OS window is sized to
         * COLLAPSED_HEIGHT and the outer wrapper's overflow-hidden clips the
         * list naturally — so we never end up in the bad state where React
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
