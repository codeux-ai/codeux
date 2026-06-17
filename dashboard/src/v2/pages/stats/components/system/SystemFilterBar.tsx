import type { FunctionComponent } from "preact";
import { Search, SlidersHorizontal, X } from "lucide-preact";
import { CHIP_CLASS, INPUT_CLASS, SUBPANEL_CLASS } from "../StatsShared.js";
import type { SystemFilters } from "../../hooks/use-system-view-data.js";

export interface SystemFilterBarProps {
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
  { value: "running", label: "Running", activeClass: "border-blue-500/40 bg-blue-500/15 text-blue-300" },
  { value: "completed", label: "Completed", activeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" },
  { value: "failed", label: "Failed", activeClass: "border-red-500/40 bg-red-500/15 text-red-300" },
  { value: "cancelled", label: "Cancelled", activeClass: "border-slate-500/40 bg-slate-500/15 text-slate-300" },
  { value: "paused", label: "Paused", activeClass: "border-amber-500/40 bg-amber-500/15 text-amber-300" },
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
    "inline-flex items-center gap-2 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.16em] transition-all active:scale-[0.98]",
    active ? activeClass : "text-slate-500 hover:border-black/[0.1] hover:text-slate-900 dark:text-slate-400 dark:hover:text-white",
  ].join(" ");
}

export const SystemFilterBar: FunctionComponent<SystemFilterBarProps> = ({
  filters,
  onFiltersChange,
  search,
  onSearchChange,
  availablePurposes,
  availableProviders,
  totalCount,
  filteredCount,
}) => {
  const hasActiveFilters = filters.status.length > 0 || filters.purpose.length > 0 || filters.provider.length > 0 || (filters.errorCategories && filters.errorCategories.length > 0) || search !== "";

  return (
    <div className={`${SUBPANEL_CLASS} flex flex-wrap items-center gap-3 p-4`}>
      <div className="relative min-w-0 w-full lg:flex-1 lg:basis-[18rem]">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" strokeWidth={2} />
        <input
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
            className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-700 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className={`inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 ${CHIP_CLASS}`}>
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2.2} />
          Status
        </div>
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
      </div>

      {availablePurposes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className={`px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 ${CHIP_CLASS}`}>
            Purposes
          </div>
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
        </div>
      ) : null}

      {availableProviders.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className={`px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 ${CHIP_CLASS}`}>
            Providers
          </div>
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
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className={`inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 ${CHIP_CLASS}`}>
          Error Category
        </div>
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
      </div>

      <div className="flex w-full items-center justify-between gap-2 lg:ml-auto lg:w-auto lg:justify-end">
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => {
              onFiltersChange({ status: [], purpose: [], provider: [], errorCategories: [] });
              onSearchChange("");
            }}
            className="text-xs text-slate-400 hover:text-slate-700"
          >
            Clear all
          </button>
        ) : null}
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
          {filteredCount} of {totalCount}
        </div>
      </div>
    </div>
  );
};
