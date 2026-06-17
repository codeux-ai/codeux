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
  PANEL_CLASS,
} from "./StatsShared.js";
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
    <div className="rounded-[2rem] border border-dashed border-black/[0.08] bg-white/68 px-8 py-16 text-center text-sm text-slate-500 dark:border-white/[0.08] dark:bg-void-800/68">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-void-700">
        <Layers3 className="h-6 w-6 text-slate-400" />
      </div>
      {STUDIO_EMPTY_MESSAGES[mode]}
    </div>
  );

  return (
    <div key={visualMode} className="animate-in fade-in duration-200">
      <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
        {STUDIO_SUBTITLES[visualMode]}
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
