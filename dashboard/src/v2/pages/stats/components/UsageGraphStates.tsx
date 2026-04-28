import type { FunctionComponent } from 'preact';
import { Activity, AlertCircle, Inbox } from 'lucide-preact';

export const UsageGraphLoading: FunctionComponent = () => (
  <div className="flex h-[24rem] w-full flex-col items-center justify-center gap-4 rounded-[1.85rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/30">
    <div className="relative">
      <div className="absolute inset-0 animate-ping rounded-full bg-signal-500/20" />
      <Activity className="relative h-8 w-8 animate-pulse text-signal-500" strokeWidth={1.5} />
    </div>
    <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">
      Synchronizing Telemetry...
    </div>
  </div>
);

export const UsageGraphEmpty: FunctionComponent = () => (
  <div className="flex h-[24rem] w-full flex-col items-center justify-center gap-4 rounded-[1.85rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/30">
    <Inbox className="h-8 w-8 text-[var(--stats-detail-color)] opacity-40" strokeWidth={1.5} />
    <div className="text-center">
      <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">
        No Activity Detected
      </div>
      <div className="mt-2 text-xs text-[var(--stats-detail-color)]">
        Telemetry will appear once the project starts executing tasks.
      </div>
    </div>
  </div>
);

export const UsageGraphError: FunctionComponent<{ message?: string }> = ({ message }) => (
  <div className="flex h-[24rem] w-full flex-col items-center justify-center gap-4 rounded-[1.85rem] border border-dashed border-rose-500/20 bg-rose-500/5">
    <AlertCircle className="h-8 w-8 text-rose-500 opacity-60" strokeWidth={1.5} />
    <div className="text-center">
      <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-rose-500/80">
        Telemetry Synchronisation Failed
      </div>
      <div className="mt-2 text-xs text-[var(--stats-detail-color)] max-w-xs px-6">
        {message || "An unexpected error occurred while retrieving graph data. Please try refreshing the page."}
      </div>
    </div>
  </div>
);
