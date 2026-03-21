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
import { MetricCard } from "./components/ui/MetricCard.js";
import { Sparkline } from "./components/ui/Sparkline.js";
import { useProjectData } from "./context/project-data.js";
import { useProjectStats } from "./hooks/use-project-stats.js";
import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageBucketSummary,
  ExecutionUsageTotals,
  ProjectExecutionStatsSnapshot,
  ProjectStatsWindow,
} from "./types.js";

type StatsVisualMode = "trend" | "composition" | "reliability";
type ChartSeriesId = "tokens" | "active" | "invocations";
type LedgerSortKey = "last" | "tokens" | "active" | "input" | "output" | "name";

interface SegmentDefinition {
  label: string;
  value: number;
  color: string;
  textClassName: string;
}

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

const EMPTY_USAGE: ExecutionUsageTotals = {
  invocationCount: 0,
  activeTimeMs: 0,
  wallTimeMs: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
  reportedInvocationCount: 0,
  estimatedInvocationCount: 0,
  unavailableInvocationCount: 0,
  unsupportedInvocationCount: 0,
};

const PANEL_CLASS = "relative overflow-hidden rounded-[1.9rem] border border-black/[0.06] bg-white/70 p-6 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]";
const SUBPANEL_CLASS = "rounded-[1.45rem] border border-black/[0.05] bg-white/68 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.045)] backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)]";
const CHIP_CLASS = "rounded-full border border-black/[0.06] bg-white/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/55 dark:shadow-[0_1px_3px_rgba(0,0,0,0.18)]";
const INPUT_CLASS = "h-11 rounded-2xl border border-black/[0.06] bg-white/72 px-4 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-200";
const LEDGER_ROW_CLASS = "group rounded-[1.5rem] border border-black/[0.05] bg-white/68 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.045)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-signal-500/18 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)] dark:border-white/[0.05] dark:bg-void-900/35 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)] dark:hover:bg-void-900/45";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

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

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return value.toLocaleString();
}

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.round(value / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "No activity yet";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return DATE_TIME_FORMATTER.format(date);
}

function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return DAY_FORMATTER.format(date);
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

function buildAreaPath(points: ChartPoint[], height: number, padding: number): string {
  if (points.length === 0) {
    return "";
  }
  const start = points[0]!;
  const end = points[points.length - 1]!;
  return `${buildPath(points)} L ${end.x.toFixed(2)} ${(height - padding).toFixed(2)} L ${start.x.toFixed(2)} ${(height - padding).toFixed(2)} Z`;
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

function createSeries(
  buckets: ExecutionUsageBucketSummary[],
  selector: (bucket: ExecutionUsageBucketSummary) => number,
): number[] {
  const values = buckets.map(selector);
  return values.some((value) => value > 0) ? values : new Array(Math.max(buckets.length, 7)).fill(0);
}

function buildConicGradient(segments: SegmentDefinition[]): string {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  if (total <= 0) {
    return "conic-gradient(rgba(148,163,184,0.24) 0deg 360deg)";
  }
  let cursor = 0;
  const parts = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const start = cursor;
      cursor += (segment.value / total) * 360;
      return `${segment.color} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`;
    });
  return `conic-gradient(${parts.join(", ")})`;
}

function sumUsage(items: ExecutionStatsEntitySummary[]): ExecutionUsageTotals {
  return items.reduce<ExecutionUsageTotals>((accumulator, item) => ({
    invocationCount: accumulator.invocationCount + item.usage.invocationCount,
    activeTimeMs: accumulator.activeTimeMs + item.usage.activeTimeMs,
    wallTimeMs: accumulator.wallTimeMs + item.usage.wallTimeMs,
    inputTokens: accumulator.inputTokens + item.usage.inputTokens,
    cachedInputTokens: accumulator.cachedInputTokens + item.usage.cachedInputTokens,
    outputTokens: accumulator.outputTokens + item.usage.outputTokens,
    reasoningOutputTokens: accumulator.reasoningOutputTokens + item.usage.reasoningOutputTokens,
    totalTokens: accumulator.totalTokens + item.usage.totalTokens,
    reportedInvocationCount: accumulator.reportedInvocationCount + item.usage.reportedInvocationCount,
    estimatedInvocationCount: accumulator.estimatedInvocationCount + item.usage.estimatedInvocationCount,
    unavailableInvocationCount: accumulator.unavailableInvocationCount + item.usage.unavailableInvocationCount,
    unsupportedInvocationCount: accumulator.unsupportedInvocationCount + item.usage.unsupportedInvocationCount,
  }), { ...EMPTY_USAGE });
}

