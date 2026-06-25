import type { FunctionComponent } from "preact";
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

  if (buckets.length < 2) {
    return null;
  }

  const lastIndex = buckets.length - 1;

  const indexToX = (index: number): number =>
    MINIMAP_PADDING + (index / lastIndex) * (MINIMAP_WIDTH - MINIMAP_PADDING * 2);

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
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const index = clientXToIndex(event.clientX);
    setDragStart(index);
    setDragCurrent(index);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (dragStart === null) {
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

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--stats-label-color,theme(colors.slate.400))]">
          Overview · drag to zoom, click to reset
        </div>
        {zoomRange ? (
          <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-signal-500">
            {zoomRange.end - zoomRange.start + 1} of {buckets.length} buckets
          </div>
        ) : null}
      </div>
      <div
        ref={containerRef}
        data-testid="usage-chart-minimap"
        tabIndex={0}
        className="relative h-[4.5rem] w-full cursor-crosshair touch-none select-none overflow-hidden rounded-2xl border border-black/[0.05] bg-black/[0.02] dark:border-white/[0.06] dark:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onZoomChange(null);
          }
        }}
      >
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id="stats-minimap-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color={accentHex} stop-opacity="0.3" />
              <stop offset="100%" stop-color={accentHex} stop-opacity="0.02" />
            </linearGradient>
          </defs>
          <path d={geometry.areaPath} fill="url(#stats-minimap-fill)" />
          <path d={geometry.path} fill="none" stroke={accentHex} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
          {windowBounds ? (
            <g>
              <rect
                x="0"
                y="0"
                width={Math.max(0, indexToX(windowBounds.start))}
                height={MINIMAP_HEIGHT}
                fill="rgba(15,23,42,0.18)"
              />
              <rect
                x={indexToX(windowBounds.end)}
                y="0"
                width={Math.max(0, MINIMAP_WIDTH - indexToX(windowBounds.end))}
                height={MINIMAP_HEIGHT}
                fill="rgba(15,23,42,0.18)"
              />
              <rect
                x={indexToX(windowBounds.start)}
                y="1"
                width={Math.max(4, indexToX(windowBounds.end) - indexToX(windowBounds.start))}
                height={MINIMAP_HEIGHT - 2}
                fill="rgba(255, 184, 0, 0.12)"
                stroke="rgba(255, 184, 0, 0.5)"
                stroke-width="1.5"
                rx="6"
                vector-effect="non-scaling-stroke"
              />
              <rect x={indexToX(windowBounds.start) - 2} y={MINIMAP_HEIGHT / 2 - 10} width="4" height="20" rx="2" fill={accentHex} />
              <rect x={indexToX(windowBounds.end) - 2} y={MINIMAP_HEIGHT / 2 - 10} width="4" height="20" rx="2" fill={accentHex} />
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
};
