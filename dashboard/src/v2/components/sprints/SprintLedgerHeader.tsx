import type { FunctionComponent } from "preact";
import { Heart, Search, X } from "lucide-preact";
import { ListWindowSelector } from "../ui/ListWindowSelector.js";
import type { ListWindowOption } from "../../lib/list-window.js";

export interface SprintLedgerHeaderProps {
  sprintsCount: number;
  ledgerSprintsCount: number;
  listWindow: ListWindowOption;
  onListWindowChange: (value: ListWindowOption) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}

export const SprintLedgerHeader: FunctionComponent<SprintLedgerHeaderProps> = ({
  sprintsCount,
  ledgerSprintsCount,
  listWindow,
  onListWindowChange,
  searchQuery,
  onSearchQueryChange,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.06] px-6 py-5 dark:border-white/[0.06]">
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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-400" strokeWidth={2.2} />
          <input
            type="text"
            value={searchQuery}
            onInput={(e) => onSearchQueryChange((e.target as HTMLInputElement).value)}
            placeholder="Search sprints…"
            className="h-9 w-56 rounded-full border border-black/[0.08] bg-white/80 pl-9 pr-8 text-xs text-slate-700 placeholder:text-slate-500 focus:border-signal-500/40 focus:outline-none focus:ring-2 focus:ring-signal-500/10 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white dark:placeholder:text-slate-400"
            aria-label="Search sprints"
          />
          {/* Hidden live region to announce search results to screen readers */}
          <div className="sr-only" role="status" aria-live="polite">
            {searchQuery ? `Showing ${ledgerSprintsCount} sprints matching "${searchQuery}"` : ""}
          </div>
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQueryChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          )}
        </div>
        <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
          {searchQuery ? `${ledgerSprintsCount} / ${sprintsCount}` : `${sprintsCount} total`}
        </div>
      </div>
    </div>
  );
};
