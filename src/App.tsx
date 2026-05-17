import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Header } from "@/components/Header";
import { ListView } from "@/components/ListView";
import { Onboarding } from "@/components/Onboarding";
import { Settings } from "@/components/Settings";
import { useGitHubAuth } from "@/hooks/useGitHubAuth";
import { useIssues } from "@/hooks/useIssues";
import { usePRs } from "@/hooks/usePRs";
import { useWindowPersistence } from "@/hooks/useWindowPersistence";

type Tab = "prs" | "issues";

export default function App() {
  useWindowPersistence();
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

  if (!auth.isAuthenticated) {
    return <Onboarding checking={auth.checking} error={auth.authError} onConnect={auth.checkToken} />;
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
          onSettings={() => setSettingsOpen(true)}
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
