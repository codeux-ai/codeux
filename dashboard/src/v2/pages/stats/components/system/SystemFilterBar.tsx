import type { FunctionComponent } from "preact";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-preact";
import { CHIP_CLASS, CONTROL_FOCUS_CLASS, INPUT_CLASS, STATUS_TONE_CLASS, SUBPANEL_CLASS } from "../StatsShared.js";
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
  { value: "running", label: "Running", activeClass: STATUS_TONE_CLASS.signal },
  { value: "completed", label: "Completed", activeClass: STATUS_TONE_CLASS.positive },
  { value: "failed", label: "Failed", activeClass: STATUS_TONE_CLASS.negative },
  { value: "cancelled", label: "Cancelled", activeClass: STATUS_TONE_CLASS.neutral },
  { value: "paused", label: "Paused", activeClass: STATUS_TONE_CLASS.warning },
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
    `inline-flex min-h-9 max-w-full items-center justify-center gap-2 whitespace-normal px-3 py-1.5 text-center text-[10px] font-bold uppercase leading-tight tracking-[0.14em] transition-all motion-safe:active:scale-[0.98] ${CONTROL_FOCUS_CLASS}`,
    active ? activeClass : "text-[color:var(--stats-detail-color)] hover:border-[color:var(--stats-border-strong)] hover:bg-[color:var(--stats-surface-chip-hover)] hover:text-[color:var(--stats-value-color)]",
  ].join(" ");
}

const FilterGroup: FunctionComponent<{
  label: string;
  children: import("preact").ComponentChildren;
  icon?: boolean;
}> = ({ label, children, icon }) => (
  <div
    className={`${SUBPANEL_CLASS} min-w-0 p-3`}
    role="group"
    aria-label={`${label} filters`}
  >
    <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
      <div className="inline-flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-detail-color)]">
        {icon ? <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} /> : null}
        <span className="truncate">{label}</span>
      </div>
    </div>
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">{children}</div>
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
  const activeFilterCount = filters.status.length + filters.purpose.length + filters.provider.length + (filters.errorCategories?.length ?? 0) + (search !== "" ? 1 : 0);

  return (
    <div className={`${SUBPANEL_CLASS} sticky top-3 z-20 flex min-w-0 max-w-full flex-col gap-4 p-4 md:p-5`}>
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(18rem,1.2fr)_minmax(0,1fr)] xl:items-start">
        <div className="relative min-w-0">
          <label htmlFor="system-filter-search" className="sr-only">Search system stats</label>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--stats-detail-color)]" strokeWidth={2} />
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
              className={`absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--stats-label-color)] transition-colors hover:bg-[color:var(--stats-surface-chip-hover)] hover:text-[color:var(--stats-value-color)] ${CONTROL_FOCUS_CLASS}`}
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

      <div className="grid min-w-0 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
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
                  className={buildChipClass(active, STATUS_TONE_CLASS.signal)}
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
                  className={buildChipClass(active, STATUS_TONE_CLASS.cyan)}
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
                className={buildChipClass(active, STATUS_TONE_CLASS.warning)}
              >
                {formatChipLabel(errorCat)}
              </button>
            );
          })}
        </FilterGroup>
      </div>

      <div className="grid gap-3 border-t border-[color:var(--stats-card-border)] pt-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={() => {
                onFiltersChange({ status: [], purpose: [], provider: [], errorCategories: [] });
                onSearchChange("");
              }}
              className={`rounded-full text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)] transition-colors hover:text-[color:var(--stats-value-color)] ${CONTROL_FOCUS_CLASS}`}
            >
              Clear all
            </button>
          ) : null}
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)]">
            Showing {shownCount} of {totalShown}
          </div>
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)]">
            {activeFilterCount.toLocaleString()} active filters
          </div>
          {page !== undefined ? (
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)]">
              Page {page + 1}{hasMore ? " · more available" : ""}
            </div>
          ) : null}
        </div>

        {page !== undefined && onPageChange ? (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:justify-end" role="group" aria-label="Invocation pagination">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => onPageChange(page - 1)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-[color:var(--stats-detail-color)] transition-colors hover:text-[color:var(--stats-value-color)] disabled:cursor-not-allowed disabled:opacity-50 ${CHIP_CLASS} ${CONTROL_FOCUS_CLASS}`}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <button
              type="button"
              disabled={!hasMore}
              onClick={() => onPageChange(page + 1)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-[color:var(--stats-detail-color)] transition-colors hover:text-[color:var(--stats-value-color)] disabled:cursor-not-allowed disabled:opacity-50 ${CHIP_CLASS} ${CONTROL_FOCUS_CLASS}`}
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
