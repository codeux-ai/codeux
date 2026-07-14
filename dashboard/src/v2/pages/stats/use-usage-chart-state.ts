import { useEffect, useMemo, useState } from "preact/hooks";
import type { ProjectExecutionStatsChartSeries, ProjectExecutionStatsSnapshot } from "../../types.js";
import type { ChartZoomRange, StatsVisualMode } from "./components/StatsShared.js";
import { calculateChartMetrics, groupChartSeries } from "./chart-view-models.js";
import type { GroupedChartSeriesSection } from "./chart-view-models.js";

const DEFAULT_STORAGE_SCOPE = "default";
const SERIES_STORAGE_PREFIX = "codeux_stats_enabled_series";
const LEGACY_SERIES_STORAGE_PREFIX = "jules_stats_enabled_series";
const VISUAL_MODE_STORAGE_PREFIX = "codeux_stats_visual_mode";
const VALID_VISUAL_MODES: StatsVisualMode[] = [
  "trend",
  "composition",
  "cost",
  "models",
  "reliability",
  "ledgers",
  "system",
];

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

type ReconcileChartSeries = Pick<ProjectExecutionStatsChartSeries, "id" | "defaultEnabled">;

export function getDefaultEnabledSeries(
  chartSeries: ReconcileChartSeries[]
): Record<string, boolean> {
  const defaults = chartSeries.reduce((acc, series) => {
    acc[series.id] = series.defaultEnabled;
    return acc;
  }, {} as Record<string, boolean>);

  if (chartSeries.length > 0 && Object.values(defaults).every((enabled) => !enabled)) {
    defaults[chartSeries[0]!.id] = true;
  }

  return defaults;
}

export function reconcileSeries(
  current: Record<string, boolean>,
  chartSeries: ReconcileChartSeries[]
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
    return getDefaultEnabledSeries(chartSeries);
  }

  return changed ? next : current;
}

function getStorageScope(projectId: string | null): string {
  return projectId || DEFAULT_STORAGE_SCOPE;
}

function getStorageKey(prefix: string, projectId: string | null): string {
  return `${prefix}_${getStorageScope(projectId)}`;
}

function readStorageValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string): void {
  try {
    if (readStorageValue(key) !== value) {
      localStorage.setItem(key, value);
    }
  } catch {
    // Ignore restricted storage environments.
  }
}

function parseVisualMode(stored: string | null): StatsVisualMode | null {
  if (!stored || !VALID_VISUAL_MODES.includes(stored as StatsVisualMode)) {
    return null;
  }

  return stored as StatsVisualMode;
}

function readStoredVisualMode(projectId: string | null): StatsVisualMode {
  return parseVisualMode(readStorageValue(getStorageKey(VISUAL_MODE_STORAGE_PREFIX, projectId))) || "composition";
}

function readStoredSeries(projectId: string | null): Record<string, boolean> {
  const storageKey = getStorageKey(SERIES_STORAGE_PREFIX, projectId);
  const legacyStorageKey = getStorageKey(LEGACY_SERIES_STORAGE_PREFIX, projectId);
  const storedSeries = readStorageValue(storageKey) ?? readStorageValue(legacyStorageKey);
  const parsedSeries = parseEnabledSeries(storedSeries);

  if (storedSeries && storageKey !== legacyStorageKey) {
    writeStorageValue(storageKey, JSON.stringify(parsedSeries));
  }

  return parsedSeries;
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
  resetEnabledSeries: () => void;
  activeSeriesCount: number;
  seriesGroups: GroupedChartSeriesSection[];
  metrics: ReturnType<typeof calculateChartMetrics> | null;
}

export function useUsageChartState(
  projectId: string | null,
  stats: ProjectExecutionStatsSnapshot | null
): UsageChartState {
  const [visualMode, setVisualModeState] = useState<StatsVisualMode>(() => readStoredVisualMode(projectId));
  const [zoomRange, setZoomRange] = useState<ChartZoomRange | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [dragCurrentIndex, setDragCurrentIndex] = useState<number | null>(null);
  const [enabledSeriesState, setEnabledSeriesState] = useState<Record<string, boolean>>(() => readStoredSeries(projectId));

  const setVisualMode = (mode: StatsVisualMode) => {
    setVisualModeState(mode);
    writeStorageValue(getStorageKey(VISUAL_MODE_STORAGE_PREFIX, projectId), mode);
  };

  const setEnabledSeries: UsageChartState["setEnabledSeries"] = (value) => {
    setEnabledSeriesState((current) => {
      const next = typeof value === "function" ? value(current) : value;
      writeStorageValue(getStorageKey(SERIES_STORAGE_PREFIX, projectId), JSON.stringify(next));
      return next;
    });
  };

  const resetEnabledSeries = () => {
    if (!stats) return;
    setEnabledSeries(getDefaultEnabledSeries(stats.chartSeries));
  };

  useEffect(() => {
    setVisualModeState(readStoredVisualMode(projectId));
    setEnabledSeriesState(readStoredSeries(projectId));
  }, [projectId]);

  useEffect(() => {
    if (!stats) return;
    setEnabledSeries((curr) => {
      const next = reconcileSeries(curr, stats.chartSeries);
      return next;
    });

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

  const metrics = stats
    ? calculateChartMetrics(
        stats.buckets.slice(
          zoomRange?.start ?? 0,
          (zoomRange?.end ?? Math.max(0, stats.buckets.length - 1)) + 1
        )
      )
    : null;
  const seriesGroups = useMemo(
    () => groupChartSeries(stats?.chartSeries ?? [], enabledSeriesState),
    [enabledSeriesState, stats?.chartSeries]
  );
  const activeSeriesCount = seriesGroups.reduce((count, group) => count + group.activeCount, 0);

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
    enabledSeries: enabledSeriesState,
    setEnabledSeries,
    resetEnabledSeries,
    activeSeriesCount,
    seriesGroups,
    metrics,
  };
}
