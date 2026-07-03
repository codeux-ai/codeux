import type { FunctionComponent } from 'preact';
import type { ProjectExecutionStatsChartSeries } from '../../../../types.js';

interface UsageGraphLegendProps {
  seriesGroups: Record<string, ProjectExecutionStatsChartSeries[]>;
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
      {Object.entries(seriesGroups).map(([grouping, groupSeries]) => (
        <div key={grouping} className={`flex min-w-0 flex-col gap-3 ${groupClassName}`.trim()} role="group" aria-label={`${grouping} series`}>
          <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">
            {grouping}
          </div>
          <div className={seriesGridClassName}>
            {groupSeries.map((s, idx) => {
              const active = enabledSeries[s.id] || false;
              const disabled = activeSeriesCount === 1 && active;
              const fallbackColors = ['#F43F5E', '#8B5CF6', '#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#14B8A6'];
              const accentHex = s.color || fallbackColors[idx % fallbackColors.length];
              const activeCountLabel = active ? 'On' : 'Off';

              return (
                <button
                  key={s.id}
                  type="button"
                  role="switch"
                  aria-checked={active}
                  aria-disabled={disabled ? "true" : undefined}
                  disabled={disabled}
                  aria-label={`${s.label} series, ${active ? 'enabled' : 'disabled'}${disabled ? ', required because it is the last active series' : ''}`}
                  onClick={() => {
                    if (!disabled) onToggleSeries(s.id);
                  }}
                  className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[1.05rem] border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--stats-card-bg)] motion-reduce:transition-none ${
                    active
                      ? 'border-signal-500/20 bg-signal-500/[0.06] text-[var(--stats-value-color)]'
                      : 'border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] text-[var(--stats-detail-color)] hover:border-[color:var(--stats-value-color)]/20 hover:bg-[color:var(--fill-muted-hover)]'
                  } ${disabled ? 'cursor-not-allowed opacity-55' : 'active:scale-[0.995]'}`}
                  title={disabled ? 'Keep one series enabled to preserve the chart.' : `${s.label} is ${activeCountLabel}`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full ring-2 ring-[var(--stats-card-bg)]"
                      style={{ backgroundColor: accentHex }}
                    />
                    <span className="min-w-0 whitespace-normal break-words text-[10px] font-bold uppercase leading-snug tracking-[0.12em]">{s.label}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`relative h-5 w-9 rounded-full border transition-colors motion-reduce:transition-none ${
                      active
                        ? 'border-signal-500/35 bg-signal-500/25'
                        : 'border-[var(--stats-card-border)] bg-[color:var(--fill-muted)]'
                    }`}
                  >
                    <span
                      className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full shadow-sm transition-transform motion-reduce:transition-none ${
                        active ? 'translate-x-[1.15rem] bg-signal-500' : 'translate-x-0.5 bg-[var(--stats-detail-color)]/55'
                      }`}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
