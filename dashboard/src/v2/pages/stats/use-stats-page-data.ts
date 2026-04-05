import { useMemo, useState } from "preact/hooks";
import { useProjectStats } from "../../hooks/use-project-stats.js";
import type {
  ProjectStatsQuery,
  ProjectStatsWindow,
} from "../../types.js";
import { createStatsSegments, createSeries, EMPTY_USAGE } from "./stats-utils.js";
import { useUsageChartState } from "./use-usage-chart-state.js";

export function useStatsPageData(projectId: string | null) {
  const today = useMemo(() => new Date(), []);
  const [activeQuery, setActiveQuery] = useState<ProjectStatsQuery>({ window: "7d" });
  const [customFrom, setCustomFrom] = useState(() => {
    const from = new Date();
    from.setDate(from.getDate() - 6);
    return from.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => today.toISOString().slice(0, 10));
  
  const { stats, loading, error } = useProjectStats(projectId, activeQuery);
  const chartState = useUsageChartState(projectId, stats || null);



  const usage = stats?.usage || EMPTY_USAGE;
  const tokenSeries = useMemo(() => createSeries(stats?.buckets || [], (bucket) => bucket.usage.totalTokens), [stats?.buckets]);
  const activeTimeSeries = useMemo(() => createSeries(stats?.buckets || [], (bucket) => bucket.usage.activeTimeMs / 1000), [stats?.buckets]);
  const wallTimeSeries = useMemo(() => createSeries(stats?.buckets || [], (bucket) => bucket.usage.wallTimeMs / 1000), [stats?.buckets]);
  const planningUsage = useMemo(() => stats?.purposes.find((purpose) => purpose.id === "planning") || null, [stats?.purposes]);
  
  const { providerSegments, sourceSegments, tokenSegments } = useMemo(
    () => createStatsSegments(stats, usage),
    [stats, usage],
  );

  const applyPresetWindow = (window: Exclude<ProjectStatsWindow, "custom">) => {
    setActiveQuery({ window });
  };

  const applyCustomRange = () => {
    if (!customFrom || !customTo) {
      return;
    }
    setActiveQuery({
      window: "custom",
      from: customFrom,
      to: customTo,
    });
  };

  const completionConfidence = useMemo(() => {
    if (!stats) {
      return "No telemetry";
    }
    if (usage.reportedInvocationCount > 0 && usage.estimatedInvocationCount === 0) {
      return "Provider reported";
    }
    if (usage.reportedInvocationCount > 0 && usage.estimatedInvocationCount > 0) {
      return "Mixed reported + fallback";
    }
    if (usage.estimatedInvocationCount > 0) {
      return "Estimated fallback";
    }
    return "Unavailable";
  }, [stats, usage.estimatedInvocationCount, usage.reportedInvocationCount]);

  return {
    stats,
    loading,
    error,
    usage,
    tokenSeries,
    activeTimeSeries,
    wallTimeSeries,
    planningUsage,
    activeQuery,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    visualMode: chartState.visualMode,
    setVisualMode: chartState.setVisualMode,
    chartState,
    providerSegments,
    sourceSegments,
    tokenSegments,
    applyPresetWindow,
    applyCustomRange,
    completionConfidence,
  };
}
