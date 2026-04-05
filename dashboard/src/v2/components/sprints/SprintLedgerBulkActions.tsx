import type { FunctionComponent } from "preact";
import { Heart, Play, Trash2 } from "lucide-preact";

export interface SprintLedgerBulkActionsProps {
  selectedCount: number;
  isPending?: boolean;
  onBulkStart: () => void;
  onBulkDelete: () => void;
  onBulkShowcaseEnable: () => void;
  onBulkShowcaseDisable: () => void;
  onClearSelection: () => void;
}

export const SprintLedgerBulkActions: FunctionComponent<SprintLedgerBulkActionsProps> = ({
  selectedCount,
  isPending,
  onBulkStart,
  onBulkDelete,
  onBulkShowcaseEnable,
  onBulkShowcaseDisable,
  onClearSelection,
}) => {
  return (
    <div
      className={`overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        selectedCount > 0 ? "max-h-20 opacity-100" : "max-h-0 opacity-0"
      }`}
    >
      <div className="flex items-center gap-3 border-b border-signal-500/20 bg-signal-500/10 px-6 py-3 dark:bg-signal-500/10">
        <span className="text-xs font-bold text-signal-600 dark:text-signal-300">
          {selectedCount} selected
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBulkShowcaseEnable}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.03] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-black/[0.06] hover:text-slate-700 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Heart className="h-3 w-3" fill="currentColor" />
            Pin
          </button>
          <button
            type="button"
            onClick={onBulkShowcaseDisable}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.03] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-black/[0.06] hover:text-slate-700 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Heart className="h-3 w-3" />
            Unpin
          </button>
          <button
            type="button"
            onClick={onBulkStart}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/25 bg-signal-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 transition-colors hover:bg-signal-500/20 dark:text-signal-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-3 w-3" fill="currentColor" />
            Start
          </button>
          <button
            type="button"
            onClick={onBulkDelete}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-status-red transition-colors hover:bg-status-red/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
          <button
            type="button"
            onClick={onClearSelection}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
};
