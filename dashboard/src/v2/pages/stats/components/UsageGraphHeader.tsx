import type { FunctionComponent } from 'preact';
import { Activity, Filter, RotateCcw } from 'lucide-preact';
import { CHIP_CLASS, STATUS_TONE_CLASS, TAB_IDLE_CLASS } from './StatsShared.js';

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
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--stats-card-border)] bg-[color:var(--fill-muted)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--stats-detail-color)]">
          <Activity className="h-3.5 w-3.5 text-[color:var(--stats-signal-text)]" strokeWidth={2.2} />
          Usage Graph
          </div>
          <div className="mt-3 text-xl font-semibold leading-tight text-[var(--stats-value-color)] md:text-3xl">
            {title}
          </div>
          <div className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--stats-detail-color)]">
            {description}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button
            type="button"
            onClick={onToggleFilters}
            aria-expanded={isFiltersOpen}
            aria-describedby="usage-graph-filter-summary"
            className={`group inline-flex items-center gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors motion-reduce:transition-none active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-focus-ring)] ${CHIP_CLASS} ${
              isFiltersOpen
                ? STATUS_TONE_CLASS.signal
                : TAB_IDLE_CLASS
            }`}
          >
            <Filter className={`h-3.5 w-3.5 transition-colors motion-reduce:transition-none ${isFiltersOpen ? 'text-[color:var(--stats-signal-text)]' : 'text-[var(--stats-detail-color)] group-hover:text-[color:var(--stats-signal-text)]'}`} strokeWidth={2.2} />
            Filters
          </button>
          {isZoomed ? (
            <button
              type="button"
              onClick={onResetZoom}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-focus-ring)] motion-reduce:transition-none ${STATUS_TONE_CLASS.signal}`}
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
        className="relative z-40 flex flex-col gap-3 rounded-[1.2rem] border border-[var(--stats-card-border)] bg-[color:var(--fill-muted)] p-3 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-none sm:auto-cols-max sm:grid-flow-col">
          <div className={`${CHIP_CLASS} min-w-0 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]`}>
            <span className="sr-only">Selected range: </span>
            <span className="block truncate">{rangeLabel}</span>
          </div>
          <div className={`${CHIP_CLASS} px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]`}>
            {bucketCount.toLocaleString()} buckets
          </div>
          <div className={`${CHIP_CLASS} px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]`}>
            {resolutionLabel}
          </div>
          <div className={`${CHIP_CLASS} min-w-0 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]`}>
            <span className="sr-only">Active zoom: </span>
            <span className="block truncate">{isZoomed ? zoomLabel : 'Full range'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
