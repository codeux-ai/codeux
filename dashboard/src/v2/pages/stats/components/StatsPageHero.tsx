import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Brain,
  Clock3,
  Database,
  Layers3,
  PieChart,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Workflow,
} from "lucide-preact";
import { MetricCard } from "../../../components/ui/MetricCard.js";
import { Sparkline } from "../../../components/ui/Sparkline.js";
import { useProjectData } from "../../../context/project-data.js";
import { useProgressiveList } from "../../../../hooks/use-progressive-list.js";
import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageBucketSummary,
  ProjectExecutionStatsSnapshot,
  ProjectStatsWindow,
  SegmentDefinition,
} from "../../../types.js";
import {
  formatTokens,
  formatDuration,
  formatPercent,
  formatDateTime,
  sumUsage,
  createSeries,
} from "../stats-utils.js";
import { useStatsPageData } from "../use-stats-page-data.js";

type StatsVisualMode = "trend" | "composition" | "reliability";
type ChartSeriesId = "tokens" | "active" | "invocations";
type LedgerSortKey = "last" | "tokens" | "active" | "input" | "output" | "name";

interface ChartPoint {
  x: number;
  y: number;
}

interface ChartSeriesDefinition {
  id: ChartSeriesId;
  label: string;
  accentHex: string;
  accessor: (bucket: ExecutionUsageBucketSummary) => number;
  formatter: (value: number) => string;
  signalLabel: string;
}

interface ChartZoomRange {
  start: number;
  end: number;
}

interface DonutSliceGeometry extends SegmentDefinition {
  path: string;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  share: number;
}

const PANEL_CLASS = "relative overflow-hidden rounded-[1.9rem] border border-black/[0.06] bg-white/70 p-6 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]";
const SUBPANEL_CLASS = "rounded-[1.45rem] border border-black/[0.05] bg-white/68 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.045)] backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)]";
const CHIP_CLASS = "rounded-full border border-black/[0.06] bg-white/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/55 dark:shadow-[0_1px_3px_rgba(0,0,0,0.18)]";
const INPUT_CLASS = "h-11 rounded-2xl border border-black/[0.06] bg-white/72 px-4 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-200";
const LEDGER_ROW_CLASS = "group rounded-[1.5rem] border border-black/[0.05] bg-white/68 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.045)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-signal-500/18 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)] dark:border-white/[0.05] dark:bg-void-900/35 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)] dark:hover:bg-void-900/45";

const DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const CHART_SERIES: ChartSeriesDefinition[] = [
  {
    id: "tokens",
    label: "Tokens",
    accentHex: "#00E0A0",
    accessor: (bucket) => bucket.usage.totalTokens,
    formatter: formatTokens,
    signalLabel: "Throughput",
  },
  {
    id: "active",
    label: "Active Time",
    accentHex: "#FFB800",
    accessor: (bucket) => bucket.usage.activeTimeMs,
    formatter: formatDuration,
    signalLabel: "Latency",
  },
  {
    id: "invocations",
    label: "Invocations",
    accentHex: "#0EA5E9",
    accessor: (bucket) => bucket.usage.invocationCount,
    formatter: (value) => value.toLocaleString(),
    signalLabel: "Volume",
  },
];

function formatDay(_value: string): string {
  const date = new Date(_value);
  if (Number.isNaN(date.getTime())) {
    return _value;
  }
  return DAY_FORMATTER.format(date);
}

function formatHourTick(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getHours()}:00`;
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.toLocaleString(undefined, { month: "short" })} ${date.getDate()}`;
}

function toTimestamp(value: string | null): number {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function buildPath(points: ChartPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  return points.map((point, index) => (
    `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  )).join(" ");
}

function buildSmoothPath(points: ChartPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    const point = points[0]!;
    return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }

  return points.map((point, index) => {
    if (index === 0) {
      return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }
    const previous = points[index - 1]!;
    const dx = point.x - previous.x;
    return `C ${(previous.x + dx * 0.35).toFixed(2)} ${previous.y.toFixed(2)} ${(point.x - dx * 0.35).toFixed(2)} ${point.y.toFixed(2)} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }).join(" ");
}

function buildAreaPath(points: ChartPoint[], height: number, padding: number): string {
  if (points.length === 0) {
    return "";
  }
  const start = points[0]!;
  const end = points[points.length - 1]!;
  return `${buildPath(points)} L ${end.x.toFixed(2)} ${(height - padding).toFixed(2)} L ${start.x.toFixed(2)} ${(height - padding).toFixed(2)} Z`;
}

function buildSmoothAreaPath(points: ChartPoint[], height: number, padding: number): string {
  if (points.length === 0) {
    return "";
  }
  const start = points[0]!;
  const end = points[points.length - 1]!;
  return `${buildSmoothPath(points)} L ${end.x.toFixed(2)} ${(height - padding).toFixed(2)} L ${start.x.toFixed(2)} ${(height - padding).toFixed(2)} Z`;
}

function buildPoints(values: number[], width: number, height: number, padding: number): ChartPoint[] {
  const safeValues = values.length > 0 ? values : [0];
  const max = Math.max(...safeValues, 1);
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);

  return safeValues.map((value, index) => {
    const x = safeValues.length === 1
      ? width / 2
      : padding + (index / (safeValues.length - 1)) * innerWidth;
    const y = height - padding - (value / max) * innerHeight;
    return { x, y };
  });
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number): ChartPoint {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function buildDonutArcPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function buildDonutSlices(segments: SegmentDefinition[]): DonutSliceGeometry[] {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  if (total <= 0) {
    return [];
  }

  const outerRadius = 104;
  const innerRadius = 58;
  const cx = 120;
  const cy = 120;
  let cursor = -90;

  return segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const sweep = (segment.value / total) * 360;
      const startAngle = cursor;
      const endAngle = cursor + sweep;
      cursor = endAngle;
      return {
        ...segment,
        share: (segment.value / total) * 100,
        startAngle,
        endAngle,
        midAngle: startAngle + sweep / 2,
        path: buildDonutArcPath(cx, cy, outerRadius, innerRadius, startAngle, endAngle),
      };
    });
}

