import type { ProjectExecutionStatsSnapshot, ExecutionStatsEntitySummary, SegmentDefinition } from "../../../types.js";
import type { UsageChartState } from "../use-usage-chart-state.js";
import type { StatsVisualMode } from "./StatsShared.js";
import type { FunctionComponent } from "preact";
import { Layers3 } from "lucide-preact";
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
  trend: "Time-series and throughput analysis",
  composition: "Token utilization and semantic distribution",
  models: "Performance and latency breakdown",
  reliability: "Telemetry coverage and fallback analysis",
  ledgers: "Operational logs and scope execution",
  system: "Debug log and system health",
};

const STUDIO_EMPTY_MESSAGES: Record<StatsVisualMode, string> = {
  trend: "Select a time window to see Trend data.",
  composition: "Select a time window to see Composition data.",
  models: "Select a time window to see Models data.",
  reliability: "Select a time window to see Reliability data.",
  ledgers: "Select a time window to see Ledgers data.",
  system: "Select a time window to see System data.",
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
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400">
          <Layers3 className="h-3 w-3" strokeWidth={2.5} />
          {STUDIO_SUBTITLES[visualMode]}
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
