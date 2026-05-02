import type { ProjectExecutionStatsSnapshot, ExecutionStatsEntitySummary, SegmentDefinition, ProjectStatsWindow } from "../../../types.js";
import type { UsageChartState } from "../use-usage-chart-state.js";
import type { StatsVisualMode } from "./StatsShared.js";
import type { FunctionComponent } from "preact";
import { Layers3 } from "lucide-preact";
import {
  ViewToggle,
  TrendStudio,
  CompositionStudio,
  ReliabilityStudio,
  StudioHeader,
  PANEL_CLASS,
} from "./StatsShared.js";
import { TelemetryLedgerTabs } from "./TelemetryLedgerTabs.js";

export interface AnalysisStudioSectionProps {
  stats: ProjectExecutionStatsSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  planningUsage: ExecutionStatsEntitySummary | null;
  providerSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
  visualMode: StatsVisualMode;
  setVisualMode: (mode: StatsVisualMode) => void;
  chartState: UsageChartState;
  activeWindow: ProjectStatsWindow | string;
  customFrom: string;
  customTo: string;
  applyPresetWindow: (value: Exclude<ProjectStatsWindow, "custom">) => void;
  setCustomFrom: (value: string) => void;
  setCustomTo: (value: string) => void;
  applyCustomRange: () => void;
}

export const AnalysisStudioSection: FunctionComponent<AnalysisStudioSectionProps> = ({
  stats,
  loading,
  error,
  refresh,
  planningUsage,
  providerSegments,
  tokenSegments,
  sourceSegments,
  visualMode,
  setVisualMode,
  chartState,
  activeWindow,
  customFrom,
  customTo,
  applyPresetWindow,
  setCustomFrom,
  setCustomTo,
  applyCustomRange,
}) => {
  if (!stats) return null;

  return (
    <>
      <div className="flex justify-end mb-4">
        <ViewToggle value={visualMode} onChange={setVisualMode} />
      </div>

      {visualMode === "trend" ? (
        <TrendStudio
          stats={stats}
          loading={loading}
          error={error}
          refresh={refresh}
          planningUsage={planningUsage}
          chartState={chartState}
          activeWindow={activeWindow}
          customFrom={customFrom}
          customTo={customTo}
          onSelectPreset={applyPresetWindow}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
          onApplyCustom={applyCustomRange}
        />
      ) : null}

      {visualMode === "composition" ? (
        <div className={loading ? "pointer-events-none opacity-60 transition-opacity motion-reduce:transition-none" : "transition-opacity motion-reduce:transition-none"}>
          <CompositionStudio stats={stats} providerSegments={providerSegments} tokenSegments={tokenSegments} />
        </div>
      ) : null}

      {visualMode === "reliability" ? (
        <div className={loading ? "pointer-events-none opacity-60 transition-opacity motion-reduce:transition-none" : "transition-opacity motion-reduce:transition-none"}>
          <ReliabilityStudio stats={stats} providerSegments={providerSegments} sourceSegments={sourceSegments} />
        </div>
      ) : null}

      {visualMode === "ledgers" ? (
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
      ) : null}
    </>
  );
};
