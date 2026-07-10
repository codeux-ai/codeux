import type { FunctionComponent } from 'preact';
import { Activity, Filter, RotateCcw } from 'lucide-preact';
import {
  CHIP_CLASS,
  CONTROL_FOCUS_CLASS,
  STATUS_TONE_CLASS,
  TAB_ACTIVE_CLASS,
  TAB_IDLE_CLASS,
} from './stats-ui-primitives.js';

export const UsageGraphHeader: FunctionComponent<{
  title: string;
  description: string;
  rangeLabel: string;
  bucketCount: number;
  resolutionLabel: string;
  zoomLabel: string;
  isZoomed: boolean;
  isFiltersOpen: boolean;
  activeSeriesCount: number;
  onToggleFilters: () => void;
  onResetZoom: () => void;
}> = ({
  title,
  description,
  rangeLabel,
  bucketCount,
  resolutionLabel,
  zoomLabel,
  isZoomed,
  isFiltersOpen,
  activeSeriesCount,
  onToggleFilters,
  onResetZoom,
}) => {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--stats-label-color)]">
            <Activity className="h-3.5 w-3.5" strokeWidth={2.2} />
            Usage Graph
          </div>
          <h2 className="mt-1 text-lg font-semibold leading-tight text-[var(--stats-value-color)] md:text-xl">
            {title}
          </h2>
          <div className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--stats-detail-color)] sm:text-sm">
            {description}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2 md:justify-end">
          <button
            type="button"
            onClick={onToggleFilters}
            aria-expanded={isFiltersOpen}
            aria-describedby="usage-graph-filter-summary"
            className={`group inline-flex items-center gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] ${CONTROL_FOCUS_CLASS} ${CHIP_CLASS} ${
              isFiltersOpen
                ? TAB_ACTIVE_CLASS
                : TAB_IDLE_CLASS
            }`}
          >
            <Filter className={`h-3.5 w-3.5 transition-colors motion-reduce:transition-none ${isFiltersOpen ? 'text-[color:var(--stats-signal-text)]' : 'text-[var(--stats-detail-color)] group-hover:text-[color:var(--stats-signal-text)]'}`} strokeWidth={2.2} />
            Filters
            <span aria-hidden="true" className="rounded-[var(--stats-chip-radius)] border border-current/20 px-1.5 py-0.5 text-[9px] leading-none">
              {activeSeriesCount}
            </span>
          </button>
          {isZoomed ? (
            <button
              type="button"
              onClick={onResetZoom}
              className={`inline-flex items-center gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] ${CONTROL_FOCUS_CLASS} ${CHIP_CLASS} ${STATUS_TONE_CLASS.signal}`}
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.2} />
              Reset zoom <span className="sr-only">to {rangeLabel}</span>
            </button>
          ) : null}
          <span id="usage-graph-filter-summary" className="sr-only">
            {activeSeriesCount} active series.
          </span>
        </div>
      </div>

      <div
        role="toolbar"
        aria-label="Usage graph controls"
        className="relative z-40 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-y border-[color:var(--stats-border-hairline)] py-2"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]">
          <div className="min-w-0 max-w-full">
            <span className="sr-only">Selected range: </span>
            <span className="block break-words">{rangeLabel}</span>
          </div>
          <span aria-hidden="true" className="text-[color:var(--stats-border-strong)]">/</span>
          <div>
            {bucketCount.toLocaleString()} buckets
          </div>
          <span aria-hidden="true" className="text-[color:var(--stats-border-strong)]">/</span>
          <div>
            {resolutionLabel}
          </div>
          <span aria-hidden="true" className="text-[color:var(--stats-border-strong)]">/</span>
          <div className="min-w-0 max-w-full">
            <span className="sr-only">Active zoom: </span>
            <span className="block break-words">{isZoomed ? zoomLabel : 'Full range'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
