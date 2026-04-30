import type { FunctionComponent } from 'preact';
import { Activity } from 'lucide-preact';
import { CHIP_CLASS } from './StatsShared.js';

export const UsageGraphHeader: FunctionComponent<{
  title: string;
  description: string;
}> = ({ title, description }) => {
  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2.5 rounded-full border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--stats-detail-color)] shadow-sm">
          <Activity className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
          Usage Graph
        </div>
        <div className="mt-5 text-4xl font-black tracking-tight text-[var(--stats-value-color)]">
          {title}
        </div>
        <div className="mt-3 text-sm leading-relaxed text-[var(--stats-detail-color)] max-w-2xl">
          {description}
        </div>
      </div>
    </div>
  );
};
