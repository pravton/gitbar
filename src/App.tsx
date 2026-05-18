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
  const data = useGitHubData(auth.token);

  // If GitHub starts rejecting the token mid-session (revoked, scope removed),
  // bounce the user back to onboarding instead of leaving them on an empty list.
  useEffect(() => {
    if (data.error?.kind === "auth" && auth.token) {
      auth.clearToken();
    }
  }, [data.error, auth]);

  const toggleCollapsed = async () => {
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
      setCollapsed(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void appWindow.setSize(new PhysicalSize(expandedSize.current.width, COLLAPSED_HEIGHT));
        });
      });
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
        {!collapsed && (
          <div className="min-h-0 flex-1">
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
