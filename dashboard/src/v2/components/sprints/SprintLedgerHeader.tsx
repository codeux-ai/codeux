import type { FunctionComponent } from "preact";
import { Heart, Search, X, FilterX } from "lucide-preact";
import { ListWindowSelector } from "../ui/ListWindowSelector.js";
import type { ListWindowOption } from "../../lib/list-window.js";
import type { SprintStatus } from "../../types.js";
import type { SprintShowcaseFilter, SprintQaFilter } from "../../lib/sprint-ledger-state.js";
import { STATUS_LABELS } from "../../lib/sprint-ledger-state.js";

export interface SprintLedgerHeaderProps {
  sprintsCount: number;
  ledgerSprintsCount: number;
  listWindow: ListWindowOption;
  onListWindowChange: (value: ListWindowOption) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  statusFilter: Set<SprintStatus> | "all";
  onStatusFilterChange: (value: Set<SprintStatus> | "all") => void;
  showcaseFilter: SprintShowcaseFilter;
  onShowcaseFilterChange: (value: SprintShowcaseFilter) => void;
  qaFilter: SprintQaFilter;
  onQaFilterChange: (value: SprintQaFilter) => void;
}

export const SprintLedgerHeader: FunctionComponent<SprintLedgerHeaderProps> = ({
  sprintsCount,
  ledgerSprintsCount,
  listWindow,
  onListWindowChange,
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  onStatusFilterChange,
  showcaseFilter,
  onShowcaseFilterChange,
  qaFilter,
  onQaFilterChange,
}) => {
  const hasActiveFilters = statusFilter !== "all" || showcaseFilter !== "all" || qaFilter !== "all";

  const handleClearFilters = () => {
    onStatusFilterChange("all");
    onShowcaseFilterChange("all");
    onQaFilterChange("all");
  };

  return (
    <div className="flex flex-col gap-4 border-b border-black/[0.06] px-6 py-5 dark:border-white/[0.06]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ember-500">
            <Heart className="h-3.5 w-3.5" strokeWidth={2.3} />
            Sprint Ledger
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-normal text-slate-800 dark:text-white">
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
            onInput={(e) => onSearchQueryChange((e.target as HTMLInputElement).value)}
            placeholder="Search sprints…"
            className="h-9 w-56 rounded-full border border-black/[0.08] bg-white/80 pl-9 pr-8 text-xs text-slate-700 placeholder:text-slate-400 focus:border-signal-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white dark:placeholder:text-slate-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQueryChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 rounded-full"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs font-mono">
          {searchQuery ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/25 bg-signal-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-300">
              {ledgerSprintsCount} results
            </span>
          ) : null}
          <span className="text-slate-400">
            {sprintsCount} total
          </span>
        </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-xs font-semibold text-slate-500 uppercase tracking-wider dark:text-slate-400">Status</label>
          <select
            id="status-filter"
            value={statusFilter === "all" ? "all" : Array.from(statusFilter)[0]}
            onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value;
              onStatusFilterChange(val === "all" ? "all" : new Set([val as SprintStatus]));
            }}
            className="h-8 rounded-md border border-black/[0.08] bg-white/80 px-2.5 text-xs text-slate-700 focus:border-signal-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white"
          >
            <option value="all">All</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 ml-4">
          <label htmlFor="showcase-filter" className="text-xs font-semibold text-slate-500 uppercase tracking-wider dark:text-slate-400">Showcase</label>
          <select
            id="showcase-filter"
            value={showcaseFilter}
            onChange={(e) => onShowcaseFilterChange((e.target as HTMLSelectElement).value as SprintShowcaseFilter)}
            className="h-8 rounded-md border border-black/[0.08] bg-white/80 px-2.5 text-xs text-slate-700 focus:border-signal-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white"
          >
            <option value="all">All</option>
            <option value="pinned">Pinned</option>
            <option value="unpinned">Unpinned</option>
          </select>
        </div>

        <div className="flex items-center gap-2 ml-4">
          <label htmlFor="qa-filter" className="text-xs font-semibold text-slate-500 uppercase tracking-wider dark:text-slate-400">QA</label>
          <select
            id="qa-filter"
            value={qaFilter}
            onChange={(e) => onQaFilterChange((e.target as HTMLSelectElement).value as SprintQaFilter)}
            className="h-8 rounded-md border border-black/[0.08] bg-white/80 px-2.5 text-xs text-slate-700 focus:border-signal-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white"
          >
            <option value="all">All</option>
            <option value="reviewed">Reviewed</option>
            <option value="missing">Missing</option>
            <option value="running">Running</option>
          </select>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-slate-200 transition-colors focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
          >
            <FilterX className="h-3.5 w-3.5" strokeWidth={2.2} />
            Clear Filters
          </button>
        )}
      </div>
    </div>
  );
};
