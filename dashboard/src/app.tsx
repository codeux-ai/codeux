import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Header } from "./components/Header.js";
import { StatsGrid } from "./components/StatsGrid.js";
import { TaskCard } from "./components/TaskCard.js";
import { ActivitySidebar } from "./components/ActivitySidebar.js";
import { computeStats, mergeLiveActivities } from "./lib/status.js";
import type { DashboardStatus, LiveActivitiesResponse } from "./types.js";

const DEFAULT_LOG_POLL_INTERVAL_MS = 10000;

export const App: FunctionComponent = () => {
  const [status, setStatus] = useState<DashboardStatus>({ subtasks: [], timestamp: null });
  const [error, setError] = useState<string | null>(null);
  const [liveActivities, setLiveActivities] = useState<Record<string, LiveActivitiesResponse["activitiesBySession"][string]>>({});

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

  useEffect(() => {
    void fetchData();
    const intervalId = window.setInterval(() => void fetchData(), DEFAULT_LOG_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
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

      <Header sprintNumber={status.sprint_number} featureBranch={status.feature_branch} timestamp={status.timestamp} />

      <main className="flex-grow max-w-7xl mx-auto px-6 py-8 w-full">
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
            <ActivitySidebar reportText={status.reportText} instructions={status.instructions} />
          </div>
        </div>
      </main>
    </div>
  );
};
