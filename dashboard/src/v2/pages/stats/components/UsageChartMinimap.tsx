import type { FunctionComponent, JSX } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import type { ExecutionUsageBucketSummary } from "../../../types.js";
import type { ChartZoomRange } from "./stats-ui-primitives.js";
import { buildSmoothAreaPath, buildSmoothPath, buildPoints } from "./stats-geometry.js";

const MINIMAP_WIDTH = 1000;
const MINIMAP_HEIGHT = 72;
const MINIMAP_PADDING = 8;

/**
 * Always-visible overview strip under the main plot. Shows the full window's
 * token shape and lets the user drag a region to zoom (or move/clear the
 * current zoom window) without losing the surrounding context.
 */
export const UsageChartMinimap: FunctionComponent<{
  buckets: ExecutionUsageBucketSummary[];
  zoomRange: ChartZoomRange | null;
  onZoomChange: (range: ChartZoomRange | null) => void;
  accentHex?: string;
}> = ({ buckets, zoomRange, onZoomChange, accentHex = "#00E0A0" }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const values = buckets.map((bucket) => bucket.usage.totalTokens);
    const points = buildPoints(values.length > 0 ? values : [0], MINIMAP_WIDTH, MINIMAP_HEIGHT, MINIMAP_PADDING);
    return {
      path: buildSmoothPath(points),
      areaPath: buildSmoothAreaPath(points, MINIMAP_HEIGHT, MINIMAP_PADDING),
    };
  }, [buckets]);

  const lastIndex = buckets.length - 1;
  const hasZoomableRange = buckets.length > 1;

  const indexToX = (index: number): number =>
    lastIndex <= 0
      ? MINIMAP_PADDING
      : MINIMAP_PADDING + (index / lastIndex) * (MINIMAP_WIDTH - MINIMAP_PADDING * 2);

  const clientXToIndex = (clientX: number): number => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return 0;
    }
    const fraction = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(lastIndex, Math.round(fraction * lastIndex)));
  };

  const selection = dragStart !== null && dragCurrent !== null
    ? { start: Math.min(dragStart, dragCurrent), end: Math.max(dragStart, dragCurrent) }
    : null;

  const windowBounds = selection ?? zoomRange;

  const handlePointerDown = (event: PointerEvent) => {
    if (!hasZoomableRange) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const index = clientXToIndex(event.clientX);
    setDragStart(index);
    setDragCurrent(index);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (dragStart === null || !hasZoomableRange) {
      return;
    }
    setDragCurrent(clientXToIndex(event.clientX));
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (dragStart === null) {
      return;
    }
    const endIndex = clientXToIndex(event.clientX);
    const start = Math.min(dragStart, endIndex);
    const end = Math.max(dragStart, endIndex);
    setDragStart(null);
    setDragCurrent(null);
    if (end - start >= 1 && !(start === 0 && end === lastIndex)) {
      onZoomChange({ start, end });
    } else if (start === end) {
      // A simple click clears the zoom and restores the full window.
      onZoomChange(null);
    }
  };

  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!hasZoomableRange) {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onZoomChange(null);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onZoomChange(null);
      return;
    }

    if (!zoomRange) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onZoomChange({ start: 0, end: lastIndex });
      }
      return;
    }

    const span = Math.max(1, zoomRange.end - zoomRange.start);
    const moveRange = (delta: number) => {
      const nextStart = Math.max(0, Math.min(lastIndex - span, zoomRange.start + delta));
      onZoomChange({ start: nextStart, end: nextStart + span });
    };

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveRange(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveRange(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      onZoomChange({ start: 0, end: Math.min(lastIndex, span) });
    } else if (event.key === "End") {
      event.preventDefault();
      onZoomChange({ start: Math.max(0, lastIndex - span), end: lastIndex });
    }
  };

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div id="usage-chart-minimap-help" className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--stats-label-color,theme(colors.slate.400))]">
          Overview - drag to zoom, arrow keys to pan, escape to reset
        </div>
        {zoomRange ? (
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
            {zoomRange.end - zoomRange.start + 1} of {buckets.length} buckets
          </div>
        ) : !hasZoomableRange ? (
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]">
            Single-bucket view
          </div>
        ) : null}
      </div>
      <div
        ref={containerRef}
        data-testid="usage-chart-minimap"
        role="region"
        aria-label={zoomRange
          ? `Chart minimap zoom region, showing buckets ${zoomRange.start + 1} through ${zoomRange.end + 1} of ${buckets.length}`
          : `Chart minimap zoom region, full range of ${buckets.length} bucket${buckets.length === 1 ? '' : 's'}`}
        aria-describedby="usage-chart-minimap-help"
        aria-disabled={!hasZoomableRange ? "true" : undefined}
        tabIndex={0}
        className={`relative h-16 w-full select-none overflow-hidden rounded-[1rem] border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/72 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--stats-card-bg)] ${hasZoomableRange ? 'cursor-crosshair touch-none' : 'cursor-default opacity-75'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <div className="sr-only" aria-live="polite">
          {zoomRange
            ? `Showing ${zoomRange.end - zoomRange.start + 1} of ${buckets.length} buckets.`
            : hasZoomableRange
              ? 'Zoom reset. Use arrow keys to pan and escape to clear.'
              : 'Single-bucket view. Zoom is unavailable until more buckets exist.'}
        </div>
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id="stats-minimap-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color={accentHex} stop-opacity="0.14" />
              <stop offset="100%" stop-color={accentHex} stop-opacity="0.015" />
            </linearGradient>
          </defs>
          <path d={geometry.areaPath} fill="url(#stats-minimap-fill)" />
          <path d={geometry.path} fill="none" stroke={accentHex} stroke-opacity="0.82" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
          {windowBounds && hasZoomableRange ? (
            <g>
              <rect
                x="0"
                y="0"
                width={Math.max(0, indexToX(windowBounds.start))}
                height={MINIMAP_HEIGHT}
                fill="rgba(15,23,42,0.1)"
              />
              <rect
                x={indexToX(windowBounds.end)}
                y="0"
                width={Math.max(0, MINIMAP_WIDTH - indexToX(windowBounds.end))}
                height={MINIMAP_HEIGHT}
                fill="rgba(15,23,42,0.1)"
              />
              <rect
                x={indexToX(windowBounds.start)}
                y="1"
                width={Math.max(4, indexToX(windowBounds.end) - indexToX(windowBounds.start))}
                height={MINIMAP_HEIGHT - 2}
                fill="rgba(255, 184, 0, 0.08)"
                stroke="rgba(255, 184, 0, 0.32)"
                stroke-width="1.5"
                rx="6"
                vector-effect="non-scaling-stroke"
              />
              <rect x={indexToX(windowBounds.start) - 1.5} y={MINIMAP_HEIGHT / 2 - 9} width="3" height="18" rx="1.5" fill={accentHex} fill-opacity="0.86" />
              <rect x={indexToX(windowBounds.end) - 1.5} y={MINIMAP_HEIGHT / 2 - 9} width="3" height="18" rx="1.5" fill={accentHex} fill-opacity="0.86" />
            </g>
          ) : null}
        </svg>
        {!hasZoomableRange ? (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]">
            Zoom becomes available after the next bucket lands.
          </div>
        ) : null}
      </div>
    </div>
  );
};
