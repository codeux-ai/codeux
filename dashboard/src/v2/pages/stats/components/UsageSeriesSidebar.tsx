import type { FunctionComponent } from "preact";
import type { NormalizedChartSeries } from "../chart-view-models.js";
import { DASHED_EMPTY_CLASS } from "./stats-ui-primitives.js";

export const UsageSeriesSidebar: FunctionComponent<{
  series: NormalizedChartSeries[];
  enabledSeries: Record<string, boolean>;
  activeIndex: number;
}> = ({ series, enabledSeries, activeIndex }) => {
  const visibleSeries = series.filter(s => enabledSeries[s.id]);

  return visibleSeries.length > 0 ? (
    <div className="divide-y divide-[color:var(--stats-border-hairline)]" role="list" aria-label="Current values for active series">
      {visibleSeries.map((s) => {
        const currentValue = s.values[activeIndex] || 0;

        return (
          <div
            key={s.id}
            role="listitem"
            aria-label={`${s.label}: ${s.formatter(currentValue)}, ${s.signalLabel || 'Metric'}`}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[color:var(--stats-surface-subpanel)]" style={{ backgroundColor: s.accentHex }} />
              <span className="min-w-0 break-words text-[10px] font-bold uppercase leading-snug tracking-[0.14em] text-[var(--stats-label-color)]">{s.label}</span>
            </div>
            <div className="min-w-0 text-right">
              <div className="break-words text-base font-semibold leading-tight text-[var(--stats-value-color)]">{s.formatter(currentValue)}</div>
              <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]">{s.signalLabel || 'Metric'}</div>
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    <div className={`${DASHED_EMPTY_CLASS} text-sm leading-relaxed text-[var(--stats-detail-color)]`}>
      Keep at least one series enabled to inspect live bucket values.
    </div>
  );
};
