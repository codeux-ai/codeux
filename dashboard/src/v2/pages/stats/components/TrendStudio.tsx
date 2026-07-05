import type { FunctionComponent } from "preact";
import {
  Clock3,
  Hash,
  TimerReset,
  type LucideIcon,
} from "lucide-preact";
import type {
  ExecutionStatsEntitySummary,
  ProjectExecutionStatsSnapshot,
} from "../../../types.js";
import {
  formatTokens,
  formatStatsDuration,
  formatPercent,
} from "../stats-utils.js";
import type { UsageChartState } from "../use-usage-chart-state.js";
import {
  CHIP_CLASS,
  LEDGER_ROW_MODERN_CLASS,
  SUBPANEL_CLASS,
} from "./stats-ui-primitives.js";
import { InteractiveUsageChart } from "./InteractiveUsageChart.js";

const TrendSignalCard: FunctionComponent<{
  icon: LucideIcon;
  label: string;
  value: string;
}> = ({ icon: Icon, label, value }) => (
  <div className={`${SUBPANEL_CLASS} flex min-h-[4.75rem] min-w-0 items-center gap-3 p-3`}>
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--stats-control-radius)] border border-[var(--stats-card-border)] bg-[color:var(--stats-accent-signal-fill)] text-[color:var(--stats-signal-text)]">
      <Icon className="h-4 w-4" strokeWidth={2.2} />
    </div>
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--stats-label-color)]">{label}</div>
      <div className="mt-1 break-words text-base font-semibold leading-tight text-[var(--stats-value-color)]">{value}</div>
    </div>
  </div>
);

export const TrendStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  planningUsage: ExecutionStatsEntitySummary | null;
  chartState: UsageChartState;
}> = ({
  stats,
  loading,
  error,
  refresh,
  planningUsage: _planningUsage,
  chartState,
}) => {
  const statusCounts = stats.statusCounts;
  const finishedCount = statusCounts
    ? statusCounts.completed + statusCounts.failed + statusCounts.cancelled
    : 0;

  const outputVelocity = stats.usage.activeTimeMs > 0
    ? `${Math.round((stats.usage.outputTokens || 0) / Math.max(1, stats.usage.activeTimeMs / 1000))} tok/s`
    : "0 tok/s";

  const purposeRows = [...stats.purposes]
    .sort((a, b) => (b.usage?.totalTokens || 0) - (a.usage?.totalTokens || 0));

  return (
  <section className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-3">
      <TrendSignalCard
        icon={TimerReset}
        label="Median"
        value={stats.duration && stats.duration.sampleCount > 0 ? formatStatsDuration(stats.duration.p50Ms) : "No samples"}
      />
      <TrendSignalCard
        icon={Hash}
        label="Velocity"
        value={outputVelocity}
      />
      <TrendSignalCard
        icon={Clock3}
        label="Success"
        value={finishedCount > 0 ? formatPercent((statusCounts!.completed / finishedCount) * 100) : "No runs"}
      />
    </div>
    <InteractiveUsageChart
      stats={stats}
      loading={loading}
      error={error}
      refresh={refresh}
      chartState={chartState}
    />
    <div className={`${SUBPANEL_CLASS} p-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--stats-label-color)]">Purpose Activity</div>
          <div className="mt-2 text-sm leading-relaxed text-[var(--stats-detail-color)]">
            Token volume, invocation count, and active time by purpose over the selected window.
          </div>
        </div>
        <div className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--stats-detail-color)] ${CHIP_CLASS}`}>
          {stats.purposes.length} purposes
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        {purposeRows.length > 0 ? purposeRows.map((purpose) => (
          <div key={purpose.id} className={`${LEDGER_ROW_MODERN_CLASS} grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center`}>
            <div className="min-w-0">
              <div className="break-words text-sm font-bold capitalize text-[color:var(--stats-value-color)]">
                {purpose.label.replace(/_/g, " ")}
              </div>
              <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--stats-detail-color)]">
                {formatTokens(purpose.usage?.totalTokens || 0)} tokens
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm text-[color:var(--stats-detail-color)] sm:min-w-[18rem]">
              <div>
                <span className="block font-medium text-[color:var(--stats-value-color)]">{(purpose.usage?.invocationCount || 0).toLocaleString()}</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em]">invocations</span>
              </div>
              <div>
                <span className="block font-medium text-[color:var(--stats-value-color)]">{formatStatsDuration(purpose.usage?.activeTimeMs || 0)}</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em]">active time</span>
              </div>
            </div>
          </div>
        )) : (
          <div className="rounded-[1.05rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/50 px-4 py-6 text-sm leading-relaxed text-[var(--stats-detail-color)]">
            No purpose activity is available for this range.
          </div>
        )}
      </div>
    </div>
  </section>
  );
};
