import type { FunctionComponent } from 'preact';
import { Activity } from 'lucide-preact';
import { CHIP_CLASS } from './StatsShared.js';

export const UsageGraphHeader: FunctionComponent<{
  title: string;
  description: string;
}> = ({ title, description }) => {
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--stats-card-border)] bg-[color:var(--fill-muted)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--stats-detail-color)]">
          <Activity className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
          Usage Graph
        </div>
        <div className="mt-3 text-2xl font-black leading-tight text-[var(--stats-value-color)] md:text-3xl">
          {title}
        </div>
        <div className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--stats-detail-color)]">
          {description}
        </div>
      </div>
      <div className="max-w-xl text-xs font-medium leading-relaxed text-[var(--stats-detail-color)]">
        Bucket hover, keyboard focus, and drag zoom all update the same active-window summary so the plot, minimap, and series rail stay synchronized.
      </div>
    </div>
  );
};
