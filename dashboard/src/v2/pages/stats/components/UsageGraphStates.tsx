import type { FunctionComponent } from 'preact';
import { Activity, AlertCircle, BarChart3, Inbox, RefreshCcw } from 'lucide-preact';
import { Button } from '../../../components/ui/Button.js';

export const UsageGraphLoading: FunctionComponent = () => (
  <div className="flex h-[24rem] w-full flex-col items-center justify-center gap-4 rounded-[1.85rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/30">
    <div className="flex w-full max-w-[200px] flex-col gap-3">
      <div className="h-6 w-3/4 animate-pulse rounded-xl bg-slate-200 dark:bg-void-700" />
      <div className="h-6 w-1/2 animate-pulse rounded-xl bg-slate-200 dark:bg-void-700" />
      <div className="h-6 w-full animate-pulse rounded-xl bg-slate-200 dark:bg-void-700" />
    </div>
  </div>
);

export const UsageGraphEmpty: FunctionComponent<{ onReset?: () => void }> = ({ onReset }) => (
  <div className="flex h-[24rem] w-full flex-col items-center justify-center gap-4 rounded-[1.85rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/30">
    <BarChart3 className="h-8 w-8 text-slate-300 dark:text-void-500" strokeWidth={1.5} />
    <div className="flex flex-col items-center text-center gap-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">
          No data for this window
        </div>
        <div className="mt-2 text-xs text-[var(--stats-detail-color)]">
          Telemetry will appear once the project starts executing tasks.
        </div>
      </div>
      {onReset && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onReset}
        >
          Reset Filters
        </Button>
      )}
    </div>
  </div>
);

export const UsageGraphError: FunctionComponent<{ message?: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="flex h-[24rem] w-full flex-col items-center justify-center gap-4 rounded-[1.85rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/30">
    <div className="flex flex-col items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/8 p-4">
      <AlertCircle className="mb-4 h-8 w-8 text-rose-500 opacity-60" strokeWidth={1.5} />
      <div className="flex flex-col items-center text-center gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-rose-500/80">
            Telemetry Synchronisation Failed
          </div>
          <div className="mt-2 text-xs text-[var(--stats-detail-color)] max-w-xs px-6">
            {message || "An unexpected error occurred while retrieving graph data. Please try refreshing the page."}
          </div>
        </div>
        {onRetry && (
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={onRetry}
          >
            <RefreshCcw className="mr-2 h-4 w-4" /> Retry
          </Button>
        )}
      </div>
    </div>
  </div>
);
