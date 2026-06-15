import type { FunctionComponent } from "preact";
import type { NormalizedChartSeries } from "../chart-view-models.js";

export const UsageSeriesSidebar: FunctionComponent<{
  series: NormalizedChartSeries[];
  enabledSeries: Record<string, boolean>;
  activeIndex: number;
}> = ({ series, enabledSeries, activeIndex }) => {
  const visibleSeries = series.filter(s => enabledSeries[s.id]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:flex xl:flex-col gap-4">
      {visibleSeries.map((s) => {
        const currentValue = s.values[activeIndex] || 0;

        return (
          <div
            key={s.id}
            className="rounded-[1.25rem] border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/40 px-5 py-4 shadow-sm transition-all hover:bg-[var(--stats-card-bg)]/60"
          >
            <div className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/10" style={{ backgroundColor: s.accentHex }} />
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)] truncate">{s.label}</span>
            </div>
            <div className="mt-4 flex items-end justify-between gap-4">
              <div className="text-xl font-black text-[var(--stats-value-color)] truncate">{s.formatter(currentValue)}</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--stats-detail-color)] opacity-70">{s.signalLabel || 'Metric'}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
