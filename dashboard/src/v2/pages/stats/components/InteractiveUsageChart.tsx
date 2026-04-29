import type { FunctionComponent } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import gsap from 'gsap';
import type {
  ProjectExecutionStatsSnapshot,
  ProjectStatsWindow,
} from '../../../types.js';
import {
  formatTokens,
  formatDuration,
  formatDateTime,
} from '../stats-utils.js';
import {
  CHIP_CLASS,
  PANEL_CLASS,
  SUBPANEL_CLASS,
  getAxisLabelStep,
  formatAxisLabel,
} from './StatsShared.js';
import { UsageSeriesSidebar } from './UsageSeriesSidebar.js';
import type { UsageChartState } from '../use-usage-chart-state.js';
import {
  getVisibleBuckets,
  normalizeChartSeries,
  calculateChartMetrics,
  getTooltipState,
  groupChartSeries,
} from '../chart-view-models.js';
import { UsageGraphHeader } from './UsageGraphHeader.js';
import { UsageFilterMenu } from './UsageFilterMenu.js';
import { useUsageFilters } from '../hooks/useUsageFilters.js';
import { UsageGraphTooltip } from './UsageGraphTooltip.js';
import { UsageGraphEmpty } from './UsageGraphStates.js';
import { Activity, Filter } from 'lucide-preact';

