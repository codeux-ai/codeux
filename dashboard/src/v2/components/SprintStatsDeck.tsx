import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  Activity,
  CheckCircle2,
  CircleDot,
  Clock3,
  GitPullRequest,
  Layers,
  Sparkles,
  Timer,
  TrendingDown,
  TrendingUp,
  WandSparkles,
  XCircle,
} from "lucide-preact";
import type {
  DashboardStats,
  ExecutionRuntimeEventSummary,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
  Subtask,
} from "../../types.js";
import {
  LIVE_TASK_STAGE_ORDER,
  STATS_DECK_VISIBLE_STAGES,
  buildLiveSprintTimingSummary,
  buildLiveTaskTimingSummaries,
  type LiveSprintTimingSummary,
  type LiveTaskStageKey,
  type LiveTaskTimingSummary,
} from "../lib/live-stats.js";
import { formatTime } from "../../lib/time.js";
import { WaveFluid } from "./ui/WaveFluid.js";
import { BorderTrace } from "./ui/BorderTrace.js";

const STAGE_META: Record<LiveTaskStageKey, {
  label: string;
  shortLabel: string;
  accent: string;
  tone: string;
  chip: string;
}> = {
  queued: {
    label: "Queued",
    shortLabel: "Queue",
    accent: "#64748B",
    tone: "text-slate-500 dark:text-slate-300",
    chip: "border-black/[0.06] bg-white/70 dark:border-white/[0.06] dark:bg-void-900/55",
  },
  coding: {
    label: "Coding",
    shortLabel: "Code",
    accent: "#00E0A0",
    tone: "text-signal-500",
    chip: "border-signal-500/15 bg-signal-500/8 dark:bg-signal-500/10",
  },
  ci: {
    label: "CI / Review",
    shortLabel: "CI",
    accent: "#FFB800",
    tone: "text-ember-500",
    chip: "border-ember-500/15 bg-ember-500/8 dark:bg-ember-500/10",
  },
  autofix: {
    label: "Autofix",
    shortLabel: "Fix",
    accent: "#F59E0B",
    tone: "text-status-amber",
    chip: "border-status-amber/15 bg-status-amber/8 dark:bg-status-amber/10",
  },
  merge: {
    label: "Merge",
    shortLabel: "Merge",
    accent: "#00AB84",
    tone: "text-status-green",
    chip: "border-status-green/15 bg-status-green/8 dark:bg-status-green/10",
  },
};

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return "0s";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatDurationTight(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return "0s";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function buildTaskTimingMap(timings: LiveTaskTimingSummary[]): Map<string, LiveTaskTimingSummary> {
  const map = new Map<string, LiveTaskTimingSummary>();
  for (const timing of timings) {
    map.set(timing.taskId, timing);
    map.set(timing.taskKey, timing);
  }
  return map;
}

const DeltaValue: FunctionComponent<{
  value: number;
  compact?: boolean;
}> = ({ value, compact = false }) => {
  const previousRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const [delta, setDelta] = useState<number | null>(null);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = value;
    if (previous == null || previous === value) {
      return;
    }
    setDelta(value - previous);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      setDelta(null);
      timeoutRef.current = null;
    }, 1600);
  }, [value]);

  useEffect(() => () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
  }, []);

  const positive = (delta ?? 0) > 0;

  return (
    <div className="flex items-center gap-2">
      <span className={`${compact ? "text-xl" : "text-[2rem]"} font-black tracking-tighter text-slate-900 dark:text-white`}>
        {value}
      </span>
      {delta !== null && delta !== 0 && (
        <span className={`stats-delta-chip ${positive ? "stats-delta-chip-positive" : "stats-delta-chip-negative"}`}>
          {positive ? <TrendingUp className="h-3 w-3" strokeWidth={2.4} /> : <TrendingDown className="h-3 w-3" strokeWidth={2.4} />}
          {positive ? `+${delta}` : `${delta}`}
        </span>
      )}
    </div>
  );
};

