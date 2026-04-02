import type { FunctionComponent } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import gsap from 'gsap';
import { Activity } from 'lucide-preact';
import type {
  ExecutionUsageBucketSummary,
  ProjectExecutionStatsSnapshot,
  ProjectExecutionStatsChartSeries,
} from '../../../types.js';
import {
  formatTokens,
  formatDuration,
  formatDateTime,
  sumUsage,
} from '../stats-utils.js';
import {
  CHIP_CLASS,
  PANEL_CLASS,
  SUBPANEL_CLASS,
  type ChartZoomRange,
  type ChartPoint,
  buildPoints,
  buildSmoothPath,
  buildSmoothAreaPath,
  getAxisLabelStep,
  formatAxisLabel,
} from './StatsShared.js';
import { UsageSeriesSidebar } from './UsageSeriesSidebar.js';

export const InteractiveUsageChart: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
}> = ({ stats }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [zoomRange, setZoomRange] = useState<ChartZoomRange | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [dragCurrentIndex, setDragCurrentIndex] = useState<number | null>(null);

  const [enabledSeries, setEnabledSeries] = useState<Record<string, boolean>>(() => {
    return stats.chartSeries.reduce((acc, s) => {
      acc[s.id] = s.defaultEnabled;
      return acc;
    }, {} as Record<string, boolean>);
  });

  const buckets = stats.buckets;

  const width = 1200;
  const height = 340;
  const padding = 34;
  const viewStart = zoomRange?.start ?? 0;
  const viewEnd = zoomRange?.end ?? Math.max(0, buckets.length - 1);
  const visibleBuckets = buckets.slice(viewStart, viewEnd + 1);

  const chartData = useMemo(() => {
    return stats.chartSeries.map((series, idx) => {
      const accentHex = series.id === 'tokens' ? '#00E0A0' : series.id === 'active' ? '#FFB800' : series.id === 'invocations' ? '#0EA5E9' : ['#F43F5E', '#8B5CF6', '#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#14B8A6'][idx % 7]!;
      const formatter = series.id.includes('time') || series.id.includes('active') ? formatDuration : series.id.includes('invocations') || series.id.includes('calls') ? (val: number) => val.toLocaleString() : formatTokens;
      const values = visibleBuckets.map((_, bucketIdx) => series.data[viewStart + bucketIdx] || 0);
      const points = buildPoints(values.length > 0 ? values : [0], width, height, padding);
      return {
        ...series,
        accentHex,
        formatter,
        signalLabel: series.id === 'tokens' ? 'Throughput' : series.id === 'active' ? 'Latency' : series.id === 'invocations' ? 'Volume' : 'Metric',
        values,
        points,
        path: buildSmoothPath(points),
        areaPath: buildSmoothAreaPath(points, height, padding),
        max: Math.max(...(values.length > 0 ? values : [0]), 1),
      };
    });
  }, [stats.chartSeries, visibleBuckets, viewStart, width, height, padding]);

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
  }, [dragCurrentIndex, dragStartIndex, buckets]);

  useEffect(() => {
    setHoveredIndex(null);
    setZoomRange(null);
    setDragStartIndex(null);
    setDragCurrentIndex(null);
    setEnabledSeries(stats.chartSeries.reduce((acc, s) => {
      acc[s.id] = s.defaultEnabled;
      return acc;
    }, {} as Record<string, boolean>));
  }, [stats.range.from, stats.range.to, stats.range.resolution, stats.chartSeries]);

  useLayoutEffect(() => {
    if (!panelRef.current) {
      return;
    }

    const paths = Array.from(panelRef.current.querySelectorAll<SVGPathElement>("[data-chart-path]"));
    const areas = Array.from(panelRef.current.querySelectorAll<SVGPathElement>("[data-chart-area]"));
    const pointsNodes = Array.from(panelRef.current.querySelectorAll<SVGCircleElement>("[data-chart-point]"));
    const cards = Array.from(panelRef.current.querySelectorAll<HTMLElement>("[data-chart-card]"));

    const timeline = gsap.timeline();
    gsap.set(areas, { opacity: 0 });
    gsap.set(pointsNodes, { opacity: 0, scale: 0.35, transformOrigin: "center center" });
    paths.forEach((path) => {
      const length = path.getTotalLength();
      gsap.set(path, { strokeDasharray: `${length} ${length}`, strokeDashoffset: length });
      timeline.to(path, { strokeDashoffset: 0, duration: 1.05, ease: "power3.out" }, 0);
    });
    timeline.to(areas, { opacity: (_index, target) => Number((target as SVGPathElement).dataset.areaOpacity || "0.3"), duration: 0.7, stagger: 0.08, ease: "power2.out" }, 0.18);
    timeline.to(pointsNodes, { opacity: 1, scale: 1, duration: 0.38, stagger: 0.012, ease: "back.out(1.8)" }, 0.3);
    timeline.fromTo(cards, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.55, stagger: 0.05, ease: "power3.out" }, 0.18);

    return () => timeline.kill();
  }, [enabledSeries, visibleBuckets.length, stats.range.from, stats.range.to]);

  return (
    <div ref={panelRef} className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.08] to-transparent dark:via-white/[0.14]" />
      <div className="relative flex flex-col gap-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/72 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-300">
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

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_16rem] 2xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className={`${SUBPANEL_CLASS} p-4 md:p-5`}>
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Interactive Legend</div>
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
                      className="fill-slate-400 text-[9px] font-bold uppercase tracking-[0.2em]"
                    >
                      {formatAxisLabel(bucket, stats.range)}
                    </text>
                  ) : null
                ))}
              </svg>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <UsageSeriesSidebar
              series={stats.chartSeries}
              enabledSeries={enabledSeries}
              activeIndex={activeIndex}
              onToggle={(id) => {
                if (activeSeriesCount === 1 && enabledSeries[id]) return;
                setEnabledSeries((curr) => ({ ...curr, [id]: !curr[id] }));
              }}
            />
            <div className={`${SUBPANEL_CLASS} p-5`}>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Focused Bucket</div>
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
