import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageTotals,
  ProjectExecutionStatsSnapshot,
  SegmentDefinition,
} from "../../types.js";
import { createStatsSegments, createSeries, EMPTY_USAGE } from "./stats-utils.js";

export interface StatsPageViewModel {
  usage: ExecutionUsageTotals;
  tokenSeries: number[];
  activeTimeSeries: number[];
  wallTimeSeries: number[];
  planningUsage: ExecutionStatsEntitySummary | null;
  providerSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
  completionConfidence: string;
}

export function deriveStatsPageViewModel(stats: ProjectExecutionStatsSnapshot | null): StatsPageViewModel {
  const usage = stats?.usage || EMPTY_USAGE;
  const buckets = stats?.buckets || [];
  const tokenSeries = createSeries(buckets, (bucket) => bucket.usage.totalTokens);
  const activeTimeSeries = createSeries(buckets, (bucket) => bucket.usage.activeTimeMs / 1000);
  const wallTimeSeries = createSeries(buckets, (bucket) => bucket.usage.wallTimeMs / 1000);
  const planningUsage = stats?.purposes.find((purpose) => purpose.id === "planning") || null;
  const { providerSegments, sourceSegments, tokenSegments } = createStatsSegments(stats, usage);

  let completionConfidence = "Unavailable";
  if (!stats) {
    completionConfidence = "No telemetry";
  } else if (usage.reportedInvocationCount > 0 && usage.estimatedInvocationCount === 0) {
    completionConfidence = "Provider reported";
  } else if (usage.reportedInvocationCount > 0 && usage.estimatedInvocationCount > 0) {
    completionConfidence = "Mixed reported + fallback";
  } else if (usage.estimatedInvocationCount > 0) {
    completionConfidence = "Estimated fallback";
  }

  return {
    usage,
    tokenSeries,
    activeTimeSeries,
    wallTimeSeries,
    planningUsage,
    providerSegments,
    sourceSegments,
    tokenSegments,
    completionConfidence,
  };
}
