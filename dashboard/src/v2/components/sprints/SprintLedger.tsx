import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckSquare,
  Heart,
  Maximize2,
  MoreVertical,
  Play,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-preact";
import { HumanInterventionBadge } from "../ui/HumanInterventionBadge.js";
import { ListWindowSelector } from "../ui/ListWindowSelector.js";
import { SkeletonRow } from "../ui/ListSkeletons.js";
import { resolveListWindow, type ListWindowOption } from "../../lib/list-window.js";
import type { Sprint, SprintStatus } from "../../types.js";
import type { ExecutionHumanInterventionSummary } from "../../../../../src/contracts/app-types.js";
import {
  filterSprints,
  sortSprints,
  sliceLedgerSprints,
  toggleSelection,
  selectAllFiltered,
  deselectAll,
  pruneSelection,
  getSelectedFilteredSprints,
  nextSort,
  formatSprintKey,
  STATUS_LABELS,
  type LedgerSort,
  type SprintTableSortKey,
} from "../../lib/sprint-ledger-state.js";

const STATUS_BADGE_TONES: Record<SprintStatus, string> = {
  running: "border-status-green/25 bg-status-green/10 text-status-green",
  paused: "border-ember-500/25 bg-ember-500/10 text-ember-500",
  completed: "border-black/[0.08] bg-black/[0.04] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  failed: "border-status-red/20 bg-status-red/10 text-status-red",
  cancelled: "border-slate-300/40 bg-slate-200/55 text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400",
  idle: "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 dark:text-signal-300",
};

