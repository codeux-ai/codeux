import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Heart, Loader2, Play, Trash2, X } from "lucide-preact";
import gsap from "gsap";
import { useGsapDurations, useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { getBulkActionMessage, type BulkLedgerAction } from "../../lib/sprint-ledger-state.js";

export interface SprintLedgerBulkActionsProps {
  selectedCount: number;
  totalCount: number;
  currentAction?: BulkLedgerAction;
  isAnyPending?: boolean;
  isStartPending?: boolean;
  isDeletePending?: boolean;
  isPinPending?: boolean;
  onBulkStart: () => void;
  onBulkDelete: () => void;
  onBulkShowcaseEnable: () => void;
  onBulkShowcaseDisable: () => void;
  onClearSelection: () => void;
}

export const SprintLedgerBulkActions: FunctionComponent<SprintLedgerBulkActionsProps> = ({
  selectedCount,
  totalCount,
  currentAction = null,
  isAnyPending,
  isStartPending,
  isDeletePending,
  isPinPending,
  onBulkStart,
  onBulkDelete,
  onBulkShowcaseEnable,
  onBulkShowcaseDisable,
  onClearSelection,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevSelectedCount = useRef(selectedCount);
  const { expansionCollapse } = useGsapInteractionTokens();

  const durations = useGsapDurations();
  const feedbackMessage = getBulkActionMessage(currentAction, selectedCount, Boolean(isAnyPending));
  const disabledTitle = isAnyPending ? feedbackMessage : undefined;
  const isBulkPinning = isPinPending && currentAction !== "unpin";
  const isBulkUnpinning = isPinPending && currentAction === "unpin";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const duration = durations.base;

    if (selectedCount > 0) {
      if (duration === 0) {
        gsap.set(el, { height: "auto", opacity: 1 });
      } else {
        gsap.to(el, {
          height: "auto",
          opacity: 1,
          duration,
          ease: expansionCollapse.ease,
        });
      }
    } else {
      if (duration === 0) {
        gsap.set(el, { height: 0, opacity: 0 });
      } else {
        gsap.to(el, {
          height: 0,
          opacity: 0,
          duration,
          ease: expansionCollapse.ease,
        });
      }
    }
  }, [selectedCount, durations, expansionCollapse.ease]);

  useEffect(() => {
    prevSelectedCount.current = selectedCount;
  }, [selectedCount]);

  return (
    <div
      ref={containerRef}
      className="overflow-hidden opacity-0"
      style={{ height: 0 }}
    >
      <div className="flex flex-col gap-3 border-b border-signal-500/20 bg-signal-500/[0.08] px-4 py-3 backdrop-blur-xl dark:bg-signal-500/[0.1] sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-signal-500/20 bg-signal-500/10 text-signal-700 dark:text-signal-300">
            {isAnyPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Heart className="h-4 w-4" fill="currentColor" />}
          </div>
          <div className="min-w-0" aria-live="polite" aria-atomic="true">
            <div className="text-sm font-bold text-slate-900 dark:text-white">
              {selectedCount} of {totalCount} selected
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {feedbackMessage}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label={isBulkPinning ? `Pinning ${selectedCount} selected sprints` : `Pin ${selectedCount} selected sprints to showcase`}
            title={disabledTitle}
            aria-disabled={isAnyPending}
            onClick={onBulkShowcaseEnable}
            disabled={isAnyPending}
            className="inline-flex min-h-9 min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-black/[0.06] bg-white/80 px-3 py-1.5 text-xs font-bold leading-tight text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            {isBulkPinning ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <Heart className="h-3 w-3" fill="currentColor" />}
            {isBulkPinning ? "Pinning..." : "Pin"}
          </button>
          <button
            type="button"
            aria-label={isBulkUnpinning ? `Unpinning ${selectedCount} selected sprints` : `Unpin ${selectedCount} selected sprints from showcase`}
            title={disabledTitle}
            aria-disabled={isAnyPending}
            onClick={onBulkShowcaseDisable}
            disabled={isAnyPending}
            className="inline-flex min-h-9 min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-black/[0.06] bg-white/80 px-3 py-1.5 text-xs font-bold leading-tight text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            {isBulkUnpinning ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <Heart className="h-3 w-3" />}
            {isBulkUnpinning ? "Unpinning..." : "Unpin"}
          </button>
          <button
            type="button"
            aria-label={isStartPending ? `Starting ${selectedCount} selected sprints` : `Start ${selectedCount} selected sprints`}
            title={disabledTitle}
            aria-disabled={isAnyPending}
            onClick={onBulkStart}
            disabled={isAnyPending}
            className="inline-flex min-h-9 min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-signal-500/25 bg-signal-500/10 px-3 py-1.5 text-xs font-bold leading-tight text-signal-700 transition-colors hover:bg-signal-500/20 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:text-signal-300 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            {isStartPending ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <Play className="h-3 w-3" fill="currentColor" />}
            {isStartPending ? "Starting..." : "Start"}
          </button>
          <button
            type="button"
            aria-label={isDeletePending ? `Deleting ${selectedCount} selected sprints` : `Delete ${selectedCount} selected sprints`}
            title={disabledTitle}
            aria-disabled={isAnyPending}
            onClick={onBulkDelete}
            disabled={isAnyPending}
            className="inline-flex min-h-9 min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-status-red/20 bg-status-red/10 px-3 py-1.5 text-xs font-bold leading-tight text-status-red transition-colors hover:bg-status-red/20 focus-visible:ring-2 focus-visible:ring-status-red/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            {isDeletePending ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <Trash2 className="h-3 w-3" />}
            {isDeletePending ? "Deleting..." : "Delete"}
          </button>
          <button
            type="button"
            aria-label="Clear sprint selection"
            title={disabledTitle}
            aria-disabled={isAnyPending}
            onClick={onClearSelection}
            disabled={isAnyPending}
            className="inline-flex min-h-9 min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold leading-tight text-slate-500 transition-colors hover:bg-black/[0.04] hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
            Clear
          </button>
        </div>
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {selectedCount === 0 && prevSelectedCount.current > 0 ? "Selection cleared" : feedbackMessage}
      </div>
    </div>
  );
};
