import type { FunctionComponent } from "preact";
import type { ProjectExecutionStatsChartSeries } from "../../../types.js";
import { formatTokens, formatDuration } from "../stats-utils.js";

export const UsageSeriesSidebar: FunctionComponent<{
  series: ProjectExecutionStatsChartSeries[];
  enabledSeries: Record<string, boolean>;
  onToggle: (id: string) => void;
  activeIndex: number;
}> = ({ series, enabledSeries, onToggle, activeIndex }) => {
  // Group series by their grouping
  const groups = series.reduce((acc, s) => {
    if (!acc[s.grouping]) acc[s.grouping] = [];
    acc[s.grouping].push(s);
    return acc;
  }, {} as Record<string, ProjectExecutionStatsChartSeries[]>);

  const formatValue = (id: string, value: number) => {
    if (id.includes('time') || id.includes('active')) return formatDuration(value);
    if (id.includes('invocations') || id.includes('calls')) return value.toLocaleString();
    return formatTokens(value);
  };

  const getAccentHex = (id: string, index: number) => {
    if (id === 'tokens') return '#00E0A0';
    if (id === 'active') return '#FFB800';
    if (id === 'invocations') return '#0EA5E9';
    // Just a basic fallback palette for others
    const colors = ['#F43F5E', '#8B5CF6', '#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#14B8A6'];
    return colors[index % colors.length];
  };

  const getSignalLabel = (id: string) => {
    if (id === 'tokens') return 'Throughput';
    if (id === 'active') return 'Latency';
    if (id === 'invocations') return 'Volume';
    return 'Metric';
  };

  const activeSeriesCount = Object.values(enabledSeries).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-6">
      {Object.entries(groups).map(([grouping, groupSeries]) => (
        <div key={grouping} className="flex flex-col gap-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 pl-2">
            {grouping}
          </div>
          <div className="flex flex-col gap-2">
            {groupSeries.map((s, idx) => {
              const active = enabledSeries[s.id] || false;
              const currentValue = s.data[activeIndex] || 0;
              const disabled = activeSeriesCount === 1 && active;
              const accentHex = getAccentHex(s.id, idx);

              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => !disabled && onToggle(s.id)}
                  disabled={disabled}
                  className={`rounded-[1.25rem] border px-4 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 ${
                    active
                      ? 'bg-white/68 dark:bg-void-900/35 shadow-[0_10px_24px_rgba(15,23,42,0.045)] border-signal-500/18'
                      : 'border-black/[0.05] bg-white/60 dark:border-white/[0.05] dark:bg-void-900/30 opacity-72 hover:opacity-100'
                  } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accentHex }} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{s.label}</span>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-4">
                    <div className="text-lg font-black text-slate-900 dark:text-white">{formatValue(s.id, currentValue)}</div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{getSignalLabel(s.id)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
