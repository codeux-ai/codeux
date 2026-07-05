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
  pendingActionIds,
  onToggleShowcase,
  onSprintToggle,
  onSprintPauseResume,
  onOpenRowMenu,
  onEditSprint,
  onExportSprint,
  onOverridesSprint,
  onMarkCompletedSprint,
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
  const [filters, setFilters] = useState<LedgerFilters>(initialFilters);
  const [sort, setSort] = useState<LedgerSort>({ key: "createdAt", direction: "desc" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastBulkAction, setLastBulkAction] = useState<BulkLedgerAction>(null);
  const { isOpen, options, requestConfirm, handleConfirm, handleCancel } = useConfirmDialog();
  const bulkDeleteButtonRef = useRef<HTMLButtonElement>(null);
  const ledgerFocusRef = useRef<HTMLDivElement>(null);
  const [sortAnnouncement, setSortAnnouncement] = useState("Sorted by Created descending.");
  const [filterAnnouncement, setFilterAnnouncement] = useState("");
  const [selectionAnnouncement, setSelectionAnnouncement] = useState("No sprints selected.");
  const [selectionEventAnnouncement, setSelectionEventAnnouncement] = useState("");
  const [bulkAnnouncement, setBulkAnnouncement] = useState("");

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

  // Prune selection when filter changes
  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const pruned = pruneSelection(current, filteredSprints);
      const removedCount = current.size - pruned.size;
      if (removedCount > 0) {
        setSelectionEventAnnouncement(`${removedCount} selected sprint${removedCount === 1 ? "" : "s"} removed from selection because filters changed. ${pruned.size} selected sprint${pruned.size === 1 ? "" : "s"} remain.`);
      }
      return pruned.size === current.size ? current : pruned;
    });
  }, [filteredSprints]);

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

  useEffect(() => {
    const hasFilters = Boolean(filters.query.trim()) || filters.qa !== "all" || filters.showcase !== "all" || filters.status !== "all";
    setFilterAnnouncement(hasFilters
      ? `Filter results updated: showing ${ledgerSprints.length} of ${sprints.length} sprints.`
      : `Filters cleared: showing all ${sprints.length} sprints.`);
  }, [filters, ledgerSprints.length, sprints.length]);

  useEffect(() => {
    const selectedCount = selectedFiltered.length;
    setSelectionAnnouncement(selectedCount === 0
      ? "No sprints selected."
      : `${selectedCount} of ${ledgerSprints.length} filtered sprints selected.`);
  }, [ledgerSprints.length, selectedFiltered.length]);

  const handleSort = (key: SprintTableSortKey) => {
    setSort((current) => {
      const next = nextSort(current, key);
      setSortAnnouncement(`Sorted by ${SPRINT_TABLE_SORT_LABELS[next.key]} ${next.direction === "asc" ? "ascending" : "descending"}. ${ledgerSprints.length} sprint${ledgerSprints.length === 1 ? " remains" : "s remain"} visible.`);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectionSummary.allSelected) {
      setSelectedIds(new Set());
      setSelectionEventAnnouncement(`Deselected all ${ledgerSprints.length} filtered sprint${ledgerSprints.length === 1 ? "" : "s"}.`);
    } else {
      const next = new Set(selectedIds);
      for (const sprint of ledgerSprints) {
        next.add(sprint.id);
      }
      setSelectedIds(next);
      setSelectionEventAnnouncement(`Selected all ${ledgerSprints.length} filtered sprint${ledgerSprints.length === 1 ? "" : "s"}.`);
    }
  };

  const handleToggleRow = useCallback((id: string) => {
    setSelectedIds((current) => toggleSelection(current, id));
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(deselectAll());
    setLastBulkAction(null);
    setSelectionEventAnnouncement("Sprint selection cleared.");
  }, []);

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
    setLastBulkAction("start");
    setBulkAnnouncement(`Starting ${selectedFiltered.length} selected sprint${selectedFiltered.length === 1 ? "" : "s"}.`);
    onBulkStart(selectedFiltered.map((s) => s.id));
  }, [onBulkStart, selectedFiltered]);

  const handleBulkDelete = useCallback(async () => {
    const selectedCount = selectedFiltered.length;
    const confirmed = await requestConfirm({
      title: "Delete Sprints?",
      body: `You are deleting ${selectedCount} selected sprint${selectedCount === 1 ? "" : "s"} from the current filtered ledger result. This action is permanent and will cascade to all downstream tasks, logs, and associated git artifacts. Please ensure you have cleaned up your repository branches if needed before proceeding.`,
      confirmLabel: "Delete Sprints",
      cancelLabel: "Cancel",
      destructive: true,
    });

    if (confirmed) {
      setLastBulkAction("delete");
      setBulkAnnouncement(`Deleting ${selectedCount} selected sprint${selectedCount === 1 ? "" : "s"}.`);
      onBulkDelete(selectedFiltered.map((s) => s.id));
      restoreBulkDeleteFocus();
      // Selection clears naturally as items are removed, keeping the pending state visible
    } else {
      setBulkAnnouncement(`Bulk delete canceled. ${selectedCount} selected sprint${selectedCount === 1 ? "" : "s"} remain selected.`);
      restoreBulkDeleteFocus();
    }
  }, [onBulkDelete, selectedFiltered, requestConfirm, restoreBulkDeleteFocus]);

  const handleBulkShowcaseEnable = useCallback(() => {
    setLastBulkAction("pin");
    setBulkAnnouncement(`Pinning ${selectedFiltered.length} selected sprint${selectedFiltered.length === 1 ? "" : "s"}.`);
    onBulkShowcaseEnable(selectedFiltered.map((s) => s.id));
  }, [onBulkShowcaseEnable, selectedFiltered]);

  const handleBulkShowcaseDisable = useCallback(() => {
    setLastBulkAction("unpin");
    setBulkAnnouncement(`Unpinning ${selectedFiltered.length} selected sprint${selectedFiltered.length === 1 ? "" : "s"}.`);
    onBulkShowcaseDisable(selectedFiltered.map((s) => s.id));
  }, [onBulkShowcaseDisable, selectedFiltered]);


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
        onListWindowChange={onListWindowChange}
        filters={filters}
        onFiltersChange={setFilters}
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
                aria-label={selectionSummary.allSelected ? "Deselect all filtered sprints" : "Select all filtered sprints"}
                aria-pressed={selectionSummary.allSelected}
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
                  onDelete={() => onDeleteSprint(sprint.id)}
                />
              ))
            )}
          </TableBody>
            </Table>
          </div>
        </div>
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {[sortAnnouncement, filterAnnouncement, selectionAnnouncement, selectionEventAnnouncement, bulkAnnouncement].filter(Boolean).join(" ")}
      </div>
    </div>
  );
};

export const SprintLedger = memo(SprintLedgerComponent);
