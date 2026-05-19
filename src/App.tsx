import { useEffect, useMemo, useRef, useState } from "react";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Header } from "@/components/Header";
import { ListView } from "@/components/ListView";
import { Onboarding } from "@/components/Onboarding";
import { Settings } from "@/components/Settings";
import { useGitHubAuth } from "@/hooks/useGitHubAuth";
import { useGitHubData } from "@/hooks/useGitHubData";
import { useWindowPersistence } from "@/hooks/useWindowPersistence";

type Tab = "prs" | "issues";

const COLLAPSED_HEIGHT = 60;
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 500;

export default function App() {
  useWindowPersistence();
  const [collapsed, setCollapsed] = useState(false);
  const expandedSize = useRef({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const togglingRef = useRef(false);

  const auth = useGitHubAuth();
  const [activeTab, setActiveTab] = useState<Tab>("prs");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const data = useGitHubData(auth.token);

  useEffect(() => {
    if (data.error?.kind === "auth" && auth.token) {
      auth.clearToken();
    }
  }, [data.error, auth]);

  // Keep the `collapsed` boolean (which drives the chevron direction) in
  // sync with the *actual* OS window height. Without this, the saved
  // window size from a previous session can land us in a state where
  // React thinks the window is full but it's collapsed (or vice versa)
  // and the chevron points the wrong way.
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cleanup: (() => void) | undefined;
    let disposed = false;

    void (async () => {
      try {
        const initial = await appWindow.outerSize();
        if (!disposed) setCollapsed(initial.height <= COLLAPSED_HEIGHT + 10);
        cleanup = await appWindow.onResized(({ payload }) => {
          setCollapsed(payload.height <= COLLAPSED_HEIGHT + 10);
        });
      } catch {
        // Tauri window API not ready; non-fatal.
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  // Resize the OS window *first*, then update React state. This avoids the
  // "square box behind" effect where React shrinks the content before macOS
  // shrinks the window. Guarded by `togglingRef` so a rapid double-click
  // doesn't race two resizes against each other.
  const toggleCollapsed = async () => {
    if (togglingRef.current) return;
    togglingRef.current = true;

    try {
      const appWindow = getCurrentWindow();
      if (collapsed) {
        await appWindow.setSize(
          new PhysicalSize(expandedSize.current.width, expandedSize.current.height),
        );
        setCollapsed(false);
      } else {
        const current = await appWindow.outerSize();
        expandedSize.current = {
          width: Math.max(current.width, 280),
          height: Math.max(current.height, 320),
        };
        await appWindow.setSize(new PhysicalSize(current.width, COLLAPSED_HEIGHT));
        setCollapsed(true);
      }
    } catch (err) {
      console.error("toggleCollapsed failed:", err);
    } finally {
      togglingRef.current = false;
    }
  };

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
          onRefresh={() => void data.forceRefresh()}
          onSettings={() => setSettingsOpen(true)}
          onToggleCollapsed={toggleCollapsed}
        />
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
          partialMessage={data.partialMessage}
        />
      </div>

      {settingsOpen && (
        <Settings
          token={auth.token}
          onSaveToken={auth.setToken}
          onClearToken={auth.clearToken}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
