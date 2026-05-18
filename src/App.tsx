import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Header } from "@/components/Header";
import { ListView } from "@/components/ListView";
import { Onboarding } from "@/components/Onboarding";
import { Settings } from "@/components/Settings";
import { Strip } from "@/components/Strip";
import { useGitHubAuth } from "@/hooks/useGitHubAuth";
import { useIssues } from "@/hooks/useIssues";
import { usePRs } from "@/hooks/usePRs";
import {
  readExpandedSize,
  readInitialCompact,
  useWindowPersistence,
  writeCompactState,
  writeExpandedSize,
} from "@/hooks/useWindowPersistence";

type Tab = "prs" | "issues";

export default function App() {
  const [isCompact, setIsCompact] = useState(readInitialCompact);
  useWindowPersistence(isCompact);
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

  const expandWindow = useCallback(async () => {
    const { width, height } = readExpandedSize();
    await getCurrentWindow().setSize(new PhysicalSize(width, height));
    setIsCompact(false);
    writeCompactState(false);
  }, []);

  const toggleCompact = useCallback(() => {
    const appWindow = getCurrentWindow();

    if (isCompact) {
      void expandWindow();
      return;
    }

    void appWindow.outerSize().then(async (currentSize) => {
      writeExpandedSize(currentSize.width, currentSize.height);
      setIsCompact(true);
      writeCompactState(true);
      await appWindow.setSize(new PhysicalSize(currentSize.width, 56));
    });
  }, [expandWindow, isCompact]);

  const openSettings = useCallback(() => {
    if (isCompact) {
      void expandWindow().finally(() => setSettingsOpen(true));
      return;
    }

    setSettingsOpen(true);
  }, [expandWindow, isCompact]);

  if (!auth.isAuthenticated) {
    return <Onboarding checking={auth.checking} error={auth.authError} onConnect={auth.checkToken} />;
  }

  const draftCount = prState.prs.filter((pr) => pr.is_draft).length;

  if (isCompact) {
    return (
      <Strip
        prCount={prState.prs.length}
        draftCount={draftCount}
        issueCount={issueState.issues.length}
        updatedAt={updatedAt}
        refreshing={prState.loading || issueState.loading}
        isCompact={isCompact}
        onRefresh={refreshAll}
        onSettings={openSettings}
        onToggle={toggleCompact}
      />
    );
  }

  return (
    <div className="relative flex h-screen overflow-hidden border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl">
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          prCount={prState.prs.length}
          issueCount={issueState.issues.length}
          updatedAt={updatedAt}
          refreshing={prState.loading || issueState.loading}
          onRefresh={refreshAll}
          onSettings={openSettings}
          onToggleCompact={toggleCompact}
        />
        <ListView
          activeTab={activeTab}
          onTabChange={setActiveTab}
          prs={prState.prs}
          issues={issueState.issues}
          loading={activeTab === "prs" ? prState.loading : issueState.loading}
          error={activeTab === "prs" ? prState.error : issueState.error}
        />
      </div>

      {settingsOpen ? (
        <Settings
          token={auth.token}
          onSaveToken={auth.setToken}
          onClearToken={auth.clearToken}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
