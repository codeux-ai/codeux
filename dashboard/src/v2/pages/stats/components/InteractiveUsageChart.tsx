import type { FunctionComponent } from 'preact';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import gsap from 'gsap';
import type {
  ProjectExecutionStatsSnapshot,
} from '../../../types.js';
import {
  formatDateTime,
} from '../stats-utils.js';
import {
  CHIP_CLASS,
  CONTROL_FOCUS_CLASS,
  PANEL_CLASS,
  SUBPANEL_CLASS,
} from './stats-ui-primitives.js';
import {
  getAxisLabelStep,
  formatAxisLabel,
} from './stats-formatters.js';
import { UsageChartMinimap } from './UsageChartMinimap.js';
import { UsageGraphLegend } from './UsageGraphLegend.js';
import type { UsageChartState } from '../use-usage-chart-state.js';
import {
  getVisibleBuckets,
  normalizeChartSeries,
  calculateChartMetrics,
  describeChartMetrics,
  getTooltipState,
  calculateHoverRect,
} from '../chart-view-models.js';
import { UsageGraphHeader } from './UsageGraphHeader.js';
import { UsageFilterMenu } from './UsageFilterMenu.js';
import { useUsageFilters } from '../hooks/useUsageFilters.js';
import { UsageGraphTooltip } from './UsageGraphTooltip.js';
import { UsageGraphEmpty, UsageGraphError } from './UsageGraphStates.js';
import { Activity } from 'lucide-preact';
import { useGsapInteractionTokens, useInteractionTokens } from '../../../lib/motion/index.js';

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
  const gsapTokens = useGsapInteractionTokens();
  const interactionTokens = useInteractionTokens();
  const [chartStatus, setChartStatus] = useState("Trend telemetry ready.");

  const handleSliderChange = (e: JSX.TargetedEvent<HTMLInputElement>) => {
    const val = parseInt(e.currentTarget.value, 10);
    setHoveredIndex(val);
  };

  const handleSliderKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (hoveredIndex !== null) {
        // Zoom into current bucket
        applyZoomRange({ start: hoveredIndex, end: hoveredIndex }, describeZoomRange(hoveredIndex, hoveredIndex));
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
    resetEnabledSeries,
    activeSeriesCount,
    seriesGroups,
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

  const visibleSeries = useMemo(
    () => chartData.filter((series) => enabledSeries[series.id]),
    [chartData, enabledSeries]
  );

  const { activeIndex, activeBucket, tooltipLeft, xPositions } = useMemo(() => getTooltipState(
    visibleBuckets, chartData, hoveredIndex, padding, width
  ), [visibleBuckets, chartData, hoveredIndex, padding, width]);
  const tooltipInspectionState = activeBucket
    ? zoomRange && zoomRange.start === zoomRange.end ? 'pinned' : 'focused'
    : 'idle';

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

  const visibleMetrics = useMemo(() => calculateChartMetrics(visibleBuckets), [visibleBuckets]);
  const activeSeriesLabels = useMemo(() => visibleSeries.map((series) => series.label), [visibleSeries]);
  const chartSummaryText = useMemo(
    () => describeChartMetrics(
      visibleMetrics,
      activeSeriesLabels,
      zoomLabel
    ),
    [activeSeriesLabels, visibleMetrics, zoomLabel]
  );
  const defaultSeriesCount = useMemo(
    () => seriesGroups.reduce((count, group) => count + group.defaultEnabledCount, 0),
    [seriesGroups]
  );
  const totalSeriesCount = useMemo(
    () => seriesGroups.reduce((count, group) => count + group.totalCount, 0),
    [seriesGroups]
  );
  const resetSeriesCount = defaultSeriesCount > 0
    ? defaultSeriesCount
    : totalSeriesCount > 0
      ? 1
      : 0;

  const describeZoomRange = (start: number, end: number): string => {
    const startLabel = buckets[start]?.label ?? `bucket ${start + 1}`;
    const endLabel = buckets[end]?.label ?? `bucket ${end + 1}`;
    return start === end
      ? `Pinned ${startLabel}.`
      : `Zoomed to ${startLabel} through ${endLabel}, ${end - start + 1} buckets.`;
  };

  const applyZoomRange = (range: { start: number; end: number } | null, status: string) => {
    setZoomRange(range);
    setChartStatus(status);
  };

  useEffect(() => {
    const handleMouseUp = () => {
      if (dragStartIndex === null || dragCurrentIndex === null) {
        return;
      }
      const start = Math.min(dragStartIndex, dragCurrentIndex);
      const end = Math.max(dragStartIndex, dragCurrentIndex);
      if (end - start >= 1) {
        applyZoomRange({ start, end }, describeZoomRange(start, end));
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
        timeline.to(path, { strokeDashoffset: 0, duration: gsapTokens.listReveal.duration, ease: gsapTokens.listReveal.ease, clearProps: "strokeDashoffset,strokeDasharray" }, 0);
      });
      if (areas.length > 0) {
        timeline.to(areas, { opacity: (_index, target) => Number((target as SVGPathElement).dataset.areaOpacity || "0.3"), duration: gsapTokens.selectionMovement.duration, stagger: gsapTokens.controlFeedback.duration / 2, ease: gsapTokens.selectionMovement.ease }, gsapTokens.controlFeedback.duration);
      }
      if (pointsNodes.length > 0) {
        timeline.to(pointsNodes, { opacity: 1, scale: 1, duration: gsapTokens.controlFeedback.duration, stagger: gsapTokens.controlFeedback.duration / 12, ease: gsapTokens.controlFeedback.ease }, gsapTokens.selectionMovement.duration);
      }
      if (cards.length > 0) {
        timeline.fromTo(cards, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: gsapTokens.listReveal.duration, stagger: gsapTokens.controlFeedback.duration / 3, ease: gsapTokens.listReveal.ease }, gsapTokens.controlFeedback.duration);
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
  }, [enabledSeries, visibleBuckets.length, stats.range.from, stats.range.to, gsapTokens.controlFeedback.duration, gsapTokens.controlFeedback.ease, gsapTokens.listReveal.duration, gsapTokens.listReveal.ease, gsapTokens.selectionMovement.duration, gsapTokens.selectionMovement.ease]);

  useEffect(() => {
    if (error) {
      setChartStatus(`Trend telemetry error: ${error}`);
    } else if (loading) {
      setChartStatus("Refreshing trend telemetry from cache. Existing chart data remains visible.");
    } else {
      setChartStatus("Trend telemetry ready.");
    }
  }, [error, loading]);

  const onToggleSeries = (id: string) => {
    if (activeSeriesCount === 1 && enabledSeries[id]) {
      setChartStatus("Keep at least one series enabled. The last active series cannot be turned off.");
      return;
    }
    const seriesLabel = stats.chartSeries.find((series) => series.id === id)?.label ?? id;
    const nextEnabled = !enabledSeries[id];
    setEnabledSeries((curr: Record<string, boolean>) => ({ ...curr, [id]: !curr[id] }));
    setChartStatus(`${seriesLabel} series ${nextEnabled ? "enabled" : "disabled"}. ${activeSeriesCount + (nextEnabled ? 1 : -1)} series active.`);
  };

  const onResetSeriesDefaults = () => {
    resetEnabledSeries();
    setChartStatus(`Graph filters reset. ${resetSeriesCount} series active.`);
  };

  const onEnableDefaultSeries = () => {
    setEnabledSeries((curr: Record<string, boolean>) => {
      const next = { ...curr };
      for (const group of seriesGroups) {
        for (const series of group.series) {
          if (series.defaultEnabled) {
            next[series.id] = true;
          }
        }
      }
      return next;
    });
    const newlyEnabledDefaults = seriesGroups.reduce((count, group) => (
      count + group.series.filter((series) => series.defaultEnabled && !enabledSeries[series.id]).length
    ), 0);
    setChartStatus(`Default series enabled. ${Math.max(activeSeriesCount + newlyEnabledDefaults, resetSeriesCount)} series active.`);
  };

  return (
    <div ref={panelRef} className={`${PANEL_CLASS} p-3 md:p-4`}>
      <div className="relative flex flex-col gap-4">
        {/* Screen reader summary */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          <h2 id="chart-summary-heading" className="sr-only">Data Visualization for {zoomRange ? "zoomed timeframe" : stats.range.label}</h2>
          <p>
            {chartSummaryText}
            {activeBucket ? `Focused bucket: ${activeBucket.label}. Tokens: ${activeBucket.usage.totalTokens}` : "No bucket focused."}
          </p>
          <table className="sr-only">
            <caption>Usage chart data for {zoomLabel}</caption>
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
          onResetZoom={() => applyZoomRange(null, `Zoom reset to ${stats.range.label}.`)}
        />

        <div className="relative z-50">
          <UsageFilterMenu
            isOpen={isFiltersOpen}
            onClose={closeFilters}
            stats={stats}
            enabledSeries={enabledSeries}
            setEnabledSeries={setEnabledSeries}
            resetEnabledSeries={resetEnabledSeries}
            activeSeriesCount={activeSeriesCount}
            seriesGroups={seriesGroups}
            onStatusChange={setChartStatus}
          />
        </div>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {chartStatus}
        </div>

        <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-3">
            <div id="usage-chart-instructions" className={`${SUBPANEL_CLASS} flex flex-wrap items-center justify-between gap-3 px-3 py-2.5`}>
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--stats-label-color)]">Interactive plot</div>
                <div className="mt-1 text-xs leading-relaxed text-[var(--stats-detail-color)]">
                  Drag the plot or minimap to zoom. Hover, focus, or use the slider to inspect a bucket.
                </div>
              </div>
              <div className={`${CHIP_CLASS} px-3 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]`}>
                {visibleSeries.length} visible series
              </div>
            </div>

            <div className={`${SUBPANEL_CLASS} p-2.5 md:p-3`}>
              <div ref={svgContainerRef} className="relative h-[clamp(32rem,62vh,52rem)] w-full">
                {error ? (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[var(--stats-subpanel-radius)] bg-[color:var(--stats-surface-panel)]">
                    <UsageGraphError message={error} onRetry={() => { refresh().catch(() => {}); }} />
                  </div>
                ) : null}
                {loading && !error ? (
                  <div className={`${CHIP_CLASS} absolute right-3 top-3 z-20 flex items-center gap-2 px-3 py-1.5`} role="status" aria-live="polite" aria-busy="true" aria-label="Loading new chart data">
                    <Activity className="h-3.5 w-3.5 animate-pulse text-[color:var(--stats-signal-text)] motion-reduce:animate-none" aria-hidden="true" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]">
                      Syncing
                    </span>
                  </div>
                ) : null}
                {buckets.length === 0 ? (
                  <div className={`absolute inset-0 h-full w-full transition-opacity motion-reduce:transition-none ${loading ? "opacity-60 pointer-events-none" : "opacity-100"}`} style={{ transitionDuration: interactionTokens.asyncFeedback.duration, transitionTimingFunction: interactionTokens.asyncFeedback.ease }}>
                    <UsageGraphEmpty onReset={() => applyZoomRange(null, `Zoom reset to ${stats.range.label}.`)} />
                  </div>
                ) : (
                  <svg role="img" aria-labelledby="chart-summary-heading" aria-busy={loading ? "true" : "false"} viewBox={`0 0 ${width} ${height}`} className={`absolute inset-0 h-full w-full overflow-visible transition-opacity motion-reduce:transition-none ${loading ? "opacity-60 pointer-events-none" : "opacity-100"}`} style={{ transitionDuration: interactionTokens.asyncFeedback.duration, transitionTimingFunction: interactionTokens.asyncFeedback.ease }}>
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
                        rx="6"
                        fill="var(--stats-selection-fill)"
                        stroke="var(--stats-selection-border)"
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
                          stroke="var(--stats-surface-subpanel)"
                          strokeWidth={hoveredIndex === index ? 2 : 0}
                          fillOpacity={hoveredIndex === null || hoveredIndex === index ? 0.9 : 0.32}
                          style={{ transition: `r ${interactionTokens.selectionMovement.duration} ${interactionTokens.selectionMovement.ease}, fill-opacity ${interactionTokens.selectionMovement.duration} ${interactionTokens.selectionMovement.ease}, stroke-width ${interactionTokens.selectionMovement.duration} ${interactionTokens.selectionMovement.ease}` }}
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
                          role="button"
                          x={startX}
                          y={padding}
                          width={rectWidth}
                          height={height - padding * 2}
                          fill="transparent"
                          className="focus:outline-none focus:ring-2 focus:ring-[color:var(--stats-focus-ring)]"
                          onMouseDown={() => {
                            setDragStartIndex(absoluteIndex);
                            setDragCurrentIndex(absoluteIndex);
                          }}
                          onMouseEnter={() => setHoveredIndex(index)}
                          onFocus={() => setHoveredIndex(index)}
                          onBlur={() => setHoveredIndex(null)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") {
                              return;
                            }

                            event.preventDefault();
                            setHoveredIndex(index);
                            applyZoomRange({ start: absoluteIndex, end: absoluteIndex }, describeZoomRange(absoluteIndex, absoluteIndex));
                          }}
                          aria-describedby="usage-chart-instructions"
                          aria-label={buckets[absoluteIndex]
                            ? `${buckets[absoluteIndex].label} bucket: ${visibleSeries.map((series) => `${series.label} ${series.formatter(series.values[index] ?? 0)}`).join(", ")}`
                            : "Telemetry bucket"}
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
                              applyZoomRange({ start, end }, describeZoomRange(start, end));
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
                  onStatusChange={setChartStatus}
                />
              ) : null}
            </div>
          </div>

          <aside className="flex h-full min-w-0 flex-col gap-3 xl:sticky xl:top-6 xl:max-h-[clamp(32rem,62vh,52rem)] xl:overflow-y-auto xl:pr-1">
            <div className={`${SUBPANEL_CLASS} flex h-full min-h-full flex-col overflow-y-auto p-3`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--stats-label-color)]">Focused bucket</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--stats-value-color)]">
                    {activeBucket ? activeBucket.label : "No bucket focused"}
                  </div>
                </div>
                <div className={`${CHIP_CLASS} px-3 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]`}>
                  {visibleSeries.length} visible
                </div>
              </div>
              <UsageGraphTooltip
                visible={!!activeBucket}
                left={tooltipLeft}
                label={activeBucket?.label || ""}
                bucketStart={activeBucket?.bucketStart || ""}
                bucket={activeBucket}
                inspectionState={tooltipInspectionState}
                activeSeries={visibleSeries.map((s) => ({
                  id: s.id,
                  label: s.label,
                  accentHex: s.accentHex,
                  value: s.formatter(s.values[activeIndex] ?? 0)
                }))}
              />
              <div className={`${SUBPANEL_CLASS} mt-4 p-4`}>
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
                  aria-describedby="usage-chart-tooltip usage-chart-instructions"
                  aria-valuetext={activeBucket ? `${activeBucket.label}, ${visibleSeries.map((s) => `${s.label}: ${s.formatter(s.values[activeIndex] ?? 0)}`).join(', ')}` : 'No bucket focused'}
                  className="mt-3 w-full accent-[color:var(--stats-focus-ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--stats-focus-ring)]"
                  disabled={visibleBuckets.length === 0}
                />
                <div className="mt-2 text-[11px] leading-relaxed text-[var(--stats-detail-color)]">
                  Use arrow keys, drag, or hover to move through the active window. Press Enter to zoom the focused bucket.
                </div>
              </div>
            </div>

          </aside>
        </div>

        <div className={`${SUBPANEL_CLASS} p-3`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--stats-label-color)]">Series switches</div>
              <div className="mt-1 text-xs leading-relaxed text-[var(--stats-detail-color)]">
                Toggle chart lines by category without leaving the usage graph.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label="Reset series defaults"
                onClick={onResetSeriesDefaults}
                className={`${CHIP_CLASS} px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)] hover:border-[color:var(--stats-border-strong)] hover:bg-[color:var(--stats-surface-chip-hover)] hover:text-[var(--stats-value-color)] ${CONTROL_FOCUS_CLASS}`}
              >
                Reset defaults
              </button>
              {defaultSeriesCount > 0 ? (
                <button
                  type="button"
                  onClick={onEnableDefaultSeries}
                  className={`${CHIP_CLASS} px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)] hover:border-[color:var(--stats-border-strong)] hover:bg-[color:var(--stats-surface-chip-hover)] hover:text-[var(--stats-value-color)] ${CONTROL_FOCUS_CLASS}`}
                >
                  Enable defaults
                </button>
              ) : null}
              <div className={`${CHIP_CLASS} px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]`}>
                {activeSeriesCount}/{totalSeriesCount} active
              </div>
            </div>
          </div>
          <UsageGraphLegend
            seriesGroups={seriesGroups}
            enabledSeries={enabledSeries}
            activeSeriesCount={activeSeriesCount}
            onToggleSeries={onToggleSeries}
            className="[grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))]"
            seriesGridClassName="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr))]"
          />
        </div>
      </div>
    </div>
  );
};