const SummaryPill: FunctionComponent<{
  label: string;
  value: string;
  icon: any;
  accent: string;
}> = ({ label, value, icon: Icon, accent }) => (
  <div className="rounded-[1.1rem] border border-black/[0.05] bg-white/65 px-3 py-3 backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35">
    <div className={`mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] ${accent}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
      <span>{label}</span>
    </div>
    <div className="font-mono text-xl font-black tracking-tighter text-slate-900 dark:text-white">
      {value}
    </div>
  </div>
);

const CounterTile: FunctionComponent<{
  label: string;
  value: number;
  icon: any;
  accent: string;
}> = ({ label, value, icon: Icon, accent }) => (
  <div className="rounded-[1.15rem] border border-black/[0.05] bg-white/68 px-4 py-4 backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35">
    <div className={`mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] ${accent}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
      <span>{label}</span>
    </div>
    <DeltaValue value={value} compact />
  </div>
);

const StageBand: FunctionComponent<{
  stage: LiveTaskStageKey;
  seconds: number;
  totalSeconds: number;
  activeCount: number;
}> = ({ stage, seconds, totalSeconds, activeCount }) => {
  const meta = STAGE_META[stage];
  const share = totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0;

  return (
    <div className="rounded-[1.1rem] border border-black/[0.05] bg-white/65 px-4 py-4 backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`text-[9px] font-bold uppercase tracking-[0.14em] ${meta.tone}`}>{meta.label}</div>
          <div className="mt-2 text-xl font-black tracking-tight text-slate-900 dark:text-white">
            {formatDurationTight(seconds)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Share</div>
          <div className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{formatPercent(share)}</div>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(share, seconds > 0 ? 6 : 0)}%`,
            background: meta.accent,
            boxShadow: `0 0 18px ${meta.accent}45`,
          }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] font-mono text-slate-500 dark:text-slate-400">
        <span>{activeCount} active</span>
        <span>{seconds > 0 ? `${Math.round(seconds / Math.max(activeCount, 1))}s / active` : "idle"}</span>
      </div>
    </div>
  );
};

export function useLiveTaskTimingSummaries(args: {
  tasks: Subtask[];
  dispatches: ExecutionTaskDispatchSummary[];
  events: ExecutionRuntimeEventSummary[];
  sprintRuns: ExecutionSprintRunSummary[];
  nowIso: string;
}): {
  sprintTiming: LiveSprintTimingSummary;
  taskTimings: LiveTaskTimingSummary[];
  taskTimingMap: Map<string, LiveTaskTimingSummary>;
} {
  const taskTimings = buildLiveTaskTimingSummaries({
    tasks: args.tasks,
    dispatches: args.dispatches,
    events: args.events,
    sprintRuns: args.sprintRuns,
    nowIso: args.nowIso,
  });

  return {
    sprintTiming: buildLiveSprintTimingSummary({
      tasks: args.tasks,
      dispatches: args.dispatches,
      events: args.events,
      sprintRuns: args.sprintRuns,
      nowIso: args.nowIso,
    }),
    taskTimings,
    taskTimingMap: buildTaskTimingMap(taskTimings),
  };
}

export const TaskStagePills: FunctionComponent<{
  timing: LiveTaskTimingSummary | null | undefined;
}> = ({ timing }) => {
  if (!timing || timing.totalSeconds <= 0) {
    return null;
  }

  const visibleStages = LIVE_TASK_STAGE_ORDER.filter((stage) => (
    timing.stageTotals[stage] > 0 || timing.activeStage === stage
  ));

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {visibleStages.map((stage) => {
        const meta = STAGE_META[stage];
        const active = timing.activeStage === stage;
        return (
          <span
            key={stage}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${meta.chip} ${meta.tone} ${active ? "shadow-[0_0_0_1px_rgba(0,224,160,0.12)]" : ""}`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: meta.accent,
                boxShadow: active ? `0 0 10px ${meta.accent}` : "none",
              }}
            />
            {meta.shortLabel}
            <span className="font-mono normal-case tracking-normal text-slate-600 dark:text-slate-300">
              {formatDurationTight(timing.stageTotals[stage])}
            </span>
          </span>
        );
      })}
      <span className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-300">
        <Timer className="h-3 w-3" strokeWidth={2.2} />
        Total
        <span className="font-mono normal-case tracking-normal text-slate-700 dark:text-white">{formatDurationTight(timing.totalSeconds)}</span>
      </span>
    </div>
  );
};

