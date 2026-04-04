import type { FunctionComponent } from "preact";
import {
  ViewToggle,
  TrendStudio,
  CompositionStudio,
  ReliabilityStudio,
} from "./StatsShared.js";

export const AnalysisStudioSection: FunctionComponent<any> = ({
  stats,
  planningUsage,
  providerSegments,
  tokenSegments,
  sourceSegments,
  visualMode,
  setVisualMode,
}) => {
  return (
    <>
      {stats ? (
        <div className="flex justify-start sm:justify-end mb-4">
          <ViewToggle value={visualMode} onChange={setVisualMode} />
        </div>
      ) : null}

      {visualMode === "trend" ? (
        <TrendStudio stats={stats} planningUsage={planningUsage} />
      ) : null}

      {visualMode === "composition" ? (
        <CompositionStudio stats={stats} providerSegments={providerSegments} tokenSegments={tokenSegments} />
      ) : null}

      {visualMode === "reliability" ? (
        <ReliabilityStudio stats={stats} providerSegments={providerSegments} sourceSegments={sourceSegments} />
      ) : null}
    </>
  );
};
