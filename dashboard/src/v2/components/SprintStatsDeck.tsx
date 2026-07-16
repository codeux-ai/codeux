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
  type LucideIcon,
} from "lucide-preact";
import type {
  DashboardStats,
  ExecutionRuntimeEventSummary,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
  Subtask,
} from "../../types.js";
import { formatDuration, formatDurationTight } from "../lib/format-duration.js";
import {
  LIVE_TASK_STAGE_ORDER,
  STATS_DECK_VISIBLE_STAGES,
  buildLiveSprintTimingSummary,
  buildLiveTaskTimingSummaries,
  type LiveSprintTimingSummary,
  type LiveTaskStageKey,
  type LiveTaskTimingSummary,
} from "../lib/live-stats.js";
import { useLiveI18n, type LiveMessageKey } from "../i18n/messages/live.js";

export interface Tone {
  accent: string;
  tone?: string;
}

export interface Node extends Tone {
  label: string;
  value: string | number;
  icon: LucideIcon;
}

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
  qa: {
    label: "QA Gate",
    shortLabel: "QA",
    accent: "#D97706",
    tone: "text-status-amber",
    chip: "border-status-amber/15 bg-status-amber/8 dark:bg-status-amber/10",
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

const STAGE_LABEL_KEYS: Record<LiveTaskStageKey, { label: LiveMessageKey; shortLabel: LiveMessageKey }> = {
  queued: { label: "queued", shortLabel: "queue" },
  coding: { label: "coding", shortLabel: "code" },
  ci: { label: "ciReview", shortLabel: "ci" },
  qa: { label: "qaGate", shortLabel: "qa" },
  autofix: { label: "autofix", shortLabel: "fix" },
  merge: { label: "merge", shortLabel: "merge" },
};

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
  const { formatNumber } = useLiveI18n();
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
      <span className={`${compact ? "text-lg" : "text-2xl"} font-semibold tracking-tight text-slate-900 dark:text-white`}>
        {formatNumber(value)}
      </span>
      {delta !== null && delta !== 0 && (
        <span className={`stats-delta-chip ${positive ? "stats-delta-chip-positive" : "stats-delta-chip-negative"}`}>
          {positive ? <TrendingUp className="h-3 w-3" strokeWidth={2.4} /> : <TrendingDown className="h-3 w-3" strokeWidth={2.4} />}
          {positive ? `+${formatNumber(delta)}` : formatNumber(delta)}
        </span>
      )}
    </div>
  );
};

const SummaryPill: FunctionComponent<Node> = ({ label, value, icon: Icon, accent }) => (
  <div className="min-w-0 rounded-[1.75rem] border border-black/[0.05] bg-white/65 p-7 shadow-sm backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35">
    <div className={`mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] ${accent}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </div>
    <div className="break-words font-mono text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
      {value}
    </div>
  </div>
);

const CounterTile: FunctionComponent<Node & { className?: string }> = ({ label, value, icon: Icon, accent, className }) => (
  <div className={`min-w-0 rounded-[1.75rem] border border-black/[0.05] bg-white/68 p-7 shadow-sm backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35 ${className || ""}`}>
    <div className={`mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] ${accent}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
      <span>{label}</span>
    </div>
    <DeltaValue value={Number(value)} compact />
  </div>
);

