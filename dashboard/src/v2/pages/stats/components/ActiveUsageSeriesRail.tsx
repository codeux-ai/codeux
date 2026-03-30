import type { FunctionComponent } from "preact";
import type { ProjectExecutionStatsChartSeries } from "../../../types.js";
import { formatTokens, formatDuration } from "../stats-utils.js";

export const ActiveUsageSeriesRail: FunctionComponent<{
  series: (ProjectExecutionStatsChartSeries & { accentHex?: string })[];
  activeIndex: number;
}> = ({ series, activeIndex }) => {
  const formatValue = (id: string, value: number) => {
    if (id.includes('time') || id.includes('active')) return formatDuration(value);
    if (id.includes('invocations') || id.includes('calls')) return value.toLocaleString();
    return formatTokens(value);
  };

  const getAccentHex = (id: string, index: number) => {
    if (id === 'tokens') return '#00E0A0';
    if (id === 'active') return '#FFB800';
    if (id === 'invocations') return '#0EA5E9';
    const colors = ['#F43F5E', '#8B5CF6', '#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#14B8A6'];
    return colors[index % colors.length];
  };

  const getSignalLabel = (id: string) => {
    if (id === 'tokens') return 'Throughput';
    if (id === 'active') return 'Latency';
    if (id === 'invocations') return 'Volume';
    return 'Metric';
  };

  const activeSeriesCount = series.length;

  if (activeSeriesCount === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {activeSeriesCount === 1 ? (
        <div className="rounded-[1.25rem] border border-dashed border-black/[0.08] p-4 text-center dark:border-white/[0.08]">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Baseline Only</div>
          <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">Enable more metrics from the filter panel to compare series.</div>
        </div>
      ) : null}
      {series.map((s, idx) => {
        const currentValue = s.data[activeIndex] || 0;
        const accentHex = s.accentHex || getAccentHex(s.id, idx);

        return (
          <div
            key={s.id}
            className="rounded-[1.25rem] border px-4 py-3 text-left transition-all bg-white/68 dark:bg-void-900/35 shadow-[0_10px_24px_rgba(15,23,42,0.045)] border-signal-500/18"
          >
            <div className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accentHex }} />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{s.label}</span>
            </div>
            <div className="mt-3 flex items-end justify-between gap-4">
              <div className="text-lg font-black text-slate-900 dark:text-white">{formatValue(s.id, currentValue)}</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{getSignalLabel(s.id)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
