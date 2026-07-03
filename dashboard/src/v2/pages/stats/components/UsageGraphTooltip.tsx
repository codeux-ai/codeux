import type { FunctionComponent } from 'preact';
import type { ExecutionUsageBucketSummary } from '../../../types.js';
import { formatCost, formatStatsDuration, formatTokens } from '../stats-utils.js';

interface UsageGraphTooltipProps {
  visible: boolean;
  left: number;
  label: string;
  bucketStart: string;
  bucket?: ExecutionUsageBucketSummary | null;
  activeSeries: Array<{
    id: string;
    label: string;
    accentHex: string;
    value: string | number;
  }>;
}

export const UsageGraphTooltip: FunctionComponent<UsageGraphTooltipProps> = ({
  visible,
  left,
  label,
  bucketStart,
  bucket,
  activeSeries,
}) => {
  const date = new Date(bucketStart);
  let formattedDate = bucketStart;
  if (!Number.isNaN(date.getTime())) {
    const isHourlyOrDaily = date.getMinutes() === 0 && date.getSeconds() === 0;
    formattedDate = isHourlyOrDaily
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(date).replace('24:00', '00:00')
      : new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(date).replace('24:00', '00:00');
  }
  const usage = bucket?.usage;
  const detailRows = usage ? [
    { label: 'Cost', value: formatCost(usage.totalCostUsd || 0) },
    { label: 'Tokens', value: formatTokens(usage.totalTokens || 0) },
    { label: 'Active time', value: formatStatsDuration(usage.activeTimeMs || 0) },
    { label: 'Invocations', value: (usage.invocationCount || 0).toLocaleString() },
  ] : [];

  return (
    <div
      role="tooltip"
      id="usage-chart-tooltip"
      aria-live="polite"
      aria-atomic="true"
      className="mt-4 w-full max-w-[calc(100vw-2rem)] rounded-[1.1rem] border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/82 px-4 py-3 text-wrap break-words backdrop-blur-xl"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-label-color)]">{label || 'Focused bucket'}</div>
          <div className="mt-1 text-sm font-black text-[var(--stats-value-color)]">{visible ? formattedDate : 'Hover or focus a bucket to inspect exact values.'}</div>
        </div>
        <div className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)] sm:text-right">
          {visible ? 'Live values' : 'Idle'}
        </div>
      </div>
      <div className="mt-3 h-1 rounded-full bg-black/5 dark:bg-white/10">
        <span
          className="block h-full w-3 rounded-full bg-signal-500"
          style={{ marginLeft: `${Math.min(92, Math.max(8, left))}%`, transform: 'translateX(-50%)' }}
        />
      </div>
      {visible && detailRows.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          {detailRows.map((row) => (
            <div key={row.label} className="min-w-0 rounded-[0.85rem] border border-[var(--stats-card-border)] bg-[color:var(--fill-muted)] px-3 py-2">
              <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--stats-label-color)]">{row.label}</dt>
              <dd className="mt-1 break-words text-sm font-black text-[var(--stats-value-color)]">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="mt-3 grid gap-2">
        {visible && activeSeries.length > 0 ? activeSeries.map((series) => (
          <div key={`tooltip-${series.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[0.85rem] border border-[var(--stats-card-border)] bg-[color:var(--fill-muted)] px-3 py-2 text-sm">
            <div className="inline-flex min-w-0 items-center gap-2.5 text-[var(--stats-detail-color)]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[var(--stats-card-bg)]" style={{ backgroundColor: series.accentHex }} />
              <span className="min-w-0 break-words font-medium">{series.label}</span>
            </div>
            <div className="text-right font-black text-[var(--stats-value-color)]">{series.value}</div>
          </div>
        )) : (
          <div className="rounded-[0.85rem] border border-dashed border-[var(--stats-card-border)] px-3 py-4 text-sm leading-relaxed text-[var(--stats-detail-color)]">
            Move the pointer, focus a bucket, or use the range slider to pin exact values here.
          </div>
        )}
      </div>
    </div>
  );
};
