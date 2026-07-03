import type { FunctionComponent } from 'preact';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import gsap from 'gsap';
import type {
  ProjectExecutionStatsSnapshot,
} from '../../../types.js';
import {
  formatTokens,
  formatStatsDuration,
  formatDateTime,
  formatCost
} from '../stats-utils.js';
import {
  PANEL_CLASS,
  getAxisLabelStep,
  formatAxisLabel,
} from './StatsShared.js';
import { UsageSeriesSidebar } from './UsageSeriesSidebar.js';
import { UsageChartMinimap } from './UsageChartMinimap.js';
import { UsageGraphLegend } from './UsageGraphLegend.js';
import type { UsageChartState } from '../use-usage-chart-state.js';
import {
  getVisibleBuckets,
  normalizeChartSeries,
  calculateChartMetrics,
  getTooltipState,
  groupChartSeries,
  calculateHoverRect,
} from '../chart-view-models.js';
import { UsageGraphHeader } from './UsageGraphHeader.js';
import { UsageFilterMenu } from './UsageFilterMenu.js';
import { useUsageFilters } from '../hooks/useUsageFilters.js';
import { UsageGraphTooltip } from './UsageGraphTooltip.js';
import { UsageGraphEmpty, UsageGraphError } from './UsageGraphStates.js';
import { Activity } from 'lucide-preact';

