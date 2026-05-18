import { useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Header } from "@/components/Header";
import { ListView } from "@/components/ListView";
import { Onboarding } from "@/components/Onboarding";
import { Settings } from "@/components/Settings";
import { useGitHubAuth } from "@/hooks/useGitHubAuth";
import { useIssues } from "@/hooks/useIssues";
import { usePRs } from "@/hooks/usePRs";
import { useWindowPersistence } from "@/hooks/useWindowPersistence";

type Tab = "prs" | "issues";

const COLLAPSED_HEIGHT = 48;
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 500;

export default function App() {
  useWindowPersistence();
  const [collapsed, setCollapsed] = useState(false);
  const expandedSize = useRef({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

  const auth = useGitHubAuth();
  const [activeTab, setActiveTab] = useState<Tab>("prs");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const prState = usePRs(auth.token);
  const issueState = useIssues(auth.token);

  const updatedAt = useMemo(() => {
    const times = [prState.updatedAt, issueState.updatedAt].filter((date): date is Date => date !== null);
    if (times.length === 0) return null;
    return new Date(Math.max(...times.map((date) => date.getTime())));
  }, [issueState.updatedAt, prState.updatedAt]);

  const refreshAll = () => {
    void invoke("refresh_cache", { token: auth.token }).finally(() => {
      void Promise.all([prState.refetch(), issueState.refetch()]);
    });
  };

  const toggleCollapsed = async () => {
    const appWindow = getCurrentWindow();
    if (collapsed) {
      // Expand: restore saved size
      await appWindow.setSize(
        new PhysicalSize(expandedSize.current.width, expandedSize.current.height),
      );
      setCollapsed(false);
    } else {
      // Collapse: save current size, shrink to header height
      const current = await appWindow.outerSize();
      expandedSize.current = {
        width: Math.max(current.width, 280),
        height: Math.max(current.height, 320),
      };
      setCollapsed(true);
      // Let React render the collapsed state, then resize
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void appWindow.setSize(new PhysicalSize(expandedSize.current.width, COLLAPSED_HEIGHT));
        });
      });
    }
  };

  if (!auth.isAuthenticated) {
    return <Onboarding checking={auth.checking} error={auth.authError} onConnect={auth.checkToken} />;
  }

  const draftCount = prState.prs.filter((pr) => pr.is_draft).length;

  return (
    <div
      className="relative overflow-hidden border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl"
      style={{ height: "100vh" }}
    >
      <div className="flex min-h-0 flex-1 flex-col" style={{ height: "100%" }}>
        <Header
          prCount={prState.prs.length}
          draftCount={draftCount}
          issueCount={issueState.issues.length}
          updatedAt={updatedAt}
          refreshing={prState.loading || issueState.loading}
          collapsed={collapsed}
          onRefresh={refreshAll}
          onSettings={() => setSettingsOpen(true)}
          onToggleCollapsed={toggleCollapsed}
        />
        {!collapsed && (
          <div className="min-h-0 flex-1">
            <ListView
              activeTab={activeTab}
              onTabChange={setActiveTab}
              prs={prState.prs}
              issues={issueState.issues}
              loading={activeTab === "prs" ? prState.loading : issueState.loading}
              error={activeTab === "prs" ? prState.error : issueState.error}
            />
          </div>
        )}
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
