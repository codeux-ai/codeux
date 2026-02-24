import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Header, type DashboardView } from "./components/Header.js";
import { StatsGrid } from "./components/StatsGrid.js";
import { TaskCard } from "./components/TaskCard.js";
import { ActivitySidebar } from "./components/ActivitySidebar.js";
import { SettingsPage } from "./components/SettingsPage.js";
import { computeStats, mergeLiveActivities } from "./lib/status.js";
import { cloneDefaultSettings } from "./lib/settings.js";
import type { DashboardSettings, DashboardStatus, GitTrackingStatus, LiveActivitiesResponse } from "./types.js";

const DEFAULT_LOG_POLL_INTERVAL_MS = 10000;

export const App: FunctionComponent = () => {
  const [view, setView] = useState<DashboardView>("dashboard");
  const [status, setStatus] = useState<DashboardStatus>({ subtasks: [], timestamp: null });
  const [error, setError] = useState<string | null>(null);
  const [liveActivities, setLiveActivities] = useState<Record<string, LiveActivitiesResponse["activitiesBySession"][string]>>({});
  const [settings, setSettings] = useState<DashboardSettings>(cloneDefaultSettings());
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSettingsLoading, setIsSettingsLoading] = useState<boolean>(false);
  const [isSettingsSaving, setIsSettingsSaving] = useState<boolean>(false);
  const [gitStatus, setGitStatus] = useState<GitTrackingStatus | null>(null);
  const [gitStatusError, setGitStatusError] = useState<string | null>(null);

  const fetchData = async (): Promise<void> => {
    try {
      const [statusRes, activitiesRes] = await Promise.all([fetch("/api/status"), fetch("/api/live-activities")]);
      if (!statusRes.ok || !activitiesRes.ok) {
        throw new Error("Failed to fetch dashboard data");
      }

      const statusData: DashboardStatus = await statusRes.json();
      const activitiesData: LiveActivitiesResponse = await activitiesRes.json();
      setStatus(statusData);
      setLiveActivities(activitiesData.activitiesBySession || {});
      setError(null);
    } catch {
      setError("Unable to connect to Orchestrator API");
    }
  };

  const fetchGitStatus = async (): Promise<void> => {
    try {
      const response = await fetch("/api/git-status");
      if (!response.ok) {
        throw new Error("Failed to fetch git status");
      }
      const data: GitTrackingStatus = await response.json();
      setGitStatus(data);
      setGitStatusError(null);
    } catch {
      setGitStatusError("Unable to load git/ci/pr tracking.");
    }
  };

  const fetchSettings = async (): Promise<void> => {
    setIsSettingsLoading(true);
    try {
      const response = await fetch("/api/settings");
      if (!response.ok) {
        throw new Error("Failed to fetch settings");
      }
      const data: DashboardSettings = await response.json();
      setSettings(data);
      setSettingsError(null);
    } catch {
      setSettingsError("Unable to load settings");
    } finally {
      setIsSettingsLoading(false);
    }
  };

  const saveSettings = async (): Promise<void> => {
    setIsSettingsSaving(true);
    setSaveMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      });
      if (!response.ok) {
        throw new Error("Failed to save settings");
      }
      const data: DashboardSettings = await response.json();
      setSettings(data);
      setSettingsError(null);
      setSaveMessage("Settings saved.");
      await fetchGitStatus();
    } catch {
      setSettingsError("Unable to save settings");
    } finally {
      setIsSettingsSaving(false);
    }
  };

  useEffect(() => {
    void fetchData();
    void fetchSettings();
    void fetchGitStatus();
    const intervalId = window.setInterval(() => void fetchData(), DEFAULT_LOG_POLL_INTERVAL_MS);
    const gitIntervalId = window.setInterval(() => void fetchGitStatus(), DEFAULT_LOG_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
      window.clearInterval(gitIntervalId);
    };
  }, []);

  const tasksWithLiveActivities = useMemo(() => {
    return mergeLiveActivities(status.subtasks || [], liveActivities);
  }, [status.subtasks, liveActivities]);

  const stats = useMemo(() => computeStats(tasksWithLiveActivities), [tasksWithLiveActivities]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 p-8 rounded-2xl text-center max-w-md">
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
                    <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 border-dashed p-12 rounded-2xl text-center">
                      <p className="text-slate-500">Awaiting sprint decomposition...</p>
                    </div>
                  ) : (
                    tasksWithLiveActivities.map((task) => <TaskCard key={task.id} task={task} />)
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
            <SettingsPage
              settings={settings}
              isLoading={isSettingsLoading}
              isSaving={isSettingsSaving}
              error={settingsError}
              saveMessage={saveMessage}
              onChange={setSettings}
              onSave={saveSettings}
            />
          </div>
        )}
      </main>
    </div>
  );
};
