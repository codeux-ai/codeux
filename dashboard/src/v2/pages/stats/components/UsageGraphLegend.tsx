import type { FunctionComponent } from 'preact';
import type { ProjectExecutionStatsChartSeries } from '../../../../types.js';

interface UsageGraphLegendProps {
  seriesGroups: Record<string, ProjectExecutionStatsChartSeries[]>;
  enabledSeries: Record<string, boolean>;
  activeSeriesCount: number;
  onToggleSeries: (id: string) => void;
}

export const UsageGraphLegend: FunctionComponent<UsageGraphLegendProps> = ({
  seriesGroups,
  enabledSeries,
  activeSeriesCount,
  onToggleSeries,
}) => {
  return (
    <div className="flex flex-col gap-4">
      {Object.entries(seriesGroups).map(([grouping, groupSeries]) => (
        <div key={grouping} className="flex flex-col gap-3">
          <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">
            {grouping}
          </div>
          <div className="grid gap-2">
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
                  aria-label={`${s.label}, ${active ? 'enabled' : 'disabled'}`}
                  onClick={() => {
                    if (!disabled) onToggleSeries(s.id);
                  }}
                  className={`flex items-center justify-between gap-3 rounded-[1.05rem] border px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--stats-card-bg)] motion-reduce:transition-none ${
                    active
                      ? 'border-signal-500/20 bg-signal-500/[0.06] text-[var(--stats-value-color)]'
                      : 'border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] text-[var(--stats-detail-color)] hover:border-[color:var(--stats-value-color)]/20 hover:bg-[color:var(--fill-muted-hover)]'
                  } ${disabled ? 'cursor-not-allowed opacity-55' : 'active:scale-[0.995]'}`}
                  title={disabled ? 'Keep one series enabled to preserve the chart.' : `${s.label} is ${activeCountLabel}`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[var(--stats-card-bg)]"
                      style={{ backgroundColor: accentHex }}
                    />
                    <span className="min-w-0 truncate">{s.label}</span>
                  </span>
                  <span className="rounded-full border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] px-2 py-1 text-[9px] tracking-[0.14em] text-[var(--stats-detail-color)]">
                    {active ? 'On' : 'Off'}
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
