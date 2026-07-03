import type { ProjectExecutionStatsSnapshot, ExecutionStatsEntitySummary, SegmentDefinition } from "../../../types.js";
import type { UsageChartState } from "../use-usage-chart-state.js";
import type { StatsVisualMode } from "./StatsShared.js";
import type { FunctionComponent } from "preact";
import { BarChart3, Cpu, Layers3, PieChart, ShieldCheck, Terminal } from "lucide-preact";
import {
  TrendStudio,
  CompositionStudio,
  ReliabilityStudio,
  StudioHeader,
} from "./StatsShared.js";
import { PANEL_CLASS } from "./stats-ui-primitives.js";
import { SystemStudio } from "./system/SystemStudio.js";
import { ModelsStudio } from "./ModelsStudio.js";
import { TelemetryLedgerTabs } from "./TelemetryLedgerTabs.js";

const STUDIO_SUBTITLES: Record<StatsVisualMode, string> = {
  trend: "Time-series and throughput analysis.",
  composition: "Token utilization, source mix, and provider activity.",
  models: "Ranked model performance, latency, and efficiency.",
  reliability: "Provider health, telemetry confidence, and integrity notes.",
  ledgers: "Dense task, sprint, and git telemetry ledgers.",
  system: "Invocation debugging, filters, and message inspection.",
};

const STUDIO_TITLES: Record<StatsVisualMode, string> = {
  trend: "Trend",
  composition: "Composition",
  models: "Models",
  reliability: "Reliability",
  ledgers: "Ledgers",
  system: "System",
};

const STUDIO_ICONS = {
  trend: BarChart3,
  composition: PieChart,
  models: Cpu,
  reliability: ShieldCheck,
  ledgers: Layers3,
  system: Terminal,
};

const STUDIO_EMPTY_MESSAGES: Record<StatsVisualMode, string> = {
  trend: "Select a time window to see Trend data.",
  composition: "Select a time window to see Composition data.",
  models: "Select a time window to see Models data.",
  reliability: "Select a time window to see Reliability data.",
  ledgers: "Select a time window to see Ledgers data.",
  system: "Select a time window to see System data.",
};

const STUDIO_FRAMES: Record<StatsVisualMode, { question: string; compare: string; action: string }> = {
  trend: {
    question: "Is activity accelerating or cooling?",
    compare: "Tokens, active time, cost, and invocation momentum.",
    action: "Use the chart rail to inspect exact buckets.",
  },
  composition: {
    question: "Where is the workload concentrated?",
    compare: "Token anatomy, provider lanes, source confidence, and purpose mix.",
    action: "Look for dominant providers or missing purpose/source signals.",
  },
  models: {
    question: "Which models are doing the best work?",
    compare: "Latency, success rate, token volume, cache efficiency, velocity, and reasoning share.",
    action: "Use leaderboard rows to compare efficiency against reliability.",
  },
  reliability: {
    question: "Can this telemetry be trusted?",
    compare: "Reported, estimated, unavailable, and unsupported coverage by provider.",
    action: "Prioritize providers with partial confidence or missing duration samples.",
  },
  ledgers: {
    question: "Which records explain the totals?",
    compare: "Task, sprint, and git rows with searchable operational context.",
    action: "Use tabs and sorting to trace the source records.",
  },
  system: {
    question: "Which invocations need inspection?",
    compare: "Runtime status, purpose, provider, messages, and error categories.",
    action: "Filter down to the exact invocation trail.",
  },
};

export interface AnalysisStudioSectionProps {
  stats: ProjectExecutionStatsSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  projectId: string;
  planningUsage: ExecutionStatsEntitySummary | null;
  providerSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
  visualMode: StatsVisualMode;
  setVisualMode: (mode: StatsVisualMode) => void;
  chartState: UsageChartState;
}

