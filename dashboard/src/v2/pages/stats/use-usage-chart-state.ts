import { useEffect, useState } from "preact/hooks";
import type { ProjectExecutionStatsSnapshot } from "../../types.js";
import type { ChartZoomRange, StatsVisualMode } from "./components/StatsShared.js";

export interface UsageChartState {
  visualMode: StatsVisualMode;
  setVisualMode: (mode: StatsVisualMode) => void;
  zoomRange: ChartZoomRange | null;
  setZoomRange: (range: ChartZoomRange | null) => void;
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
  dragStartIndex: number | null;
  setDragStartIndex: (index: number | null) => void;
  dragCurrentIndex: number | null;
  setDragCurrentIndex: (index: number | null) => void;
  enabledSeries: Record<string, boolean>;
  setEnabledSeries: (val: Record<string, boolean> | ((curr: Record<string, boolean>) => Record<string, boolean>)) => void;
}

export function useUsageChartState(
  projectId: string | null,
  stats: ProjectExecutionStatsSnapshot | null
): UsageChartState {
  const [visualMode, setVisualMode] = useState<StatsVisualMode>("trend");
  const [zoomRange, setZoomRange] = useState<ChartZoomRange | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [dragCurrentIndex, setDragCurrentIndex] = useState<number | null>(null);
  
  const [enabledSeries, setEnabledSeries] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem('jules_stats_enabled_series');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      // ignore
    }
    return {};
  });

  useEffect(() => {
    if (Object.keys(enabledSeries).length > 0) {
      try {
        localStorage.setItem('jules_stats_enabled_series', JSON.stringify(enabledSeries));
      } catch (e) {
        // ignore
      }
    }
  }, [enabledSeries]);

  // Reconcile and initialize series on stats load
  useEffect(() => {
    if (!stats) return;

    setEnabledSeries((curr) => {
      let changed = false;
      const next = { ...curr };
      let enabledCount = 0;

      for (const series of stats.chartSeries) {
        if (next[series.id] === undefined) {
          next[series.id] = series.defaultEnabled;
          changed = true;
        }
        if (next[series.id]) {
          enabledCount++;
        }
      }

      // Ensure at least one series is enabled
      if (enabledCount === 0 && stats.chartSeries.length > 0) {
        next[stats.chartSeries[0]!.id] = true;
        changed = true;
      }

      return changed ? next : curr;
    });

    // Constrain zoom range to current buckets
    setZoomRange((curr) => {
      if (!curr) return null;
      const maxIdx = Math.max(0, stats.buckets.length - 1);
      if (curr.start > maxIdx || curr.end > maxIdx) {
        return {
          start: Math.min(curr.start, maxIdx),
          end: Math.min(curr.end, maxIdx),
        };
      }
      return curr;
    });
  }, [stats]);

  // Reset state on project or range change
  const currentRangeKey = stats ? `${stats.range.from}-${stats.range.to}-${stats.range.resolution}` : null;
  useEffect(() => {
    setZoomRange(null);
    setHoveredIndex(null);
    setDragStartIndex(null);
    setDragCurrentIndex(null);
  }, [projectId, currentRangeKey]);

  return {
    visualMode,
    setVisualMode,
    zoomRange,
    setZoomRange,
    hoveredIndex,
    setHoveredIndex,
    dragStartIndex,
    setDragStartIndex,
    dragCurrentIndex,
    setDragCurrentIndex,
    enabledSeries,
    setEnabledSeries,
  };
}
