import { useEffect, useState, useRef } from "preact/hooks";
import type { ProjectExecutionStatsSnapshot } from "../../types.js";
import type { ChartZoomRange, StatsVisualMode } from "./components/StatsShared.js";

export function parseEnabledSeries(stored: string | null): Record<string, boolean> {
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'boolean') {
        result[k] = v;
      }
    }
    return result;
  } catch (e) {
    return {};
  }
}

export function reconcileSeries(
  current: Record<string, boolean>,
  chartSeries: { id: string; defaultEnabled: boolean }[]
): Record<string, boolean> {
  let changed = false;
  const next = { ...current };
  let enabledCount = 0;

  const validIds = new Set(chartSeries.map(s => s.id));
  for (const key of Object.keys(next)) {
    if (!validIds.has(key)) {
      delete next[key];
      changed = true;
    }
  }

  for (const series of chartSeries) {
    if (next[series.id] === undefined) {
      next[series.id] = series.defaultEnabled;
      changed = true;
    }
    if (next[series.id]) {
      enabledCount++;
    }
  }

  if (enabledCount === 0 && chartSeries.length > 0) {
    next[chartSeries[0]!.id] = true;
    changed = true;
  }

  return changed ? next : current;
}

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
  const [visualMode, setVisualMode] = useState<StatsVisualMode>("composition");
  const [zoomRange, setZoomRange] = useState<ChartZoomRange | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [dragCurrentIndex, setDragCurrentIndex] = useState<number | null>(null);
  
  const activeProjectRef = useRef<string | null>(projectId);
  const [enabledSeries, setEnabledSeries] = useState<Record<string, boolean>>(() => {
    const storageKey = `jules_stats_enabled_series_${projectId || 'default'}`;
    try {
      return parseEnabledSeries(localStorage.getItem(storageKey));
    } catch (e) {
      return {};
    }
  });

  useEffect(() => {
    if (activeProjectRef.current !== projectId) return;
    if (Object.keys(enabledSeries).length === 0) return;

    const storageKey = `jules_stats_enabled_series_${projectId || 'default'}`;
    const serialized = JSON.stringify(enabledSeries);
    try {
      if (localStorage.getItem(storageKey) !== serialized) {
        localStorage.setItem(storageKey, serialized);
      }
    } catch (e) {
      // ignore
    }
  }, [enabledSeries, projectId]);

  // Load project-specific series config when project changes
  useEffect(() => {
    activeProjectRef.current = projectId;
    const storageKey = `jules_stats_enabled_series_${projectId || 'default'}`;
    try {
      setEnabledSeries(parseEnabledSeries(localStorage.getItem(storageKey)));
    } catch (e) {
      setEnabledSeries({});
    }
  }, [projectId]);

  // Reconcile and initialize series on stats load
  useEffect(() => {
    if (!stats) return;

    setEnabledSeries((curr) => reconcileSeries(curr, stats.chartSeries));

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
