import { useMemo, useState } from "preact/hooks";
import { useProjectStats } from "../../hooks/use-project-stats.js";
import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageTotals,
  ProjectStatsQuery,
  ProjectStatsWindow,
  SegmentDefinition,
} from "../../types.js";
import { createStatsSegments, createSeries, EMPTY_USAGE, isValidCustomRange } from "./stats-utils.js";
import { useUsageChartState } from "./use-usage-chart-state.js";

export interface StatsPageData {
  stats: import("../../types.js").ProjectExecutionStatsSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  usage: ExecutionUsageTotals;
  tokenSeries: number[];
  activeTimeSeries: number[];
  wallTimeSeries: number[];
  planningUsage: ExecutionStatsEntitySummary | null;
  activeQuery: ProjectStatsQuery;
  customFrom: string;
  setCustomFrom: (value: string) => void;
  customTo: string;
  setCustomTo: (value: string) => void;
  applyCustomWindow?: () => void;
  visualMode: import("./components/StatsShared.js").StatsVisualMode;
  setVisualMode: (mode: import("./components/StatsShared.js").StatsVisualMode) => void;
  chartState: ReturnType<typeof useUsageChartState>;
  providerSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
  applyPresetWindow: (window: Exclude<ProjectStatsWindow, "custom">) => void;
  applyCustomRange: () => void;
  completionConfidence: string;
}

export function useStatsPageData(projectId: string | null): StatsPageData {
  const [activeQuery, setActiveQuery] = useState<ProjectStatsQuery>({ window: "7d" });
  const [customFrom, setCustomFrom] = useState(() => {
    const from = new Date();
    from.setDate(from.getDate() - 6);
    return from.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  });
  
  const { stats, loading, error, refresh } = useProjectStats(projectId, activeQuery);
  const chartState = useUsageChartState(projectId, stats || null);

  const usage = stats?.usage || EMPTY_USAGE;
  
  const derivations = useMemo(() => {
    const tokenSeries = createSeries(stats?.buckets || [], (bucket) => bucket.usage.totalTokens);
    const activeTimeSeries = createSeries(stats?.buckets || [], (bucket) => bucket.usage.activeTimeMs / 1000);
    const wallTimeSeries = createSeries(stats?.buckets || [], (bucket) => bucket.usage.wallTimeMs / 1000);
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
      tokenSeries,
      activeTimeSeries,
      wallTimeSeries,
      planningUsage,
      providerSegments,
      sourceSegments,
      tokenSegments,
      completionConfidence,
    };
  }, [stats, usage]);

  const applyPresetWindow = (window: Exclude<ProjectStatsWindow, "custom">) => {
    setActiveQuery({ window });
  };

  const applyCustomWindow = () => {
    setActiveQuery({
      window: "custom",
      from: customFrom,
      to: customTo,
    });
  };

  const applyCustomRange = () => {
    if (!isValidCustomRange(customFrom, customTo)) {
      return;
    }
    setActiveQuery({
      window: "custom",
      from: customFrom,
      to: customTo,
    });
  };

  return {
    stats,
    loading,
    error,
    refresh,
    usage,
    tokenSeries: derivations.tokenSeries,
    activeTimeSeries: derivations.activeTimeSeries,
    wallTimeSeries: derivations.wallTimeSeries,
    planningUsage: derivations.planningUsage,
    activeQuery,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    applyCustomWindow,
    visualMode: chartState.visualMode,
    setVisualMode: chartState.setVisualMode,
    chartState,
    providerSegments: derivations.providerSegments,
    sourceSegments: derivations.sourceSegments,
    tokenSegments: derivations.tokenSegments,
    applyPresetWindow,
    applyCustomRange,
    completionConfidence: derivations.completionConfidence,
  };
}