const StageBand: FunctionComponent<{
  stage: LiveTaskStageKey;
  seconds: number;
  totalSeconds: number;
  activeCount: number;
}> = ({ stage, seconds, totalSeconds, activeCount }) => {
  const { locale, t, formatNumber } = useLiveI18n();
  const meta = STAGE_META[stage];
  const share = totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0;
  const localizedShare = formatNumber(share / 100, { style: "percent", maximumFractionDigits: 0 });
  const stageLabel = t(STAGE_LABEL_KEYS[stage].label);

  return (
    <div className="rounded-[1.75rem] border border-black/[0.05] bg-white/65 p-7 shadow-sm backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`text-[9px] font-bold uppercase tracking-[0.14em] ${meta.tone}`}>{stageLabel}</div>
          <div className="mt-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {formatDurationTight(seconds, locale)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("share")}</div>
          <div className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{localizedShare}</div>
        </div>
      </div>
      <div 
        className="mt-4 h-2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]"
        role="progressbar"
        aria-valuenow={Math.round(share)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("stageShare", { stage: stageLabel, share: localizedShare })}
      >
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
        <span>{t("activeCount", { count: formatNumber(activeCount) })}</span>
        <span>{seconds > 0 ? t("perActive", { duration: formatDurationTight(Math.round(seconds / Math.max(activeCount, 1)), locale) }) : t("idle")}</span>
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
  includeTaskDetails?: boolean;
}): {
  sprintTiming: LiveSprintTimingSummary;
  taskTimings: LiveTaskTimingSummary[];
  taskTimingMap: Map<string, LiveTaskTimingSummary>;
} {
  const taskTimings = args.includeTaskDetails === false
    ? []
    : buildLiveTaskTimingSummaries({
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
  const { locale, t } = useLiveI18n();
  if (!timing || timing.totalSeconds <= 0) {
    return null;
  }

  const visibleStages = LIVE_TASK_STAGE_ORDER.filter((stage) => (
    timing.stageTotals[stage] > 0 || timing.activeStage === stage
  ));

  return (
    <div className="mt-4 mb-4 flex flex-wrap items-center gap-2">
      {visibleStages.map((stage) => {
        const meta = STAGE_META[stage];
        const active = timing.activeStage === stage;
        return (
          <span
            key={stage}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${meta.chip} ${meta.tone} ${active ? "shadow-[0_0_0_1px_rgba(0,224,160,0.12)]" : ""}`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: meta.accent,
                boxShadow: active ? `0 0 10px ${meta.accent}` : "none",
              }}
            />
            <span className="sr-only">{t(active ? "activeStage" : "stage")}</span>
            {t(STAGE_LABEL_KEYS[stage].shortLabel)}
            <span className="font-mono normal-case tracking-normal text-slate-600 dark:text-slate-300">
              {formatDurationTight(timing.stageTotals[stage], locale)}
            </span>
          </span>
        );
      })}
      <span className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-300">
        <Timer className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
        {t("total")}
        <span className="font-mono normal-case tracking-normal text-slate-700 dark:text-white">{formatDurationTight(timing.totalSeconds, locale)}</span>
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
  const { locale, t, formatNumber, formatTime } = useLiveI18n();
  const totalTrackedStageSeconds = LIVE_TASK_STAGE_ORDER.reduce((sum, stage) => sum + sprintTiming.stageTotals[stage], 0);
  const completionRate = tasks.length > 0 ? (stats.completed / tasks.length) * 100 : 0;
  const mergePressure = stats.ci + stats.qa + stats.mergeBlocked + stats.mergeConflicts;
  const formatCompactTokens = (value: number): string => formatNumber(value, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).toLocaleLowerCase(locale);

  if (!hasSprintContext) {
    return (
      <div role="status" aria-live="polite" className="relative overflow-hidden rounded-[1.75rem] border border-black/[0.08] bg-white p-7 shadow-sm dark:border-white/[0.08] dark:bg-void-800">


        <div className="relative z-10 flex min-h-[22rem] flex-col items-center justify-center text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[1.3rem] border border-signal-500/20 bg-signal-500/10 text-signal-500 shadow-[0_0_24px_rgba(0,224,160,0.16)]">
            <Timer className="h-8 w-8" strokeWidth={1.4} aria-hidden="true" />
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">{t("sprintStats")}</div>
          <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {t("telemetryWakes")}
          </h3>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            {t("telemetryStartDescription")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div role="region" aria-label={t("liveSprintStats")} className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.08] bg-white p-7 shadow-sm dark:border-white/[0.08] dark:bg-void-800">



      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="dag-aurora absolute -left-20 top-8 h-56 w-56 rounded-full" style={{ background: 'radial-gradient(circle, rgba(0,224,160,0.08) 0%, transparent 70%)' }} />
        <div className="dag-aurora absolute right-[-4rem] top-1/3 h-64 w-64 rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,184,0,0.08) 0%, transparent 70%)', animationDelay: "-4s" }} />
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
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">
              <Timer className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />
              {t("telemetryField")}
            </div>
            <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-[2rem]">
              {t("liveStatsRendered")}
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {t("telemetryDescription")}
            </p>
          </div>

          <div className="w-full overflow-x-auto pb-1 xl:max-w-[62rem] xl:justify-end">
            <div className="grid min-w-[60rem] grid-cols-5 gap-2.5" role="group" aria-label={t("sprintStatSummary")}>
              <SummaryPill label={t("elapsed")} value={formatDuration(sprintTiming.sprintElapsedSeconds, locale)} icon={Timer} accent="text-signal-500" />
              <SummaryPill label={t("completion")} value={formatNumber(completionRate / 100, { style: "percent", maximumFractionDigits: 0 })} icon={CheckCircle2} accent="text-status-green" />
              <SummaryPill label={t("averageFinish")} value={formatDurationTight(sprintTiming.averageCompletedTaskSeconds, locale)} icon={Sparkles} accent="text-ember-500" />
              <SummaryPill label={t("longest")} value={sprintTiming.longestTask ? `${sprintTiming.longestTask.taskKey} · ${formatDurationTight(sprintTiming.longestTask.totalSeconds, locale)}` : t("noRuntime")} icon={Layers} accent="text-slate-500" />
              <SummaryPill label={t("pressure")} value={formatNumber(mergePressure)} icon={GitPullRequest} accent="text-ember-500" />
            </div>
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-black/[0.06] bg-black/[0.02] p-7 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="grid gap-3 xl:grid-cols-12">
            <div className="xl:col-span-7 rounded-[1.75rem] border border-black/[0.06] bg-white/68 p-7 shadow-sm backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/35">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">
                <Clock3 className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
                {t("sprintClock")}
              </div>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="break-words text-4xl font-semibold leading-none tracking-tight text-slate-900 dark:text-white md:text-5xl">
                    {formatDuration(sprintTiming.sprintElapsedSeconds, locale)}
                  </div>
                  <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    {sprintTiming.sprintStartedAt
                      ? t("startedAt", { time: formatTime(new Date(sprintTiming.sprintStartedAt)) })
                      : t("awaitingFirstTask")}
                  </div>
                </div>
                <div className="rounded-[1rem] border border-signal-500/15 bg-signal-500/8 px-4 py-3 text-right dark:bg-signal-500/10">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-signal-500">{t("trackedTasks")}</div>
                  <div className="mt-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                    {formatNumber(sprintTiming.trackedTaskCount)}
                  </div>
                </div>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-[1.75rem] border border-black/[0.06] bg-black/[0.025] p-7 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("finished")}</div>
                  <div className="mt-2 text-base font-semibold tracking-tight text-slate-900 dark:text-white">{formatNumber(sprintTiming.completedTaskCount)}</div>
                </div>
                <div className="rounded-[1.75rem] border border-black/[0.06] bg-black/[0.025] p-7 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("averageFinish")}</div>
                  <div className="mt-2 text-base font-semibold tracking-tight text-slate-900 dark:text-white">{formatDurationTight(sprintTiming.averageCompletedTaskSeconds, locale)}</div>
                </div>
                <div className="rounded-[1.75rem] border border-black/[0.06] bg-black/[0.025] p-7 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("accumulated")}</div>
                  <div className="mt-2 text-base font-semibold tracking-tight text-slate-900 dark:text-white">{formatDuration(totalTrackedStageSeconds, locale)}</div>
                </div>
                <div className="rounded-[1.75rem] border border-black/[0.06] bg-black/[0.025] p-7 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("input")}</div>
                  <div className="mt-2 text-base font-semibold tracking-tight text-slate-900 dark:text-white">{formatCompactTokens(sprintTiming.tokenTotals.inputTokens)}</div>
                </div>
                <div className="rounded-[1.75rem] border border-black/[0.06] bg-black/[0.025] p-7 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("output")}</div>
                  <div className="mt-2 text-base font-semibold tracking-tight text-slate-900 dark:text-white">{formatCompactTokens(sprintTiming.tokenTotals.outputTokens)}</div>
                </div>
                <div className="rounded-[1.75rem] border border-black/[0.06] bg-black/[0.025] p-7 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("cached")}</div>
                  <div className="mt-2 text-base font-semibold tracking-tight text-slate-900 dark:text-white">{formatCompactTokens(sprintTiming.tokenTotals.cachedInputTokens)}</div>
                </div>
              </div>
            </div>

            <div className="xl:col-span-5 space-y-3">
              <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/68 p-7 shadow-sm backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/35">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  <Activity className="h-3.5 w-3.5 text-signal-500" strokeWidth={1.9} aria-hidden="true" />
                  {t("flowState")}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <CounterTile label={t("running")} value={stats.running} icon={Activity} accent="text-signal-500" />
                  <CounterTile label={t("codingDone")} value={stats.codingCompleted} icon={CircleDot} accent="text-ember-500" />
                  <CounterTile label={t("completed")} value={stats.completed} icon={CheckCircle2} accent="text-status-green" />
                  <CounterTile label={t("failed")} value={stats.failed} icon={XCircle} accent="text-status-red" />
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/68 p-7 shadow-sm backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/35">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  <WandSparkles className="h-3.5 w-3.5 text-ember-500" strokeWidth={1.9} aria-hidden="true" />
                  {t("mergeSurface")}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <CounterTile label={t("ciLane")} value={stats.ci} icon={GitPullRequest} accent="text-ember-500" />
                  <CounterTile label={t("qaGate")} value={stats.qa} icon={Timer} accent="text-status-amber" />
                  <CounterTile label={t("automerge")} value={stats.automerge} icon={Sparkles} accent="text-status-green" />
                  <CounterTile label={t("merged")} value={stats.merged} icon={CheckCircle2} accent="text-status-green" />
                  <CounterTile label={t("blocked")} value={stats.mergeBlocked + stats.mergeConflicts} icon={WandSparkles} accent="text-status-amber" className="col-span-2" />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-[1.75rem] border border-black/[0.06] bg-white/68 p-7 shadow-sm backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/35">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                <Sparkles className="h-3.5 w-3.5 text-signal-500" strokeWidth={1.9} aria-hidden="true" />
                {t("stageLedger")}
              </div>
              <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">
                {t("runtimeMilestones")}
              </div>
            </div>
            <div className="grid gap-3 xl:grid-cols-5">
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
