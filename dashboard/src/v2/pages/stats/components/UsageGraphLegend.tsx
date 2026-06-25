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
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap gap-x-8 gap-y-5 px-5 py-4">
      {Object.entries(seriesGroups).map(([grouping, groupSeries]) => (
        <div key={grouping} className="flex flex-col gap-2.5">
          <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)] pl-1">
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
                  onClick={() => onToggleSeries(s.id)}
                  disabled={disabled}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] transition-all border ${
                    active
                      ? 'bg-[var(--stats-card-bg)] border-signal-500/25 text-[var(--stats-value-color)] shadow-sm ring-1 ring-amber-500/40'
                      : 'border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] text-[var(--stats-detail-color)] opacity-60 hover:opacity-100'
                  } ${disabled ? "cursor-not-allowed opacity-40" : "hover:scale-[1.02] active:scale-[0.98]"}`}
                >
                  <span 
                    className="h-2 w-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.1)]" 
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