const TABLE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const TABLE_META_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const shortenId = (value: string): string => value.slice(0, 8);
const formatTableDate = (value: string): string => TABLE_DATE_FORMATTER.format(new Date(value));
const formatMetaDate = (value: string): string => TABLE_META_DATE_FORMATTER.format(new Date(value));

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
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<LedgerSort>({ key: "createdAt", direction: "desc" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filteredSprints = useMemo(
    () => filterSprints(sprints, searchQuery),
    [sprints, searchQuery],
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

  const handleToggleRow = (id: string) => {
    setSelectedIds((current) => toggleSelection(current, id));
  };

  const handleBulkStart = () => {
    onBulkStart(selectedFiltered.map((s) => s.id));
  };

  const handleBulkDelete = () => {
    onBulkDelete(selectedFiltered.map((s) => s.id));
    setSelectedIds(deselectAll());
  };

  const renderSortIndicator = (key: SprintTableSortKey) => {
    if (sort.key !== key) {
      return <ArrowUpDown className="h-3 w-3 text-slate-300 dark:text-slate-600" strokeWidth={2.2} />;
    }
    return sort.direction === "asc"
      ? <ArrowUp className="h-3 w-3 text-signal-500" strokeWidth={2.2} />
      : <ArrowDown className="h-3 w-3 text-signal-500" strokeWidth={2.2} />;
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.06] px-6 py-5 dark:border-white/[0.06]">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ember-500">
            <Heart className="h-3.5 w-3.5" strokeWidth={2.3} />
            Sprint Ledger
          </div>
          <h2 className="mt-2 font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            All sprints, fully sortable.
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            The showcase above reflects the sprints marked with the heart. New sprints are showcased by default. Pin or unpin any sprint using the heart icon.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ListWindowSelector
            value={listWindow}
            onChange={onListWindowChange}
            label="Show"
          />
          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={2.2} />
            <input
              type="text"
              value={searchQuery}
              onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
              placeholder="Search sprints…"
              className="h-9 w-56 rounded-full border border-black/[0.08] bg-white/80 pl-9 pr-8 text-xs text-slate-700 placeholder:text-slate-400 focus:border-signal-500/40 focus:outline-none focus:ring-2 focus:ring-signal-500/10 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white dark:placeholder:text-slate-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            )}
          </div>
          <div className="text-xs font-mono text-slate-400">
            {searchQuery ? `${ledgerSprints.length} / ${sprints.length}` : `${sprints.length} total`}
          </div>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedFiltered.length > 0 && (
        <div className="flex items-center gap-3 border-b border-signal-500/20 bg-signal-500/[0.06] px-6 py-3 dark:bg-signal-500/[0.08]">
          <span className="text-xs font-bold text-signal-600 dark:text-signal-300">
            {selectedFiltered.length} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBulkStart}
              className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/25 bg-signal-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-signal-600 transition-colors hover:bg-signal-500/20 dark:text-signal-300"
            >
              <Play className="h-3 w-3" fill="currentColor" />
              Start
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="inline-flex items-center gap-1.5 rounded-full border border-status-red/20 bg-status-red/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-status-red transition-colors hover:bg-status-red/20"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(deselectAll())}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left">
          <thead>
            <tr className="border-b border-black/[0.06] text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:border-white/[0.06]">
              <th className="px-4 py-3 pl-6 w-10">
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="inline-flex items-center justify-center text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                  title={allFilteredSelected ? "Deselect all" : "Select all visible"}
                >
                  {allFilteredSelected
                    ? <CheckSquare className="h-4 w-4 text-signal-500" strokeWidth={2.2} />
                    : <Square className="h-4 w-4" strokeWidth={2.2} />}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("showcasePinned")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                >
                  Showcase
                  {renderSortIndicator("showcasePinned")}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("sprintKey")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                >
                  Sprint ID
                  {renderSortIndicator("sprintKey")}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("name")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                >
                  Sprint
                  {renderSortIndicator("name")}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("status")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                >
                  Status
                  {renderSortIndicator("status")}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("tasksCount")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                >
                  Tasks
                  {renderSortIndicator("tasksCount")}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("completion")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                >
                  Completion
                  {renderSortIndicator("completion")}
                </button>
              </th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => handleSort("createdAt")}
                  className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
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
                    {searchQuery
                      ? `No sprints match "${searchQuery}".`
                      : "No sprints exist yet. Create one above and it will appear in the showcase and in the ledger below."}
                  </div>
                </td>
              </tr>
            ) : (
              windowedSprints.map((sprint, index) => {
                const activeRun = activeRunsBySprintId.get(sprint.id);
                const humanIntervention = interventionBySprintId.get(sprint.id) || null;
                const pendingActionId = activeRun ? `sprint-stop:${activeRun.id}` : `sprint-start:${sprint.id}`;
                const pinActionId = `sprint-showcase:${sprint.id}`;
                const isCompleted = sprint.status === "completed";
                const isSelected = selectedIds.has(sprint.id);
                const isEven = index % 2 === 0;
                const rowBg = isSelected
                  ? "bg-signal-500/[0.06] dark:bg-signal-500/[0.08]"
                  : isEven
                    ? "bg-white/60 dark:bg-white/[0.02]"
                    : "bg-slate-50/60 dark:bg-white/[0.035]";
                return (
                  <tr
                    key={sprint.id}
                    className={`group border-b border-black/[0.04] transition-colors hover:bg-signal-500/[0.04] dark:border-white/[0.04] dark:hover:bg-signal-500/[0.06] ${rowBg} ${isCompleted ? "text-slate-500 dark:text-slate-400" : ""}`}
                  >
                    <td className="px-4 py-3 pl-6 align-top">
                      <button
                        type="button"
                        onClick={() => handleToggleRow(sprint.id)}
                        className="inline-flex items-center justify-center text-slate-400 transition-colors hover:text-signal-500"
                      >
                        {isSelected
                          ? <CheckSquare className="h-4 w-4 text-signal-500" strokeWidth={2.2} />
                          : <Square className="h-4 w-4" strokeWidth={2.2} />}
                      </button>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => onToggleShowcase(sprint)}
                        disabled={pendingActionIds.has(pinActionId)}
                        className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                          sprint.showcasePinned
                            ? "border-status-red/20 bg-status-red/10 text-status-red"
                            : "border-black/[0.06] bg-black/[0.03] text-slate-400 hover:text-status-red dark:border-white/[0.06] dark:bg-white/[0.03]"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <Heart className="h-3.5 w-3.5" fill={sprint.showcasePinned ? "currentColor" : "none"} strokeWidth={2.1} />
                      </button>
                    </td>
                    <td className="px-4 py-3 min-w-[8rem] align-top">
                      <div className="font-mono text-sm font-bold text-slate-700 dark:text-white truncate">{formatSprintKey(sprint)}</div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 truncate">
                        {shortenId(sprint.id)}
                      </div>
                    </td>
                    <td className="px-4 py-3 min-w-0 max-w-full align-top">
                      <div className={`font-display text-lg font-black tracking-tight break-words ${isCompleted ? "text-slate-700 dark:text-slate-300" : "text-slate-900 dark:text-white"}`}>{sprint.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                        <span>Updated {formatMetaDate(sprint.updatedAt)}</span>
                        <span>·</span>
                        <span>{formatTableDate(sprint.createdAt)}</span>
                      </div>
                      {humanIntervention && (
                        <div className="mt-3">
                          <HumanInterventionBadge summary={humanIntervention} label="Needs you" compact align="left" />
                        </div>
                      )}
                      {sprint.goal ? (
                        <p className={`mt-2 max-w-xl text-sm leading-relaxed ${isCompleted ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400"}`}>
                          {sprint.goal}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col items-start gap-2">
                        <span className={`inline-flex rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] ${STATUS_BADGE_TONES[sprint.status]}`}>
                          {STATUS_LABELS[sprint.status]}
                        </span>
                        {humanIntervention && (
                          <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-status-amber">
                            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.2} />
                            Intervention
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-lg font-bold text-slate-700 dark:text-white">{sprint.tasksCount}</div>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">planned tasks</div>
                    </td>
                    <td className="px-4 py-3 min-w-[11rem] align-top">
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]">
                          <div
                            className="h-full rounded-full bg-signal-500 transition-[width]"
                            style={{ width: `${sprint.completion}%` }}
                          />
                        </div>
                        <span className="font-mono text-sm font-bold text-slate-700 dark:text-white">{sprint.completion}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-slate-700 dark:text-slate-200">{formatTableDate(sprint.createdAt)}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-400">created</div>
                    </td>
                    <td className="px-4 py-3 pr-6 align-top">
                      <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSprintToggle(sprint.id)}
                          disabled={pendingActionIds.has(pendingActionId)}
                          className={`inline-flex h-10 min-w-[5.5rem] items-center justify-center gap-2 rounded-full border px-4 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
                            activeRun
                              ? "border-status-red/20 bg-status-red/[0.1] text-status-red hover:bg-status-red/[0.14]"
                              : "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 hover:bg-signal-500/[0.12] dark:text-signal-300"
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {activeRun ? <Square className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
                          {activeRun ? "Stop" : "Start"}
                        </button>
                        <a
                          href={`/tasks?sprint=${encodeURIComponent(sprint.id)}`}
                          className="inline-flex h-10 min-w-[4.8rem] items-center justify-center gap-2 rounded-full border border-black/[0.06] bg-white/80 px-4 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white"
                        >
                          Open
                          <Maximize2 className="h-3.5 w-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={(event) => onOpenRowMenu(event, sprint.id)}
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white/80 text-slate-600 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
            </tbody>
          </table>
        </div>
    </div>
  );
};
