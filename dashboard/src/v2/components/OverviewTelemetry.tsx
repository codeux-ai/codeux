import type { FunctionComponent } from "preact";
import { Activity, AlertTriangle, FolderKanban, Layers, Radio, Zap } from "lucide-preact";
import { useMemo } from "preact/hooks";
import { SkeletonPanel } from "./layout/SkeletonLoader.js";
import { useOverviewTelemetry } from "../../hooks/use-overview-telemetry.js";
import { formatTime } from "../../lib/time.js";
import { buildProjectLookup, getEventStyle, getInterventionContent } from "../lib/overview-telemetry-view-models.js";
import { useProjectData } from "../context/project-data.js";


export const OverviewTelemetry: FunctionComponent = () => {
  const { telemetry, loading: telemetryLoading, error } = useOverviewTelemetry();
  const { loading: projectsLoading } = useProjectData();
  const isLoading = telemetryLoading || projectsLoading;

  const hasActiveProjects = telemetry?.activeProjects?.length > 0;
  const hasAttentionProjects = telemetry?.attentionProjects?.length > 0;

  const projectLookup = useMemo(() => buildProjectLookup(telemetry), [telemetry]);
  const hasRuntimeSignal = hasActiveProjects || hasAttentionProjects;

  const totalRunningDispatches = useMemo(
    () => (telemetry?.activeProjects ?? []).reduce((sum, project) => sum + (project.runningDispatchCount ?? 0), 0),
    [telemetry],
  );

  if (error) {
    return (
      <aside className="sticky top-24 flex h-[calc(100vh-7rem)] min-h-[30rem] flex-col overflow-hidden rounded-[1.75rem] border border-status-red/20 bg-white/80 p-8 backdrop-blur-sm dark:bg-void-800/75">
        <div className="flex items-center gap-3">
          <Radio className="w-5 h-5 text-status-red" strokeWidth={1.5} />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-status-red">Telemetry Error</div>
            <div className="text-sm text-slate-500 dark:text-slate-500 mt-1">{error}</div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sticky top-24 flex h-[calc(100vh-7rem)] min-h-[34rem] flex-col overflow-hidden group">
      <h3 className="mb-7 flex items-center gap-4 font-display text-3xl font-black tracking-tighter text-slate-900 dark:text-white">
        <div className="relative flex items-center justify-center">
          <div className={`w-3.5 h-3.5 rounded-full relative z-10 shadow-sm ${
            hasActiveProjects
              ? "bg-status-green shadow-[0_0_8px_rgba(0,171,132,0.4)]"
              : hasAttentionProjects
                ? "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.4)]"
                : "bg-slate-400 dark:bg-slate-500"
          }`} />
        </div>
        Telemetry.
      </h3>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/78 p-8 backdrop-blur-sm dark:border-white/[0.06] dark:bg-void-800/75">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-500/40 to-transparent" />
        {isLoading ? (
          <div className="flex flex-col gap-6">
            <SkeletonPanel />
            <SkeletonPanel />
          </div>
        ) : !hasRuntimeSignal ? (
          <div className="relative flex h-full items-center justify-center overflow-hidden">
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-48 rounded-full border border-black/[0.07] dark:border-white/[0.08] animate-[ping_4s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
              <div className="absolute h-72 w-72 rounded-full border border-black/[0.04] dark:border-white/[0.05] animate-[ping_7s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
              <div className="absolute h-[22rem] w-[22rem] rounded-full border border-black/[0.02] dark:border-white/[0.03] animate-[ping_10s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
            </div>
            <div className="relative z-10 text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[1.25rem] border border-black/[0.07] shadow-[0_0_28px_rgba(100,116,139,0.12)] dark:border-white/[0.07]">
                <FolderKanban className="h-7 w-7 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
              </div>
              <span className="block font-display text-sm font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-500">Awaiting Runtime</span>
              <span className="mt-2 block font-mono text-xs text-slate-400 dark:text-slate-600">No active project telemetry yet</span>
            </div>
          </div>
        ) : (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col">
            {/* Stat cards */}
            <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-status-green/15 bg-status-green/[0.06] p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-status-green">Active</div>
                <div className="mt-1.5 font-mono text-2xl font-black text-slate-900 dark:text-white">{telemetry?.activeProjects?.length ?? 0}</div>
              </div>
              <div className="rounded-2xl border border-signal-500/15 bg-signal-500/[0.06] p-4">
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400"><Zap className="h-3 w-3" strokeWidth={2.4} />Running</div>
                <div className="mt-1.5 font-mono text-2xl font-black text-slate-900 dark:text-white">{totalRunningDispatches}</div>
              </div>
              <div className="rounded-2xl border border-status-amber/15 bg-status-amber/[0.07] p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-status-amber">Attention</div>
                <div className="mt-1.5 font-mono text-2xl font-black text-slate-900 dark:text-white">{telemetry?.attentionProjects?.length ?? 0}</div>
              </div>
              <div className="rounded-2xl border border-black/[0.05] bg-black/[0.02] p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Events</div>
                <div className="mt-1.5 font-mono text-2xl font-black text-slate-900 dark:text-white">{telemetry?.recentEvents?.length ?? 0}</div>
              </div>
            </div>

            {/* Attention block (capped, scrollable) */}
            {telemetry?.attentionProjects?.length > 0 && (
              <div className="mt-5 max-h-[26%] shrink-0 overflow-y-auto dashboard-scrollbar rounded-[1.5rem] border border-status-amber/18 bg-status-amber/[0.07] p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-status-amber">
                  <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.1} />
                  Human Intervention Needed
                </div>
                <div className="mt-3 space-y-2.5">
                  {telemetry.attentionProjects.map((project) => (
                    <div key={project.sprintRunId} className="rounded-2xl border border-status-amber/15 bg-white/75 p-3.5 dark:bg-void-800/55">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold tracking-tight text-slate-900 dark:text-white">{project.projectName}</div>
                          <div className="mt-1 font-mono text-[10px] text-slate-400">
                            {project.sprintName}{project.sprintNumber != null ? ` · Sprint ${project.sprintNumber}` : ""}
                          </div>
                        </div>
                        <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-status-amber/20 bg-status-amber/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-status-amber">
                          <AlertTriangle className="h-3 w-3" strokeWidth={2.2} />
                          Paused
                        </div>
                      </div>
                      {getInterventionContent(project) && (
                        <div className="mt-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {getInterventionContent(project)!.title}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active sprints + timeline share the remaining height. The active list is capped
                and scrolls so the timeline always keeps a guaranteed share and is never cut off. */}
            <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5">
              {telemetry?.activeProjects?.length > 0 && (
                <div className="flex max-h-[45%] shrink-0 flex-col">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Active Sprints</span>
                    <span className="font-mono text-[10px] text-slate-400">{telemetry.activeProjects.length}</span>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto dashboard-scrollbar pr-1">
                    {telemetry.activeProjects.map((project) => {
                      const running = project.runningDispatchCount ?? 0;
                      const active = Math.max(project.activeDispatchCount ?? 0, running);
                      const fill = active > 0 ? Math.round((running / active) * 100) : 0;
                      return (
                        <div key={project.sprintRunId} className="rounded-2xl border border-black/[0.05] bg-black/[0.02] p-3.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-signal-500/20 bg-signal-500/10 text-signal-600 dark:text-signal-400">
                                <Layers className="h-3.5 w-3.5" strokeWidth={2.1} />
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-bold tracking-tight text-slate-900 dark:text-white">{project.projectName}</div>
                                <div className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                                  {project.sprintName}{project.sprintNumber != null ? ` · Sprint ${project.sprintNumber}` : ""}
                                </div>
                              </div>
                            </div>
                            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-status-green/20 bg-status-green/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-status-green">
                              <Activity className="h-3 w-3 animate-pulse" strokeWidth={2.2} />
                              {running}
                            </span>
                          </div>
                          {active > 0 && (
                            <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
                              <div className="h-full rounded-full bg-gradient-to-r from-signal-500 to-status-green transition-[width] duration-700 ease-out" style={{ width: `${fill}%` }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Runtime Timeline</div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto dashboard-scrollbar pr-1">
                  {telemetry?.recentEvents?.map((event) => {
                    const style = getEventStyle(event);
                    return (
                      <div key={event.id} className="relative overflow-hidden rounded-2xl border border-black/[0.05] bg-black/[0.02] p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
                        <div className={`absolute inset-y-0 left-0 w-0.5 ${style.toneClass.replace("text-", "bg-")}`} />
                        <div className="flex items-center justify-between gap-2 pl-1.5">
                          <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${style.toneClass}`}>{style.label}</div>
                          <div className="font-mono text-[10px] text-slate-400">{formatTime(event.createdAt)}</div>
                        </div>
                        <div className="mt-1 pl-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {projectLookup.get(event.projectId) || "Project"}
                        </div>
                        <div className="mt-1 pl-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-500">
                          {event.sprintName}{event.sprintNumber != null ? ` · Sprint ${event.sprintNumber}` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