function getAxisLabelStep(stats: ProjectExecutionStatsSnapshot["range"]): number {
  if (stats.resolution === "hour") {
    return stats.bucketCount > 18 ? 3 : 1;
  }
  if (stats.resolution === "week") {
    return stats.bucketCount > 24 ? 4 : 2;
  }
  return stats.bucketCount > 20 ? 5 : 1;
}

function formatAxisLabel(bucket: ExecutionUsageBucketSummary, range: ProjectExecutionStatsSnapshot["range"]): string {
  if (range.resolution === "hour") {
    return formatHourTick(bucket.bucketStart);
  }
  if (range.resolution === "week") {
    return bucket.label;
  }
  return formatShortDate(bucket.bucketStart);
}

function getLedgerSortValue(item: ExecutionStatsEntitySummary, key: LedgerSortKey): number | string {
  switch (key) {
    case "tokens":
      return item.usage.totalTokens;
    case "active":
      return item.usage.activeTimeMs;
    case "input":
      return item.usage.inputTokens;
    case "output":
      return item.usage.outputTokens;
    case "name":
      return item.label.toLowerCase();
    case "last":
    default:
      return toTimestamp(item.lastActivityAt);
  }
}

const RangeToggle: FunctionComponent<{
  activeWindow: ProjectStatsWindow | string;
  customFrom: string;
  customTo: string;
  onSelectPreset: (value: Exclude<ProjectStatsWindow, "custom">) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  onApplyCustom: () => void;
}> = ({
  activeWindow,
  customFrom,
  customTo,
  onSelectPreset,
  onCustomFromChange,
  onCustomToChange,
  onApplyCustom,
}) => (
  <div className="flex flex-col gap-4">
    <div className={`inline-flex flex-wrap p-1 ${CHIP_CLASS}`}>
      {(["24h", "7d", "30d", "all"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onSelectPreset(value)}
          className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.22em] transition-all ${
            activeWindow === value
              ? "bg-void-900 text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] dark:bg-white dark:text-void-900"
              : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          }`}
        >
          {value === "all" ? "All time" : value}
        </button>
      ))}
      <button
        type="button"
        onClick={onApplyCustom}
        className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.22em] transition-all ${
          activeWindow === "custom"
            ? "bg-void-900 text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] dark:bg-white dark:text-void-900"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        }`}
      >
        Custom
      </button>
    </div>
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <input
        type="date"
        value={customFrom}
        onInput={(event) => onCustomFromChange((event.currentTarget as HTMLInputElement).value)}
        className={INPUT_CLASS}
      />
      <input
        type="date"
        value={customTo}
        onInput={(event) => onCustomToChange((event.currentTarget as HTMLInputElement).value)}
        className={INPUT_CLASS}
      />
      <button
        type="button"
        onClick={onApplyCustom}
        className="inline-flex h-11 items-center justify-center rounded-2xl bg-white/78 px-4 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-transform hover:-translate-y-0.5 dark:bg-white dark:text-void-900"
      >
        Apply
      </button>
    </div>
  </div>
);

const ViewToggle: FunctionComponent<{
  value: StatsVisualMode;
  onChange: (value: StatsVisualMode) => void;
}> = ({ value, onChange }) => {
  const modes: Array<{ id: StatsVisualMode; label: string; icon: typeof BarChart3 }> = [
    { id: "trend", label: "Trend", icon: BarChart3 },
    { id: "composition", label: "Composition", icon: PieChart },
    { id: "reliability", label: "Reliability", icon: ShieldCheck },
  ];

  return (
    <div className={`inline-flex p-1 ${CHIP_CLASS}`}>
      {modes.map((mode) => {
        const Icon = mode.icon;
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onChange(mode.id)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] transition-all ${
              value === mode.id
                ? "bg-slate-900 text-white shadow-[0_14px_32px_rgba(15,23,42,0.16)] dark:bg-white dark:text-slate-900"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            {mode.label}
          </button>
        );
      })}
    </div>
  );
};

const SignalMetricCard: FunctionComponent<{
  label: string;
  value: string;
  detail: string;
  accentHex: string;
  hoverTint: string;
  sparkline: number[];
  signalLabel: string;
}> = ({ label, value, detail, accentHex, hoverTint, sparkline, signalLabel }) => (
  <MetricCard hoverTint={hoverTint} accentHex={accentHex}>
    <Sparkline points={sparkline} color={accentHex} />
    <div className="relative z-10 flex items-center justify-between gap-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 ${CHIP_CLASS}`}>
        {signalLabel}
      </div>
    </div>
    <div className="relative z-10 mt-6 text-[2.35rem] font-semibold tracking-tighter text-slate-900 dark:text-white">
      {value}
    </div>
    <div className="relative z-10 mt-3 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
      {detail}
    </div>
  </MetricCard>
);

const TokenChip: FunctionComponent<{
  icon: typeof ArrowDownRight;
  label: string;
  value: number;
  tone: string;
}> = ({ icon: Icon, label, value, tone }) => (
  <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${tone}`}>
    <Icon className="h-3.5 w-3.5" strokeWidth={2.1} />
    {label} {formatTokens(value)}
  </div>
);

const SeriesLegendButton: FunctionComponent<{
  series: ChartSeriesDefinition;
  active: boolean;
  currentValue: number;
  disabled?: boolean;
  onToggle: () => void;
}> = ({ series, active, currentValue, disabled = false, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    disabled={disabled}
    className={`rounded-[1.25rem] border px-4 py-3 text-left transition-all ${
      active
        ? `${SUBPANEL_CLASS} border-signal-500/18`
        : "rounded-[1.25rem] border border-black/[0.05] bg-white/60 px-4 py-3 text-left opacity-72 backdrop-blur-xl hover:opacity-100 dark:border-white/[0.05] dark:bg-void-900/30"
    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
  >
    <div className="flex items-center gap-3">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.accentHex }} />
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{series.label}</span>
    </div>
    <div className="mt-3 flex items-end justify-between gap-4">
      <div className="text-lg font-black text-slate-900 dark:text-white">{series.formatter(currentValue)}</div>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{series.signalLabel}</div>
    </div>
  </button>
);

