import type { FunctionComponent } from 'preact';
import type { ExecutionUsageBucketSummary } from '../../../types.js';
import { formatCost, formatStatsDuration, formatTokens } from '../stats-utils.js';
import { DASHED_EMPTY_CLASS } from './stats-ui-primitives.js';

export type UsageGraphInspectionState = 'idle' | 'focused' | 'pinned';

interface UsageGraphTooltipProps {
  visible: boolean;
  left: number;
  label: string;
  bucketStart: string;
  bucket?: ExecutionUsageBucketSummary | null;
  inspectionState?: UsageGraphInspectionState;
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
  inspectionState,
  activeSeries,
}) => {
  const state = inspectionState ?? (visible ? 'focused' : 'idle');
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
  const stateCopy = state === 'pinned'
    ? 'Pinned bucket'
    : state === 'focused'
      ? 'Focused bucket'
      : visible
        ? 'Latest bucket'
        : 'Idle';
  const dateCopy = visible ? formattedDate : 'No bucket selected';
  const helperCopy = state === 'pinned'
    ? 'Pinned from keyboard or range control. Exact values stay visible until focus changes.'
    : state === 'focused'
      ? 'Focused from pointer or keyboard inspection. Exact bucket values are shown below.'
      : visible
        ? 'Showing the latest bucket in the visible window. Hover, focus, or use the range slider to inspect another bucket.'
        : 'Hover a bucket, tab into the chart, or move the range slider to inspect exact values.';
  const markerLeft = Math.min(92, Math.max(8, left));

  return (
    <div
      role="tooltip"
      id="usage-chart-tooltip"
      aria-live="polite"
      aria-atomic="true"
      className="w-full min-w-0 max-w-[calc(100vw-2rem)] text-wrap break-words"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-label-color)]">Bucket inspection</div>
          <div className="mt-1 break-words text-base font-semibold text-[var(--stats-value-color)]">{label || stateCopy}</div>
          <div className="mt-1 text-sm font-semibold text-[var(--stats-value-color)]">{dateCopy}</div>
          <div className="mt-1 text-xs leading-relaxed text-[var(--stats-detail-color)]">{helperCopy}</div>
        </div>
        <div className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)] sm:text-right">
          {stateCopy}
        </div>
      </div>
      <div
        className="mt-3 h-1 rounded-full bg-[color:var(--stats-quiet-track)]"
        role="img"
        aria-label={visible ? `${stateCopy} marker at ${Math.round(markerLeft)} percent of the visible chart window.` : 'Idle marker waiting for chart focus.'}
      >
        <span
          className="block h-full w-3 rounded-full bg-[color:var(--stats-value-color)]"
          style={{ marginLeft: `${markerLeft}%`, transform: 'translateX(-50%)' }}
        />
      </div>
      {visible && detailRows.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 border-y border-[color:var(--stats-border-hairline)] sm:grid-cols-4">
          {detailRows.map((row) => (
            <div key={row.label} className="min-w-0 border-b border-[color:var(--stats-border-hairline)] p-3 last:border-b-0 odd:border-r sm:border-b-0 sm:border-r sm:last:border-r-0">
              <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--stats-label-color)]">{row.label}</dt>
              <dd className="mt-1 break-words text-sm font-semibold text-[var(--stats-value-color)]">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : visible ? (
          <div className={`${DASHED_EMPTY_CLASS} mt-3 text-sm leading-relaxed text-[var(--stats-detail-color)]`}>
          This bucket has no usage totals available for the active series.
        </div>
      ) : null}
      <div className="mt-3 divide-y divide-[color:var(--stats-border-hairline)]">
        {visible && activeSeries.length > 0 ? activeSeries.map((series) => (
          <div key={`tooltip-${series.id}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-sm">
            <div className="inline-flex min-w-0 items-center gap-2.5 text-[var(--stats-detail-color)]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[color:var(--stats-surface-subpanel)]" style={{ backgroundColor: series.accentHex }} />
              <span className="min-w-0 break-words font-medium">{series.label}</span>
            </div>
            <div className="max-w-[9rem] break-words text-right font-semibold text-[var(--stats-value-color)]">{series.value}</div>
          </div>
        )) : (
          <div className={`${DASHED_EMPTY_CLASS} text-sm leading-relaxed text-[var(--stats-detail-color)]`}>
            Move the pointer, focus a bucket, or use the range slider to pin exact values here.
          </div>
        )}
      </div>
    </div>
  );
};
