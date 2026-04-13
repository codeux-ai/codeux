import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState, useCallback } from "preact/hooks";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckSquare,
  Square,
} from "lucide-preact";
import { SkeletonRow } from "../ui/ListSkeletons.js";
import { resolveListWindow, type ListWindowOption } from "../../lib/list-window.js";
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

import { SprintLedgerHeader } from "./SprintLedgerHeader.js";
import { SprintLedgerBulkActions } from "./SprintLedgerBulkActions.js";
import { SprintLedgerRow } from "./SprintLedgerRow.js";

export interface SprintLedgerProps {
  sprints: Sprint[];
  isLoading?: boolean;
  listWindow: ListWindowOption;
  onListWindowChange: (value: ListWindowOption) => void;
  activeRunsBySprintId: Map<string, { id: string; status: string }>;
  interventionBySprintId: Map<string, ExecutionHumanInterventionSummary>;
  pendingActionIds: Set<string>;
  onToggleShowcase: (sprint: Sprint) => void;
  onSprintToggle: (sprintId: string) => void;
  onOpenRowMenu: (event: MouseEvent, sprintId: string) => void;
  onBulkStart: (sprintIds: string[]) => void;
  onBulkDelete: (sprintIds: string[]) => void;
  onBulkShowcaseEnable: (sprintIds: string[]) => void;
  onBulkShowcaseDisable: (sprintIds: string[]) => void;
}

export const SprintLedger: FunctionComponent<SprintLedgerProps> = ({
  sprints,
  isLoading,
  listWindow,
  onListWindowChange,
  activeRunsBySprintId,
  interventionBySprintId,
  pendingActionIds,
  onToggleShowcase,
  onSprintToggle,
  onOpenRowMenu,
  onBulkStart,
  onBulkDelete,
  onBulkShowcaseEnable,
  onBulkShowcaseDisable,
}) => {
  const [filters, setFilters] = useState<LedgerFilters>(DEFAULT_LEDGER_FILTERS);
  const [sort, setSort] = useState<LedgerSort>({ key: "createdAt", direction: "desc" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  const isBulkPending = useMemo(() => {
    return selectedFiltered.some((sprint) => {
      const activeRun = activeRunsBySprintId.get(sprint.id);
      return (
        pendingActionIds.has(`sprint-start:${sprint.id}`) ||
        (activeRun && pendingActionIds.has(`sprint-stop:${activeRun.id}`)) ||
        pendingActionIds.has(`sprint-showcase:${sprint.id}`) ||
        pendingActionIds.has(`sprint-delete:${sprint.id}`)
      );
    });
  }, [selectedFiltered, activeRunsBySprintId, pendingActionIds]);

  const allFilteredSelected = windowedSprints.length > 0 && windowedSprints.every((s) => selectedIds.has(s.id));

  const handleSort = (key: SprintTableSortKey) => {
    setSort((current) => nextSort(current, key));
  };

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      const next = new Set(selectedIds);
      for (const sprint of windowedSprints) {
        next.delete(sprint.id);
      }
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      for (const sprint of windowedSprints) {
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

  const handleBulkDelete = useCallback(() => {
    onBulkDelete(selectedFiltered.map((s) => s.id));
    setSelectedIds(deselectAll());
  }, [onBulkDelete, selectedFiltered]);

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
  const stableOnOpenRowMenu = useCallback(
    (event: MouseEvent, sprintId: string) => onOpenRowMenu(event, sprintId),
    [onOpenRowMenu]
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
        listWindow={listWindow}
        onListWindowChange={onListWindowChange}
        filters={filters}
        onFiltersChange={setFilters}
      />

      <SprintLedgerBulkActions
        selectedCount={selectedFiltered.length}
        isPending={isBulkPending}
        onBulkStart={handleBulkStart}
        onBulkDelete={handleBulkDelete}
        onBulkShowcaseEnable={handleBulkShowcaseEnable}
        onBulkShowcaseDisable={handleBulkShowcaseDisable}
        onClearSelection={handleClearSelection}
      />

      {/* Table */}
      <div className="overflow-x-auto min-h-[20rem]">
        <table className="min-w-full text-left">
          <thead>
            <tr className="border-b border-black/[0.06] text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:border-white/[0.06]">
              <th className="px-4 py-3 pl-6 w-10">
                <button
                  type="button"
                  disabled={windowedSprints.length === 0}
                  onClick={handleToggleSelectAll}
                  className="inline-flex items-center justify-center text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 rounded"
                  title={allFilteredSelected ? "Deselect all" : "Select all visible"}
                >
                  {allFilteredSelected
                    ? <CheckSquare className="h-4 w-4 text-signal-500" strokeWidth={2.2} />
                    : <Square className="h-4 w-4" strokeWidth={2.2} />}
                </button>
              </th>
              <th className="px-4 py-3 group">
                <button
                  type="button"
                  onClick={() => handleSort("showcasePinned")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 rounded"
                >
                  Showcase
                  {renderSortIndicator("showcasePinned")}
                </button>
              </th>
              <th className="px-4 py-3 group">
                <button
                  type="button"
                  onClick={() => handleSort("sprintKey")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 rounded"
                >
                  Sprint ID
                  {renderSortIndicator("sprintKey")}
                </button>
              </th>
              <th className="px-4 py-3 group">
                <button
                  type="button"
                  onClick={() => handleSort("name")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 rounded"
                >
                  Sprint
                  {renderSortIndicator("name")}
                </button>
              </th>
              <th className="px-4 py-3 group">
                <button
                  type="button"
                  onClick={() => handleSort("status")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 rounded"
                >
                  Status
                  {renderSortIndicator("status")}
                </button>
              </th>
              <th className="px-4 py-3 group">
                <button
                  type="button"
                  onClick={() => handleSort("tasksCount")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 rounded"
                >
                  Tasks
                  {renderSortIndicator("tasksCount")}
                </button>
              </th>
              <th className="px-4 py-3 group">
                <button
                  type="button"
                  onClick={() => handleSort("completion")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 rounded"
                >
                  Completion
                  {renderSortIndicator("completion")}
                </button>
              </th>
              <th className="px-4 py-3 group">
                <button
                  type="button"
                  onClick={() => handleSort("createdAt")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 rounded"
                >
                  Created
                  {renderSortIndicator("createdAt")}
                </button>
              </th>
              <th className="px-4 py-3 pr-6 text-right">Controls</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && windowedSprints.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04]">
                  <td colSpan={9} className="p-4">
                    <SkeletonRow />
                  </td>
                </tr>
              ))
            ) : windowedSprints.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="px-6 py-8 text-sm text-slate-400">
                    {filters.query || filters.qa !== "all" || filters.showcase !== "all" || filters.status !== "all"
                      ? "No sprints match the current filters."
                      : "No sprints exist yet. Create one above and it will appear in the showcase and in the ledger below."}
                  </div>
                </td>
              </tr>
            ) : (
              windowedSprints.map((sprint, index) => (
                <SprintLedgerRow
                  key={sprint.id}
                  sprint={sprint}
                  isSelected={selectedIds.has(sprint.id)}
                  isEven={index % 2 === 0}
                  activeRun={activeRunsBySprintId.get(sprint.id)}
                  humanIntervention={interventionBySprintId.get(sprint.id) || null}
                  pendingActionIds={pendingActionIds}
                  onToggleRow={handleToggleRow}
                  onToggleShowcase={stableOnToggleShowcase}
                  onSprintToggle={stableOnSprintToggle}
                  onOpenRowMenu={stableOnOpenRowMenu}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
