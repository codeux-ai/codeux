import type { FunctionComponent } from "preact";
import type { NormalizedChartSeries } from "../chart-view-models.js";

export const UsageSeriesSidebar: FunctionComponent<{
  series: NormalizedChartSeries[];
  enabledSeries: Record<string, boolean>;
  activeIndex: number;
}> = ({ series, enabledSeries, activeIndex }) => {
  const visibleSeries = series.filter(s => enabledSeries[s.id]);

  return visibleSeries.length > 0 ? (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
      {visibleSeries.map((s) => {
        const currentValue = s.values[activeIndex] || 0;

        return (
          <div
            key={s.id}
            className="rounded-[1.35rem] border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/60 px-4 py-4 shadow-sm transition-colors hover:bg-[var(--stats-card-bg)] focus-within:border-signal-500/30"
          >
            <div className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/10" style={{ backgroundColor: s.accentHex }} />
              <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">{s.label}</span>
            </div>
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
              <div className="min-w-0 text-xl font-black text-[var(--stats-value-color)]">{s.formatter(currentValue)}</div>
              <div className="text-right text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--stats-detail-color)] opacity-80">{s.signalLabel || 'Metric'}</div>
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    <div className="rounded-[1.35rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/40 px-4 py-6 text-sm text-[var(--stats-detail-color)]">
      Focus a bucket to see live series values.
    </div>
  );
};
