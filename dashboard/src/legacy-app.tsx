import type { FunctionComponent } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { ActivitySidebar } from "./components/ActivitySidebar.js";
import { Header, type DashboardView } from "./components/Header.js";
import { StatsGrid } from "./components/StatsGrid.js";

import { TaskCard } from "./components/TaskCard.js";
import { useDashboardRuntimeData } from "./hooks/use-dashboard-runtime-data.js";
import { useDashboardSettings } from "./hooks/use-dashboard-settings.js";
import { rerunTask } from "./lib/api/dashboard-api.js";
import { SkeletonPanel } from "./v2/components/ui/ListSkeletons.js";

const SettingsPage = lazy(() => import("./components/SettingsPage.js").then(m => ({ default: m.SettingsPage })));

export const App: FunctionComponent = () => {
  const [view, setView] = useState<DashboardView>("dashboard");
  const { error, gitStatus, gitStatusError, refreshGitStatus, refreshRuntimeStatus, status, stats, tasksWithLiveActivities } =
    useDashboardRuntimeData();
  const {
    fetchSettings,
    importMissingSettings,
    isLoading,
    isSaving,
    saveMessage,
    saveSettings,
    settings,
    settingsError,
    setSettings,
  } = useDashboardSettings();

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const handleSaveSettings = async (): Promise<void> => {
    const saveSucceeded = await saveSettings();
    if (saveSucceeded) {
      await refreshGitStatus();
    }
  };

  const handleRerunTask = async (taskId: string): Promise<void> => {
    await rerunTask(taskId);
    await refreshRuntimeStatus();
    await refreshGitStatus();
  };

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 p-8 rounded-xl text-center max-w-md">
          <div className="text-red-400 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold mb-2 text-white">Connection Lost</h2>
          <p className="text-slate-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex flex-col">
      <div className="fixed top-0 -left-4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[128px] pointer-events-none" />
      <div className="fixed bottom-0 -right-4 w-96 h-96 bg-blue-500/10 rounded-full blur-[128px] pointer-events-none" />

      <Header
        sprintNumber={status.sprint_number}
        featureBranch={status.feature_branch}
        timestamp={status.timestamp}
        view={view}
        onChangeView={setView}
      />

      <main className="flex-grow max-w-7xl mx-auto px-6 py-8 w-full">
        {view === "dashboard" ? (
          <>
            <StatsGrid stats={stats} />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-8">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    Task Pipeline
                    <span className="px-2 py-0.5 bg-slate-800 rounded text-xs text-slate-400 font-mono">{stats.total}</span>
                  </h2>
                </div>

                <div className="space-y-4">
                  {stats.total === 0 ? (
                    <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 border-dashed p-12 rounded-xl text-center">
                      <p className="text-slate-500">Awaiting sprint decomposition...</p>
                    </div>
                  ) : (
                    tasksWithLiveActivities.map((task) => <TaskCard key={task.id} task={task} onRerunTask={handleRerunTask} />)
                  )}
                </div>
              </div>

              <div className="lg:col-span-4">
                <ActivitySidebar
                  reportText={status.reportText}
                  instructions={status.instructions}
                  gitStatus={gitStatus}
                  gitStatusError={gitStatusError}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="max-w-5xl">
            <Suspense fallback={<div className="p-8"><SkeletonPanel /></div>}>
              <SettingsPage
                settings={settings}
                isLoading={isLoading}
                isSaving={isSaving}
                error={settingsError}
                saveMessage={saveMessage}
                onChange={setSettings}
                onSave={handleSaveSettings}
                onImportMissing={importMissingSettings}
              />
            </Suspense>
          </div>
        )}
      </main>
    </div>
  );
};
