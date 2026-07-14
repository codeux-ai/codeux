import type { FunctionComponent, Ref } from "preact";
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Heart, Loader2, Play, Trash2, X } from "lucide-preact";
import gsap from "gsap";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { getBulkActionButtonLabel, getBulkActionMessage, getBulkPendingReason, type BulkLedgerAction } from "../../lib/sprint-ledger-state.js";
import { useDashboardI18n } from "../../i18n/index.js";
import { sprintsMessages } from "../../i18n/messages/sprints.js";

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
  controlTransitionStyle?: JSX.CSSProperties;
  deleteButtonRef?: Ref<HTMLButtonElement>;
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
  controlTransitionStyle,
  deleteButtonRef,
}) => {
  const { formatNumber, locale, translate, translatePlural } = useDashboardI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const prevSelectedCount = useRef(selectedCount);
  const { expansionCollapse } = useGsapInteractionTokens();

  const effectivePendingAction: BulkLedgerAction = currentAction
    ?? (isStartPending ? "start" : isDeletePending ? "delete" : isPinPending ? "pin" : null);
  const feedbackMessage = getBulkActionMessage(effectivePendingAction ?? currentAction, selectedCount, Boolean(isAnyPending), locale);
  const pendingReason = getBulkPendingReason(effectivePendingAction, selectedCount, locale);
  const disabledTitle = isAnyPending ? pendingReason : undefined;
  const isBulkPinning = isPinPending && currentAction !== "unpin";
  const isBulkUnpinning = isPinPending && currentAction === "unpin";
  const feedbackId = "sprint-ledger-bulk-action-feedback";
  const pendingReasonId = "sprint-ledger-bulk-action-pending-reason";
  const disabledDescription = isAnyPending ? `${feedbackId} ${pendingReasonId}` : undefined;
  const pinLabel = getBulkActionButtonLabel("pin", Boolean(isBulkPinning), locale);
  const unpinLabel = getBulkActionButtonLabel("unpin", Boolean(isBulkUnpinning), locale);
  const startLabel = getBulkActionButtonLabel("start", Boolean(isStartPending), locale);
  const deleteLabel = getBulkActionButtonLabel("delete", Boolean(isDeletePending), locale);
  const handleBulkShowcaseEnable = () => {
    if (isAnyPending) return;
    onBulkShowcaseEnable();
  };
  const handleBulkShowcaseDisable = () => {
    if (isAnyPending) return;
    onBulkShowcaseDisable();
  };
  const handleBulkStart = () => {
    if (isAnyPending) return;
    onBulkStart();
  };
  const handleBulkDelete = () => {
    if (isAnyPending) return;
    onBulkDelete();
  };
  const handleClearSelection = () => {
    if (isAnyPending) return;
    onClearSelection();
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const duration = expansionCollapse.duration;

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
  }, [selectedCount, expansionCollapse.duration, expansionCollapse.ease]);

  useEffect(() => {
    prevSelectedCount.current = selectedCount;
  }, [selectedCount]);

  return (
    <div
      ref={containerRef}
      className="overflow-hidden opacity-0"
      style={{ height: 0 }}
      aria-hidden={selectedCount === 0 ? "true" : undefined}
    >
      <div
        role="region"
        aria-label={translate(sprintsMessages, "sprintLedgerBulkActions")}
        className="flex flex-col gap-3 border-b border-signal-500/20 bg-signal-500/[0.08] px-4 py-3 backdrop-blur-xl dark:bg-signal-500/[0.1] sm:px-6 lg:flex-row lg:items-center lg:justify-between"
      >
        <div className="flex min-w-0 items-center gap-3" aria-busy={isAnyPending ? "true" : undefined}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-signal-500/20 bg-signal-500/10 text-signal-700 dark:text-signal-300">
            {isAnyPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Heart className="h-4 w-4" fill="currentColor" />}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 dark:text-white">
              {translate(sprintsMessages, "selectedOfTotal", { selected: formatNumber(selectedCount), total: formatNumber(totalCount) })}
            </div>
            <div id={feedbackId} className="text-xs text-slate-500 dark:text-slate-400">
              {feedbackMessage}
            </div>
            {isAnyPending ? (
              <div id={pendingReasonId} className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                {pendingReason}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label={translatePlural(sprintsMessages, isBulkPinning ? "pinningSelectedCountPlural" : "pinSelectedToShowcasePlural", selectedCount, { count: formatNumber(selectedCount) })}
            title={disabledTitle}
            aria-disabled={isAnyPending}
            aria-busy={isBulkPinning ? "true" : undefined}
            aria-describedby={disabledDescription}
            onClick={handleBulkShowcaseEnable}
            disabled={isAnyPending}
            className="inline-flex min-h-9 min-w-[5.5rem] flex-1 flex-nowrap items-center justify-center gap-1.5 rounded-xl border border-black/[0.06] bg-white/80 px-3 py-1.5 text-xs font-bold leading-tight text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
            style={controlTransitionStyle}
          >
            <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center">
              {isBulkPinning ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <Heart className="h-3 w-3" fill="currentColor" />}
            </span>
            <span className="inline-flex min-w-[3.75rem] justify-center">{pinLabel}</span>
          </button>
          <button
            type="button"
            aria-label={translatePlural(sprintsMessages, isBulkUnpinning ? "unpinningSelectedCountPlural" : "unpinSelectedFromShowcasePlural", selectedCount, { count: formatNumber(selectedCount) })}
            title={disabledTitle}
            aria-disabled={isAnyPending}
            aria-busy={isBulkUnpinning ? "true" : undefined}
            aria-describedby={disabledDescription}
            onClick={handleBulkShowcaseDisable}
            disabled={isAnyPending}
            className="inline-flex min-h-9 min-w-[5.5rem] flex-1 flex-nowrap items-center justify-center gap-1.5 rounded-xl border border-black/[0.06] bg-white/80 px-3 py-1.5 text-xs font-bold leading-tight text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
            style={controlTransitionStyle}
          >
            <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center">
              {isBulkUnpinning ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <Heart className="h-3 w-3" />}
            </span>
            <span className="inline-flex min-w-[3.75rem] justify-center">{unpinLabel}</span>
          </button>
          <button
            type="button"
            aria-label={translatePlural(sprintsMessages, isStartPending ? "startingSelectedCountPlural" : "startSelectedCountPlural", selectedCount, { count: formatNumber(selectedCount) })}
            title={disabledTitle}
            aria-disabled={isAnyPending}
            aria-busy={isStartPending ? "true" : undefined}
            aria-describedby={disabledDescription}
            onClick={handleBulkStart}
            disabled={isAnyPending}
            className="inline-flex min-h-9 min-w-[5.5rem] flex-1 flex-nowrap items-center justify-center gap-1.5 rounded-xl border border-signal-500/25 bg-signal-500/10 px-3 py-1.5 text-xs font-bold leading-tight text-signal-700 transition-colors hover:bg-signal-500/20 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:text-signal-300 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
            style={controlTransitionStyle}
          >
            <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center">
              {isStartPending ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <Play className="h-3 w-3" fill="currentColor" />}
            </span>
            <span className="inline-flex min-w-[3.75rem] justify-center">{startLabel}</span>
          </button>
          <button
            ref={deleteButtonRef}
            type="button"
            aria-label={translatePlural(sprintsMessages, isDeletePending ? "deletingSelectedCountPlural" : "deleteSelectedPermanentPlural", selectedCount, { count: formatNumber(selectedCount) })}
            title={disabledTitle}
            aria-disabled={isAnyPending}
            aria-busy={isDeletePending ? "true" : undefined}
            aria-describedby={disabledDescription}
            onClick={handleBulkDelete}
            disabled={isAnyPending}
            className="inline-flex min-h-9 min-w-[5.5rem] flex-1 flex-nowrap items-center justify-center gap-1.5 rounded-xl border border-status-red/20 bg-status-red/10 px-3 py-1.5 text-xs font-bold leading-tight text-status-red transition-colors hover:bg-status-red/20 focus-visible:ring-2 focus-visible:ring-status-red/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
            style={controlTransitionStyle}
          >
            <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center">
              {isDeletePending ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <Trash2 className="h-3 w-3" />}
            </span>
            <span className="inline-flex min-w-[3.75rem] justify-center">{deleteLabel}</span>
          </button>
          <button
            type="button"
            aria-label={translate(sprintsMessages, "clearSprintSelection")}
            title={disabledTitle}
            aria-disabled={isAnyPending}
            aria-describedby={disabledDescription}
            onClick={handleClearSelection}
            disabled={isAnyPending}
            className="inline-flex min-h-9 min-w-[5.5rem] flex-1 flex-nowrap items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold leading-tight text-slate-500 transition-colors hover:bg-black/[0.04] hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
            style={controlTransitionStyle}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
            {translate(sprintsMessages, "clear")}
          </button>
        </div>
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {selectedCount === 0 && prevSelectedCount.current > 0 ? translate(sprintsMessages, "selectionClearedShort") : feedbackMessage}
      </div>
    </div>
  );
};
