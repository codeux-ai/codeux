import type { FunctionComponent } from 'preact';
import type { GroupedChartSeriesSection } from '../chart-view-models.js';

const FALLBACK_COLORS = ['#F43F5E', '#8B5CF6', '#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#14B8A6'];

interface UsageGraphLegendProps {
  seriesGroups: GroupedChartSeriesSection[];
  enabledSeries: Record<string, boolean>;
  activeSeriesCount: number;
  onToggleSeries: (id: string) => void;
  className?: string;
  groupClassName?: string;
  seriesGridClassName?: string;
}

export const UsageGraphLegend: FunctionComponent<UsageGraphLegendProps> = ({
  seriesGroups,
  enabledSeries,
  activeSeriesCount,
  onToggleSeries,
  className = "",
  groupClassName = "",
  seriesGridClassName = "grid gap-2",
}) => {
  return (
    <div className={`grid gap-4 ${className}`.trim()} role="group" aria-label="Usage chart series switches">
      {seriesGroups.map((group) => (
        <div
          key={group.label}
          className={`flex min-w-0 flex-col gap-3 ${groupClassName}`.trim()}
          role="group"
          aria-label={`${group.label} series, ${group.activeCount} of ${group.totalCount} active`}
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--stats-label-color)]">
              <span className="break-words">{group.label}</span>
            </div>
            <div className="shrink-0 rounded-full border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]">
              {group.activeCount}/{group.totalCount} active
              {group.defaultEnabledCount > 0 ? (
                <span className="sr-only">, {group.defaultEnabledCount} default</span>
              ) : null}
            </div>
          </div>
          <div className={seriesGridClassName}>
            {group.series.map((s, idx) => {
              const active = enabledSeries[s.id] || false;
              const disabled = activeSeriesCount === 1 && active;
              const accentHex = s.color || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
              const activeCountLabel = active ? 'On' : 'Off';
              const disabledReasonId = `usage-series-${s.id}-disabled-reason`;
              const signalLabel = s.signalLabel || (s.formatter === 'duration' ? 'Duration' : s.formatter === 'percent' ? 'Percent' : s.formatter === 'number' ? 'Number' : 'Metric');

              return (
                <button
                  key={s.id}
                  type="button"
                  role="switch"
                  aria-checked={active}
                  aria-disabled={disabled ? "true" : undefined}
                  aria-describedby={disabled ? disabledReasonId : undefined}
                  aria-label={`${s.label} ${signalLabel} series, ${active ? 'enabled' : 'disabled'}${disabled ? ', required because it is the last active series' : ''}`}
                  onClick={() => onToggleSeries(s.id)}
                  className={`grid min-h-[4.4rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[0.85rem] border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--stats-card-bg)] motion-reduce:transition-none ${
                    active
                      ? 'border-[color:var(--stats-control-border-active)] bg-[color:var(--stats-surface-control-active)] text-[var(--stats-value-color)]'
                      : 'border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] text-[var(--stats-detail-color)] hover:border-[color:var(--stats-value-color)]/20 hover:bg-[color:var(--fill-muted-hover)]'
                  } ${disabled ? 'cursor-not-allowed opacity-55' : 'active:scale-[0.995]'}`}
                  title={disabled ? 'Keep one series enabled to preserve the chart.' : `${s.label} is ${activeCountLabel}`}
                >
                  <span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-[var(--stats-card-bg)]"
                      style={{ backgroundColor: accentHex }}
                    />
                    <span className="min-w-0">
                      <span className="block whitespace-normal break-words text-[11px] font-semibold leading-snug text-[var(--stats-value-color)]">{s.label}</span>
                      <span className="mt-1 block whitespace-normal break-words text-[9px] font-bold uppercase leading-snug tracking-[0.12em] text-[var(--stats-label-color)]">
                        {signalLabel}
                      </span>
                    </span>
                  </span>
                  <span className="grid shrink-0 justify-items-end gap-1">
                    <span className={`text-[9px] font-bold uppercase tracking-[0.12em] ${active ? 'text-[color:var(--stats-signal-text)]' : 'text-[var(--stats-detail-color)]'}`}>
                      {activeCountLabel}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`relative h-5 w-9 rounded-full border transition-colors motion-reduce:transition-none ${
                        active
                          ? 'border-[color:var(--stats-control-border-active)] bg-[color:var(--stats-accent-signal-fill)]'
                          : 'border-[var(--stats-card-border)] bg-[color:var(--fill-muted)]'
                      }`}
                    >
                      <span
                        className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full shadow-sm transition-transform motion-reduce:transition-none ${
                          active ? 'translate-x-[1.15rem] bg-[color:var(--stats-signal-text)]' : 'translate-x-0.5 bg-[var(--stats-detail-color)]/55'
                        }`}
                      />
                    </span>
                  </span>
                  {disabled ? (
                    <span id={disabledReasonId} className="sr-only">
                      Keep one series enabled so the chart can still render.
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
