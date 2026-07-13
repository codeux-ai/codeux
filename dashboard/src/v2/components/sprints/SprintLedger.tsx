import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useEffect, useMemo, useRef, useState, useCallback } from "preact/hooks";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckSquare,
  Inbox,
  Square,
} from "lucide-preact";
import { SkeletonRow } from "../layout/SkeletonLoader.js";
import { INTERACTION_TOKENS, useInteractionTokens } from "../../lib/motion/tokens.js";
import { useResolvedMotionDuration } from "../../hooks/use-reduced-motion.js";
import { sliceListWindow, type ListWindowOption } from "../../lib/list-window.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import type { Sprint } from "../../types.js";
import type { ExecutionHumanInterventionSummary } from "../../../../../src/contracts/app-types.js";
import type { CiStatusPresentation } from "../../lib/ci-status-presentation.js";
import {
  filterSprints,
  sortSprints,
  toggleSelection,
  deselectAll,
  pruneSelection,
  getSelectedFilteredSprints,
  getLedgerSelectionSummary,
  getLedgerViewStateKey,
  getSortAriaSort,
  getSortButtonLabel,
  getSortButtonDescription,
  getLedgerOutcomeMessage,
  formatSelectedSprintNamesForConfirmation,
  type BulkLedgerAction,
  nextSort,
  DEFAULT_LEDGER_FILTERS,
  SPRINT_TABLE_SORT_LABELS,
  type LedgerSort,
  type LedgerFilters,
  type SprintTableSortKey,
} from "../../lib/sprint-ledger-state.js";

import { Table, TableHeader, TableBody, TableCell } from "../ui/Table.js";
import { SprintLedgerHeader } from "./SprintLedgerHeader.js";
import { SprintLedgerBulkActions } from "./SprintLedgerBulkActions.js";
import { SprintLedgerRow } from "./SprintLedgerRow.js";

const EMPTY_CI_STATUS_BY_SPRINT_ID = new Map<string, CiStatusPresentation>();

export interface SprintLedgerProps {
  initialQuery?: string;
  sprints: Sprint[];
  isLoading?: boolean;
  sprintKeyPrefix?: string;
  listWindow: ListWindowOption;
  onListWindowChange: (value: ListWindowOption) => void;
  activeRunsBySprintId: Map<string, { id: string; status: string }>;
  pauseResumeRunsBySprintId: Map<string, { id: string; status: string }>;
  interventionBySprintId: Map<string, ExecutionHumanInterventionSummary>;
  ciStatusBySprintId?: ReadonlyMap<string, CiStatusPresentation>;
  pendingActionIds: Set<string>;
  onToggleShowcase: (sprint: Sprint) => void;
  onSprintToggle: (sprintId: string) => void;
  onSprintPauseResume: (sprintId: string) => void;
  onOpenRowMenu?: (event: MouseEvent, sprintId: string) => void;
  onBulkStart: (sprintIds: string[]) => void;
  onBulkDelete: (sprintIds: string[]) => void;
  onEditSprint: (sprint: Sprint) => void;
  onExportSprint: (sprint: Sprint) => void;
  onOverridesSprint: (sprint: Sprint) => void;
  onMarkCompletedSprint: (sprintId: string) => void;
  onMarkQaPassedSprint?: (sprintId: string) => void;
  onRollbackSprint?: (sprint: Sprint) => void;
  onDeleteSprint: (sprintId: string) => void;
  onBulkShowcaseEnable: (sprintIds: string[]) => void;
  onBulkShowcaseDisable: (sprintIds: string[]) => void;
}

