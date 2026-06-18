import type { FunctionComponent } from 'preact';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import gsap from 'gsap';
import { useReducedMotion } from "../../../hooks/use-reduced-motion.js";
import type {
  ProjectExecutionStatsSnapshot,
} from '../../../types.js';
import {
  formatTokens,
  formatDuration,
  formatDateTime,
  formatCost
} from '../stats-utils.js';
import {
  CHIP_CLASS,
  PANEL_CLASS,
  SUBPANEL_CLASS,
  getAxisLabelStep,
  formatAxisLabel,
} from './StatsShared.js';
import { UsageSeriesSidebar } from './UsageSeriesSidebar.js';
import { UsageChartMinimap } from './UsageChartMinimap.js';
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
import { h } from 'preact';
import { UsageGraphTooltip } from './UsageGraphTooltip.js';
import { UsageGraphEmpty, UsageGraphError } from './UsageGraphStates.js';
import { Activity, Filter } from 'lucide-preact';

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

  const isReducedMotion = useReducedMotion();
  const buckets = stats.buckets;

  const dimensionsRef = useRef({ width: 1200, height: 256 });
  const statsRef = useRef(stats);
  const viewStartRef = useRef(zoomRange?.start ?? 0);
  const viewEndRef = useRef(zoomRange?.end ?? Math.max(0, buckets.length - 1));
  const hoveredIndexRef = useRef(hoveredIndex);

  // Update refs to latest render values
  statsRef.current = stats;
  viewStartRef.current = zoomRange?.start ?? 0;
  viewEndRef.current = zoomRange?.end ?? Math.max(0, buckets.length - 1);
  hoveredIndexRef.current = hoveredIndex;

  const padding = 34;
  const viewStart = viewStartRef.current;
  const viewEnd = viewEndRef.current;
  const visibleBuckets = getVisibleBuckets(buckets, viewStart, viewEnd);

  // Keep the visibleBucketsRef updated
  const visibleBucketsRef = useRef(visibleBuckets);
  visibleBucketsRef.current = visibleBuckets;

  const chartData = useMemo(() => {
    return normalizeChartSeries(stats.chartSeries, visibleBuckets, viewStart, dimensionsRef.current.width, dimensionsRef.current.height, padding);
  }, [stats.chartSeries, visibleBuckets, viewStart, padding]); // Intentionally omitting dimensions to prevent React re-renders

  useLayoutEffect(() => {
    if (!svgContainerRef.current || typeof ResizeObserver === 'undefined') return;

    const updateChartDOM = (width: number, height: number) => {
      const svg = svgContainerRef.current?.querySelector('svg');
      if (!svg) return;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

      const newChartData = normalizeChartSeries(
        statsRef.current.chartSeries,
        visibleBucketsRef.current,
        viewStartRef.current,
        width,
        height,
        padding
      );
      const newXPositions = newChartData[0]?.points.map((p) => p.x) ?? [];

      const gridLines = svg.querySelectorAll('[data-grid-line]');
      gridLines.forEach((line, index) => {
        line.setAttribute('x2', String(width - padding));
        line.setAttribute('y1', String(padding + ((height - padding * 2) / 4) * index));
        line.setAttribute('y2', String(padding + ((height - padding * 2) / 4) * index));
      });

      const areas = svg.querySelectorAll('[data-chart-area]');
      areas.forEach((area) => {
        const seriesId = area.getAttribute('data-series-id');
        const series = newChartData.find(s => s.id === seriesId);
        if (series) area.setAttribute('d', series.areaPath);
      });

      const paths = svg.querySelectorAll('[data-chart-path]');
      paths.forEach((path) => {
        const seriesId = path.getAttribute('data-series-id');
        const series = newChartData.find(s => s.id === seriesId);
        if (series) path.setAttribute('d', series.path);
      });

      const hoverLine = svg.querySelector('[data-hover-line]');
      if (hoverLine && hoveredIndexRef.current !== null && newXPositions[hoveredIndexRef.current]) {
        hoverLine.setAttribute('x1', String(newXPositions[hoveredIndexRef.current]));
        hoverLine.setAttribute('x2', String(newXPositions[hoveredIndexRef.current]));
        hoverLine.setAttribute('y2', String(height - padding));
      }

      const points = svg.querySelectorAll('[data-chart-point]');
      points.forEach((point) => {
        const seriesId = point.getAttribute('data-series-id');
        const index = parseInt(point.getAttribute('data-point-index') || '0', 10);
        const series = newChartData.find(s => s.id === seriesId);
        if (series && series.points[index]) {
          point.setAttribute('cx', String(series.points[index].x));
          point.setAttribute('cy', String(series.points[index].y));
        }
      });

      const hoverRects = svg.querySelectorAll('[data-hover-rect]');
      hoverRects.forEach((rect) => {
        const index = parseInt(rect.getAttribute('data-rect-index') || '0', 10);
        const x = newXPositions[index];
        if (x === undefined) return;
        const startX = index === 0 ? padding : (newXPositions[index - 1]! + x) / 2;
        const endX = index === newXPositions.length - 1 ? width - padding : (x + newXPositions[index + 1]!) / 2;
        const rectWidth = Math.max(8, endX - startX);
        rect.setAttribute('x', String(startX));
        rect.setAttribute('width', String(rectWidth));
        rect.setAttribute('height', String(height - padding * 2));
      });

      const axisLabels = svg.querySelectorAll('[data-axis-label]');
      axisLabels.forEach((label) => {
        const index = parseInt(label.getAttribute('data-label-index') || '0', 10);
        if (newXPositions[index] !== undefined) {
          label.setAttribute('x', String(newXPositions[index]));
          label.setAttribute('y', String(height - 8));
        }
      });
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        const newWidth = entry.contentRect.width;
        const newHeight = Math.max(256, entry.contentRect.height);

        // Only update if dimensions actually changed
        if (dimensionsRef.current.width !== newWidth || dimensionsRef.current.height !== newHeight) {
          dimensionsRef.current = { width: newWidth, height: newHeight };
          // Update DOM directly bypassing React render loop
          requestAnimationFrame(() => updateChartDOM(newWidth, newHeight));
        }
      }
    });

    observer.observe(svgContainerRef.current);

    return () => observer.disconnect();
  }, [padding]); // Add dependencies as needed, though refs are mutable

  const { width, height } = dimensionsRef.current;

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
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.08] to-transparent dark:via-white/[0.14]" />
      <div className="relative flex flex-col gap-8">
        {/* Screen reader summary */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          <h2 id="chart-summary-heading" className="sr-only">Data Visualization for {zoomRange ? "zoomed timeframe" : stats.range.label}</h2>
          <p>
            Currently showing {visibleBuckets.length} buckets.
            {activeBucket ? `Focused bucket: ${activeBucket.label}. Tokens: ${activeBucket.usage.totalTokens}` : "No bucket focused."}
            Active series: {visibleSeries.map(s => s.label).join(", ")}.
            Peak Tokens: {formatTokens(peakTokens)}. Peak Time: {formatDuration(peakTime)}. Average Tokens: {formatTokens(averageTokens)}. Peak Invocations: {peakInvocations.toLocaleString()}.
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-4">
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

        <div className="grid grid-cols-1 gap-8 items-start xl:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className={`${SUBPANEL_CLASS} flex flex-col border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/20 p-5 md:p-6`}>
            <div className="mb-6 flex flex-wrap items-center gap-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">Interactive Plot</div>
              <div className={`px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--stats-detail-color)] border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/60 ${CHIP_CLASS} truncate max-w-full`}>
                Hover buckets for exact values
              </div>
              <div className={`px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--stats-detail-color)] border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/60 ${CHIP_CLASS} truncate max-w-full`}>
                {zoomLabel}
              </div>
              <button
                type="button"
                onClick={toggleFilters} aria-expanded={isFiltersOpen}
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
                  Reset zoom <span className="sr-only">to {stats.range.label}</span>
                </button>
              ) : null}
            </div>
            <div className="sr-only">
              <label htmlFor="bucket-focus-slider">Explore chart data across time</label>
              <input
                id="bucket-focus-slider"
                type="range"
                min={0}
                max={Math.max(0, visibleBuckets.length - 1)}
                value={hoveredIndex ?? 0}
                onInput={handleSliderChange}
                onChange={handleSliderChange}
                onKeyDown={handleSliderKeyDown}
                aria-valuetext={activeBucket ? `${activeBucket.label}, ${visibleSeries.map(s => `${s.label}: ${s.formatter(s.values[activeIndex] ?? 0)}`).join(', ')}` : 'No bucket focused'}
              />
            </div>
            <div ref={svgContainerRef} className="relative flex-1 min-h-[16rem] sm:min-h-[24rem] md:min-h-[30rem] lg:min-h-[36rem] w-full">
              {error ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--stats-card-bg)]/50 backdrop-blur-sm">
                  <UsageGraphError message={error} onRetry={() => { refresh().catch(() => {}); }} />
                </div>
              ) : null}
              {loading && !error ? (
                <div className="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full bg-[var(--stats-card-bg)]/80 px-3 py-1.5 shadow-sm backdrop-blur-md border border-[var(--stats-card-border)]" aria-busy="true" aria-label="Loading new data">
                  <Activity className="h-3.5 w-3.5 animate-pulse text-signal-500" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--stats-detail-color)]">
                    Syncing
                  </span>
                </div>
              ) : null}
              
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
                <div className={`absolute inset-0 h-full w-full transition-opacity duration-300 motion-reduce:transition-none ${loading ? "opacity-60 pointer-events-none" : "opacity-100"}`}>
                  <UsageGraphEmpty />
                </div>
              ) : (
                <svg role="img" aria-labelledby="chart-summary-heading" viewBox={`0 0 ${width} ${height}`} className={`absolute inset-0 h-full w-full overflow-visible transition-opacity duration-300 motion-reduce:transition-none ${loading ? "opacity-60 pointer-events-none" : "opacity-100"}`}>
                  <defs>
                    {chartData.map((series) => (
                      <linearGradient key={`fill-${series.id}`} id={`stats-area-${series.id}`} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stop-color={series.accentHex} stop-opacity="0.25" />
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
            {buckets.length > 1 ? (
              <UsageChartMinimap
                buckets={buckets}
                zoomRange={zoomRange}
                onZoomChange={setZoomRange}
              />
            ) : null}
          </div>

          <div className="flex flex-col gap-6 w-full xl:w-auto">
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
              {activeBucket ? (() => {
                const hasCost = activeBucket.usage.totalCostUsd > 0;
                return (
                <div className="mt-6 space-y-4">
                  {hasCost ? (
                  <div className="flex items-center justify-between rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-4 shadow-sm transition-all hover:bg-emerald-500/[0.15]">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400">Total Cost</div>
                    <div className="text-base font-black text-[var(--stats-value-color)]">{formatCost(activeBucket.usage.totalCostUsd)}</div>
                  </div>
                ) : null}
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
                );
              })() : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
