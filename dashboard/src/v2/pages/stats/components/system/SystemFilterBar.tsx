import type { FunctionComponent } from "preact";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-preact";
import { CHIP_CLASS, INPUT_CLASS, SUBPANEL_CLASS } from "../StatsShared.js";
import type { SystemFilters } from "../../hooks/use-system-view-data.js";

export interface SystemFilterBarProps {
  page?: number;
  onPageChange?: (p: number) => void;
  hasMore?: boolean;
  filters: SystemFilters;
  onFiltersChange: (f: SystemFilters) => void;
  search: string;
  onSearchChange: (s: string) => void;
  availablePurposes: string[];
  availableProviders: string[];
  totalCount: number;
  filteredCount: number;
}

const STATUS_OPTIONS = [
  { value: "running", label: "Running", activeClass: "border-signal-500/30 bg-signal-500/10 text-signal-700 dark:text-signal-300" },
  { value: "completed", label: "Completed", activeClass: "border-emerald-500/28 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300" },
  { value: "failed", label: "Failed", activeClass: "border-rose-500/24 bg-rose-500/[0.08] text-rose-700 dark:text-rose-300" },
  { value: "cancelled", label: "Cancelled", activeClass: "border-slate-500/40 bg-slate-500/15 text-slate-300" },
  { value: "paused", label: "Paused", activeClass: "border-amber-500/26 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300" },
] as const;

function formatChipLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function buildChipClass(active: boolean, activeClass: string): string {
  return [
    CHIP_CLASS,
    "inline-flex min-h-9 max-w-full items-center gap-2 whitespace-normal px-3 py-1.5 text-left text-[10px] font-bold uppercase leading-tight tracking-[0.14em] transition-all motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900",
    active ? activeClass : "text-slate-500 hover:bg-black/[0.05] hover:border-black/[0.1] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-white",
  ].join(" ");
}

const FilterGroup: FunctionComponent<{
  label: string;
  children: import("preact").ComponentChildren;
  icon?: boolean;
}> = ({ label, children, icon }) => (
  <div
    className="min-w-0 rounded-2xl border border-black/[0.04] bg-white/42 p-2.5 dark:border-white/[0.04] dark:bg-white/[0.025]"
    role="group"
    aria-label={`${label} filters`}
  >
    <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
      {icon ? <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2.2} /> : null}
      {label}
    </div>
    <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
  </div>
);

export const SystemFilterBar: FunctionComponent<SystemFilterBarProps> = ({
  filters,
  onFiltersChange,
  search,
  onSearchChange,
  availablePurposes,
  availableProviders,
  totalCount,
  filteredCount,
  page,
  onPageChange,
  hasMore,
}) => {
  const hasActiveFilters = filters.status.length > 0 || filters.purpose.length > 0 || filters.provider.length > 0 || (filters.errorCategories && filters.errorCategories.length > 0) || search !== "";
  const shownCount = filteredCount.toLocaleString();
  const totalShown = totalCount.toLocaleString();

  return (
    <div className={`${SUBPANEL_CLASS} sticky top-3 z-20 flex min-w-0 max-w-full flex-col gap-4 p-4 md:p-5`}>
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(16rem,1fr)_minmax(18rem,auto)] xl:items-start">
        <div className="relative min-w-0">
          <label htmlFor="system-filter-search" className="sr-only">Search system stats</label>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" strokeWidth={2} />
          <input
            id="system-filter-search"
            type="search"
            value={search}
            onInput={(event) => onSearchChange((event.currentTarget as HTMLInputElement).value)}
            placeholder="Search system stats"
            className={`${INPUT_CLASS} w-full pl-10 pr-10`}
          />
          {search !== "" ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:hover:bg-white/[0.06] dark:hover:text-slate-200 dark:focus-visible:ring-offset-void-900"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <FilterGroup label="Status" icon>
          {STATUS_OPTIONS.map((status) => {
            const active = filters.status.includes(status.value);
            return (
              <button
                key={status.value}
                type="button"
                aria-pressed={active}
                onClick={() => onFiltersChange({ ...filters, status: toggleValue(filters.status, status.value) })}
                className={buildChipClass(active, status.activeClass)}
              >
                {status.label}
              </button>
            );
          })}
        </FilterGroup>
      </div>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {availablePurposes.length > 0 ? (
          <FilterGroup label="Purposes">
            {availablePurposes.map((purpose) => {
              const active = filters.purpose.includes(purpose);
              return (
                <button
                  key={purpose}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onFiltersChange({ ...filters, purpose: toggleValue(filters.purpose, purpose) })}
                  className={buildChipClass(active, "border-signal-500/40 bg-signal-500/15 text-signal-400")}
                >
                  {formatChipLabel(purpose)}
                </button>
              );
            })}
          </FilterGroup>
        ) : null}

        {availableProviders.length > 0 ? (
          <FilterGroup label="Providers">
            {availableProviders.map((provider) => {
              const active = filters.provider.includes(provider);
              return (
                <button
                  key={provider}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onFiltersChange({ ...filters, provider: toggleValue(filters.provider, provider) })}
                  className={buildChipClass(active, "border-indigo-500/40 bg-indigo-500/15 text-indigo-300")}
                >
                  {formatChipLabel(provider)}
                </button>
              );
            })}
          </FilterGroup>
        ) : null}

        <FilterGroup label="Error Category">
          {["timeout", "rateLimit", "apiError", "modelError", "cancelled"].map((errorCat) => {
            const active = filters.errorCategories?.includes(errorCat) ?? false;
            return (
              <button
                key={errorCat}
                type="button"
                aria-pressed={active}
                onClick={() => onFiltersChange({ ...filters, errorCategories: toggleValue(filters.errorCategories || [], errorCat) })}
                className={buildChipClass(active, "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300")}
              >
                {formatChipLabel(errorCat)}
              </button>
            );
          })}
        </FilterGroup>
      </div>

      <div className="flex flex-col gap-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.06] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={() => {
                onFiltersChange({ status: [], purpose: [], provider: [], errorCategories: [] });
                onSearchChange("");
              }}
              className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:hover:text-slate-200 dark:focus-visible:ring-offset-void-900"
            >
              Clear all
            </button>
          ) : null}
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            Showing {shownCount} of {totalShown}
          </div>
          {page !== undefined ? (
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
              Page {page + 1}{hasMore ? " · more available" : ""}
            </div>
          ) : null}
        </div>

        {page !== undefined && onPageChange ? (
          <div className="flex flex-wrap items-center gap-2 lg:justify-end" aria-label="Invocation pagination">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => onPageChange(page - 1)}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/72 px-3 py-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-400 dark:hover:text-slate-300 dark:focus-visible:ring-offset-void-900"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <button
              type="button"
              disabled={!hasMore}
              onClick={() => onPageChange(page + 1)}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/72 px-3 py-1.5 text-xs font-bold text-slate-500 transition-colors hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-400 dark:hover:text-slate-300 dark:focus-visible:ring-offset-void-900"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
