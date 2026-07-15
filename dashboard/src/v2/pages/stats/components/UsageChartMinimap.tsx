import type { FunctionComponent, JSX } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import type { ExecutionUsageBucketSummary } from "../../../types.js";
import { CONTROL_FOCUS_CLASS, SUBPANEL_CLASS, type ChartZoomRange } from "./stats-ui-primitives.js";
import { buildSmoothAreaPath, buildSmoothPath, buildPoints } from "./stats-geometry.js";
import { useStatsI18n } from "../stats-i18n.js";

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
  onStatusChange?: (message: string) => void;
  accentHex?: string;
}> = ({ buckets, zoomRange, onZoomChange, onStatusChange, accentHex = "var(--stats-accent-signal)" }) => {
  const { locale, formatNumber } = useStatsI18n();
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
  const showBucketLabels = buckets.length > 1 && buckets.length <= 14;

  const indexToX = (index: number): number =>
    lastIndex <= 0
      ? MINIMAP_PADDING
      : MINIMAP_PADDING + (index / lastIndex) * (MINIMAP_WIDTH - MINIMAP_PADDING * 2);

  const describeRange = (start: number, end: number): string => {
    const startLabel = buckets[start]?.label ?? `${locale === "de" ? "Intervall" : "bucket"} ${formatNumber(start + 1)}`;
    const endLabel = buckets[end]?.label ?? `${locale === "de" ? "Intervall" : "bucket"} ${formatNumber(end + 1)}`;
    return locale === "de" ? `Übersicht auf ${startLabel} bis ${endLabel} gezoomt, ${formatNumber(end - start + 1)} von ${formatNumber(buckets.length)} Intervallen.` : `Zoomed overview to ${startLabel} through ${endLabel}, ${formatNumber(end - start + 1)} of ${formatNumber(buckets.length)} buckets.`;
  };

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
      onStatusChange?.(describeRange(start, end));
    } else if (start === end) {
      // A simple click clears the zoom and restores the full window.
      onZoomChange(null);
      onStatusChange?.(locale === "de" ? `Zoom auf den gesamten Zeitraum mit ${formatNumber(buckets.length)} Intervallen zurückgesetzt.` : `Zoom reset to the full ${formatNumber(buckets.length)}-bucket range.`);
    }
  };

  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!hasZoomableRange) {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onZoomChange(null);
        onStatusChange?.(locale === "de" ? 'Ansicht mit einem Intervall. Zoom ist erst mit weiteren Intervallen verfügbar.' : 'Single-bucket view. Zoom is unavailable until more buckets exist.');
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onZoomChange(null);
      onStatusChange?.(locale === "de" ? `Zoom auf den gesamten Zeitraum mit ${formatNumber(buckets.length)} Intervallen zurückgesetzt.` : `Zoom reset to the full ${formatNumber(buckets.length)}-bucket range.`);
      return;
    }

    if (!zoomRange) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onZoomChange({ start: 0, end: lastIndex });
        onStatusChange?.(locale === "de" ? `Übersicht auf den gesamten Zeitraum mit ${formatNumber(buckets.length)} Intervallen fixiert.` : `Pinned overview to the full ${formatNumber(buckets.length)}-bucket range.`);
      }
      return;
    }

    const span = Math.max(1, zoomRange.end - zoomRange.start);
    const moveRange = (delta: number) => {
      const nextStart = Math.max(0, Math.min(lastIndex - span, zoomRange.start + delta));
      onZoomChange({ start: nextStart, end: nextStart + span });
      onStatusChange?.(describeRange(nextStart, nextStart + span));
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
      onStatusChange?.(describeRange(0, Math.min(lastIndex, span)));
    } else if (event.key === "End") {
      event.preventDefault();
      onZoomChange({ start: Math.max(0, lastIndex - span), end: lastIndex });
      onStatusChange?.(describeRange(Math.max(0, lastIndex - span), lastIndex));
    }
  };

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div id="usage-chart-minimap-help" className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--stats-label-color,theme(colors.slate.400))]">
          {locale === "de" ? "Übersicht – zum Zoomen ziehen, mit Pfeiltasten verschieben, mit Escape zurücksetzen" : "Overview - drag to zoom, arrow keys to pan, escape to reset"}
        </div>
        {zoomRange ? (
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-signal-text)]">
            {formatNumber(zoomRange.end - zoomRange.start + 1)} {locale === "de" ? "von" : "of"} {formatNumber(buckets.length)} {locale === "de" ? "Intervallen" : "buckets"}
          </div>
        ) : !hasZoomableRange ? (
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)]">
            {locale === "de" ? "Ansicht mit einem Intervall" : "Single-bucket view"}
          </div>
        ) : null}
      </div>
      <div
        ref={containerRef}
        data-testid="usage-chart-minimap"
        role="region"
        aria-label={zoomRange
          ? (locale === "de" ? `Zoomregion der Diagramm-Minimap, Intervalle ${formatNumber(zoomRange.start + 1)} bis ${formatNumber(zoomRange.end + 1)} von ${formatNumber(buckets.length)}` : `Chart minimap zoom region, showing buckets ${formatNumber(zoomRange.start + 1)} through ${formatNumber(zoomRange.end + 1)} of ${formatNumber(buckets.length)}`)
          : (locale === "de" ? `Zoomregion der Diagramm-Minimap, gesamter Zeitraum mit ${formatNumber(buckets.length)} Intervallen` : `Chart minimap zoom region, full range of ${formatNumber(buckets.length)} bucket${buckets.length === 1 ? '' : 's'}`)}
        aria-describedby="usage-chart-minimap-help"
        aria-disabled={!hasZoomableRange ? "true" : undefined}
        tabIndex={0}
        className={`${SUBPANEL_CLASS} relative h-16 w-full select-none overflow-hidden p-0 ${CONTROL_FOCUS_CLASS} ${hasZoomableRange ? 'cursor-crosshair touch-none' : 'cursor-default opacity-75'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <div className="sr-only" aria-live="polite">
          {zoomRange
            ? (locale === "de" ? `${formatNumber(zoomRange.end - zoomRange.start + 1)} von ${formatNumber(buckets.length)} Intervallen, ${buckets[zoomRange.start]?.label ?? "Start"} bis ${buckets[zoomRange.end]?.label ?? "Ende"}.` : `Showing ${formatNumber(zoomRange.end - zoomRange.start + 1)} of ${formatNumber(buckets.length)} buckets, ${buckets[zoomRange.start]?.label ?? "start"} through ${buckets[zoomRange.end]?.label ?? "end"}.`)
            : hasZoomableRange
              ? (locale === "de" ? `Gesamter Zeitraum mit ${formatNumber(buckets.length)} Intervallen angezeigt. Zum Zoomen ziehen oder die Eingabetaste drücken, um den Zeitraum zu fixieren.` : `Full ${formatNumber(buckets.length)}-bucket range shown. Drag to zoom or press Enter to pin the full range.`)
              : (locale === "de" ? 'Ansicht mit einem Intervall. Zoom ist erst mit weiteren Intervallen verfügbar.' : 'Single-bucket view. Zoom is unavailable until more buckets exist.')}
        </div>
        <div className="sr-only">
          {locale === "de" ? "Intervallreihenfolge der Minimap" : "Minimap bucket order"}: {buckets.map((bucket, index) => `${formatNumber(index + 1)}. ${bucket.label}, ${formatNumber(bucket.usage.totalTokens)} Tokens`).join("; ")}.
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
                fill="var(--stats-scrim)"
              />
              <rect
                x={indexToX(windowBounds.end)}
                y="0"
                width={Math.max(0, MINIMAP_WIDTH - indexToX(windowBounds.end))}
                height={MINIMAP_HEIGHT}
                fill="var(--stats-scrim)"
              />
              <rect
                x={indexToX(windowBounds.start)}
                y="1"
                width={Math.max(4, indexToX(windowBounds.end) - indexToX(windowBounds.start))}
                height={MINIMAP_HEIGHT - 2}
                fill="var(--stats-window-fill)"
                stroke="var(--stats-window-border)"
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
            {locale === "de" ? "Zoom wird verfügbar, sobald das nächste Intervall eintrifft." : "Zoom becomes available after the next bucket lands."}
          </div>
        ) : null}
      </div>
      {showBucketLabels ? (
        <div className="mt-2 grid gap-1 text-center text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
          {buckets.map((bucket) => (
            <span key={bucket.bucketStart} className="min-w-0 truncate" title={bucket.label}>
              {bucket.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
};
