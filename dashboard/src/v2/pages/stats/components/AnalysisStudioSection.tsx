import type { ProjectExecutionStatsSnapshot, ExecutionStatsEntitySummary, SegmentDefinition } from "../../../types.js";
import type { UsageChartState } from "../use-usage-chart-state.js";
import type { FunctionComponent } from "preact";
import { Layers3 } from "lucide-preact";
import { TrendStudio } from "./TrendStudio.js";
import { CompositionStudio } from "./CompositionStudio.js";
import { ReliabilityStudio } from "./ReliabilityStudio.js";
import {
  CHIP_CLASS,
  PANEL_CLASS,
  type StatsVisualMode,
} from "./stats-ui-primitives.js";
import { SystemStudio } from "./system/SystemStudio.js";
import { ModelsStudio } from "./ModelsStudio.js";
import { TelemetryLedgerTabs } from "./TelemetryLedgerTabs.js";
import { CostStudio } from "./cost/CostStudio.js";

interface StudioMetadata {
  label: string;
  eyebrow: string;
  description: string;
  emptyMessage: string;
}

const STUDIO_METADATA: Record<StatsVisualMode, StudioMetadata> = {
  trend: {
    label: "Trend",
    eyebrow: "Time-series lens",
    description: "Token, invocation, and runtime movement across the selected range.",
    emptyMessage: "Select a time window to see Trend data.",
  },
  composition: {
    label: "Composition",
    eyebrow: "Usage mix",
    description: "Provider, token, purpose, and source mix for the current telemetry window.",
    emptyMessage: "Select a time window to see Composition data.",
  },
  cost: {
    label: "Cost",
    eyebrow: "Spend intelligence",
    description: "Spend, pricing coverage, allocation, and entity-level cost detail for the selected range.",
    emptyMessage: "Select a time window to see Cost data.",
  },
  models: {
    label: "Models",
    eyebrow: "Model performance",
    description: "Model activity, latency, cache behavior, and reliability signals.",
    emptyMessage: "Select a time window to see Models data.",
  },
  reliability: {
    label: "Providers",
    eyebrow: "Reliability lens",
    description: "Provider health, source confidence, failures, and integrity notes.",
    emptyMessage: "Select a time window to see Provider data.",
  },
  ledgers: {
    label: "Ledgers",
    eyebrow: "Audit rows",
    description: "Dense task, sprint, and git telemetry rows for audit-style review.",
    emptyMessage: "Select a time window to see Ledger data.",
  },
  system: {
    label: "System",
    eyebrow: "Invocation workbench",
    description: "Invocation health, filters, transcript detail, and debugging context.",
    emptyMessage: "Select a time window to see System data.",
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
  const activeMetadata = STUDIO_METADATA[visualMode];
  const metadataDescriptionId = `stats-analysis-${visualMode}-description`;

  const renderSectionMetadata = (metadata: StudioMetadata) => (
    <div className="mb-3 flex min-w-0 flex-col gap-1.5 border-b border-[color:var(--stats-border-hairline)] px-1 pb-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 break-words text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
        {metadata.label}
      </div>
      <p id={metadataDescriptionId} className="m-0 max-w-3xl text-xs leading-relaxed text-[color:var(--stats-detail-color)]">
        {metadata.description}
      </p>
    </div>
  );

  const renderEmptyState = (metadata: StudioMetadata) => (
    <div role="status" aria-live="polite" className={`${PANEL_CLASS} flex flex-col items-center justify-center py-16 text-center`}>
      <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center border border-[color:var(--stats-border-hairline)] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
        <Layers3 className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
      </div>
      <div className="text-base font-bold text-[color:var(--stats-value-color)]">Waiting for Telemetry</div>
      <div className="mt-2 text-sm text-[color:var(--stats-detail-color)]">{metadata.emptyMessage}</div>
    </div>
  );

  return (
    <div
      key={visualMode}
      id="stats-analysis-panel"
      role="region"
      aria-label="Stats analysis panel"
      aria-describedby={metadataDescriptionId}
      aria-busy={loading ? "true" : undefined}
      className="animate-in fade-in duration-200 motion-reduce:animate-none"
    >
      {renderSectionMetadata(activeMetadata)}
      {loading && stats ? (
        <div role="status" aria-live="polite" aria-atomic="true" className={`mb-3 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
          Updating analytics from cached data. Current values remain visible while the latest snapshot loads.
        </div>
      ) : null}
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
        ) : renderEmptyState(STUDIO_METADATA.trend)
      ) : null}

      {visualMode === "composition" ? (
        stats ? (
          <div className={loading ? "pointer-events-none opacity-60 transition-opacity motion-reduce:transition-none" : "transition-opacity motion-reduce:transition-none"}>
            <CompositionStudio stats={stats} providerSegments={providerSegments} tokenSegments={tokenSegments} />
          </div>
        ) : renderEmptyState(STUDIO_METADATA.composition)
      ) : null}

      {visualMode === "cost" ? (
        stats ? (
          <div className={loading ? "pointer-events-none opacity-60 transition-opacity motion-reduce:transition-none" : "transition-opacity motion-reduce:transition-none"}>
            <CostStudio stats={stats} />
          </div>
        ) : renderEmptyState(STUDIO_METADATA.cost)
      ) : null}

      {visualMode === "models" ? (
        stats ? (
          <div className={loading ? "pointer-events-none opacity-60 transition-opacity motion-reduce:transition-none" : "transition-opacity motion-reduce:transition-none"}>
            <ModelsStudio stats={stats} />
          </div>
        ) : renderEmptyState(STUDIO_METADATA.models)
      ) : null}

      {visualMode === "reliability" ? (
        stats ? (
          <div className={loading ? "pointer-events-none opacity-60 transition-opacity motion-reduce:transition-none" : "transition-opacity motion-reduce:transition-none"}>
            <ReliabilityStudio stats={stats} providerSegments={providerSegments} sourceSegments={sourceSegments} />
          </div>
        ) : renderEmptyState(STUDIO_METADATA.reliability)
      ) : null}

      {visualMode === "ledgers" ? (
        stats ? (
          <section className={`space-y-6 ${loading ? "pointer-events-none opacity-60 transition-opacity motion-reduce:transition-none" : "transition-opacity motion-reduce:transition-none"}`}>
            <TelemetryLedgerTabs stats={stats} />
          </section>
        ) : renderEmptyState(STUDIO_METADATA.ledgers)
      ) : null}

      {visualMode === "system" ? (
        stats ? (
          <SystemStudio projectId={projectId} />
        ) : renderEmptyState(STUDIO_METADATA.system)
      ) : null}
    </div>
  );
};
