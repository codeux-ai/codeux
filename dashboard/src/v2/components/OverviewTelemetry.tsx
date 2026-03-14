import type { FunctionComponent } from "preact";
import { Activity, AlertTriangle, FolderKanban, Radio } from "lucide-preact";
import { useOverviewTelemetry } from "../../hooks/use-overview-telemetry.js";
import { formatTime } from "../../lib/time.js";

const describeEvent = (eventType: string): string => {
  switch (eventType) {
    case "dispatch_started":
      return "Dispatch started";
    case "dispatch_queued":
      return "Dispatch queued";
    case "cli_provider_started":
      return "CLI provider started";
    case "cli_provider_completed":
      return "CLI provider completed";
    case "ci_gate_status":
      return "CI gate updated";
    case "sprint_cancel_requested":
      return "Sprint cancellation requested";
    case "sprint_cancelled":
      return "Sprint cancelled";
    case "sprint_completed":
      return "Sprint completed";
    case "sprint_failed":
      return "Sprint failed";
    default:
      return eventType.replace(/_/g, " ");
  }
};

export const OverviewTelemetry: FunctionComponent = () => {
  const { telemetry, error } = useOverviewTelemetry();
  const hasActiveProjects = telemetry.activeProjects.length > 0;
  const hasAttentionProjects = telemetry.attentionProjects.length > 0;
  const hasRuntimeSignal = hasActiveProjects || hasAttentionProjects;

  if (error) {
    return (
      <aside className="sticky top-24 flex flex-col h-[760px] overflow-hidden group rounded-[1.75rem] border border-status-red/20 bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl p-8">
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
    <aside className="sticky top-24 flex flex-col h-[760px] overflow-hidden group">
      <h3 className="text-3xl font-black tracking-tighter text-slate-900 dark:text-white mb-12 flex items-center gap-4 font-display">
        <div className="relative flex items-center justify-center">
          <div className={`absolute inset-0 rounded-full blur-[10px] animate-[pulse_2s_ease-in-out_infinite] ${
            hasActiveProjects
              ? "bg-status-red opacity-70"
              : hasAttentionProjects
                ? "bg-status-amber opacity-70"
                : "bg-slate-300 dark:bg-slate-700 opacity-50"
          }`} />
          <div className={`w-3.5 h-3.5 rounded-full relative z-10 ${
            hasActiveProjects
              ? "bg-status-red"
              : hasAttentionProjects
                ? "bg-status-amber"
                : "bg-slate-400 dark:bg-slate-500"
          }`} />
        </div>
        Telemetry.
      </h3>

      <div className="relative flex-1 overflow-hidden rounded-[2rem] border border-black/[0.06] dark:border-white/[0.06] bg-white/65 dark:bg-void-800/60 backdrop-blur-2xl p-7">
        {!hasRuntimeSignal ? (
          <div className="h-full flex items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 rounded-full border border-black/[0.07] dark:border-white/[0.08] animate-[ping_4s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
              <div className="w-72 h-72 rounded-full border border-black/[0.04] dark:border-white/[0.05] absolute animate-[ping_7s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
              <div className="w-[22rem] h-[22rem] rounded-full border border-black/[0.02] dark:border-white/[0.03] absolute animate-[ping_10s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
            </div>
            <div className="text-center relative z-10">
              <div className="w-14 h-14 rounded-[1.25rem] border border-black/[0.07] dark:border-white/[0.07] shadow-[0_0_28px_rgba(100,116,139,0.12)] mx-auto mb-5 flex items-center justify-center">
                <FolderKanban className="w-7 h-7 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
              </div>
              <span className="text-slate-500 dark:text-slate-500 font-semibold text-sm tracking-widest block uppercase font-display">Awaiting Runtime</span>
              <span className="text-xs text-slate-400 dark:text-slate-600 font-mono mt-2 block">No active project telemetry yet</span>
            </div>
          </div>
        ) : (
          <div className="relative z-10 h-full flex flex-col">
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="rounded-2xl border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02] p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Active Projects</div>
                <div className="mt-2 text-3xl font-black font-mono text-slate-900 dark:text-white">{telemetry.activeProjects.length}</div>
              </div>
              <div className="rounded-2xl border border-status-amber/15 bg-status-amber/8 p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-status-amber">Needs Attention</div>
                <div className="mt-2 text-3xl font-black font-mono text-slate-900 dark:text-white">{telemetry.attentionProjects.length}</div>
              </div>
              <div className="rounded-2xl border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02] p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Timeline Events</div>
                <div className="mt-2 text-3xl font-black font-mono text-slate-900 dark:text-white">{telemetry.recentEvents.length}</div>
              </div>
            </div>

            {telemetry.attentionProjects.length > 0 && (
              <div className="mb-6 rounded-[1.6rem] border border-status-amber/18 bg-status-amber/8 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-status-amber">
                  <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.1} />
                  Human Intervention Needed
                </div>
                <div className="mt-3 space-y-3">
                  {telemetry.attentionProjects.slice(0, 3).map((project) => (
                    <div key={project.sprintRunId} className="rounded-2xl border border-status-amber/15 bg-white/75 p-4 dark:bg-void-800/55">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate">
                            {project.projectName}
                          </div>
                          <div className="mt-1 text-[10px] font-mono text-slate-400">
                            {project.sprintName}{project.sprintNumber != null ? ` · Sprint ${project.sprintNumber}` : ""}
                          </div>
                        </div>
                        <div className="inline-flex items-center gap-1.5 rounded-full border border-status-amber/20 bg-status-amber/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-status-amber">
                          <AlertTriangle className="w-3 h-3" strokeWidth={2.2} />
                          Paused
                        </div>
                      </div>
                      <div className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {project.humanIntervention?.title || "Human intervention required"}
                      </div>
                      <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
                        {project.humanIntervention?.reason}
                      </p>
                      <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                        What to do
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                        {project.humanIntervention?.instructions}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {telemetry.activeProjects.length > 0 && (
              <div className="space-y-2 mb-6">
              {telemetry.activeProjects.slice(0, 4).map((project) => (
                <div key={project.sprintRunId} className="rounded-2xl border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate">{project.projectName}</div>
                      <div className="mt-1 text-[10px] font-mono text-slate-400">
                        {project.sprintName}{project.sprintNumber != null ? ` · Sprint ${project.sprintNumber}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-status-green/20 bg-status-green/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-status-green">
                        <Activity className="w-3 h-3" strokeWidth={2} />
                        {project.runningDispatchCount}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              </div>
            )}

            <div className="flex-1 min-h-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-3">Runtime Timeline</div>
              <div className="h-full overflow-y-auto dashboard-scrollbar pr-1 space-y-2">
                {telemetry.recentEvents.map((event) => (
                  <div key={event.id} className="rounded-2xl border border-black/[0.05] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-status-red">{describeEvent(event.eventType)}</div>
                      <div className="text-[10px] font-mono text-slate-400">{formatTime(event.createdAt)}</div>
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {telemetry.activeProjects.find((project) => project.projectId === event.projectId)?.projectName
                        || telemetry.attentionProjects.find((project) => project.projectId === event.projectId)?.projectName
                        || "Project"}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-500 font-mono">
                      {event.sprintName}{event.sprintNumber != null ? ` · Sprint ${event.sprintNumber}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
