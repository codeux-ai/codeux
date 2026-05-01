import type { ProjectExecutionStatsSnapshot, ProjectExecutionStatsChartSeries } from "../../../types.js";

export interface AggregatedProviderSummary {
  id: string;
  name: string;
  totalUsage: number;
  inputTokens: number;
  outputTokens: number;
  invocationCount: number;
  activeTimeMs: number;
  dailySeries: number[];
}

export function aggregateTopProviders(stats: ProjectExecutionStatsSnapshot | null): AggregatedProviderSummary[] {
  if (!stats || !stats.providers || stats.providers.length === 0) {
    return [];
  }

  // Sort providers by totalTokens descending, breaking ties alphabetically
  const sortedProviders = [...stats.providers].sort((a, b) => {
    if (b.usage.totalTokens !== a.usage.totalTokens) {
      return b.usage.totalTokens - a.usage.totalTokens;
    }
    return a.label.localeCompare(b.label);
  });

  const topProviders = sortedProviders.slice(0, 4);

  return topProviders.map((provider) => {
    const chartSeriesData = stats.chartSeries?.find(cs => cs.id === provider.id && cs.grouping === "provider")?.data || [];
    const finalSeries = chartSeriesData.length > 0 ? chartSeriesData : new Array(stats.buckets?.length || 7).fill(0);

    return {
      id: provider.id,
      name: provider.label,
      totalUsage: provider.usage.totalTokens,
      inputTokens: provider.usage.inputTokens,
      outputTokens: provider.usage.outputTokens,
      invocationCount: provider.usage.invocationCount,
      activeTimeMs: provider.usage.activeTimeMs,
      dailySeries: finalSeries,
    };
  });
}
