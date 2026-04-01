import type { FunctionComponent } from "preact";
import { Play, Trash2 } from "lucide-preact";

export interface SprintLedgerBulkActionsProps {
  selectedCount: number;
  onBulkStart: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}

export const SprintLedgerBulkActions: FunctionComponent<SprintLedgerBulkActionsProps> = ({
  selectedCount,
  onBulkStart,
  onBulkDelete,
  onClearSelection,
}) => {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 border-b border-signal-500/20 bg-signal-500/10 px-6 py-3 dark:bg-signal-500/10">
      <span className="text-xs font-bold text-signal-600 dark:text-signal-300">
        {selectedCount} selected
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBulkStart}
          className="touch-target inline-flex items-center gap-1.5 rounded-full border border-signal-500/25 bg-signal-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-signal-600 transition-colors hover:bg-signal-500/20 dark:text-signal-300"
        >
          <Play className="h-3 w-3" fill="currentColor" />
          Start
        </button>
        <button
          type="button"
          onClick={onBulkDelete}
          className="touch-target inline-flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-status-red transition-colors hover:bg-status-red/20"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          className="touch-target inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Clear
        </button>
      </div>
    </div>
  );
};
