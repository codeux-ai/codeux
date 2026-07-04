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
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap gap-x-6 gap-y-4 px-5 py-4">
      {Object.entries(seriesGroups).map(([grouping, groupSeries]) => (
        <div key={grouping} className="flex flex-col gap-2.5">
          <div className="pl-1 text-[9px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">
            {grouping}
          </div>
          <div className="pointer-events-auto flex flex-wrap gap-2.5">
            {groupSeries.map((s, idx) => {
              const active = enabledSeries[s.id] || false;
              const disabled = activeSeriesCount === 1 && active;
              const fallbackColors = ['#F43F5E', '#8B5CF6', '#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#14B8A6'];
              const accentHex = s.color || fallbackColors[idx % fallbackColors.length];

              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { if (!disabled) onToggleSeries(s.id); }}
                  aria-disabled={disabled ? "true" : undefined}
                  aria-pressed={active}
                  role="switch"
                  aria-checked={active}
                  className={`inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] transition-all border ${
                    active
                      ? 'border-amber-500/30 bg-amber-500/10 text-[var(--stats-value-color)] shadow-[var(--stats-card-shadow)]'
                      : 'border-[var(--stats-card-border)] bg-[var(--stats-chip-bg)] text-[var(--stats-detail-color)] opacity-70 hover:bg-[var(--stats-row-hover-bg)] hover:opacity-100'
                  } ${disabled ? "cursor-not-allowed opacity-45" : "active:scale-[0.98]"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-focus-ring)]`}
                >
                  <span 
                    className="h-2 w-2 rounded-full ring-1 ring-black/10 dark:ring-white/15" 
                    style={{ backgroundColor: accentHex }} 
                  />
                  <span className={!active ? "opacity-40 line-through" : ""}>
                    {s.label}
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