function groupSegments(
  items: ExecutionStatsEntitySummary[],
  options: {
    top?: number;
    colorPalette: string[];
    fallbackLabel: string;
  },
): SegmentDefinition[] {
  const sorted = [...items].sort((left, right) => right.usage.totalTokens - left.usage.totalTokens);
  const topCount = options.top ?? sorted.length;
  const head = sorted.slice(0, topCount);
  const tail = sorted.slice(topCount);

  const segments = head.map((item, index) => ({
    label: item.label,
    value: item.usage.totalTokens,
    color: options.colorPalette[index % options.colorPalette.length]!,
    textClassName: [
      "text-signal-600 dark:text-signal-400",
      "text-amber-600 dark:text-amber-400",
      "text-cyan-600 dark:text-cyan-400",
      "text-rose-600 dark:text-rose-400",
      "text-emerald-600 dark:text-emerald-400",
    ][index % 5] || "text-slate-600 dark:text-slate-300",
  }));

  if (tail.length > 0) {
    segments.push({
      label: options.fallbackLabel,
      value: sumUsage(tail).totalTokens,
      color: "rgba(148,163,184,0.46)",
      textClassName: "text-slate-600 dark:text-slate-300",
    });
  }

  return segments.filter((segment) => segment.value > 0);
}

function getWindowLabel(window: ProjectStatsWindow): string {
  return window === "24h" ? "Last 24 hours" : "Last 7 days";
}

