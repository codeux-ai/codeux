import type { FunctionComponent } from 'preact';
import { formatDateTime } from '../stats-utils.js';

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
  if (!visible) return null;

  return (
    <div
      className="pointer-events-none absolute top-3 z-50 w-64 -translate-x-1/2 rounded-[1.25rem] border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] px-5 py-4 shadow-[var(--stats-card-shadow)] backdrop-blur-2xl transition-all duration-200"
      style={{ left: `${Math.min(92, Math.max(8, left))}%` }}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--stats-label-color)]">{label}</div>
      <div className="mt-2 text-sm font-black text-[var(--stats-value-color)]">{formatDateTime(bucketStart)}</div>
      <div className="mt-4 space-y-2.5">
        {activeSeries.map((series) => (
          <div key={`tooltip-${series.id}`} className="flex items-center justify-between gap-4 text-sm">
            <div className="inline-flex items-center gap-2.5 text-[var(--stats-detail-color)]">
              <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/10" style={{ backgroundColor: series.accentHex }} />
              <span className="font-medium">{series.label}</span>
            </div>
            <div className="font-black text-[var(--stats-value-color)]">{series.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
