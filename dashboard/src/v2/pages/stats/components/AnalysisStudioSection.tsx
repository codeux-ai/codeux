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

export const AnalysisStudioSection: FunctionComponent<any> = ({
  stats,
  planningUsage,
  providerSegments,
  tokenSegments,
  sourceSegments,
  visualMode,
  setVisualMode,
  chartState,
}) => {
  return (
    <>
      {stats ? (
        <div className="flex justify-end mb-4">
          <ViewToggle value={visualMode} onChange={setVisualMode} />
        </div>
      ) : null}

      {visualMode === "trend" ? (
        <TrendStudio stats={stats} planningUsage={planningUsage} chartState={chartState} />
      ) : null}

      {visualMode === "composition" ? (
        <CompositionStudio stats={stats} providerSegments={providerSegments} tokenSegments={tokenSegments} />
      ) : null}

      {visualMode === "reliability" ? (
        <ReliabilityStudio stats={stats} providerSegments={providerSegments} sourceSegments={sourceSegments} />
      ) : null}

      {visualMode === "ledgers" ? (
        <section className="space-y-6">
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
