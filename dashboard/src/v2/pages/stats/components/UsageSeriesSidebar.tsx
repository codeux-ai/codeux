import type { FunctionComponent } from "preact";
import type { NormalizedChartSeries } from "../chart-view-models.js";

export const UsageSeriesSidebar: FunctionComponent<{
  series: NormalizedChartSeries[];
  enabledSeries: Record<string, boolean>;
  activeIndex: number;
}> = ({ series, enabledSeries, activeIndex }) => {
  const visibleSeries = series.filter(s => enabledSeries[s.id]);

  return visibleSeries.length > 0 ? (
    <div className="grid gap-2">
      {visibleSeries.map((s) => {
        const currentValue = s.values[activeIndex] || 0;

        return (
          <div
            key={s.id}
            className="rounded-[1.05rem] border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/68 px-3 py-3 transition-colors hover:bg-[var(--stats-card-bg)] motion-reduce:transition-none"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[var(--stats-card-bg)]" style={{ backgroundColor: s.accentHex }} />
              <span className="min-w-0 break-words text-[10px] font-bold uppercase leading-snug tracking-[0.14em] text-[var(--stats-label-color)]">{s.label}</span>
            </div>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
              <div className="min-w-0 break-words text-lg font-black leading-tight text-[var(--stats-value-color)]">{s.formatter(currentValue)}</div>
              <div className="text-right text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)] opacity-80">{s.signalLabel || 'Metric'}</div>
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    <div className="rounded-[1.05rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/50 px-4 py-6 text-sm leading-relaxed text-[var(--stats-detail-color)]">
      Keep at least one series enabled to inspect live bucket values.
    </div>
  );
};