const SprintLedgerComponent: FunctionComponent<SprintLedgerProps> = ({
  initialQuery,
  sprints,
  isLoading,
  sprintKeyPrefix = "SPR",
  listWindow,
  onListWindowChange,
  activeRunsBySprintId,
  pauseResumeRunsBySprintId,
  interventionBySprintId,
  ciStatusBySprintId = EMPTY_CI_STATUS_BY_SPRINT_ID,
  pendingActionIds,
  onToggleShowcase,
  onSprintToggle,
  onSprintPauseResume,
  onOpenRowMenu,
  onEditSprint,
  onExportSprint,
  onOverridesSprint,
  onMarkCompletedSprint,
  onMarkQaPassedSprint,
  onRollbackSprint,
  onDeleteSprint,
  onBulkStart,
  onBulkDelete,
  onBulkShowcaseEnable,
  onBulkShowcaseDisable,
}) => {
  const initialFilters: LedgerFilters = {
    ...DEFAULT_LEDGER_FILTERS,
    query: initialQuery || DEFAULT_LEDGER_FILTERS.query,
  };
  const getInitialLedgerAnnouncement = () => {
    const initialSort: LedgerSort = { key: "createdAt", direction: "desc" };
    const initialFiltered = filterSprints(sprints, initialFilters, sprintKeyPrefix);
    const initialSorted = sortSprints(initialFiltered, initialSort, sprintKeyPrefix);
    const initialWindowed = sliceListWindow(initialSorted, listWindow);
    return getLedgerOutcomeMessage(
      "Sorted by Created descending.",
      initialWindowed.length,
      {
        totalCount: sprints.length,
        filteredCount: initialSorted.length,
        selectedCount: 0,
      },
    );
  };
  const [filters, setFilters] = useState<LedgerFilters>(initialFilters);
  const [sort, setSort] = useState<LedgerSort>({ key: "createdAt", direction: "desc" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastBulkAction, setLastBulkAction] = useState<BulkLedgerAction>(null);
  const { isOpen, options, requestConfirm, handleConfirm, handleCancel } = useConfirmDialog();
  const bulkDeleteButtonRef = useRef<HTMLButtonElement>(null);
  const ledgerFocusRef = useRef<HTMLDivElement>(null);
  const previousBulkPendingRef = useRef(false);
  const bulkPendingSummaryRef = useRef<{ action: BulkLedgerAction; count: number } | null>(null);
  const [ledgerAnnouncement, setLedgerAnnouncement] = useState(getInitialLedgerAnnouncement);

  useEffect(() => {
    if (initialQuery !== undefined) {
      setFilters(prev => ({ ...prev, query: initialQuery }));
    }
  }, [initialQuery]);

  const filteredSprints = useMemo(
    () => filterSprints(sprints, filters, sprintKeyPrefix),
    [sprints, filters, sprintKeyPrefix],
  );

  const ledgerSprints = useMemo(
    () => sortSprints(filteredSprints, sort, sprintKeyPrefix),
    [filteredSprints, sort, sprintKeyPrefix],
  );

  const windowedSprints = useMemo(() => {
    return sliceListWindow(ledgerSprints, listWindow);
  }, [ledgerSprints, listWindow]);

  const ledgerSummary = useMemo(() => ({
    pinnedCount: sprints.filter((sprint) => sprint.showcasePinned).length,
    activeCount: sprints.filter((sprint) => sprint.status === "running" || sprint.status === "paused").length,
    completedCount: sprints.filter((sprint) => sprint.status === "completed").length,
  }), [sprints]);

  const actionableInterventionBySprintId = useMemo(() => {
    const map = new Map<string, ExecutionHumanInterventionSummary>();
    for (const sprint of sprints) {
      if (sprint.status === "running" || sprint.status === "paused") {
        const intervention = interventionBySprintId.get(sprint.id);
        if (intervention && intervention.ownerType !== "worker") {
          map.set(sprint.id, intervention);
        }
      }
    }
    return map;
  }, [sprints, interventionBySprintId]);

  const announceLedgerOutcome = useCallback((
    outcome: string,
    visibleCount: number,
    selectedCount: number,
    options?: { totalCount?: number; filteredCount?: number; removedSelectedCount?: number },
  ) => {
    setLedgerAnnouncement(getLedgerOutcomeMessage(outcome, visibleCount, {
      totalCount: options?.totalCount,
      filteredCount: options?.filteredCount,
      selectedCount,
      removedSelectedCount: options?.removedSelectedCount,
    }));
  }, []);

  const handleFiltersChange = useCallback((nextFilters: LedgerFilters) => {
    const nextFiltered = filterSprints(sprints, nextFilters, sprintKeyPrefix);
    const nextLedgerSprints = sortSprints(nextFiltered, sort, sprintKeyPrefix);
    const nextWindowedCount = sliceListWindow(nextLedgerSprints, listWindow).length;
    const nextSelectedIds = pruneSelection(selectedIds, nextLedgerSprints);
    const removedCount = selectedIds.size - nextSelectedIds.size;

    setFilters(nextFilters);
    if (removedCount > 0) {
      setSelectedIds(nextSelectedIds);
    }
    announceLedgerOutcome(
      nextFilters.query.trim() || nextFilters.qa !== "all" || nextFilters.showcase !== "all" || nextFilters.status !== "all"
        ? "Filters updated."
        : "Filters cleared.",
      nextWindowedCount,
      nextSelectedIds.size,
      { totalCount: sprints.length, filteredCount: nextLedgerSprints.length, removedSelectedCount: removedCount },
    );
  }, [announceLedgerOutcome, listWindow, selectedIds, sort, sprintKeyPrefix, sprints]);

  // Prune selection when the backing sprint list changes under the current filters.
  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const pruned = pruneSelection(current, filteredSprints);
      const removedCount = current.size - pruned.size;
      if (removedCount > 0) {
        const nextWindowedCount = sliceListWindow(filteredSprints, listWindow).length;
        announceLedgerOutcome(
          "Selection updated after ledger data changed.",
          nextWindowedCount,
          pruned.size,
          { totalCount: sprints.length, filteredCount: filteredSprints.length, removedSelectedCount: removedCount },
        );
      }
      return pruned.size === current.size ? current : pruned;
    });
  }, [announceLedgerOutcome, filteredSprints, listWindow, sprints.length]);

  const selectedFiltered = useMemo(
    () => getSelectedFilteredSprints(selectedIds, ledgerSprints),
    [selectedIds, ledgerSprints],
  );
  const selectionSummary = useMemo(
    () => getLedgerSelectionSummary(selectedIds, ledgerSprints),
    [selectedIds, ledgerSprints],
  );

  const {
    isBulkStartPending,
    isBulkStopPending,
    isBulkPinPending,
    isBulkDeletePending,
    isAnyBulkPending
  } = useMemo(() => {
    let start = false;
    let stop = false;
    let pin = false;
    let del = false;

    // We only care about pending actions that are part of a BULK operation
    // against the selected set, OR a global delete that locks the table.
    // For specific UI requests, we can just check if ANY of the selected rows
    // are currently pending, and consider that a "bulk pending" state for those rows.
    for (const sprint of selectedFiltered) {
      const activeRun = activeRunsBySprintId.get(sprint.id);
      if (pendingActionIds.has(`sprint-start:${sprint.id}`)) start = true;
      if (activeRun && pendingActionIds.has(`sprint-stop:${activeRun.id}`)) stop = true;
      if (pendingActionIds.has(`sprint-showcase:${sprint.id}`)) pin = true;
      if (pendingActionIds.has(`sprint-delete:${sprint.id}`)) del = true;
    }

    // Check for any ongoing deletes at all, as delete is destructive
    for (const sprint of ledgerSprints) {
      if (pendingActionIds.has(`sprint-delete:${sprint.id}`)) del = true;
    }

    return {
      isBulkStartPending: start,
      isBulkStopPending: stop,
      isBulkPinPending: pin,
      isBulkDeletePending: del,
      isAnyBulkPending: start || stop || pin || del
    };
  }, [selectedFiltered, ledgerSprints, activeRunsBySprintId, pendingActionIds]);

  const isBulkPending = isAnyBulkPending;
  const isBulkOperationPending = isBulkPending && lastBulkAction !== null;

  useEffect(() => {
    if (isBulkOperationPending) {
      previousBulkPendingRef.current = true;
      bulkPendingSummaryRef.current = {
        action: lastBulkAction,
        count: selectedFiltered.length,
      };
      return;
    }

    if (!previousBulkPendingRef.current) {
      return;
    }

    previousBulkPendingRef.current = false;
    const summary = bulkPendingSummaryRef.current;
    bulkPendingSummaryRef.current = null;
    const completedAction = summary?.action;
    const completedCount = summary?.count ?? selectedFiltered.length;
    const actionLabel = completedAction === "delete"
      ? "Delete"
      : completedAction === "start"
        ? "Start"
        : completedAction === "pin"
          ? "Pin"
          : completedAction === "unpin"
            ? "Unpin"
            : "Bulk action";

    announceLedgerOutcome(
      `${actionLabel} completed for ${completedCount} selected sprint${completedCount === 1 ? "" : "s"}.`,
      windowedSprints.length,
      selectedFiltered.length,
      { totalCount: sprints.length, filteredCount: ledgerSprints.length },
    );
    setLastBulkAction(null);
  }, [announceLedgerOutcome, isBulkOperationPending, lastBulkAction, ledgerSprints.length, selectedFiltered.length, sprints.length, windowedSprints.length]);

  const viewStateKey = useMemo(
    () => getLedgerViewStateKey(filters, sort, listWindow),
    [filters, sort, listWindow],
  );

  const interactionTokens = useInteractionTokens();
  const sortDuration = useResolvedMotionDuration(INTERACTION_TOKENS.listReorder.duration);
  const sortEase = INTERACTION_TOKENS.listReorder.ease;
  const listReorderStyle = {
    transitionDuration: interactionTokens.listReorder.duration,
    transitionTimingFunction: interactionTokens.listReorder.ease,
  };
  const controlFeedbackStyle = {
    transitionDuration: interactionTokens.controlFeedback.duration,
    transitionTimingFunction: interactionTokens.controlFeedback.ease,
  };
  const selectionMovementStyle = {
    transitionDuration: interactionTokens.selectionMovement.duration,
    transitionTimingFunction: interactionTokens.selectionMovement.ease,
  };

  const handleSort = (key: SprintTableSortKey) => {
    setSort((current) => {
      const next = nextSort(current, key);
      const nextLedgerSprints = sortSprints(filteredSprints, next, sprintKeyPrefix);
      const nextWindowedCount = sliceListWindow(nextLedgerSprints, listWindow).length;
      announceLedgerOutcome(
        `Sorted by ${SPRINT_TABLE_SORT_LABELS[next.key]} ${next.direction === "asc" ? "ascending" : "descending"}.`,
        nextWindowedCount,
        selectedFiltered.length,
        { totalCount: sprints.length, filteredCount: nextLedgerSprints.length },
      );
      return next;
    });
  };

  const handleListWindowChange = useCallback((value: ListWindowOption) => {
    onListWindowChange(value);
    const nextVisibleCount = sliceListWindow(ledgerSprints, value).length;
    announceLedgerOutcome(
      `List window updated to show ${value === "All" || value === "all" ? "all filtered sprints" : `up to ${value} sprints`}.`,
      nextVisibleCount,
      selectedFiltered.length,
      { totalCount: sprints.length, filteredCount: ledgerSprints.length },
    );
  }, [announceLedgerOutcome, ledgerSprints, onListWindowChange, selectedFiltered.length, sprints.length]);

  const handleToggleSelectAll = () => {
    if (selectionSummary.allSelected) {
      setSelectedIds(new Set());
      announceLedgerOutcome("Deselected all filtered sprints.", windowedSprints.length, 0, { totalCount: sprints.length, filteredCount: ledgerSprints.length });
    } else {
      const next = new Set(selectedIds);
      for (const sprint of ledgerSprints) {
        next.add(sprint.id);
      }
      setSelectedIds(next);
      announceLedgerOutcome("Selected all filtered sprints.", windowedSprints.length, ledgerSprints.length, { totalCount: sprints.length, filteredCount: ledgerSprints.length });
    }
  };

  const handleToggleRow = useCallback((id: string) => {
    const sprint = ledgerSprints.find((item) => item.id === id);
    setSelectedIds((current) => {
      const next = toggleSelection(current, id);
      const selected = next.has(id);
      announceLedgerOutcome(
        `${selected ? "Selected" : "Deselected"} sprint ${sprint?.name ?? id}.`,
        windowedSprints.length,
        getLedgerSelectionSummary(next, ledgerSprints).selectedCount,
        { totalCount: sprints.length, filteredCount: ledgerSprints.length },
      );
      return next;
    });
  }, [announceLedgerOutcome, ledgerSprints, sprints.length, windowedSprints.length]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(deselectAll());
    setLastBulkAction(null);
    announceLedgerOutcome("Sprint selection cleared.", windowedSprints.length, 0, { totalCount: sprints.length, filteredCount: ledgerSprints.length });
  }, [announceLedgerOutcome, ledgerSprints.length, sprints.length, windowedSprints.length]);

  const restoreBulkDeleteFocus = useCallback(() => {
    const focusTarget = () => {
      if (bulkDeleteButtonRef.current && !bulkDeleteButtonRef.current.disabled) {
        bulkDeleteButtonRef.current.focus();
      } else {
        ledgerFocusRef.current?.focus();
      }
    };
    window.setTimeout(focusTarget, 0);
    window.setTimeout(focusTarget, 75);
  }, []);

  const handleBulkStart = useCallback(() => {
    if (isBulkPending || selectedFiltered.length === 0) return;
    setLastBulkAction("start");
    announceLedgerOutcome("Starting selected sprints.", windowedSprints.length, selectedFiltered.length, { totalCount: sprints.length, filteredCount: ledgerSprints.length });
    onBulkStart(selectedFiltered.map((s) => s.id));
  }, [announceLedgerOutcome, isBulkPending, ledgerSprints.length, onBulkStart, selectedFiltered, sprints.length, windowedSprints.length]);

  const handleBulkDelete = useCallback(async () => {
    if (isBulkPending || selectedFiltered.length === 0) return;
    const selectedCount = selectedFiltered.length;
    const confirmed = await requestConfirm({
      title: `Delete ${selectedCount} Selected Sprint${selectedCount === 1 ? "" : "s"}?`,
      body: `You are deleting ${selectedCount} selected sprint${selectedCount === 1 ? "" : "s"} from the current filtered ledger result. ${formatSelectedSprintNamesForConfirmation(selectedFiltered)} This action is permanent and will cascade to all downstream tasks, logs, and associated git artifacts. Please ensure you have cleaned up your repository branches if needed before proceeding.`,
      confirmLabel: `Delete ${selectedCount} Sprint${selectedCount === 1 ? "" : "s"}`,
      cancelLabel: "Cancel",
      destructive: true,
    });

    if (confirmed) {
      setLastBulkAction("delete");
      announceLedgerOutcome("Bulk delete confirmed. Deleting selected sprints.", windowedSprints.length, selectedCount, { totalCount: sprints.length, filteredCount: ledgerSprints.length });
      onBulkDelete(selectedFiltered.map((s) => s.id));
      restoreBulkDeleteFocus();
      // Selection clears naturally as items are removed, keeping the pending state visible
    } else {
      announceLedgerOutcome("Bulk delete canceled. Selected sprints were not deleted.", windowedSprints.length, selectedCount, { totalCount: sprints.length, filteredCount: ledgerSprints.length });
      restoreBulkDeleteFocus();
    }
  }, [announceLedgerOutcome, isBulkPending, ledgerSprints.length, onBulkDelete, selectedFiltered, requestConfirm, restoreBulkDeleteFocus, sprints.length, windowedSprints.length]);

  const handleBulkShowcaseEnable = useCallback(() => {
    if (isBulkPending || selectedFiltered.length === 0) return;
    setLastBulkAction("pin");
    announceLedgerOutcome("Pinning selected sprints.", windowedSprints.length, selectedFiltered.length, { totalCount: sprints.length, filteredCount: ledgerSprints.length });
    onBulkShowcaseEnable(selectedFiltered.map((s) => s.id));
  }, [announceLedgerOutcome, isBulkPending, ledgerSprints.length, onBulkShowcaseEnable, selectedFiltered, sprints.length, windowedSprints.length]);

  const handleBulkShowcaseDisable = useCallback(() => {
    if (isBulkPending || selectedFiltered.length === 0) return;
    setLastBulkAction("unpin");
    announceLedgerOutcome("Unpinning selected sprints.", windowedSprints.length, selectedFiltered.length, { totalCount: sprints.length, filteredCount: ledgerSprints.length });
    onBulkShowcaseDisable(selectedFiltered.map((s) => s.id));
  }, [announceLedgerOutcome, isBulkPending, ledgerSprints.length, onBulkShowcaseDisable, selectedFiltered, sprints.length, windowedSprints.length]);

  const restoreLedgerFallbackFocus = useCallback(() => {
    const focusTarget = () => ledgerFocusRef.current?.focus();
    window.setTimeout(focusTarget, 0);
    window.setTimeout(focusTarget, 75);
  }, []);

  const handleDeleteSprint = useCallback(async (sprint: Sprint) => {
    if (pendingActionIds.has(`sprint-delete:${sprint.id}`)) {
      return;
    }

    const confirmed = await requestConfirm({
      title: `Delete Sprint "${sprint.name}"?`,
      body: `You are deleting sprint "${sprint.name}". This action is permanent and will remove all associated tasks, logs, and execution history.`,
      confirmLabel: "Delete Sprint",
      cancelLabel: "Cancel",
      destructive: true,
    });

    if (confirmed) {
      announceLedgerOutcome(
        `Delete confirmed for sprint ${sprint.name}. Deletion is in progress.`,
        windowedSprints.length,
        selectedFiltered.length,
        { totalCount: sprints.length, filteredCount: ledgerSprints.length },
      );
      onDeleteSprint(sprint.id);
    } else {
      announceLedgerOutcome(
        `Delete canceled for sprint ${sprint.name}. Sprint was not deleted.`,
        windowedSprints.length,
        selectedFiltered.length,
        { totalCount: sprints.length, filteredCount: ledgerSprints.length },
      );
    }
    restoreLedgerFallbackFocus();
  }, [announceLedgerOutcome, ledgerSprints.length, onDeleteSprint, pendingActionIds, requestConfirm, restoreLedgerFallbackFocus, selectedFiltered.length, sprints.length, windowedSprints.length]);


  // Memoize stable handlers to pass to memoized SprintLedgerRow
  const stableOnToggleShowcase = useCallback(
    (sprint: Sprint) => onToggleShowcase(sprint),
    [onToggleShowcase]
  );
  const stableOnSprintToggle = useCallback(
    (sprintId: string) => onSprintToggle(sprintId),
    [onSprintToggle]
  );
  const stableOnSprintPauseResume = useCallback(
    (sprintId: string) => onSprintPauseResume(sprintId),
    [onSprintPauseResume]
  );

  const renderSortIndicator = (key: SprintTableSortKey) => {
    if (sort.key !== key) {
      return (
        <span className="inline-flex min-w-[2.75rem] items-center justify-end gap-1 text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500" aria-hidden="true">
          <ArrowUpDown className="h-3 w-3 transition-transform" strokeWidth={2.2} style={{ transitionDuration: typeof sortDuration === 'number' ? `${sortDuration}s` : sortDuration, transitionTimingFunction: sortEase }} />
          None
        </span>
      );
    }
    return sort.direction === "asc"
      ? (
        <span className="inline-flex min-w-[2.75rem] items-center justify-end gap-1 text-[10px] font-bold uppercase text-signal-600 dark:text-signal-300" aria-hidden="true">
          <ArrowUp className="h-3 w-3 transition-transform" strokeWidth={2.2} style={{ transitionDuration: typeof sortDuration === 'number' ? `${sortDuration}s` : sortDuration, transitionTimingFunction: sortEase }} />
          Asc
        </span>
      )
      : (
        <span className="inline-flex min-w-[2.75rem] items-center justify-end gap-1 text-[10px] font-bold uppercase text-signal-600 dark:text-signal-300" aria-hidden="true">
          <ArrowDown className="h-3 w-3 transition-transform" strokeWidth={2.2} style={{ transitionDuration: typeof sortDuration === 'number' ? `${sortDuration}s` : sortDuration, transitionTimingFunction: sortEase }} />
          Desc
        </span>
      );
  };

  const renderSortHeader = (key: SprintTableSortKey, options?: { align?: "left" | "right"; className?: string; isLast?: boolean }) => {
    const label = SPRINT_TABLE_SORT_LABELS[key];
    const alignRight = options?.align === "right";
    const descriptionId = `sprint-ledger-sort-${key}-description`;
    const sortDescription = getSortButtonDescription(sort, key);
    return (
      <TableCell
        isHeader
        align={options?.align}
        isLast={options?.isLast}
        className={`group ${options?.className ?? ""}`}
        ariaSort={getSortAriaSort(sort, key)}
      >
        <button
          type="button"
          onClick={() => handleSort(key)}
          className={`inline-flex w-full items-center gap-2 rounded-lg transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:hover:text-slate-200 ${alignRight ? "justify-end" : "justify-start"}`}
          style={controlFeedbackStyle}
          aria-label={getSortButtonLabel(sort, key)}
          aria-describedby={descriptionId}
        >
          {alignRight ? (
            <>
              {renderSortIndicator(key)}
              <span>{label}</span>
            </>
          ) : (
            <>
              <span>{label}</span>
              {renderSortIndicator(key)}
            </>
          )}
          <span id={descriptionId} className="sr-only">{sortDescription}</span>
        </button>
      </TableCell>
    );
  };

  return (
    <div className="w-full">
      <SprintLedgerHeader
        sprintsCount={sprints.length}
        ledgerSprintsCount={ledgerSprints.length}
        pinnedCount={ledgerSummary.pinnedCount}
        activeCount={ledgerSummary.activeCount}
        completedCount={ledgerSummary.completedCount}
        listWindow={listWindow}
        onListWindowChange={handleListWindowChange}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        transitionStyle={listReorderStyle}
      />

      <SprintLedgerBulkActions
        selectedCount={selectedFiltered.length}
        totalCount={ledgerSprints.length}
        currentAction={lastBulkAction}
        isAnyPending={isBulkPending}
        isStartPending={isBulkStartPending}
        isDeletePending={isBulkDeletePending}
        isPinPending={isBulkPinPending}
        onBulkStart={handleBulkStart}
        onBulkDelete={handleBulkDelete}
        onBulkShowcaseEnable={handleBulkShowcaseEnable}
        onBulkShowcaseDisable={handleBulkShowcaseDisable}
        onClearSelection={handleClearSelection}
        controlTransitionStyle={controlFeedbackStyle}
        deleteButtonRef={bulkDeleteButtonRef}
      />

      <ConfirmDialog
        isOpen={isOpen}
        options={options}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      <div
        ref={ledgerFocusRef}
        tabIndex={-1}
        className="min-h-[20rem] px-3 py-4 transition-[opacity,transform] sm:px-4 lg:px-5"
        data-ledger-view-state={viewStateKey}
        style={listReorderStyle}
      >
        <div className="overflow-x-auto w-full overscroll-x-contain -mx-3 px-3 sm:-mx-4 sm:px-4 lg:-mx-5 lg:px-5">
          <div className="min-w-max">
            <Table caption="Sprint ledger with selection, sorting, and bulk actions.">
              <TableHeader>
            <TableCell isHeader isFirst className="w-[80px] min-w-[80px]">
              <span className="sr-only">Select</span>
              <button
                type="button"
                disabled={windowedSprints.length === 0 || isAnyBulkPending}
                onClick={handleToggleSelectAll}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-black/[0.04] hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:hover:bg-white/[0.05] dark:hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                style={selectionMovementStyle}
                title={isAnyBulkPending ? "Bulk action in progress for selected sprints" : selectionSummary.allSelected ? "Deselect all filtered sprints" : "Select all filtered sprints"}
                aria-label={isAnyBulkPending ? "Cannot change filtered sprint selection while a bulk action is in progress" : selectionSummary.allSelected ? "Deselect all filtered sprints" : "Select all filtered sprints"}
                aria-pressed={selectionSummary.allSelected}
                aria-disabled={windowedSprints.length === 0 || isAnyBulkPending}
                aria-busy={isAnyBulkPending ? "true" : undefined}
              >
                {selectionSummary.allSelected
                  ? <CheckSquare className="h-4 w-4 text-signal-500" strokeWidth={2.2} />
                  : <Square className="h-4 w-4" strokeWidth={2.2} />}
              </button>
            </TableCell>
            {renderSortHeader("showcasePinned", { className: "w-[80px] min-w-[80px]" })}
            {renderSortHeader("sprintKey", { className: "w-[120px] min-w-[120px]" })}
            {renderSortHeader("name", { className: "w-[220px] min-w-[220px]" })}
            {renderSortHeader("status", { className: "w-[120px] min-w-[120px]" })}
            {renderSortHeader("tasksCount", { align: "right", className: "w-[100px] min-w-[100px]" })}
            {renderSortHeader("completion", { align: "right", className: "w-[140px] min-w-[140px]" })}
            {renderSortHeader("createdAt", { className: "w-[120px] min-w-[120px]" })}
            <TableCell isHeader align="right" isLast className="w-[140px] min-w-[140px] pr-6">Controls</TableCell>
          </TableHeader>
          <TableBody>
            {isLoading && windowedSprints.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="block lg:table-row">
                  <TableCell colSpan={9} className="p-2">
                    <SkeletonRow />
                  </TableCell>
                </tr>
              ))
            ) : windowedSprints.length === 0 ? (
              <tr className="block lg:table-row">
                <TableCell colSpan={9}>
                  <div className="flex min-h-[16rem] flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-black/[0.08] bg-white/50 px-6 py-10 text-center dark:border-white/[0.08] dark:bg-white/[0.03]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-black/[0.06] bg-white/80 text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.05]">
                      <Inbox className="h-5 w-5" strokeWidth={2.1} />
                    </div>
                    <div aria-live="polite" className="mt-4 font-display text-xl font-bold text-slate-800 dark:text-white">
                      {filters.query || filters.qa !== "all" || filters.showcase !== "all" || filters.status !== "all"
                        ? "No matching sprints"
                        : "No sprints yet"}
                    </div>
                    <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {filters.query || filters.qa !== "all" || filters.showcase !== "all" || filters.status !== "all"
                        ? "Adjust the search or filters to bring sprints back into the ledger."
                        : "Create a sprint above and it will appear in the showcase and ledger automatically."}
                    </p>
                  </div>
                </TableCell>
              </tr>
            ) : (
              windowedSprints.map((sprint, index) => (
                <SprintLedgerRow
                  key={sprint.id}
                  sprint={sprint}
                  isSelected={selectedIds.has(sprint.id)}
                  isEven={index % 2 === 0}
                  activeRun={activeRunsBySprintId.get(sprint.id)}
                  pauseResumeRun={pauseResumeRunsBySprintId.get(sprint.id)}
                  humanIntervention={actionableInterventionBySprintId.get(sprint.id) || null}
                  ciStatus={ciStatusBySprintId.get(sprint.id) || null}
                  sprintKeyPrefix={sprintKeyPrefix}
                  pendingActionIds={pendingActionIds}
                  isAnyBulkPending={isAnyBulkPending}
                  transitionStyle={listReorderStyle}
                  controlTransitionStyle={controlFeedbackStyle}
                  selectionTransitionStyle={selectionMovementStyle}
                  onToggleRow={handleToggleRow}
                  onToggleShowcase={stableOnToggleShowcase}
                  onSprintToggle={stableOnSprintToggle}
                  onSprintPauseResume={stableOnSprintPauseResume}
                  onOpenRowMenu={onOpenRowMenu}
                  onEdit={() => onEditSprint(sprint)}
                  onExport={() => onExportSprint(sprint)}
                  onOverrides={() => onOverridesSprint(sprint)}
                  onMarkCompleted={() => onMarkCompletedSprint(sprint.id)}
                  onMarkQaPassed={onMarkQaPassedSprint ? () => onMarkQaPassedSprint(sprint.id) : undefined}
                  onRollback={onRollbackSprint ? () => onRollbackSprint(sprint) : undefined}
                  onDelete={() => { void handleDeleteSprint(sprint); }}
                />
              ))
            )}
          </TableBody>
            </Table>
          </div>
        </div>
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {ledgerAnnouncement}
      </div>
    </div>
  );
};

export const SprintLedger = memo(SprintLedgerComponent);