export const SprintStatsDeck: FunctionComponent<{
  hasSprintContext: boolean;
  stats: DashboardStats;
  tasks: Subtask[];
  sprintTiming: LiveSprintTimingSummary;
}> = ({ hasSprintContext, stats, tasks, sprintTiming }) => {
  const totalTrackedStageSeconds = LIVE_TASK_STAGE_ORDER.reduce((sum, stage) => sum + sprintTiming.stageTotals[stage], 0);
  const completionRate = tasks.length > 0 ? (stats.completed / tasks.length) * 100 : 0;
  const mergePressure = stats.ci + stats.mergeBlocked + stats.mergeConflicts;

  if (!hasSprintContext) {
    return (
      <div className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/70 p-8 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        <WaveFluid accentHex="#00E0A0" />
        <BorderTrace accentHex="#00E0A0" />
        <div className="relative z-10 flex min-h-[22rem] flex-col items-center justify-center text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[1.3rem] border border-signal-500/20 bg-signal-500/10 text-signal-500 shadow-[0_0_24px_rgba(0,224,160,0.16)]">
            <Timer className="h-8 w-8" strokeWidth={1.4} />
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">Sprint Stats</div>
          <h3 className="mt-3 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            The telemetry field wakes up with the sprint.
          </h3>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Start a sprint to visualize elapsed time, stage timing, merge pressure, and live task-state deltas in the same view language as the DAG.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] md:p-6">
      <WaveFluid accentHex="#00E0A0" />
      <BorderTrace accentHex="#00E0A0" />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="dag-aurora absolute -left-20 top-8 h-56 w-56 rounded-full bg-signal-500/10 blur-[90px]" />
        <div className="dag-aurora absolute right-[-4rem] top-1/3 h-64 w-64 rounded-full bg-ember-500/10 blur-[110px]" style={{ animationDelay: "-4s" }} />
        <div
          className="dag-grid-pan absolute inset-0 opacity-30 dark:opacity-35"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, rgba(100,116,139,0.18) 1px, transparent 0)",
            backgroundSize: "26px 26px",
          }}
        />
      </div>

      <div className="relative z-10">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-signal-500">
              <Timer className="h-4 w-4" strokeWidth={1.6} />
              Telemetry Field
            </div>
            <h3 className="mt-2 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-[2.35rem]">
              Live sprint stats, rendered in the same surface.
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Elapsed sprint time, task-state deltas, merge pressure, and stage durations are projected from runtime events without leaving the Live page visual language.
            </p>
          </div>

          <div className="w-full overflow-x-auto pb-1 xl:max-w-[62rem] xl:justify-end">
            <div className="grid min-w-[60rem] grid-cols-5 gap-2.5">
              <SummaryPill label="Elapsed" value={formatDuration(sprintTiming.sprintElapsedSeconds)} icon={Timer} accent="text-signal-500" />
              <SummaryPill label="Completion" value={formatPercent(completionRate)} icon={CheckCircle2} accent="text-status-green" />
              <SummaryPill label="Avg Finish" value={formatDurationTight(sprintTiming.averageCompletedTaskSeconds)} icon={Sparkles} accent="text-ember-500" />
              <SummaryPill label="Longest" value={sprintTiming.longestTask ? `${sprintTiming.longestTask.taskKey} · ${formatDurationTight(sprintTiming.longestTask.totalSeconds)}` : "No runtime"} icon={Layers} accent="text-slate-500" />
              <SummaryPill label="Pressure" value={String(mergePressure)} icon={GitPullRequest} accent="text-ember-500" />
            </div>
          </div>
        </div>

        <div className="rounded-[1.6rem] border border-black/[0.05] bg-black/[0.02] p-3 dark:border-white/[0.05] dark:bg-white/[0.02]">
          <div className="grid gap-3 xl:grid-cols-12">
            <div className="xl:col-span-7 rounded-[1.45rem] border border-black/[0.05] bg-white/68 p-5 backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">
                <Clock3 className="h-3.5 w-3.5" strokeWidth={1.9} />
                Sprint Clock
              </div>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-[3.5rem] font-black leading-none tracking-[-0.07em] text-slate-900 dark:text-white md:text-[4.6rem]">
                    {formatDuration(sprintTiming.sprintElapsedSeconds)}
                  </div>
                  <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    {sprintTiming.sprintStartedAt
                      ? `Started ${formatTime(sprintTiming.sprintStartedAt)}`
                      : "Awaiting first task start"}
                  </div>
                </div>
                <div className="rounded-[1.2rem] border border-signal-500/15 bg-signal-500/8 px-4 py-3 text-right dark:bg-signal-500/10">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-signal-500">Tracked Tasks</div>
                  <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                    {sprintTiming.trackedTaskCount}
                  </div>
                </div>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-[1.1rem] border border-black/[0.05] bg-black/[0.025] px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.03]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Finished</div>
                  <div className="mt-2 text-lg font-black tracking-tight text-slate-900 dark:text-white">{sprintTiming.completedTaskCount}</div>
                </div>
                <div className="rounded-[1.1rem] border border-black/[0.05] bg-black/[0.025] px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.03]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Avg Finish</div>
                  <div className="mt-2 text-lg font-black tracking-tight text-slate-900 dark:text-white">{formatDurationTight(sprintTiming.averageCompletedTaskSeconds)}</div>
                </div>
                <div className="rounded-[1.1rem] border border-black/[0.05] bg-black/[0.025] px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.03]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Accumulated</div>
                  <div className="mt-2 text-lg font-black tracking-tight text-slate-900 dark:text-white">{formatDuration(totalTrackedStageSeconds)}</div>
                </div>
              </div>
            </div>

            <div className="xl:col-span-5 space-y-3">
              <div className="rounded-[1.45rem] border border-black/[0.05] bg-white/68 p-4 backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  <Activity className="h-3.5 w-3.5 text-signal-500" strokeWidth={1.9} />
                  Flow State
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <CounterTile label="Running" value={stats.running} icon={Activity} accent="text-signal-500" />
                  <CounterTile label="Coding Done" value={stats.codingCompleted} icon={CircleDot} accent="text-ember-500" />
                  <CounterTile label="Completed" value={stats.completed} icon={CheckCircle2} accent="text-status-green" />
                  <CounterTile label="Failed" value={stats.failed} icon={XCircle} accent="text-status-red" />
                </div>
              </div>

              <div className="rounded-[1.45rem] border border-black/[0.05] bg-white/68 p-4 backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  <WandSparkles className="h-3.5 w-3.5 text-ember-500" strokeWidth={1.9} />
                  Merge Surface
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <CounterTile label="CI Lane" value={stats.ci} icon={GitPullRequest} accent="text-ember-500" />
                  <CounterTile label="Automerge" value={stats.automerge} icon={Sparkles} accent="text-status-green" />
                  <CounterTile label="Merged" value={stats.merged} icon={CheckCircle2} accent="text-status-green" />
                  <CounterTile label="Blocked" value={stats.mergeBlocked + stats.mergeConflicts} icon={WandSparkles} accent="text-status-amber" />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-[1.45rem] border border-black/[0.05] bg-white/68 p-4 backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                <Sparkles className="h-3.5 w-3.5 text-signal-500" strokeWidth={1.9} />
                Stage Ledger
              </div>
              <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">
                Split from runtime milestones
              </div>
            </div>
            <div className="grid gap-3 xl:grid-cols-4">
              {STATS_DECK_VISIBLE_STAGES.map((stage) => (
                <StageBand
                  key={stage}
                  stage={stage}
                  seconds={sprintTiming.stageTotals[stage]}
                  totalSeconds={totalTrackedStageSeconds}
                  activeCount={sprintTiming.activeStageCounts[stage]}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
