import type { FunctionComponent } from "preact";
import type { JSX } from "preact";
import { Activity, CheckCircle2, Heart, Layers3, Search, Sparkles, X } from "lucide-preact";
import { ListWindowSelector } from "../ui/ListWindowSelector.js";
import type { ListWindowOption } from "../../lib/list-window.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import type { LedgerFilters } from "../../lib/sprint-ledger-state.js";
import type { SprintStatus } from "../../types.js";
import { useDashboardI18n } from "../../i18n/index.js";
import { sprintsMessages } from "../../i18n/messages/sprints.js";

export interface SprintLedgerHeaderProps {
  sprintsCount: number;
  ledgerSprintsCount: number;
  pinnedCount: number;
  activeCount: number;
  completedCount: number;
  listWindow: ListWindowOption;
  onListWindowChange: (value: ListWindowOption) => void;
  filters: LedgerFilters;
  onFiltersChange: (filters: LedgerFilters) => void;
  transitionStyle?: JSX.CSSProperties;
}

export const SprintLedgerHeader: FunctionComponent<SprintLedgerHeaderProps> = ({
  sprintsCount,
  ledgerSprintsCount,
  pinnedCount,
  activeCount,
  completedCount,
  listWindow,
  onListWindowChange,
  filters,
  onFiltersChange,
  transitionStyle,
}) => {
  const { formatNumber, translate } = useDashboardI18n();
  const statusFilter = filters.status === "all" || filters.status.size !== 1
    ? "all"
    : [...filters.status][0];
  const hasFilters = Boolean(filters.query)
    || filters.qa !== "all"
    || filters.showcase !== "all"
    || filters.status !== "all";
  const setStatusFilter = (value: string) => {
    onFiltersChange({
      ...filters,
      status: value === "all" ? "all" : new Set([value as SprintStatus]),
    });
  };
  const clearFilters = () => {
    onFiltersChange({
      query: "",
      status: "all",
      showcase: "all",
      qa: "all",
    });
  };

  return (
    <div
      role="region"
      aria-label={translate(sprintsMessages, "sprintLedger")}
      className="relative overflow-visible border-b border-black/[0.06] px-4 py-5 dark:border-white/[0.06] sm:px-6 lg:px-7"
    >
      <div className="relative grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-ember-500/20 bg-ember-500/10 px-3 py-1 text-[11px] font-bold text-ember-600 dark:text-ember-400">
            <Heart className="h-3.5 w-3.5" strokeWidth={2.3} />
            {translate(sprintsMessages, "sprintLedger")}
          </div>
          <h2 className="mt-3 font-display text-xl font-semibold text-slate-900 dark:text-white sm:text-2xl">
            {translate(sprintsMessages, "ledgerHeading")}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
            {translate(sprintsMessages, "ledgerDescription")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[34rem]">
          {[
            { label: translate(sprintsMessages, "visible"), value: ledgerSprintsCount, icon: Layers3, tone: "text-signal-600 dark:text-signal-300" },
            { label: translate(sprintsMessages, "pinned"), value: pinnedCount, icon: Sparkles, tone: "text-status-red" },
            { label: translate(sprintsMessages, "active"), value: activeCount, icon: Activity, tone: "text-status-green" },
            { label: translate(sprintsMessages, "done"), value: completedCount, icon: CheckCircle2, tone: "text-slate-600 dark:text-slate-300" },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-2xl border border-black/[0.06] bg-white/70 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-white/[0.04]">
                <div className={`flex items-center gap-2 text-xs font-semibold ${item.tone}`}>
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                  {item.label}
                </div>
                <div className="mt-1 font-mono text-lg font-semibold text-slate-900 dark:text-white">{formatNumber(item.value)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative mt-5 grid gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1 lg:max-w-xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={2.2} />
            <input
              type="text"
              value={filters.query}
              onInput={(e) => onFiltersChange({ ...filters, query: (e.target as HTMLInputElement).value })}
              placeholder={translate(sprintsMessages, "searchSprintsEllipsis")}
              className="h-12 w-full rounded-2xl border border-black/[0.08] bg-white/85 pl-11 pr-11 text-sm text-slate-800 shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-signal-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-white dark:placeholder:text-slate-500"
              style={transitionStyle}
            />
            {filters.query && (
              <button
                type="button"
                onClick={() => onFiltersChange({ ...filters, query: "" })}
                className="absolute right-3.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-black/[0.04] hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
                style={transitionStyle}
                title={translate(sprintsMessages, "clearSearch")} aria-label={translate(sprintsMessages, "clearSearch")}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ListWindowSelector
              value={listWindow}
              onChange={onListWindowChange}
              label={translate(sprintsMessages, "show")}
            />
            <span className="rounded-full border border-black/[0.06] bg-white/70 px-3 py-1.5 font-mono text-xs text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400" aria-label={translate(sprintsMessages, "showingSprints", { visible: formatNumber(ledgerSprintsCount), total: formatNumber(sprintsCount) })}>
              {formatNumber(ledgerSprintsCount)} / {formatNumber(sprintsCount)}
            </span>
            {hasFilters ? (
              <button
                type="button"
              onClick={clearFilters}
              title={translate(sprintsMessages, "clearAllFilters")}
              aria-label={translate(sprintsMessages, "clearAllFiltersAria")}
              className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1.5 text-xs font-bold text-signal-700 transition-colors hover:bg-signal-500/15 focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:text-signal-300"
              style={transitionStyle}
            >
                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                {translate(sprintsMessages, "clearFilters")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <AvantgardeSelect
            options={[
              { value: "all", label: translate(sprintsMessages, "allStatus") },
              { value: "running", label: translate(sprintsMessages, "statusRunning") },
              { value: "idle", label: translate(sprintsMessages, "statusDraft") },
              { value: "paused", label: translate(sprintsMessages, "statusPaused") },
              { value: "completed", label: translate(sprintsMessages, "done") },
              { value: "failed", label: translate(sprintsMessages, "statusFailed") },
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
            aria-label={translate(sprintsMessages, "filterByStatus")}
          />
          <AvantgardeSelect
            options={[
              { value: "all", label: translate(sprintsMessages, "allQa") },
              { value: "missing", label: translate(sprintsMessages, "noQa") },
              { value: "running", label: translate(sprintsMessages, "reviewingLabel") },
              { value: "reviewed", label: translate(sprintsMessages, "reviewed") },
            ]}
            value={filters.qa}
            onChange={(val) => onFiltersChange({ ...filters, qa: val as LedgerFilters["qa"] })}
            aria-label={translate(sprintsMessages, "filterByQa")}
          />
          <AvantgardeSelect
            options={[
              { value: "all", label: translate(sprintsMessages, "allPins") },
              { value: "pinned", label: translate(sprintsMessages, "pinned") },
              { value: "unpinned", label: translate(sprintsMessages, "unpinned") },
            ]}
            value={filters.showcase}
            onChange={(val) => onFiltersChange({ ...filters, showcase: val as LedgerFilters["showcase"] })}
            aria-label={translate(sprintsMessages, "filterByPins")}
          />
        </div>
      </div>

      <div className="sr-only">
        {ledgerSprintsCount === 0 && hasFilters
          ? translate(sprintsMessages, "noMatchingAdjust")
          : hasFilters
            ? translate(sprintsMessages, "showingFilteredTotal", { visible: formatNumber(ledgerSprintsCount), total: formatNumber(sprintsCount) })
            : translate(sprintsMessages, "showingAll", { total: formatNumber(sprintsCount) })}
      </div>
    </div>
  );
};
