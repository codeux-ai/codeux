import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageTotals,
  ProjectExecutionStatsSnapshot,
  SegmentDefinition,
} from "../../types.js";
import { createStatsSegments, createSeries, EMPTY_USAGE } from "./stats-utils.js";
import type { DashboardLocale } from "../../i18n/index.js";

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

export function deriveStatsPageViewModel(stats: ProjectExecutionStatsSnapshot | null, locale: DashboardLocale = "en"): StatsPageViewModel {
  const usage = stats?.usage || EMPTY_USAGE;
  const buckets = stats?.buckets || [];
  const tokenSeries = createSeries(buckets, (bucket) => bucket.usage.totalTokens);
  const activeTimeSeries = createSeries(buckets, (bucket) => bucket.usage.activeTimeMs / 1000);
  const wallTimeSeries = createSeries(buckets, (bucket) => bucket.usage.wallTimeMs / 1000);
  const planningUsage = stats?.purposes.find((purpose) => purpose.id === "planning") || null;
  const { providerSegments, sourceSegments, tokenSegments } = createStatsSegments(stats, usage, locale);

  let completionConfidence = locale === "de" ? "Nicht verfügbar" : "Unavailable";
  if (!stats) {
    completionConfidence = locale === "de" ? "Keine Telemetrie" : "No telemetry";
  } else if (usage.reportedInvocationCount > 0 && usage.estimatedInvocationCount === 0) {
    completionConfidence = locale === "de" ? "Vom Anbieter gemeldet" : "Provider reported";
  } else if (usage.reportedInvocationCount > 0 && usage.estimatedInvocationCount > 0) {
    completionConfidence = locale === "de" ? "Gemeldet und Ersatzwerte gemischt" : "Mixed reported + fallback";
  } else if (usage.estimatedInvocationCount > 0) {
    completionConfidence = locale === "de" ? "Geschätzte Ersatzwerte" : "Estimated fallback";
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