const InteractiveUsageChart: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
}> = ({ stats }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [zoomRange, setZoomRange] = useState<ChartZoomRange | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [dragCurrentIndex, setDragCurrentIndex] = useState<number | null>(null);
  const [enabledSeries, setEnabledSeries] = useState<Record<ChartSeriesId, boolean>>({
    tokens: true,
    active: true,
    invocations: true,
  });
  const buckets = stats.buckets;

  const width = 900;
  const height = 340;
  const padding = 34;
  const viewStart = zoomRange?.start ?? 0;
  const viewEnd = zoomRange?.end ?? Math.max(0, buckets.length - 1);
  const visibleBuckets = buckets.slice(viewStart, viewEnd + 1);

  const chartData = useMemo(() => {
    return CHART_SERIES.map((series) => {
      const values = visibleBuckets.map(series.accessor);
      const points = buildPoints(values.length > 0 ? values : [0], width, height, padding);
      return {
        ...series,
        values,
        points,
        path: buildSmoothPath(points),
        areaPath: buildSmoothAreaPath(points, height, padding),
        max: Math.max(...(values.length > 0 ? values : [0]), 1),
      };
    });
  }, [visibleBuckets]);

  const visibleSeries = chartData.filter((series) => enabledSeries[series.id]);
  const activeSeriesCount = visibleSeries.length;
  const activeIndex = hoveredIndex ?? (visibleBuckets.length > 0 ? visibleBuckets.length - 1 : 0);
  const activeBucket = visibleBuckets[activeIndex] ?? null;
  const xPositions = chartData[0]?.points.map((point) => point.x) ?? [];
  const tooltipLeft = xPositions[activeIndex]
    ? ((xPositions[activeIndex]! - padding) / Math.max(1, width - padding * 2)) * 100
    : 50;
  const selectionBounds = dragStartIndex !== null && dragCurrentIndex !== null
    ? {
      start: Math.min(dragStartIndex, dragCurrentIndex),
      end: Math.max(dragStartIndex, dragCurrentIndex),
    }
    : null;
  const zoomLabel = zoomRange
    ? `${formatDateTime(buckets[zoomRange.start]?.bucketStart || null)} to ${formatDateTime(buckets[zoomRange.end]?.bucketEnd || null)}`
    : stats.range.label;
  const axisLabelStep = getAxisLabelStep(stats.range);

  const peakTokens = Math.max(0, ...visibleBuckets.map((bucket) => bucket.usage.totalTokens));
  const peakTime = Math.max(0, ...visibleBuckets.map((bucket) => bucket.usage.activeTimeMs));
  const peakInvocations = Math.max(0, ...visibleBuckets.map((bucket) => bucket.usage.invocationCount));
  const averageTokens = visibleBuckets.length > 0 ? Math.round(sumUsage(visibleBuckets.map((bucket) => ({
    id: bucket.bucketStart,
    label: bucket.label,
    secondaryLabel: null,
    status: null,
    purpose: null,
    provider: null,
    usage: bucket.usage,
    lastActivityAt: bucket.bucketEnd,
  }))).totalTokens / visibleBuckets.length) : 0;

  useEffect(() => {
    const handleMouseUp = () => {
      if (dragStartIndex === null || dragCurrentIndex === null) {
        return;
      }
      const start = Math.min(dragStartIndex, dragCurrentIndex);
      const end = Math.max(dragStartIndex, dragCurrentIndex);
      if (end - start >= 1) {
        setZoomRange({ start, end });
      }
      setDragStartIndex(null);
      setDragCurrentIndex(null);
    };

    globalThis.window.addEventListener("mouseup", handleMouseUp);
    return () => globalThis.window.removeEventListener("mouseup", handleMouseUp);
  }, [dragCurrentIndex, dragStartIndex]);

  useEffect(() => {
    setHoveredIndex(null);
    setZoomRange(null);
    setDragStartIndex(null);
    setDragCurrentIndex(null);
  }, [stats.range.from, stats.range.to, stats.range.resolution]);

  useLayoutEffect(() => {
    if (!panelRef.current) {
      return;
    }

    const paths = Array.from(panelRef.current.querySelectorAll<SVGPathElement>("[data-chart-path]"));
    const areas = Array.from(panelRef.current.querySelectorAll<SVGPathElement>("[data-chart-area]"));
    const points = Array.from(panelRef.current.querySelectorAll<SVGCircleElement>("[data-chart-point]"));
    const cards = Array.from(panelRef.current.querySelectorAll<HTMLElement>("[data-chart-card]"));

    const timeline = gsap.timeline();
    gsap.set(areas, { opacity: 0 });
    gsap.set(points, { opacity: 0, scale: 0.35, transformOrigin: "center center" });
    paths.forEach((path) => {
      const length = path.getTotalLength();
      gsap.set(path, { strokeDasharray: `${length} ${length}`, strokeDashoffset: length });
      timeline.to(path, { strokeDashoffset: 0, duration: 1.05, ease: "power3.out" }, 0);
    });
    timeline.to(areas, { opacity: (_index, target) => Number((target as SVGPathElement).dataset.areaOpacity || "0.3"), duration: 0.7, stagger: 0.08, ease: "power2.out" }, 0.18);
    timeline.to(points, { opacity: 1, scale: 1, duration: 0.38, stagger: 0.012, ease: "back.out(1.8)" }, 0.3);
    timeline.fromTo(cards, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.55, stagger: 0.05, ease: "power3.out" }, 0.18);

    return () => timeline.kill();
  }, [enabledSeries.tokens, enabledSeries.active, enabledSeries.invocations, visibleBuckets.length, stats.range.from, stats.range.to]);

  return (
    <div ref={panelRef} className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.08] to-transparent dark:via-white/[0.14]" />
      <div className="relative flex flex-col gap-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/72 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-300">
              <Activity className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
              Usage Graph
            </div>
            <div className="mt-4 text-3xl font-black tracking-tight text-slate-900 dark:text-white">
              {zoomRange ? "Zoomed telemetry window" : stats.range.label}
            </div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Normalized telemetry lines reveal shape instead of forcing tokens, duration, and invocation counts into one scale. Drag across the plot to zoom a timeframe, keep hourly hover precision, and use the legend to focus the graph.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:w-[27rem]">
            <div data-chart-card className={SUBPANEL_CLASS}>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Peak Tokens</div>
              <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{formatTokens(peakTokens)}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Highest bucket in view</div>
            </div>
            <div data-chart-card className={SUBPANEL_CLASS}>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Peak Time</div>
              <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{formatDuration(peakTime)}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Active model runtime</div>
            </div>
            <div data-chart-card className={SUBPANEL_CLASS}>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Average Tokens</div>
              <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{formatTokens(averageTokens)}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{stats.range.resolutionLabel}</div>
            </div>
            <div data-chart-card className={SUBPANEL_CLASS}>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Peak Invocations</div>
              <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{peakInvocations.toLocaleString()}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">CLI calls in one bucket</div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_22rem]">
          <div className={`${SUBPANEL_CLASS} p-4 md:p-5`}>
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Interactive Legend</div>
              <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                Hover buckets for exact values
              </div>
              <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                {zoomLabel}
              </div>
              {zoomRange ? (
                <button
                  type="button"
                  onClick={() => setZoomRange(null)}
                  className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white ${CHIP_CLASS}`}
                >
                  Reset zoom
                </button>
              ) : null}
            </div>
            <div className="relative">
              {activeBucket ? (
                <div
                  className="pointer-events-none absolute top-3 z-10 w-56 -translate-x-1/2 rounded-[1.25rem] border border-black/[0.06] bg-white/88 px-4 py-3 shadow-[0_18px_38px_rgba(15,23,42,0.12)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-900/88 dark:shadow-[0_20px_40px_rgba(0,0,0,0.32)]"
                  style={{ left: `${Math.min(92, Math.max(8, tooltipLeft))}%` }}
                >
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{activeBucket.label}</div>
                  <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{formatDateTime(activeBucket.bucketStart)}</div>
                  <div className="mt-3 space-y-2">
                    {visibleSeries.map((series) => (
                      <div key={`tooltip-${series.id}`} className="flex items-center justify-between gap-3 text-sm">
                        <div className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.accentHex }} />
                          {series.label}
                        </div>
                        <div className="font-black text-slate-900 dark:text-white">{series.formatter(series.values[activeIndex] ?? 0)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <svg viewBox={`0 0 ${width} ${height + 40}`} className="h-[24rem] w-full overflow-visible">
                <defs>
                  {chartData.map((series) => (
                    <linearGradient key={`fill-${series.id}`} id={`stats-area-${series.id}`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor={series.accentHex} stopOpacity="0.2" />
                      <stop offset="100%" stopColor={series.accentHex} stopOpacity="0" />
                    </linearGradient>
                  ))}
                </defs>
                {Array.from({ length: 5 }).map((_, index) => (
                  <line
                    key={`grid-${index}`}
                    x1={padding}
                    x2={width - padding}
                    y1={padding + ((height - padding * 2) / 4) * index}
                    y2={padding + ((height - padding * 2) / 4) * index}
                    stroke="currentColor"
                    strokeOpacity="0.08"
                  />
                ))}
                {selectionBounds && xPositions.length > 0 ? (
                  <rect
                    x={Math.max(padding, xPositions[Math.max(0, selectionBounds.start - viewStart)] ?? padding)}
                    y={padding}
                    width={Math.max(
                      12,
                      (xPositions[Math.max(0, selectionBounds.end - viewStart)] ?? width - padding)
                      - (xPositions[Math.max(0, selectionBounds.start - viewStart)] ?? padding),
                    )}
                    height={height - padding * 2}
                    rx="18"
                    fill="rgba(0,224,160,0.08)"
                    stroke="rgba(0,224,160,0.4)"
                    strokeDasharray="8 8"
                  />
                ) : null}
                {visibleSeries.map((series) => (
                  <g key={series.id}>
                    <path
                      data-chart-area
                      data-area-opacity={series.id === "tokens" ? "1" : "0.45"}
                      d={series.areaPath}
                      fill={`url(#stats-area-${series.id})`}
                      opacity={series.id === "tokens" ? 1 : 0.45}
                    />
                    <path
                      data-chart-path
                      d={series.path}
                      fill="none"
                      stroke={series.accentHex}
                      strokeWidth={series.id === "tokens" ? "4.2" : "3.1"}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="drop-shadow-[0_0_12px_rgba(0,0,0,0.12)]"
                    />
                  </g>
                ))}
                {hoveredIndex !== null && xPositions[hoveredIndex] ? (
                  <line
                    x1={xPositions[hoveredIndex]}
                    x2={xPositions[hoveredIndex]}
                    y1={padding}
                    y2={height - padding}
                    stroke="currentColor"
                    strokeOpacity="0.18"
                    strokeDasharray="6 8"
                  />
                ) : null}
                {visibleSeries.map((series) => (
                  series.points.map((point, index) => (
                    <circle
                      data-chart-point
                      key={`${series.id}-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r={hoveredIndex === index ? 5.2 : 3.2}
                      fill={series.accentHex}
                      fillOpacity={hoveredIndex === null || hoveredIndex === index ? 1 : 0.4}
                      className="transition-all duration-200"
                    />
                  ))
                ))}
                {xPositions.map((x, index) => {
                  const startX = index === 0 ? padding : (xPositions[index - 1]! + x) / 2;
                  const endX = index === xPositions.length - 1 ? width - padding : (x + xPositions[index + 1]!) / 2;
                  const rectWidth = Math.max(8, endX - startX);
                  const absoluteIndex = viewStart + index;
                  return (
                    <rect
                      key={`hover-${index}`}
                      x={startX}
                      y={padding}
                      width={rectWidth}
                      height={height - padding * 2}
                      fill="transparent"
                      onMouseDown={() => {
                        setDragStartIndex(absoluteIndex);
                        setDragCurrentIndex(absoluteIndex);
                      }}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseMove={() => {
                        if (dragStartIndex !== null) {
                          setDragCurrentIndex(absoluteIndex);
                        }
                      }}
                      onMouseLeave={() => setHoveredIndex(null)}
                      onMouseUp={() => {
                        if (dragStartIndex === null) {
                          return;
                        }
                        const start = Math.min(dragStartIndex, absoluteIndex);
                        const end = Math.max(dragStartIndex, absoluteIndex);
                        if (end - start >= 1) {
                          setZoomRange({ start, end });
                        }
                        setDragStartIndex(null);
                        setDragCurrentIndex(null);
                      }}
                    />
                  );
                })}
                {visibleBuckets.map((bucket, index) => (
                  (index % axisLabelStep === 0 || index === visibleBuckets.length - 1) ? (
                    <text
                      key={bucket.bucketStart}
                      x={xPositions[index] ?? padding}
                      y={height + 24}
                      textAnchor="middle"
                      className="fill-slate-400 text-[9px] font-bold uppercase tracking-[0.18em]"
                    >
                      {formatAxisLabel(bucket, stats.range)}
                    </text>
                  ) : null
                ))}
              </svg>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {chartData.map((series) => (
              <SeriesLegendButton
                key={series.id}
                series={series}
                active={enabledSeries[series.id]}
                currentValue={series.values[activeIndex] ?? 0}
                disabled={activeSeriesCount === 1 && enabledSeries[series.id]}
                onToggle={() => {
                  if (activeSeriesCount === 1 && enabledSeries[series.id]) {
                    return;
                  }
                  setEnabledSeries((current) => ({
                    ...current,
                    [series.id]: !current[series.id],
                  }));
                }}
              />
            ))}
            <div className={`${SUBPANEL_CLASS} p-5`}>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Focused Bucket</div>
              <div className="mt-3 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                {activeBucket ? activeBucket.label : "--"}
              </div>
              <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {activeBucket ? `${formatDateTime(activeBucket.bucketStart)} to ${formatDateTime(activeBucket.bucketEnd)}` : "No bucket data yet."}
              </div>
              <div className="mt-4 rounded-2xl border border-black/[0.05] bg-white/70 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-white/[0.05] dark:bg-void-900/40 dark:text-slate-300">
                {zoomRange
                  ? `${visibleBuckets.length} buckets in zoom`
                  : `${stats.range.bucketCount} buckets in ${stats.range.label.toLowerCase()}`}
              </div>
              {activeBucket ? (
                <div className="mt-5 space-y-3">
                  <div className="flex items-center justify-between rounded-2xl border border-signal-500/16 bg-signal-500/10 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-400">Tokens</div>
                    <div className="text-sm font-black text-slate-900 dark:text-white">{formatTokens(activeBucket.usage.totalTokens)}</div>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-amber-500/16 bg-amber-500/10 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">Active Time</div>
                    <div className="text-sm font-black text-slate-900 dark:text-white">{formatDuration(activeBucket.usage.activeTimeMs)}</div>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-cyan-500/16 bg-cyan-500/10 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-600 dark:text-cyan-400">Invocations</div>
                    <div className="text-sm font-black text-slate-900 dark:text-white">{activeBucket.usage.invocationCount.toLocaleString()}</div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const DonutCard: FunctionComponent<{
  title: string;
  eyebrow: string;
  description: string;
  centerValue: string;
  centerLabel: string;
  segments: SegmentDefinition[];
}> = ({ title, eyebrow, description, centerValue, centerLabel, segments }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<SVGSVGElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const slices = useMemo(() => buildDonutSlices(segments), [segments]);
  const activeSegment = hoveredIndex === null ? null : slices[hoveredIndex] || null;

  useLayoutEffect(() => {
    if (!cardRef.current || !wheelRef.current) {
      return;
    }

    const items = Array.from(cardRef.current.querySelectorAll("[data-donut-item]"));
    const sliceNodes = Array.from(cardRef.current.querySelectorAll("[data-donut-slice]"));
    const timeline = gsap.timeline();
    timeline
      .fromTo(wheelRef.current, { opacity: 0, scale: 0.84, rotate: -14 }, { opacity: 1, scale: 1, rotate: 0, duration: 0.85, ease: "power4.out" })
      .fromTo(sliceNodes, { opacity: 0, scale: 0.86, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.42, stagger: 0.05, ease: "power3.out" }, "-=0.52")
      .fromTo(items, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: "power3.out" }, "-=0.3");
    return () => timeline.kill();
  }, [segments.length]);

  return (
    <div ref={cardRef} className={`${PANEL_CLASS} h-full p-6`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.08] to-transparent dark:via-white/[0.14]" />
      <div className="relative flex h-full flex-col gap-6">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{eyebrow}</div>
          <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</div>
          <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description}</div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-center">
          <div className="flex items-center justify-center">
            <div className="relative h-60 w-60">
              <svg
                ref={wheelRef}
                viewBox="0 0 240 240"
                className="h-full w-full overflow-visible"
              >
                <defs>
                  <filter id="stats-donut-glow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="8" result="blur" />
                    <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.28 0" />
                    <feBlend in="SourceGraphic" />
                  </filter>
                </defs>
                <circle cx="120" cy="120" r="103" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" />
                {slices.map((slice, index) => {
                  const radians = ((slice.midAngle - 90) * Math.PI) / 180;
                  const offsetX = hoveredIndex === index ? Math.cos(radians) * 7 : 0;
                  const offsetY = hoveredIndex === index ? Math.sin(radians) * 7 : 0;
                  return (
                    <path
                      data-donut-slice
                      key={slice.label}
                      d={slice.path}
                      fill={slice.color}
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth={hoveredIndex === index ? 3 : 1.2}
                      filter={hoveredIndex === index ? "url(#stats-donut-glow)" : undefined}
                      style={{
                        transform: `translate(${offsetX}px, ${offsetY}px)`,
                        transformOrigin: "120px 120px",
                        opacity: hoveredIndex === null || hoveredIndex === index ? 1 : 0.58,
                        transition: "transform 220ms ease, opacity 220ms ease, stroke-width 220ms ease",
                      }}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                    />
                  );
                })}
              </svg>
              <div className="pointer-events-none absolute inset-[24%] rounded-full border border-black/[0.05] bg-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/88 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_12px_28px_rgba(0,0,0,0.28)]" />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                  {activeSegment ? formatTokens(activeSegment.value) : centerValue}
                </div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  {activeSegment ? activeSegment.label : centerLabel}
                </div>
                <div className="mt-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {activeSegment ? `${formatPercent(activeSegment.share)} of visible volume` : `${segments.length} lanes`}
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {segments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-8 text-center text-sm text-slate-400 dark:border-white/[0.08]">
                No telemetry landed in this composition yet.
              </div>
            ) : slices.map((segment, index) => {
              return (
                <div
                  key={segment.label}
                  data-donut-item
                  className={`${SUBPANEL_CLASS} transition-transform duration-300 ${hoveredIndex === index ? "translate-x-1 border-white/[0.12] dark:border-white/[0.12]" : ""}`}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                        <span className={`truncate text-sm font-semibold ${segment.textClassName}`}>{segment.label}</span>
                      </div>
                      <div className="mt-1 text-[11px] font-mono text-slate-400 dark:text-slate-500">
                        {formatPercent(segment.share)} of visible volume
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-slate-900 dark:text-white">{formatTokens(segment.value)}</div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">tokens</div>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.06]">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${Math.max(6, segment.share)}%`,
                        backgroundColor: segment.color,
                        opacity: hoveredIndex === null || hoveredIndex === index ? 1 : 0.72,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const PurposeRibbon: FunctionComponent<{
  purposes: ExecutionStatsEntitySummary[];
}> = ({ purposes }) => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
    {purposes.slice(0, 4).map((purpose, index) => {
      const tones = [
        "bg-signal-500/10 text-signal-600 dark:text-signal-400",
        "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        "bg-slate-500/10 text-slate-600 dark:text-slate-300",
      ];
      return (
        <div key={purpose.id} className={`${SUBPANEL_CLASS} p-5`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              {purpose.label.replace(/_/g, " ")}
            </div>
            <div className={`inline-flex h-8 w-8 items-center justify-center rounded-2xl ${tones[index % tones.length]!}`}>
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            </div>
          </div>
          <div className="mt-4 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            {formatTokens(purpose.usage.totalTokens)}
          </div>
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {formatDuration(purpose.usage.activeTimeMs)} active time
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <TokenChip icon={ArrowDownRight} label="In" value={purpose.usage.inputTokens} tone="border-black/[0.06] bg-white/72 text-slate-600 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-300" />
            <TokenChip icon={ArrowUpRight} label="Out" value={purpose.usage.outputTokens} tone="border-black/[0.06] bg-white/72 text-slate-600 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-300" />
          </div>
        </div>
      );
    })}
  </div>
);

const StudioHeader: FunctionComponent<{
  icon: typeof Activity;
  eyebrow: string;
  title: string;
  description: string;
}> = ({ icon: Icon, eyebrow, title, description }) => (
  <div className="max-w-3xl">
    <div className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/72 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-300">
      <Icon className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
      {eyebrow}
    </div>
    <div className="mt-4 text-3xl font-black tracking-tight text-slate-900 dark:text-white">{title}</div>
    <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description}</div>
  </div>
);

const TrendStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  planningUsage: ExecutionStatsEntitySummary | null;
}> = ({ stats, planningUsage }) => (
  <section className="space-y-6">
    <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
      <div className="flex flex-col gap-6">
        <StudioHeader
          icon={Activity}
          eyebrow="Analysis Studio"
          title="Trend analysis"
          description="A single interactive telemetry surface for flow, peaks, and pacing across the selected window."
        />
        <InteractiveUsageChart stats={stats} />
      </div>
    </div>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div className={`${PANEL_CLASS} p-6`}>
        <div className="flex items-center gap-3">
          <Workflow className="h-4 w-4 text-signal-500" strokeWidth={2} />
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Execution Lanes</div>
        </div>
        <div className="mt-4 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Purpose mix</div>
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Planning, coding, merge recovery, and CI repair are now visible as a unified telemetry system rather than separate operational silos.
        </div>
        <div className="mt-5">
          <PurposeRibbon purposes={stats.purposes} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6">
        <div className={`${PANEL_CLASS} p-6`}>
          <div className="flex items-center gap-3">
            <Layers3 className="h-4 w-4 text-amber-500" strokeWidth={2} />
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Sprint Focus</div>
          </div>
          <div className="mt-4 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            {stats.activeSprint ? stats.activeSprint.sprintName : "Historical view"}
          </div>
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {stats.activeSprint
                ? `Sprint ${stats.activeSprint.sprintNumber ?? "?"} is the live telemetry anchor for this project.`
                : "No live sprint is active, so the dashboard is reading the selected historical window only."}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <div className={SUBPANEL_CLASS}>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Planning</div>
              <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{planningUsage ? formatTokens(planningUsage.usage.totalTokens) : "0"}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{planningUsage ? formatDuration(planningUsage.usage.activeTimeMs) : "No planning data yet"}</div>
            </div>
            <div className={SUBPANEL_CLASS}>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Providers</div>
              <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{stats.providers.length}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Active in {stats.range.label.toLowerCase()}</div>
            </div>
          </div>
        </div>
        <div className={`${PANEL_CLASS} p-6`}>
          <div className="flex items-center gap-3">
            <Clock3 className="h-4 w-4 text-cyan-500" strokeWidth={2} />
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Window Discipline</div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className={SUBPANEL_CLASS}>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Buckets</div>
              <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{stats.buckets.length}</div>
            </div>
            <div className={SUBPANEL_CLASS}>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Generated</div>
              <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{formatDateTime(stats.generatedAt)}</div>
            </div>
            <div className={SUBPANEL_CLASS}>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Window</div>
              <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{stats.range.label}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const CompositionStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  providerSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
}> = ({ stats, providerSegments, tokenSegments }) => (
  <section className="space-y-6">
    <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
      <div className="flex flex-col gap-6">
        <StudioHeader
          icon={PieChart}
          eyebrow="Analysis Studio"
          title="Composition analysis"
          description="Read provider distribution, token anatomy, and execution purpose concentration inside one focused composition workspace."
        />
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.05fr_0.95fr]">
          <DonutCard
            title="Provider Share"
            eyebrow="Composition"
            description="Provider token split grouped into visible lanes for faster reading at high volume."
            centerValue={String(stats.providers.length)}
            centerLabel="providers"
            segments={providerSegments}
          />
          <DonutCard
            title="Token Anatomy"
            eyebrow="Flow Mix"
            description="Input, cached, output, and reasoning balance across the selected telemetry window."
            centerValue={formatTokens(stats.usage.totalTokens)}
            centerLabel="token mix"
            segments={tokenSegments}
          />
        </div>
      </div>
    </div>
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
      <div className={`${PANEL_CLASS} p-6`}>
        <div className="flex items-center gap-3">
          <Workflow className="h-4 w-4 text-signal-500" strokeWidth={2} />
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Purpose Architecture</div>
        </div>
        <div className="mt-4 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Execution purposes</div>
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Composition mode emphasizes where effort is going, not just how much of it happened.
        </div>
        <div className="mt-5">
          <PurposeRibbon purposes={stats.purposes} />
        </div>
      </div>
      <div className={`${PANEL_CLASS} p-6`}>
        <div className="flex items-center gap-3">
          <TimerReset className="h-4 w-4 text-amber-500" strokeWidth={2} />
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Token Flight</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-signal-500/16 bg-signal-500/10 p-4">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-400">
              <ArrowDownRight className="h-3.5 w-3.5" strokeWidth={2.1} />
              Input
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{formatTokens(stats.usage.inputTokens)}</div>
          </div>
          <div className="rounded-2xl border border-cyan-500/16 bg-cyan-500/10 p-4">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-600 dark:text-cyan-400">
              <Database className="h-3.5 w-3.5" strokeWidth={2.1} />
              Cached
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{formatTokens(stats.usage.cachedInputTokens)}</div>
          </div>
          <div className="rounded-2xl border border-amber-500/16 bg-amber-500/10 p-4">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">
              <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.1} />
              Output
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{formatTokens(stats.usage.outputTokens)}</div>
          </div>
          <div className="rounded-2xl border border-rose-500/16 bg-rose-500/10 p-4">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-rose-600 dark:text-rose-400">
              <Brain className="h-3.5 w-3.5" strokeWidth={2.1} />
              Reasoning
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{formatTokens(stats.usage.reasoningOutputTokens)}</div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const ReliabilityStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  providerSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
}> = ({ stats, providerSegments, sourceSegments }) => (
  <section className="space-y-6">
    <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
      <div className="flex flex-col gap-6">
        <StudioHeader
          icon={ShieldCheck}
          eyebrow="Analysis Studio"
          title="Reliability analysis"
          description="Read confidence, fallback pressure, and provider contribution inside one audit-focused telemetry workspace."
        />
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.05fr_0.95fr]">
          <DonutCard
            title="Telemetry Source Mix"
            eyebrow="Reliability"
            description="Provider-reported versus estimated, unavailable, and unsupported usage across the selected window."
            centerValue={String(stats.tokenSources.reduce((sum, entry) => sum + entry.count, 0))}
            centerLabel="invocations"
            segments={sourceSegments}
          />
          <DonutCard
            title="Provider Share"
            eyebrow="Signal Integrity"
            description="Provider leaders over the selected period, grouped for a cleaner read under high volume."
            centerValue={formatTokens(stats.usage.totalTokens)}
            centerLabel="token volume"
            segments={providerSegments}
          />
        </div>
      </div>
    </div>
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
      <div className={`${PANEL_CLASS} p-6`}>
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-4 w-4 text-status-green" strokeWidth={2} />
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Confidence Board</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-status-green/16 bg-status-green/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-status-green">Reported</div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.reportedInvocationCount}</div>
          </div>
          <div className="rounded-2xl border border-amber-500/16 bg-amber-500/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">Estimated</div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.estimatedInvocationCount}</div>
          </div>
          <div className="rounded-2xl border border-rose-500/16 bg-rose-500/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-600 dark:text-rose-400">Unavailable</div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.unavailableInvocationCount}</div>
          </div>
          <div className="rounded-2xl border border-slate-500/16 bg-slate-500/10 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Unsupported</div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{stats.usage.unsupportedInvocationCount}</div>
          </div>
        </div>
      </div>
      <div className={`${PANEL_CLASS} p-6`}>
        <div className="flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-amber-500" strokeWidth={2} />
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Audit Notes</div>
        </div>
        <div className="mt-4 space-y-4">
          <div className={SUBPANEL_CLASS}>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Fallback policy</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Codex and Claude stay visible even when they cannot report authoritative token counts, but the dashboard explicitly keeps those invocations marked as estimated rather than pretending they are exact.
            </div>
          </div>
          <div className={SUBPANEL_CLASS}>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Reliability signal</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Reliability mode is tuned for operational trust: how much of the window is exact, how much came from fallback, and where unsupported providers still participate in time tracking without token precision.
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const SortButton: FunctionComponent<{
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ label, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] transition-all ${
      active
        ? "bg-slate-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.12)] dark:bg-white dark:text-void-900"
        : `${CHIP_CLASS} text-slate-500 dark:text-slate-300`
    }`}
  >
    {label}
  </button>
);

const TelemetryLedger: FunctionComponent<{
  title: string;
  eyebrow: string;
  items: ExecutionStatsEntitySummary[];
  kindLabel: string;
  emptyLabel: string;
  defaultSortKey?: LedgerSortKey;
}> = ({
  title,
  eyebrow,
  items,
  kindLabel,
  emptyLabel,
  defaultSortKey = "tokens",
}) => {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<LedgerSortKey>(defaultSortKey);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const base = normalizedQuery.length === 0
      ? items
      : items.filter((item) => {
        const haystack = [
          item.label,
          item.secondaryLabel || "",
          item.status || "",
          item.provider || "",
          item.purpose || "",
        ].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      });

    return [...base].sort((left, right) => {
      const leftValue = getLedgerSortValue(left, sortKey);
      const rightValue = getLedgerSortValue(right, sortKey);

      if (typeof leftValue === "string" && typeof rightValue === "string") {
        return leftValue.localeCompare(rightValue);
      }

      return Number(rightValue) - Number(leftValue);
    });
  }, [items, query, sortKey]);

  const {
    visibleItems,
    sentinelRef,
    scrollContainerRef,
  } = useProgressiveList(filteredItems, { initialCount: 12, stepCount: 8 });

  const topTokens = filteredItems[0]?.usage.totalTokens ?? 0;
  const topTime = filteredItems[0]?.usage.activeTimeMs ?? 0;

  return (
    <div className={`${PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{eyebrow}</div>
            <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Search, sort, and compare {kindLabel} by recency, tokens, active time, and directional token flow.
            </div>
          </div>
          <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
            {filteredItems.length} {kindLabel}
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <input
            type="text"
            value={query}
            onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
            placeholder={`Search ${kindLabel}`}
            className={INPUT_CLASS}
          />
          <div className="flex flex-wrap gap-2">
            {([
              ["last", "Latest"],
              ["tokens", "Tokens"],
              ["active", "Active"],
              ["input", "Input"],
              ["output", "Output"],
              ["name", "Name"],
            ] as const).map(([value, label]) => (
              <SortButton
                key={value}
                label={label}
                active={sortKey === value}
                onClick={() => setSortKey(value)}
              />
            ))}
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-12 text-center text-sm text-slate-400 dark:border-white/[0.08]">
            {emptyLabel}
          </div>
        ) : (
          <div ref={scrollContainerRef} className="max-h-[42rem] overflow-y-auto pr-2 dashboard-scrollbar">
            <div className="space-y-3">
              {visibleItems.map((item, index) => {
                const tokenShare = topTokens > 0 ? (item.usage.totalTokens / topTokens) * 100 : 0;
                const timeShare = topTime > 0 ? (item.usage.activeTimeMs / topTime) * 100 : 0;
                return (
                  <div key={item.id} className={LEDGER_ROW_CLASS}>
                    <div className="flex items-start gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-black/[0.06] bg-white/75 text-sm font-black text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.07)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/55 dark:text-white dark:shadow-[0_12px_28px_rgba(0,0,0,0.22)]">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0">
                            <div className="truncate text-base font-black tracking-tight text-slate-900 dark:text-white">{item.label}</div>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {item.secondaryLabel ? (
                                <span className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                                  {item.secondaryLabel}
                                </span>
                              ) : null}
                              {item.status ? (
                                <span className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                                  {item.status}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="text-left xl:text-right">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Last activity</div>
                            <div className="mt-1 text-sm font-black text-slate-900 dark:text-white">{formatDateTime(item.lastActivityAt)}</div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <div className="grid grid-cols-3 gap-3">
                            <div className={SUBPANEL_CLASS}>
                              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Total</div>
                              <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{formatTokens(item.usage.totalTokens)}</div>
                            </div>
                            <div className={SUBPANEL_CLASS}>
                              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Active</div>
                              <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{formatDuration(item.usage.activeTimeMs)}</div>
                            </div>
                            <div className={SUBPANEL_CLASS}>
                              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Calls</div>
                              <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{item.usage.invocationCount.toLocaleString()}</div>
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                              <span>Token share</span>
                              <span>{formatPercent(tokenShare)}</span>
                            </div>
                            <div className="mt-2 h-2.5 rounded-full bg-black/[0.05] dark:bg-white/[0.06]">
                              <div
                                className="h-2.5 rounded-full bg-[linear-gradient(90deg,rgba(0,224,160,0.92),rgba(14,165,233,0.92))]"
                                style={{ width: `${Math.max(6, tokenShare)}%` }}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                              <span>Active time share</span>
                              <span>{formatPercent(timeShare)}</span>
                            </div>
                            <div className="mt-2 h-2.5 rounded-full bg-black/[0.05] dark:bg-white/[0.06]">
                              <div
                                className="h-2.5 rounded-full bg-[linear-gradient(90deg,rgba(255,184,0,0.92),rgba(251,113,133,0.92))]"
                                style={{ width: `${Math.max(6, timeShare)}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <TokenChip icon={ArrowDownRight} label="In" value={item.usage.inputTokens} tone="border-signal-500/16 bg-signal-500/8 text-signal-600 dark:text-signal-400" />
                          <TokenChip icon={Database} label="Cached" value={item.usage.cachedInputTokens} tone="border-cyan-500/16 bg-cyan-500/8 text-cyan-600 dark:text-cyan-400" />
                          <TokenChip icon={ArrowUpRight} label="Out" value={item.usage.outputTokens} tone="border-amber-500/16 bg-amber-500/8 text-amber-600 dark:text-amber-400" />
                          <TokenChip icon={Brain} label="Reason" value={item.usage.reasoningOutputTokens} tone="border-rose-500/16 bg-rose-500/8 text-rose-600 dark:text-rose-400" />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {visibleItems.length < filteredItems.length ? (
                <div ref={sentinelRef} className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-4 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:border-white/[0.08]">
                  Loading more telemetry lanes...
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const StatsPageHero: FunctionComponent<any> = ({ selectedProject, stats, activeQuery, customFrom, customTo, applyPresetWindow, setCustomFrom, setCustomTo, applyCustomRange }) => {
  return (
    <section className={`${PANEL_CLASS} rounded-[2.5rem] p-8 md:p-10`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.08] to-transparent dark:via-white/[0.14]" />
      <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-signal-600 dark:text-signal-400">
            <BarChart3 className="h-3.5 w-3.5" strokeWidth={2.2} />
            Telemetry Atlas
          </div>
          <h1 className="mt-6 text-5xl font-black tracking-[-0.06em] text-slate-900 dark:text-white md:text-7xl">
            Statistics.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-relaxed text-slate-500 dark:text-slate-400">
            A high-signal telemetry workspace for planning, coding, CI recovery, and merge automation with deeper analysis, stronger interaction, and better operational usability.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <div className={`px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
              {selectedProject?.name || "No project selected"}
            </div>
            <div className={`px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
              {stats?.activeSprint ? `Live sprint ${stats.activeSprint.sprintNumber ?? "?"}` : "Historical lens"}
            </div>
            <div className={`px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
              Generated {stats ? formatDateTime(stats.generatedAt) : "--"}
            </div>
            {stats ? (
              <div className={`px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                {stats.range.resolutionLabel}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-start gap-4 xl:items-end">
          <RangeToggle
            activeWindow={activeQuery.window}
            customFrom={customFrom}
            customTo={customTo}
            onSelectPreset={applyPresetWindow}
            onCustomFromChange={setCustomFrom}
            onCustomToChange={setCustomTo}
            onApplyCustom={applyCustomRange}
          />
        </div>
      </div>
    </section>
  );
};
