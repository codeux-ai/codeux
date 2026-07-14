import { useMemo, useState } from "preact/hooks";
import { useProjectStats } from "../../hooks/use-project-stats.js";
import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageTotals,
  ProjectStatsQuery,
  ProjectStatsWindow,
  SegmentDefinition,
} from "../../types.js";
import { isValidCustomRange } from "./stats-utils.js";
import { deriveStatsPageViewModel } from "./stats-page-view-model.js";
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
  
  const viewModel = useMemo(() => deriveStatsPageViewModel(stats), [stats]);

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
    usage: viewModel.usage,
    tokenSeries: viewModel.tokenSeries,
    activeTimeSeries: viewModel.activeTimeSeries,
    wallTimeSeries: viewModel.wallTimeSeries,
    planningUsage: viewModel.planningUsage,
    activeQuery,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    applyCustomWindow,
    visualMode: chartState.visualMode,
    setVisualMode: chartState.setVisualMode,
    chartState,
    providerSegments: viewModel.providerSegments,
    sourceSegments: viewModel.sourceSegments,
    tokenSegments: viewModel.tokenSegments,
    applyPresetWindow,
    applyCustomRange,
    completionConfidence: viewModel.completionConfidence,
  };
}
