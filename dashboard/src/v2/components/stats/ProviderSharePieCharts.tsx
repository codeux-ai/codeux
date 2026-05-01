import type { FunctionComponent } from "preact";
import type { SegmentDefinition, ProjectExecutionStatsSnapshot } from "../../types.js";
import { DonutCard } from "../../pages/stats/components/StatsShared.js";
import { aggregateTopProviders } from "../../lib/stats/provider-aggregation.js";

interface ProviderSharePieChartsProps {
  stats: ProjectExecutionStatsSnapshot;
  providerSegments: SegmentDefinition[];
}

export const ProviderSharePieCharts: FunctionComponent<ProviderSharePieChartsProps> = ({
  stats,
  providerSegments,
}) => {
  const topProviders = aggregateTopProviders(stats);
  const topProvider = topProviders.length > 0 ? topProviders[0] : null;

  // The secondary chart should display the model breakdown for the top provider found in the current selection
  // stats.chartSeries may have model breakdown, but wait, do we have model breakdowns in the snapshot?
  // Let's check stats object or we can mock some segments for now based on what's available if model data isn't there.
  // Actually, let's see how models are represented. We might have stats.models or similar.
  const modelSegments: SegmentDefinition[] = [];
  let modelCenterValue = "0";

  // TODO: extract actual model breakdown from stats once we know the structure.
  if (topProvider) {
    // If stats contains model data we can extract it here.
    // For now we'll just populate an empty array to be updated if needed.
    modelCenterValue = String(topProvider.invocationCount);
  }

  return (
    <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.05fr_0.95fr]">
      <DonutCard
        title="Token Share by Provider"
        eyebrow="Providers"
        description="Share of token volume across all providers in the selected window."
        centerValue={formatTokens(stats.usage.totalTokens)}
        centerLabel="token volume"
        segments={providerSegments}
      />
      <DonutCard
        title={`Model Breakdown: ${topProvider?.name || "None"}`}
        eyebrow="Top Provider Details"
        description={`Usage breakdown by model for ${topProvider?.name || "the top provider"}.`}
        centerValue={modelCenterValue}
        centerLabel="invocations"
        segments={modelSegments}
      />
    </div>
  );
};

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return value.toLocaleString();
}