export const InteractiveUsageChart: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  chartState: UsageChartState;
}> = ({
  stats,
  loading,
  error,
  refresh,
  chartState,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const { isFiltersOpen, toggleFilters, closeFilters } = useUsageFilters();

  const handleSliderChange = (e: JSX.TargetedEvent<HTMLInputElement>) => {
    const val = parseInt(e.currentTarget.value, 10);
    setHoveredIndex(val);
  };

  const handleSliderKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (hoveredIndex !== null) {
        // Zoom into current bucket
        setZoomRange({ start: hoveredIndex, end: hoveredIndex });
      }
    }
  };

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

  const [dimensions, setDimensions] = useState({ width: 1200, height: 256 });
  const viewStartRef = useRef(zoomRange?.start ?? 0);
  viewStartRef.current = zoomRange?.start ?? 0;

  const padding = 34;
  const viewStart = viewStartRef.current;
  const viewEnd = zoomRange?.end ?? Math.max(0, buckets.length - 1);
  const visibleBuckets = useMemo(() => getVisibleBuckets(buckets, viewStart, viewEnd), [buckets, viewStart, viewEnd]);

  const chartData = useMemo(() => {
    return normalizeChartSeries(stats.chartSeries, visibleBuckets, viewStart, dimensions.width, dimensions.height, padding);
  }, [stats.chartSeries, visibleBuckets, viewStart, dimensions.width, dimensions.height, padding]);

  useLayoutEffect(() => {
    if (!svgContainerRef.current || typeof ResizeObserver === 'undefined') return;

    let rafId: number | null = null;
    let prevWidth = 1200;
    let prevHeight = 256;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        const newWidth = entry.contentRect.width;
        const newHeight = Math.max(256, entry.contentRect.height);

        if (prevWidth !== newWidth || prevHeight !== newHeight) {
          prevWidth = newWidth;
          prevHeight = newHeight;
          if (rafId !== null) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            setDimensions({ width: newWidth, height: newHeight });
          });
        }
      }
    });

    observer.observe(svgContainerRef.current);

    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  const { width, height } = dimensions;

  const seriesGroups = useMemo(() => groupChartSeries(stats.chartSeries), [stats.chartSeries]);
  const activeSeriesCount = Object.values(enabledSeries).filter(Boolean).length;

  const visibleSeries = chartData.filter((series) => enabledSeries[series.id]);

  const { activeIndex, activeBucket, tooltipLeft, xPositions } = useMemo(() => getTooltipState(
    visibleBuckets, chartData, hoveredIndex, padding, width
  ), [visibleBuckets, chartData, hoveredIndex, padding, width]);

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

  const { peakTokens, peakActiveTimeMs, peakInvocations, averageTokens, totalCostUsd, invocationDensity } = useMemo(() => calculateChartMetrics(visibleBuckets), [visibleBuckets]);
  const invocationDensityLabel = visibleBuckets.length > 0 ? `${invocationDensity.toFixed(1)} / bucket` : "—";
  const summaryCards = [
    { label: 'Peak tokens', value: formatTokens(peakTokens), detail: 'highest bucket' },
    { label: 'Peak active time', value: formatStatsDuration(peakActiveTimeMs), detail: 'highest bucket' },
    { label: 'Average tokens', value: formatTokens(averageTokens), detail: 'per bucket' },
    { label: 'Peak invocations', value: peakInvocations.toLocaleString(), detail: 'highest bucket' },
    { label: 'Total cost', value: formatCost(totalCostUsd), detail: 'visible window' },
    { label: 'Invocation density', value: invocationDensityLabel, detail: 'visible window' },
  ];

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

    const ctx = gsap.matchMedia();

    ctx.add("(prefers-reduced-motion: no-preference)", () => {
      const timeline = gsap.timeline();
      if (areas.length > 0) {
        gsap.set(areas, { opacity: 0 });
      }
      if (pointsNodes.length > 0) {
        gsap.set(pointsNodes, { opacity: 0, scale: 0.35, transformOrigin: "center center" });
      }
      paths.forEach((path) => {
        const length = typeof path.getTotalLength === "function" ? path.getTotalLength() : 100;
        gsap.set(path, { strokeDasharray: `${length} ${length}`, strokeDashoffset: length });
        timeline.to(path, { strokeDashoffset: 0, duration: 1.05, ease: "power3.out", clearProps: "strokeDashoffset,strokeDasharray" }, 0);
      });
      if (areas.length > 0) {
        timeline.to(areas, { opacity: (_index, target) => Number((target as SVGPathElement).dataset.areaOpacity || "0.3"), duration: 0.7, stagger: 0.08, ease: "power2.out" }, 0.18);
      }
      if (pointsNodes.length > 0) {
        timeline.to(pointsNodes, { opacity: 1, scale: 1, duration: 0.38, stagger: 0.012, ease: "back.out(1.8)" }, 0.3);
      }
      if (cards.length > 0) {
        timeline.fromTo(cards, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.55, stagger: 0.05, ease: "power3.out" }, 0.18);
      }
    });

    ctx.add("(prefers-reduced-motion: reduce)", () => {
      if (areas.length > 0) gsap.set(areas, { opacity: (_index, target) => Number((target as SVGPathElement).dataset.areaOpacity || "0.3") });
      if (pointsNodes.length > 0) gsap.set(pointsNodes, { opacity: 1, scale: 1 });
      paths.forEach((path) => {
        gsap.set(path, { strokeDasharray: "none", strokeDashoffset: 0, clearProps: "strokeDashoffset,strokeDasharray" });
      });
      if (cards.length > 0) gsap.set(cards, { opacity: 1, y: 0 });
    });

    return () => ctx.revert();
  }, [enabledSeries, visibleBuckets.length, stats.range.from, stats.range.to]);

  const onToggleSeries = (id: string) => {
    if (activeSeriesCount === 1 && enabledSeries[id]) return;
    setEnabledSeries((curr: Record<string, boolean>) => ({ ...curr, [id]: !curr[id] }));
  };

  return (
    <div ref={panelRef} className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7 border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] shadow-[var(--stats-card-shadow)]`}>
      <div className="relative flex flex-col gap-8">
        {/* Screen reader summary */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          <h2 id="chart-summary-heading" className="sr-only">Data Visualization for {zoomRange ? "zoomed timeframe" : stats.range.label}</h2>
          <p>
            Currently showing {visibleBuckets.length} buckets.
            {activeBucket ? `Focused bucket: ${activeBucket.label}. Tokens: ${activeBucket.usage.totalTokens}` : "No bucket focused."}
            Active series: {visibleSeries.map(s => s.label).join(", ")}.
            Peak Tokens: {formatTokens(peakTokens)}. Peak Time: {formatStatsDuration(peakActiveTimeMs)}. Average Tokens: {formatTokens(averageTokens)}. Peak Invocations: {peakInvocations.toLocaleString()}.
          </p>
          <table className="sr-only">
            <thead>
              <tr>
                <th>Time</th>
                {visibleSeries.map(s => (
                  <th key={s.id}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleBuckets.map((bucket, i) => (
                <tr key={bucket.bucketStart}>
                  <td>{bucket.label}</td>
                  {visibleSeries.map(s => (
                    <td key={s.id}>{s.formatter(s.values[i] ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <UsageGraphHeader
          title={zoomRange ? "Zoomed telemetry window" : stats.range.label}
          description="Normalized telemetry lines reveal shape instead of forcing tokens, duration, and invocation counts into one scale. Drag across the plot or the overview strip to zoom a timeframe, hover for exact bucket values, and use filters to focus the graph."
          rangeLabel={stats.range.label}
          bucketCount={visibleBuckets.length}
          resolutionLabel={stats.range.resolutionLabel}
          zoomLabel={zoomLabel}
          isZoomed={!!zoomRange}
          isFiltersOpen={isFiltersOpen}
          activeSeriesCount={activeSeriesCount}
          onToggleFilters={toggleFilters}
          onResetZoom={() => setZoomRange(null)}
        />

        <div className="relative z-50">
          <UsageFilterMenu
            isOpen={isFiltersOpen}
            onClose={closeFilters}
            stats={stats}
            enabledSeries={enabledSeries}
            setEnabledSeries={setEnabledSeries}
          />
        </div>

        <div
          aria-label="Usage chart summary metrics"
          className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6"
        >
          {summaryCards.map((card) => (
            <article
              key={card.label}
              data-chart-card
              aria-label={`${card.label}: ${card.value}, ${card.detail}`}
              className="min-w-0 rounded-[1.15rem] border border-[var(--stats-card-border)] bg-[color:var(--fill-muted)] px-4 py-3"
            >
              <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--stats-label-color)]">{card.label}</div>
              <div className="mt-2 break-words text-lg font-black leading-tight text-[var(--stats-value-color)]">{card.value}</div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]">{card.detail}</div>
            </article>
          ))}
        </div>

        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.15rem] border border-[var(--stats-card-border)] bg-[color:var(--fill-muted)] px-4 py-3">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--stats-label-color)]">Interactive plot</div>
                <div className="mt-1 text-xs leading-relaxed text-[var(--stats-detail-color)]">
                  Drag the plot or minimap to zoom. Hover, focus, or use the slider to inspect a bucket.
                </div>
              </div>
              <div className="rounded-full border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] px-3 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]">
                {visibleSeries.length} visible series
              </div>
            </div>

            <div className="rounded-[1.35rem] border border-[var(--stats-card-border)] bg-[color:var(--fill-muted)] p-3 md:p-4">
              <div ref={svgContainerRef} className="relative h-[22rem] w-full sm:h-[26rem] lg:h-[30rem]">
                {error ? (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[1.1rem] bg-[var(--stats-card-bg)]/72 backdrop-blur-sm">
                    <UsageGraphError message={error} onRetry={() => { refresh().catch(() => {}); }} />
                  </div>
                ) : null}
                {loading && !error ? (
                  <div className="absolute right-3 top-3 z-20 flex items-center gap-2 rounded-full border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/88 px-3 py-1.5 shadow-sm backdrop-blur-md" aria-busy="true" aria-label="Loading new data">
                    <Activity className="h-3.5 w-3.5 animate-pulse text-signal-500 motion-reduce:animate-none" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]">
                      Syncing
                    </span>
                  </div>
                ) : null}
                {buckets.length === 0 ? (
                  <div className={`absolute inset-0 h-full w-full transition-opacity duration-300 motion-reduce:transition-none ${loading ? "opacity-60 pointer-events-none" : "opacity-100"}`}>
                    <UsageGraphEmpty onReset={() => setZoomRange(null)} />
                  </div>
                ) : (
                  <svg role="img" aria-labelledby="chart-summary-heading" viewBox={`0 0 ${width} ${height}`} className={`absolute inset-0 h-full w-full overflow-visible transition-opacity duration-300 motion-reduce:transition-none ${loading ? "opacity-60 pointer-events-none" : "opacity-100"}`}>
                    <defs>
                      {chartData.map((series) => (
                        <linearGradient key={`fill-${series.id}`} id={`stats-area-${series.id}`} x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stop-color={series.accentHex} stop-opacity="0.1" />
                          <stop offset="100%" stop-color={series.accentHex} stop-opacity="0" />
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
                        strokeOpacity="0.045"
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
                        fill="rgba(0,224,160,0.055)"
                        stroke="rgba(0,224,160,0.28)"
                        strokeDasharray="8 8"
                      />
                    ) : null}
                    {visibleSeries.map((series) => (
                      <g key={series.id}>
                        <path
                          data-chart-area
                          data-area-opacity={series.id === "tokens" ? "0.45" : "0.22"}
                          d={series.areaPath}
                          fill={`url(#stats-area-${series.id})`}
                          opacity={series.id === "tokens" ? 0.45 : 0.22}
                        />
                        <path
                          data-chart-path
                          d={series.path}
                          fill="none"
                          stroke={series.accentHex}
                          strokeWidth={series.id === "tokens" ? "3.2" : "2.6"}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity="0.92"
                          className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
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
                        strokeOpacity="0.14"
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
                          r={hoveredIndex === index ? 5 : 3.2}
                          fill={series.accentHex}
                          stroke="var(--stats-card-bg)"
                          strokeWidth={hoveredIndex === index ? 2 : 0}
                          fillOpacity={hoveredIndex === null || hoveredIndex === index ? 0.9 : 0.32}
                          style={{ transition: 'r 0.2s, fill-opacity 0.2s, stroke-width 0.2s' }}
                        />
                      ))
                    ))}
                    {xPositions.map((x, index) => {
                      const { startX, rectWidth } = calculateHoverRect(index, x, xPositions, width, padding);
                      const absoluteIndex = viewStart + index;
                      return (
                        <rect
                          key={`hover-${index}`}
                          tabIndex={0}
                          x={startX}
                          y={padding}
                          width={rectWidth}
                          height={height - padding * 2}
                          fill="transparent"
                          className="focus:outline-none focus:ring-2 focus:ring-signal-500"
                          onMouseDown={() => {
                            setDragStartIndex(absoluteIndex);
                            setDragCurrentIndex(absoluteIndex);
                          }}
                          onMouseEnter={() => setHoveredIndex(index)}
                          onFocus={() => setHoveredIndex(index)}
                          onBlur={() => setHoveredIndex(null)}
                          aria-label={buckets[absoluteIndex]?.label || "Bucket"}
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
                          className="fill-[var(--stats-detail-color)] text-[9px] font-bold uppercase tracking-[0.14em]"
                        >
                          {formatAxisLabel(bucket, stats.range)}
                        </text>
                      ) : null
                    ))}
                  </svg>
                )}
              </div>
              {buckets.length > 1 ? (
                <UsageChartMinimap
                  buckets={buckets}
                  zoomRange={zoomRange}
                  onZoomChange={setZoomRange}
                />
              ) : null}
            </div>
          </div>

          <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-6">
            <div className="rounded-[1.35rem] border border-[var(--stats-card-border)] bg-[color:var(--fill-muted)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--stats-label-color)]">Focused bucket</div>
                  <div className="mt-1 text-sm font-black text-[var(--stats-value-color)]">
                    {activeBucket ? activeBucket.label : "No bucket focused"}
                  </div>
                </div>
                <div className="rounded-full border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] px-3 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]">
                  {visibleSeries.length} visible
                </div>
              </div>
              <UsageGraphTooltip
                visible={!!activeBucket}
                left={tooltipLeft}
                label={activeBucket?.label || ""}
                bucketStart={activeBucket?.bucketStart || ""}
                bucket={activeBucket}
                activeSeries={visibleSeries.map((s) => ({
                  id: s.id,
                  label: s.label,
                  accentHex: s.accentHex,
                  value: s.formatter(s.values[activeIndex] ?? 0)
                }))}
              />
              <div className="mt-4 rounded-[1.1rem] border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--stats-label-color)]">Range focus</div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]">
                    {activeBucket ? formatDateTime(activeBucket.bucketStart) : "Move focus to inspect"}
                  </div>
                </div>
                <label htmlFor="bucket-focus-slider" className="mt-3 block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]">
                  Explore chart data across time
                </label>
                <input
                  id="bucket-focus-slider"
                  type="range"
                  min={0}
                  max={Math.max(0, visibleBuckets.length - 1)}
                  value={hoveredIndex ?? 0}
                  onInput={handleSliderChange}
                  onChange={handleSliderChange}
                  onKeyDown={handleSliderKeyDown}
                  aria-describedby="usage-chart-tooltip"
                  aria-valuetext={activeBucket ? `${activeBucket.label}, ${visibleSeries.map((s) => `${s.label}: ${s.formatter(s.values[activeIndex] ?? 0)}`).join(', ')}` : 'No bucket focused'}
                  className="mt-3 w-full accent-[color:var(--accent-focus-ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-focus-ring)]"
                  disabled={visibleBuckets.length === 0}
                />
                <div className="mt-2 text-[11px] leading-relaxed text-[var(--stats-detail-color)]">
                  Use arrow keys, drag, or hover to move through the active window. Press Enter to zoom the focused bucket.
                </div>
              </div>
            </div>

            <div className="rounded-[1.35rem] border border-[var(--stats-card-border)] bg-[color:var(--fill-muted)] p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--stats-label-color)]">Series switches</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]">
                  {activeSeriesCount} active
                </div>
              </div>
              <UsageGraphLegend
                seriesGroups={seriesGroups}
                enabledSeries={enabledSeries}
                activeSeriesCount={activeSeriesCount}
                onToggleSeries={onToggleSeries}
              />
            </div>

            <div className="rounded-[1.35rem] border border-[var(--stats-card-border)] bg-[color:var(--fill-muted)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--stats-label-color)]">Live values</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]">
                  Peak {formatTokens(peakTokens)}
                </div>
              </div>
              <UsageSeriesSidebar
                series={chartData}
                enabledSeries={enabledSeries}
                activeIndex={activeIndex}
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