export const AnalysisStudioSection: FunctionComponent<AnalysisStudioSectionProps> = ({
  stats,
  loading,
  error,
  refresh,
  projectId,
  planningUsage,
  providerSegments,
  tokenSegments,
  sourceSegments,
  visualMode,
  chartState,
}) => {
  const StudioIcon = STUDIO_ICONS[visualMode];
  const frame = STUDIO_FRAMES[visualMode];

  const renderEmptyState = (mode: StatsVisualMode) => (
    <div role="status" aria-live="polite" className={`${PANEL_CLASS} flex flex-col items-center justify-center py-20 text-center`}>
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.25rem] border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Layers3 className="h-8 w-8" strokeWidth={2} />
      </div>
      <div className="text-base font-bold text-slate-900 dark:text-white">Waiting for Telemetry</div>
      <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{STUDIO_EMPTY_MESSAGES[mode]}</div>
    </div>
  );

  return (
    <div key={visualMode} className="animate-in fade-in duration-200">
      <div className={`${PANEL_CLASS} mb-6 p-4 md:p-5`} aria-labelledby={`stats-${visualMode}-studio-title`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-chip)] text-signal-600 dark:text-signal-400">
              <StudioIcon className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Analysis Studio</div>
              <h2 id={`stats-${visualMode}-studio-title`} className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                {STUDIO_TITLES[visualMode]}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {STUDIO_SUBTITLES[visualMode]}
              </p>
            </div>
          </div>
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3 lg:max-w-3xl" aria-label={`${STUDIO_TITLES[visualMode]} analysis frame`}>
            {[
              ["Question", frame.question],
              ["Compare", frame.compare],
              ["Action", frame.action],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-subpanel)] px-3 py-2">
                <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</div>
                <div className="mt-1 text-xs font-semibold leading-snug text-slate-700 dark:text-slate-200">{value}</div>
              </div>
            ))}
          </div>
          <div
            role="status"
            aria-live="polite"
            aria-label={`${STUDIO_TITLES[visualMode]} studio ${loading ? "refreshing" : stats ? "ready" : "waiting"}`}
            className={`self-start rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] lg:self-center ${
              loading
                ? "border-amber-500/24 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300"
                : "border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-chip)] text-slate-500 dark:text-slate-400"
            }`}
          >
            {loading ? "Refreshing" : stats ? "Ready" : "Waiting"}
          </div>
        </div>
      </div>


      {visualMode === "trend" ? (
        stats ? (
          <TrendStudio
            stats={stats}
            loading={loading}
            error={error}
            refresh={refresh}
            planningUsage={planningUsage}
            chartState={chartState}
          />
        ) : renderEmptyState("trend")
      ) : null}

      {visualMode === "composition" ? (
        stats ? (
          <div className={loading ? "pointer-events-none opacity-60 transition-opacity motion-reduce:transition-none" : "transition-opacity motion-reduce:transition-none"}>
            <CompositionStudio stats={stats} providerSegments={providerSegments} tokenSegments={tokenSegments} />
          </div>
        ) : renderEmptyState("composition")
      ) : null}

      {visualMode === "models" ? (
        stats ? (
          <div className={loading ? "pointer-events-none opacity-60 transition-opacity motion-reduce:transition-none" : "transition-opacity motion-reduce:transition-none"}>
            <ModelsStudio stats={stats} />
          </div>
        ) : renderEmptyState("models")
      ) : null}

      {visualMode === "reliability" ? (
        stats ? (
          <div className={loading ? "pointer-events-none opacity-60 transition-opacity motion-reduce:transition-none" : "transition-opacity motion-reduce:transition-none"}>
            <ReliabilityStudio stats={stats} providerSegments={providerSegments} sourceSegments={sourceSegments} />
          </div>
        ) : renderEmptyState("reliability")
      ) : null}

      {visualMode === "ledgers" ? (
        stats ? (
          <section className={`space-y-6 ${loading ? "pointer-events-none opacity-60 transition-opacity motion-reduce:transition-none" : "transition-opacity motion-reduce:transition-none"}`}>
            <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
              <StudioHeader
                icon={Layers3}
                eyebrow="Telemetry Ledgers"
                title="Task and sprint telemetry"
                description="Deep operational ledgers for execution scopes, redesigned around search, recency, sort controls, and richer usage breakdowns."
              />
            </div>
            <TelemetryLedgerTabs stats={stats} />
          </section>
        ) : renderEmptyState("ledgers")
      ) : null}

      {visualMode === "system" ? (
        stats ? (
          <SystemStudio projectId={projectId} />
        ) : renderEmptyState("system")
      ) : null}
    </div>
  );
};
