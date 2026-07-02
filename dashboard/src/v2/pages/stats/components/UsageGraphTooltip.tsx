import type { FunctionComponent } from 'preact';

interface UsageGraphTooltipProps {
  visible: boolean;
  left: number;
  label: string;
  bucketStart: string;
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

  return (
    <div
      role="tooltip"
      id="usage-chart-tooltip"
      aria-live="polite"
      aria-atomic="true"
      className="rounded-[1.45rem] border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] px-5 py-4 shadow-[var(--stats-card-shadow)] backdrop-blur-2xl max-w-[calc(100vw-2rem)] text-wrap break-words"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--stats-label-color)]">{label || 'Focused bucket'}</div>
          <div className="mt-1 text-sm font-black text-[var(--stats-value-color)]">{visible ? formattedDate : 'Hover or focus a bucket to inspect exact values.'}</div>
        </div>
        <div className="min-w-[5rem] text-right text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--stats-detail-color)]">
          {visible ? 'Live values' : 'Idle'}
        </div>
      </div>
      <div className="mt-4 h-1.5 rounded-full bg-black/5 dark:bg-white/10">
        <span
          className="block h-full w-3 rounded-full bg-signal-500 shadow-[0_0_0_4px_rgba(0,224,160,0.12)]"
          style={{ marginLeft: `${Math.min(92, Math.max(8, left))}%`, transform: 'translateX(-50%)' }}
        />
      </div>
      <div className="mt-4 grid gap-2">
        {visible && activeSeries.length > 0 ? activeSeries.map((series) => (
          <div key={`tooltip-${series.id}`} className="flex items-center justify-between gap-4 rounded-2xl border border-black/[0.04] bg-black/[0.02] px-3 py-2.5 text-sm dark:border-white/[0.05] dark:bg-white/[0.03]">
            <div className="inline-flex min-w-0 items-center gap-2.5 text-[var(--stats-detail-color)]">
              <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/10" style={{ backgroundColor: series.accentHex }} />
              <span className="min-w-0 truncate font-medium">{series.label}</span>
            </div>
            <div className="font-black text-[var(--stats-value-color)]">{series.value}</div>
          </div>
        )) : (
          <div className="rounded-2xl border border-dashed border-black/[0.06] px-3 py-4 text-sm text-[var(--stats-detail-color)] dark:border-white/[0.08]">
            Move the pointer, drag the plot, or use the bucket slider to pin exact values here.
          </div>
        )}
      </div>
    </div>
  );
};