export const InteractiveUsageChart: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  chartState: UsageChartState;
  activeWindow: ProjectStatsWindow | string;
  customFrom: string;
  customTo: string;
  onSelectPreset: (value: Exclude<ProjectStatsWindow, "custom">) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  onApplyCustom: () => void;
}> = ({
  stats,
  chartState,
  activeWindow,
  customFrom,
  customTo,
  onSelectPreset,
  onCustomFromChange,
  onCustomToChange,
  onApplyCustom,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const { isFiltersOpen, toggleFilters, closeFilters } = useUsageFilters();

  const {
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
  } = chartState;

  const buckets = stats.buckets;

  const [dimensions, setDimensions] = useState({ width: 1200, height: 540 });

  useLayoutEffect(() => {
    if (!svgContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        setDimensions({
          width: entry.contentRect.width,
          height: Math.max(540, entry.contentRect.height) // maintain a minimum height
        });
      }
    });
    observer.observe(svgContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const { width, height } = dimensions;
  const padding = 34;
  const viewStart = zoomRange?.start ?? 0;
  const viewEnd = zoomRange?.end ?? Math.max(0, buckets.length - 1);
  const visibleBuckets = getVisibleBuckets(buckets, viewStart, viewEnd);

  const chartData = useMemo(() => {
    return normalizeChartSeries(stats.chartSeries, visibleBuckets, viewStart, width, height, padding);
  }, [stats.chartSeries, visibleBuckets, viewStart, width, height, padding]);

  const seriesGroups = useMemo(() => groupChartSeries(stats.chartSeries), [stats.chartSeries]);
  const activeSeriesCount = Object.values(enabledSeries).filter(Boolean).length;

  const visibleSeries = chartData.filter((series) => enabledSeries[series.id]);

  const { activeIndex, activeBucket, tooltipLeft, xPositions } = getTooltipState(
    visibleBuckets, chartData, hoveredIndex, padding, width
  );

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

  const { peakTokens, peakTime, peakInvocations, averageTokens } = calculateChartMetrics(visibleBuckets);

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
  }, [dragCurrentIndex, dragStartIndex, buckets, setZoomRange, setDragStartIndex, setDragCurrentIndex]);

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
      timeline.to(path, { strokeDashoffset: 0, duration: 1.05, ease: "power3.out", clearProps: "strokeDashoffset,strokeDasharray" }, 0);
    });
    timeline.to(areas, { opacity: (_index, target) => Number((target as SVGPathElement).dataset.areaOpacity || "0.3"), duration: 0.7, stagger: 0.08, ease: "power2.out" }, 0.18);
    timeline.to(pointsNodes, { opacity: 1, scale: 1, duration: 0.38, stagger: 0.012, ease: "back.out(1.8)" }, 0.3);
    timeline.fromTo(cards, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.55, stagger: 0.05, ease: "power3.out" }, 0.18);

    return () => timeline.kill();
  }, [enabledSeries, visibleBuckets.length, stats.range.from, stats.range.to]);

  const onToggleSeries = (id: string) => {
    if (activeSeriesCount === 1 && enabledSeries[id]) return;
    setEnabledSeries((curr: Record<string, boolean>) => ({ ...curr, [id]: !curr[id] }));
  };

  return (
    <div ref={panelRef} className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7 border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] shadow-[var(--stats-card-shadow)]`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.08] to-transparent dark:via-white/[0.14]" />
      <div className="relative flex flex-col gap-8">
        <UsageGraphHeader
          title={zoomRange ? "Zoomed telemetry window" : stats.range.label}
          description="Normalized telemetry lines reveal shape instead of forcing tokens, duration, and invocation counts into one scale. Drag across the plot to zoom a timeframe, keep hourly hover precision, and use filters to focus the graph."
        />

        <div className="relative z-50">
          <UsageFilterMenu
            isOpen={isFiltersOpen}
            onClose={closeFilters}
            activeWindow={activeWindow}
            customFrom={customFrom}
            customTo={customTo}
            onSelectPreset={onSelectPreset}
            onCustomFromChange={onCustomFromChange}
            onCustomToChange={onCustomToChange}
            onApplyCustom={onApplyCustom}
            stats={stats}
            enabledSeries={enabledSeries}
            setEnabledSeries={setEnabledSeries}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <div data-chart-card className={`${SUBPANEL_CLASS} border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/40 p-5`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--stats-label-color)]">Peak Tokens</div>
            <div className="mt-2 text-2xl font-black text-[var(--stats-value-color)]">{formatTokens(peakTokens)}</div>
            <div className="mt-1 text-xs text-[var(--stats-detail-color)]">Highest bucket in view</div>
          </div>
          <div data-chart-card className={`${SUBPANEL_CLASS} border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/40 p-5`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--stats-label-color)]">Peak Time</div>
            <div className="mt-2 text-2xl font-black text-[var(--stats-value-color)]">{formatDuration(peakTime)}</div>
            <div className="mt-1 text-xs text-[var(--stats-detail-color)]">Active model runtime</div>
          </div>
          <div data-chart-card className={`${SUBPANEL_CLASS} border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/40 p-5`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--stats-label-color)]">Average Tokens</div>
            <div className="mt-2 text-2xl font-black text-[var(--stats-value-color)]">{formatTokens(averageTokens)}</div>
            <div className="mt-1 text-xs text-[var(--stats-detail-color)]">{stats.range.resolutionLabel}</div>
          </div>
          <div data-chart-card className={`${SUBPANEL_CLASS} border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/40 p-5`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--stats-label-color)]">Peak Invocations</div>
            <div className="mt-2 text-2xl font-black text-[var(--stats-value-color)]">{peakInvocations.toLocaleString()}</div>
            <div className="mt-1 text-xs text-[var(--stats-detail-color)]">CLI calls in one bucket</div>
          </div>
        </div>

        <div className="grid gap-8 items-start xl:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className={`${SUBPANEL_CLASS} flex flex-col border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/20 p-5 md:p-6`}>
            <div className="mb-6 flex flex-wrap items-center gap-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">Interactive Plot</div>
              <div className={`px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--stats-detail-color)] border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/60 ${CHIP_CLASS}`}>
                Hover buckets for exact values
              </div>
              <div className={`px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--stats-detail-color)] border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/60 ${CHIP_CLASS}`}>
                {zoomLabel}
              </div>
              <button
                type="button"
                onClick={toggleFilters}
                className={`group flex items-center gap-2 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-all border shadow-sm active:scale-95 ${CHIP_CLASS} ${
                  isFiltersOpen 
                    ? 'border-signal-500/30 bg-signal-500/[0.08] text-signal-500 shadow-signal-500/5' 
                    : 'border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/60 text-[var(--stats-detail-color)] hover:text-[var(--stats-value-color)] hover:border-[var(--stats-value-color)]/20'
                }`}
              >
                <Filter className={`h-3 w-3 transition-colors ${isFiltersOpen ? 'text-signal-500' : 'text-[var(--stats-detail-color)] group-hover:text-signal-500'}`} strokeWidth={2.2} />
                Filters
              </button>
              {zoomRange ? (
                <button
                  type="button"
                  onClick={() => setZoomRange(null)}
                  className={`px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500 transition-all hover:bg-signal-500/10 border border-signal-500/20 rounded-full active:scale-95`}
                >
                  Reset zoom
                </button>
              ) : null}
            </div>
            <div ref={svgContainerRef} className="relative flex-1 min-h-[36rem] w-full">
              
              <UsageGraphTooltip 
                visible={!!activeBucket}
                left={tooltipLeft}
                label={activeBucket?.label || ""}
                bucketStart={activeBucket?.bucketStart || ""}
                activeSeries={visibleSeries.map(s => ({
                  id: s.id,
                  label: s.label,
                  accentHex: s.accentHex,
                  value: s.formatter(s.values[activeIndex] ?? 0)
                }))}
              />

              {buckets.length === 0 ? (
                <UsageGraphEmpty />
              ) : (
                <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full overflow-visible">
                  <defs>
                    {chartData.map((series) => (
                      <linearGradient key={`fill-${series.id}`} id={`stats-area-${series.id}`} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={series.accentHex} stopOpacity="0.25" />
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
                        className="drop-shadow-[0_4px_12px_rgba(0,0,0,0.12)]"
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
                        r={hoveredIndex === index ? 6 : 4}
                        fill={series.accentHex}
                        stroke="white"
                        strokeWidth={hoveredIndex === index ? 2 : 0}
                        fillOpacity={hoveredIndex === null || hoveredIndex === index ? 1 : 0.4}
                        style={{ transition: 'r 0.2s, fill-opacity 0.2s, stroke-width 0.2s' }}
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
                        y={height - 8}
                        textAnchor="middle"
                        className="fill-[var(--stats-label-color)] text-[9px] font-bold uppercase tracking-[0.25em]"
                      >
                        {formatAxisLabel(bucket, stats.range)}
                      </text>
                    ) : null
                  ))}
                </svg>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <UsageSeriesSidebar
              series={chartData}
              enabledSeries={enabledSeries}
              activeIndex={activeIndex}
            />
            <div className={`${SUBPANEL_CLASS} border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/40 p-6`}>
              <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">Focused Bucket</div>
              <div className="mt-4 text-2xl font-black tracking-tight text-[var(--stats-value-color)]">
                {activeBucket ? activeBucket.label : "--"}
              </div>
              <div className="mt-2 text-sm leading-relaxed text-[var(--stats-detail-color)]">
                {activeBucket ? `${formatDateTime(activeBucket.bucketStart)} to ${formatDateTime(activeBucket.bucketEnd)}` : "No bucket data yet."}
              </div>
              <div className="mt-5 rounded-2xl border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/60 px-4 py-3.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--stats-detail-color)] shadow-sm">
                {zoomRange
                  ? `${visibleBuckets.length} buckets in zoom`
                  : `${stats.range.bucketCount} buckets in ${stats.range.label.toLowerCase()}`}
              </div>
              {activeBucket ? (
                <div className="mt-6 space-y-4">
                  <div className="flex items-center justify-between rounded-2xl border border-signal-500/20 bg-signal-500/10 px-5 py-4 shadow-sm transition-all hover:bg-signal-500/[0.15]">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-signal-600 dark:text-signal-400">Tokens</div>
                    <div className="text-base font-black text-[var(--stats-value-color)]">{formatTokens(activeBucket.usage.totalTokens)}</div>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-amber-500/20 bg-amber-500/10 px-5 py-4 shadow-sm transition-all hover:bg-amber-500/[0.15]">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400">Active Time</div>
                    <div className="text-base font-black text-[var(--stats-value-color)]">{formatDuration(activeBucket.usage.activeTimeMs)}</div>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-5 py-4 shadow-sm transition-all hover:bg-cyan-500/[0.15]">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-600 dark:text-cyan-400">Invocations</div>
                    <div className="text-base font-black text-[var(--stats-value-color)]">{activeBucket.usage.invocationCount.toLocaleString()}</div>
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

