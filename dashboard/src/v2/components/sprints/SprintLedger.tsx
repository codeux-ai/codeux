import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState, useCallback } from "preact/hooks";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckSquare,
  Inbox,
  Square,
} from "lucide-preact";
import { SkeletonRow } from "../layout/SkeletonLoader.js";
import { resolveListWindow, type ListWindowOption } from "../../lib/list-window.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import type { Sprint } from "../../types.js";
import type { ExecutionHumanInterventionSummary } from "../../../../../src/contracts/app-types.js";
import {
  filterSprints,
  sortSprints,
  sliceLedgerSprints,
  toggleSelection,
  deselectAll,
  pruneSelection,
  getSelectedFilteredSprints,
  nextSort,
  DEFAULT_LEDGER_FILTERS,
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

export const SprintLedger: FunctionComponent<SprintLedgerProps> = ({
  initialQuery,
  sprints,
  isLoading,
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
  const { isOpen, options, requestConfirm, handleConfirm, handleCancel } = useConfirmDialog();

  useEffect(() => {
    if (initialQuery !== undefined) {
      setFilters(prev => ({ ...prev, query: initialQuery }));
    }
  }, [initialQuery]);

  const filteredSprints = useMemo(
    () => filterSprints(sprints, filters),
    [sprints, filters],
  );

  const ledgerSprints = useMemo(
    () => sortSprints(filteredSprints, sort),
    [filteredSprints, sort],
  );

  const windowedSprints = useMemo(() => {
    const limit = resolveListWindow(listWindow, ledgerSprints.length);
    return sliceLedgerSprints(ledgerSprints, limit);
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
      return pruned.size === current.size ? current : pruned;
    });
  }, [filteredSprints]);

  const selectedFiltered = useMemo(
    () => getSelectedFilteredSprints(selectedIds, ledgerSprints),
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

  const allFilteredSelected = ledgerSprints.length > 0 && ledgerSprints.every((s) => selectedIds.has(s.id));

  const handleSort = (key: SprintTableSortKey) => {
    setSort((current) => nextSort(current, key));
  };

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      const next = new Set(selectedIds);
      for (const sprint of ledgerSprints) {
        next.add(sprint.id);
      }
      setSelectedIds(next);
    }
  };

  const handleToggleRow = useCallback((id: string) => {
    setSelectedIds((current) => toggleSelection(current, id));
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(deselectAll());
  }, []);

  const handleBulkStart = useCallback(() => {
    onBulkStart(selectedFiltered.map((s) => s.id));
  }, [onBulkStart, selectedFiltered]);

  const handleBulkDelete = useCallback(async () => {
    const confirmed = await requestConfirm({
      title: "Delete Sprints?",
      body: `Are you sure you want to delete ${selectedFiltered.length} selected sprint${selectedFiltered.length === 1 ? "" : "s"}? All associated tasks and execution history will be permanently removed.`,
      confirmLabel: "Delete Sprints",
      cancelLabel: "Cancel",
      destructive: true,
    });

    if (confirmed) {
      onBulkDelete(selectedFiltered.map((s) => s.id));
      setSelectedIds(deselectAll());
    }
  }, [onBulkDelete, selectedFiltered, requestConfirm]);

  const handleBulkShowcaseEnable = useCallback(() => {
    onBulkShowcaseEnable(selectedFiltered.map((s) => s.id));
  }, [onBulkShowcaseEnable, selectedFiltered]);

  const handleBulkShowcaseDisable = useCallback(() => {
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
      return <ArrowUpDown className="h-3 w-3 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600" strokeWidth={2.2} />;
    }
    return sort.direction === "asc"
      ? <ArrowUp className="h-3 w-3 text-signal-500" strokeWidth={2.2} />
      : <ArrowDown className="h-3 w-3 text-signal-500" strokeWidth={2.2} />;
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
      />

      <SprintLedgerBulkActions
        selectedCount={selectedFiltered.length}
        totalCount={ledgerSprints.length}
        isAnyPending={isAnyBulkPending}
        isStartPending={isBulkStartPending}
        isDeletePending={isBulkDeletePending}
        isPinPending={isBulkPinPending}
        onBulkStart={handleBulkStart}
        onBulkDelete={handleBulkDelete}
        onBulkShowcaseEnable={handleBulkShowcaseEnable}
        onBulkShowcaseDisable={handleBulkShowcaseDisable}
        onClearSelection={handleClearSelection}
      />

      <ConfirmDialog
        isOpen={isOpen}
        options={options}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      <div className="min-h-[20rem] px-3 py-4 sm:px-4 lg:px-5">
        <Table>
          <TableHeader>
            <TableCell isHeader isFirst className="w-[80px] min-w-[80px]">
              <span className="sr-only">Select</span>
              <button
                type="button"
                disabled={windowedSprints.length === 0 || isAnyBulkPending}
                onClick={handleToggleSelectAll}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-black/[0.04] hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:hover:bg-white/[0.05] dark:hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                title={allFilteredSelected ? "Deselect all" : "Select all visible"}
              >
                {allFilteredSelected
                  ? <CheckSquare className="h-4 w-4 text-signal-500" strokeWidth={2.2} />
                  : <Square className="h-4 w-4" strokeWidth={2.2} />}
              </button>
            </TableCell>
            <TableCell isHeader className="group w-[80px] min-w-[80px]">
              <button
                type="button"
                onClick={() => handleSort("showcasePinned")}
                className="inline-flex items-center gap-2 rounded-lg transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:hover:text-slate-200"
              >
                Showcase
                {renderSortIndicator("showcasePinned")}
              </button>
            </TableCell>
            <TableCell isHeader className="group w-[120px] min-w-[120px]">
              <button
                type="button"
                onClick={() => handleSort("sprintKey")}
                className="inline-flex items-center gap-2 rounded-lg transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:hover:text-slate-200"
              >
                Sprint ID
                {renderSortIndicator("sprintKey")}
              </button>
            </TableCell>
            <TableCell isHeader className="group w-[220px] min-w-[220px]">
              <button
                type="button"
                onClick={() => handleSort("name")}
                className="inline-flex items-center gap-2 rounded-lg transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:hover:text-slate-200"
              >
                Sprint
                {renderSortIndicator("name")}
              </button>
            </TableCell>
            <TableCell isHeader className="group w-[120px] min-w-[120px]">
              <button
                type="button"
                onClick={() => handleSort("status")}
                className="inline-flex items-center gap-2 rounded-lg transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:hover:text-slate-200"
              >
                Status
                {renderSortIndicator("status")}
              </button>
            </TableCell>
            <TableCell isHeader align="right" className="group w-[100px] min-w-[100px]">
              <button
                type="button"
                onClick={() => handleSort("tasksCount")}
                className="inline-flex w-full items-center justify-end gap-2 rounded-lg transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:hover:text-slate-200"
              >
                {renderSortIndicator("tasksCount")}
                Tasks
              </button>
            </TableCell>
            <TableCell isHeader align="right" className="group w-[140px] min-w-[140px]">
              <button
                type="button"
                onClick={() => handleSort("completion")}
                className="inline-flex w-full items-center justify-end gap-2 rounded-lg transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:hover:text-slate-200"
              >
                {renderSortIndicator("completion")}
                Completion
              </button>
            </TableCell>
            <TableCell isHeader className="group w-[120px] min-w-[120px]">
              <button
                type="button"
                onClick={() => handleSort("createdAt")}
                className="inline-flex items-center gap-2 rounded-lg transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:hover:text-slate-200"
              >
                Created
                {renderSortIndicator("createdAt")}
              </button>
            </TableCell>
            <TableCell isHeader align="right" isLast className="w-[140px] min-w-[140px]">Controls</TableCell>
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
                    <div className="mt-4 font-display text-xl font-bold text-slate-800 dark:text-white">
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
                  pendingActionIds={pendingActionIds}
                  isAnyBulkPending={isAnyBulkPending}
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
  );
};