function getWindowResolutionLabel(window: ProjectStatsWindow): string {
  return window === "24h" ? "Hourly telemetry buckets" : "Daily telemetry buckets";
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
  window: ProjectStatsWindow;
  onChange: (value: ProjectStatsWindow) => void;
}> = ({ window, onChange }) => (
  <div className={`inline-flex p-1 ${CHIP_CLASS}`}>
    {(["24h", "7d"] as const).map((value) => (
      <button
        key={value}
        type="button"
        onClick={() => onChange(value)}
        className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.22em] transition-all ${
          window === value
            ? "bg-void-900 text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] dark:bg-white dark:text-void-900"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        }`}
      >
        {value}
      </button>
    ))}
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
  buckets: ExecutionUsageBucketSummary[];
  window: ProjectStatsWindow;
}> = ({ buckets, window }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [enabledSeries, setEnabledSeries] = useState<Record<ChartSeriesId, boolean>>({
    tokens: true,
    active: true,
    invocations: true,
  });

  const width = 900;
  const height = 340;
  const padding = 34;

  const chartData = useMemo(() => {
    return CHART_SERIES.map((series) => {
      const values = buckets.map(series.accessor);
      const points = buildPoints(values.length > 0 ? values : [0], width, height, padding);
      return {
        ...series,
        values,
        points,
        path: buildPath(points),
        areaPath: buildAreaPath(points, height, padding),
        max: Math.max(...(values.length > 0 ? values : [0]), 1),
      };
    });
  }, [buckets]);

  const visibleSeries = chartData.filter((series) => enabledSeries[series.id]);
  const activeSeriesCount = visibleSeries.length;
  const activeIndex = hoveredIndex ?? (buckets.length > 0 ? buckets.length - 1 : 0);
  const activeBucket = buckets[activeIndex] ?? null;
  const xPositions = chartData[0]?.points.map((point) => point.x) ?? [];
  const tooltipLeft = xPositions[activeIndex]
    ? ((xPositions[activeIndex]! - padding) / Math.max(1, width - padding * 2)) * 100
    : 50;

  const peakTokens = Math.max(0, ...buckets.map((bucket) => bucket.usage.totalTokens));
  const peakTime = Math.max(0, ...buckets.map((bucket) => bucket.usage.activeTimeMs));
  const peakInvocations = Math.max(0, ...buckets.map((bucket) => bucket.usage.invocationCount));
  const averageTokens = buckets.length > 0 ? Math.round(sumUsage(buckets.map((bucket) => ({
    id: bucket.bucketStart,
    label: bucket.label,
    secondaryLabel: null,
    status: null,
    purpose: null,
    provider: null,
    usage: bucket.usage,
    lastActivityAt: bucket.bucketEnd,
  }))).totalTokens / buckets.length) : 0;

  useLayoutEffect(() => {
    if (!panelRef.current) {
      return;
    }

    const paths = Array.from(panelRef.current.querySelectorAll<SVGPathElement>("[data-chart-path]"));
    const cards = Array.from(panelRef.current.querySelectorAll<HTMLElement>("[data-chart-card]"));

    const timeline = gsap.timeline();
    paths.forEach((path) => {
      const length = path.getTotalLength();
      gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
      timeline.to(path, { strokeDashoffset: 0, duration: 0.9, ease: "power3.out" }, 0);
    });
    timeline.fromTo(cards, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.55, stagger: 0.05, ease: "power3.out" }, 0.18);

    return () => timeline.kill();
  }, [window, enabledSeries.tokens, enabledSeries.active, enabledSeries.invocations, buckets.length]);

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
              {getWindowLabel(window)}
            </div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Normalized telemetry lines reveal shape instead of forcing tokens, duration, and invocation counts into one scale. Hover any bucket for exact values and use the legend to focus the graph.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:w-[27rem]">
            <div data-chart-card className={SUBPANEL_CLASS}>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Peak Tokens</div>
              <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{formatTokens(peakTokens)}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Highest bucket in {window}</div>
            </div>
            <div data-chart-card className={SUBPANEL_CLASS}>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Peak Time</div>
              <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{formatDuration(peakTime)}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Active model runtime</div>
            </div>
            <div data-chart-card className={SUBPANEL_CLASS}>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Average Tokens</div>
              <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{formatTokens(averageTokens)}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{getWindowResolutionLabel(window)}</div>
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
                {visibleSeries.map((series) => (
                  <g key={series.id}>
                    <path d={series.areaPath} fill={`url(#stats-area-${series.id})`} opacity={series.id === "tokens" ? 1 : 0.45} />
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
                  return (
                    <rect
                      key={`hover-${index}`}
                      x={startX}
                      y={padding}
                      width={rectWidth}
                      height={height - padding * 2}
                      fill="transparent"
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                    />
                  );
                })}
                {buckets.map((bucket, index) => (
                  <text
                    key={bucket.bucketStart}
                    x={xPositions[index] ?? padding}
                    y={height + 24}
                    textAnchor="middle"
                    className="fill-slate-400 text-[9px] font-bold uppercase tracking-[0.18em]"
                  >
                    {window === "24h" ? bucket.label : formatDay(bucket.bucketStart)}
                  </text>
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
  const wheelRef = useRef<HTMLDivElement>(null);
  const gradient = useMemo(() => buildConicGradient(segments), [segments]);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  useLayoutEffect(() => {
    if (!cardRef.current || !wheelRef.current) {
      return;
    }

    const items = Array.from(cardRef.current.querySelectorAll("[data-donut-item]"));
    const timeline = gsap.timeline();
    timeline
      .fromTo(wheelRef.current, { opacity: 0, scale: 0.84, rotate: -14 }, { opacity: 1, scale: 1, rotate: 0, duration: 0.85, ease: "power4.out" })
      .fromTo(items, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: "power3.out" }, "-=0.44");
    return () => timeline.kill();
  }, [gradient, segments.length]);

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
            <div
              ref={wheelRef}
              className="relative h-56 w-56 rounded-full border border-white/30 shadow-[inset_0_0_60px_rgba(255,255,255,0.12),0_24px_60px_rgba(15,23,42,0.12)] dark:border-white/[0.16] dark:shadow-[inset_0_0_60px_rgba(255,255,255,0.08),0_28px_60px_rgba(0,0,0,0.28)]"
              style={{ backgroundImage: gradient }}
            >
              <div className="absolute inset-[18%] rounded-full border border-black/[0.05] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(247,244,237,0.82))] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:border-white/[0.05] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,8,23,0.86))]" />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">{centerValue}</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{centerLabel}</div>
                <div className="mt-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">{segments.length} lanes</div>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {segments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-8 text-center text-sm text-slate-400 dark:border-white/[0.08]">
                No telemetry landed in this composition yet.
              </div>
            ) : segments.map((segment) => {
              const share = total > 0 ? (segment.value / total) * 100 : 0;
              return (
                <div key={segment.label} data-donut-item className={SUBPANEL_CLASS}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                        <span className={`truncate text-sm font-semibold ${segment.textClassName}`}>{segment.label}</span>
                      </div>
                      <div className="mt-1 text-[11px] font-mono text-slate-400 dark:text-slate-500">{formatPercent(share)} of visible volume</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-slate-900 dark:text-white">{formatTokens(segment.value)}</div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">tokens</div>
                    </div>
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
  window: ProjectStatsWindow;
  planningUsage: ExecutionStatsEntitySummary | null;
}> = ({ stats, window, planningUsage }) => (
  <section className="space-y-6">
    <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
      <div className="flex flex-col gap-6">
        <StudioHeader
          icon={Activity}
          eyebrow="Analysis Studio"
          title="Trend analysis"
          description="A single interactive telemetry surface for flow, peaks, and pacing across the selected window."
        />
        <InteractiveUsageChart buckets={stats.buckets} window={window} />
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
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Active in {stats.window}</div>
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
              <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{getWindowLabel(stats.window)}</div>
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<LedgerSortKey>(defaultSortKey);
  const [visibleCount, setVisibleCount] = useState(12);

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

  useEffect(() => {
    setVisibleCount(Math.min(12, filteredItems.length));
  }, [filteredItems.length, sortKey, query]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || visibleCount >= filteredItems.length) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry?.isIntersecting) {
        return;
      }
      setVisibleCount((current) => Math.min(filteredItems.length, current + 8));
    }, {
      root,
      rootMargin: "120px 0px 120px 0px",
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredItems.length, visibleCount]);

  const visibleItems = filteredItems.slice(0, visibleCount);
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
          <div ref={scrollRef} className="max-h-[42rem] overflow-y-auto pr-2 dashboard-scrollbar">
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
              {visibleCount < filteredItems.length ? (
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

function createStatsSegments(stats: ProjectExecutionStatsSnapshot | null, usage: ExecutionUsageTotals): {
  providerSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
} {
  const providerSegments = groupSegments(stats?.providers || [], {
    top: 5,
    colorPalette: [
      "rgba(0,224,160,0.9)",
      "rgba(255,184,0,0.88)",
      "rgba(0,170,255,0.9)",
      "rgba(251,113,133,0.88)",
      "rgba(20,184,166,0.9)",
    ],
    fallbackLabel: "Other providers",
  });

  const sourceSegments: SegmentDefinition[] = (stats?.tokenSources || []).map((entry, index) => ({
    label: entry.source,
    value: entry.count,
    color: [
      "rgba(0,224,160,0.9)",
      "rgba(255,184,0,0.9)",
      "rgba(248,113,113,0.88)",
      "rgba(148,163,184,0.8)",
    ][index % 4]!,
    textClassName: [
      "text-signal-600 dark:text-signal-400",
      "text-amber-600 dark:text-amber-400",
      "text-rose-600 dark:text-rose-400",
      "text-slate-600 dark:text-slate-300",
    ][index % 4]!,
  }));

  const tokenSegments: SegmentDefinition[] = [
    {
      label: "Input",
      value: usage.inputTokens,
      color: "rgba(0,224,160,0.9)",
      textClassName: "text-signal-600 dark:text-signal-400",
    },
    {
      label: "Cached",
      value: usage.cachedInputTokens,
      color: "rgba(0,170,255,0.88)",
      textClassName: "text-cyan-600 dark:text-cyan-400",
    },
    {
      label: "Output",
      value: usage.outputTokens,
      color: "rgba(255,184,0,0.88)",
      textClassName: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Reasoning",
      value: usage.reasoningOutputTokens,
      color: "rgba(251,113,133,0.9)",
      textClassName: "text-rose-600 dark:text-rose-400",
    },
  ].filter((segment) => segment.value > 0);

  return { providerSegments, sourceSegments, tokenSegments };
}

export const StatsPage: FunctionComponent = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { selectedProject } = useProjectData();
  const [window, setWindow] = useState<ProjectStatsWindow>("7d");
  const [visualMode, setVisualMode] = useState<StatsVisualMode>("trend");
  const { stats, loading, error } = useProjectStats(selectedProject?.id || null, window);

  useLayoutEffect(() => {
    if (!rootRef.current) {
      return;
    }
    gsap.fromTo(
      rootRef.current.children,
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, duration: 0.8, stagger: 0.08, ease: "power4.out" },
    );
  }, []);

  const usage = stats?.usage || EMPTY_USAGE;
  const tokenSeries = useMemo(() => createSeries(stats?.buckets || [], (bucket) => bucket.usage.totalTokens), [stats?.buckets]);
  const activeTimeSeries = useMemo(() => createSeries(stats?.buckets || [], (bucket) => bucket.usage.activeTimeMs / 1000), [stats?.buckets]);
  const wallTimeSeries = useMemo(() => createSeries(stats?.buckets || [], (bucket) => bucket.usage.wallTimeMs / 1000), [stats?.buckets]);
  const planningUsage = useMemo(() => stats?.purposes.find((purpose) => purpose.id === "planning") || null, [stats?.purposes]);

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

  const { providerSegments, sourceSegments, tokenSegments } = useMemo(
    () => createStatsSegments(stats, usage),
    [stats, usage],
  );

  return (
    <div ref={rootRef} className="mx-auto flex max-w-[2400px] flex-col gap-16 px-8 py-20 md:px-20">
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
            </div>
          </div>
          <div className="flex flex-col items-start gap-4 xl:items-end">
            <RangeToggle window={window} onChange={setWindow} />
            <ViewToggle value={visualMode} onChange={setVisualMode} />
          </div>
        </div>
      </section>

      {!selectedProject ? (
        <div className="rounded-[2rem] border border-dashed border-black/[0.08] bg-white/68 px-8 py-16 text-center text-base text-slate-400 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/55 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
          Select a project to load telemetry.
        </div>
      ) : loading && !stats ? (
        <div className="rounded-[2rem] border border-black/[0.05] bg-white/68 px-8 py-16 text-center text-base text-slate-500 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.05] dark:bg-void-800/55 dark:text-slate-400 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
          Loading the telemetry field for {selectedProject.name}.
        </div>
      ) : error ? (
        <div className="rounded-[2rem] border border-red-500/20 bg-red-500/10 px-8 py-12 text-base text-red-600 dark:text-red-300">
          {error}
        </div>
      ) : stats ? (
        <>
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-5">
            <SignalMetricCard
              label="Total Tokens"
              value={formatTokens(usage.totalTokens)}
              detail={`${usage.reportedInvocationCount} reported · ${usage.estimatedInvocationCount} estimated provider calls`}
              accentHex="#00E0A0"
              hoverTint="group-hover:bg-signal-500/[0.025]"
              sparkline={tokenSeries}
              signalLabel="Throughput"
            />
            <SignalMetricCard
              label="Active AI Time"
              value={formatDuration(usage.activeTimeMs)}
              detail={`${usage.invocationCount} tracked CLI invocations across the selected window`}
              accentHex="#FFB800"
              hoverTint="group-hover:bg-amber-500/[0.03]"
              sparkline={activeTimeSeries}
              signalLabel="Latency"
            />
            <SignalMetricCard
              label="Wall Runtime"
              value={formatDuration(usage.wallTimeMs)}
              detail="Task-run wall time in the same window, including completed sprint work."
              accentHex="#0EA5E9"
              hoverTint="group-hover:bg-cyan-500/[0.03]"
              sparkline={wallTimeSeries}
              signalLabel="Task Scope"
            />
            <SignalMetricCard
              label="Planning Lane"
              value={planningUsage ? formatTokens(planningUsage.usage.totalTokens) : "0"}
              detail={planningUsage
                ? `${formatDuration(planningUsage.usage.activeTimeMs)} spent in sprint planning`
                : "Planning usage will land here once virtual planning runs execute."}
              accentHex="#F43F5E"
              hoverTint="group-hover:bg-rose-500/[0.03]"
              sparkline={createSeries(stats.buckets, (bucket) => bucket.usage.invocationCount)}
              signalLabel="Planning"
            />
            <SignalMetricCard
              label="Telemetry Confidence"
              value={completionConfidence}
              detail={`${usage.unavailableInvocationCount + usage.unsupportedInvocationCount} invocations could not expose authoritative counts`}
              accentHex="#10B981"
              hoverTint="group-hover:bg-emerald-500/[0.03]"
              sparkline={createSeries(stats.buckets, (bucket) => bucket.usage.reportedInvocationCount)}
              signalLabel="Audit"
            />
          </section>

          {visualMode === "trend" ? (
            <TrendStudio stats={stats} window={window} planningUsage={planningUsage} />
          ) : null}

          {visualMode === "composition" ? (
            <CompositionStudio stats={stats} providerSegments={providerSegments} tokenSegments={tokenSegments} />
          ) : null}

          {visualMode === "reliability" ? (
            <ReliabilityStudio stats={stats} providerSegments={providerSegments} sourceSegments={sourceSegments} />
          ) : null}

          <section className="space-y-6">
            <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
              <StudioHeader
                icon={Layers3}
                eyebrow="Telemetry Ledgers"
                title="Task and sprint telemetry"
                description="Deep operational ledgers for execution scopes, redesigned around search, recency, sort controls, and richer usage breakdowns."
              />
            </div>
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              <TelemetryLedger
                title="Task Telemetry"
                eyebrow="Task Ledger"
                items={stats.tasks}
                kindLabel="tasks"
                emptyLabel="No task telemetry landed in this window yet."
                defaultSortKey="last"
              />
              <TelemetryLedger
                title="Sprint Telemetry"
                eyebrow="Sprint Ledger"
                items={stats.sprints}
                kindLabel="sprints"
                emptyLabel="No sprint telemetry landed in this window yet."
                defaultSortKey="tokens"
              />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <TelemetryLedger
              title="Provider Split"
              eyebrow="Provider Ledger"
              items={stats.providers}
              kindLabel="providers"
              emptyLabel="No provider telemetry landed in this window yet."
              defaultSortKey="tokens"
            />
            <TelemetryLedger
              title="Purpose Split"
              eyebrow="Execution Purpose Ledger"
              items={stats.purposes}
              kindLabel="purposes"
              emptyLabel="No execution-purpose telemetry landed in this window yet."
              defaultSortKey="tokens"
            />
          </section>
        </>
      ) : null}
    </div>
  );
};
