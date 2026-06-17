import type { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { ArrowDownRight, ArrowUpRight, Brain, Database, Activity, Clock3, Hash, Zap, Search } from "lucide-preact";
import { useProgressiveList } from "../../../../hooks/use-progressive-list.js";
import type { ExecutionStatsEntitySummary } from "../../../types.js";
import { formatTokens, formatDuration, formatDateTime, formatPercent } from "../stats-utils.js";
import {
  CHIP_CLASS,
  INPUT_CLASS,
  LEDGER_ROW_MODERN_CLASS,
  PANEL_CLASS,
  SUBPANEL_CLASS,
  SortButton,
  TokenChip,
  TokenFlowBar,
  getProviderIcon,
  getLedgerSortValue,
  type LedgerSortKey
} from "./StatsShared.js";

function getStatusChipTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("complete") || normalized.includes("done") || normalized.includes("merged")) {
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }
  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("blocked")) {
    return "bg-rose-500/10 text-rose-600 dark:text-rose-400";
  }
  if (normalized.includes("running") || normalized.includes("progress") || normalized.includes("active")) {
    return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  }
  if (normalized.includes("cancel") || normalized.includes("paused")) {
    return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  }
  return "bg-slate-500/10 text-slate-500 dark:text-slate-300";
}

const LedgerSummaryTile: FunctionComponent<{
  icon: typeof Zap;
  label: string;
  value: string;
  detail: string;
}> = ({ icon: Icon, label, value, detail }) => (
  <div className={`${SUBPANEL_CLASS} p-4`}>
    <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
      <Icon className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
      {label}
    </div>
    <div className="mt-2 text-xl font-black tracking-tight text-slate-900 dark:text-white">{value}</div>
    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{detail}</div>
  </div>
);

export const TelemetryLedger: FunctionComponent<{
  title: string;
  eyebrow: string;
  items: ExecutionStatsEntitySummary[];
  kindLabel: string;
  emptyLabel: string;
  defaultSortKey?: LedgerSortKey;
}> = ({
  title,
  eyebrow,
  items,
  kindLabel,
  emptyLabel,
  defaultSortKey = "tokens",
}) => {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<LedgerSortKey>(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const base = normalizedQuery.length === 0
      ? items
      : items.filter((item) => {
        const haystack = [
          item.label,
          item.secondaryLabel || "",
          item.status || "",
          item.provider || "",
          item.purpose || "",
        ].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      });

    const directionFactor = sortDir === "desc" ? 1 : -1;
    return [...base].sort((left, right) => {
      const leftValue = getLedgerSortValue(left, sortKey);
      const rightValue = getLedgerSortValue(right, sortKey);

      if (typeof leftValue === "string" && typeof rightValue === "string") {
        // First click on a text sort reads A→Z; toggling flips it.
        return leftValue.localeCompare(rightValue) * (sortDir === "desc" ? 1 : -1);
      }

      return (Number(rightValue) - Number(leftValue)) * directionFactor;
    });
  }, [items, query, sortKey, sortDir]);

  const globalTotals = useMemo(() => {
    let totalTokens = 0;
    let totalActiveMs = 0;
    for (const item of items) {
      totalTokens += item.usage.totalTokens;
      totalActiveMs += item.usage.activeTimeMs;
    }
    return { totalTokens, totalActiveMs };
  }, [items]);

  const totals = useMemo(() => {
    let tokens = 0;
    let activeTimeMs = 0;
    let calls = 0;
    let leaderTokens = 0;
    for (const item of filteredItems) {
      tokens += item.usage.totalTokens;
      activeTimeMs += item.usage.activeTimeMs;
      calls += item.usage.invocationCount;
      leaderTokens = Math.max(leaderTokens, item.usage.totalTokens);
    }
    return { tokens, activeTimeMs, calls, leaderTokens };
  }, [filteredItems]);

  const topItem = useMemo(() => {
    return filteredItems.reduce<ExecutionStatsEntitySummary | null>(
      (best, item) => (best === null || item.usage.totalTokens > best.usage.totalTokens ? item : best),
      null,
    );
  }, [filteredItems]);

  const handleSort = (key: LedgerSortKey) => {
    if (sortKey === key) {
      setSortDir((current) => (current === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const {
    visibleItems,
    sentinelRef,
    scrollContainerRef,
  } = useProgressiveList(filteredItems, { initialCount: 12, stepCount: 8 });

  return (
    <div className={`${PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{eyebrow}</div>
            <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Search, sort, and compare {kindLabel} by recency, tokens, active time, and directional token flow.
            </div>
          </div>
          <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
            {filteredItems.length} {kindLabel}
          </div>
        </div>

        {items.length > 0 ? (
          <div className={`${SUBPANEL_CLASS} p-2`}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <LedgerSummaryTile
                icon={Hash}
                label="Total"
                value={items.length.toLocaleString()}
                detail={kindLabel}
              />
              <LedgerSummaryTile
                icon={Zap}
                label="Avg Tokens"
                value={formatTokens(globalTotals.totalTokens / Math.max(1, items.length))}
                detail={`per ${kindLabel.replace(/s$/, "")}`}
              />
              <LedgerSummaryTile
                icon={Clock3}
                label="Avg Active"
                value={formatDuration(globalTotals.totalActiveMs / Math.max(1, items.length))}
                detail={`per ${kindLabel.replace(/s$/, "")}`}
              />
              <LedgerSummaryTile
                icon={Activity}
                label="Most Recent"
                value={items[0]?.lastActivityAt ? formatDateTime(items[0].lastActivityAt) : "—"}
                detail="last activity"
              />
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" strokeWidth={2} />
            <input
              type="text"
              value={query}
              onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
              placeholder={`Search ${kindLabel}`}
              className={`${INPUT_CLASS} w-full pl-10`}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              ["last", "Latest"],
              ["tokens", "Tokens"],
              ["active", "Active"],
              ["input", "Input"],
              ["output", "Output"],
              ["name", "Name"],
              ["p50", "p50"],
              ["p95", "p95"],
            ] as const).map(([value, label]) => (
              <SortButton
                key={value}
                label={label}
                active={sortKey === value}
                direction={sortKey === value ? sortDir : null}
                onClick={() => handleSort(value as LedgerSortKey)}
              />
            ))}
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-12 text-center text-sm text-slate-400 dark:border-white/[0.08]">
            {emptyLabel}
          </div>
        ) : (
          <div ref={scrollContainerRef} className="max-h-[42rem] overflow-y-auto pr-2 dashboard-scrollbar">
            <div className="space-y-3">
              {visibleItems.map((item, index) => {
                const shareOfTotal = totals.tokens > 0 ? (item.usage.totalTokens / totals.tokens) * 100 : 0;
                const shareOfLeader = totals.leaderTokens > 0 ? (item.usage.totalTokens / totals.leaderTokens) * 100 : 0;

                return (
                  <div key={item.id} className={`${LEDGER_ROW_MODERN_CLASS} !p-5`}>
                    <div className="flex flex-col gap-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-white/75 text-xs font-black text-slate-900 shadow-[0_6px_16px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/55 dark:text-white">
                            {index + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-base font-black tracking-tight text-slate-900 dark:text-white">{item.label}</div>
                            {kindLabel === "sprints" ? (
                              <div className="text-[10px] text-slate-400">
                                {formatTokens(item.usage.totalTokens / Math.max(1, item.usage.invocationCount))}/call
                              </div>
                            ) : null}
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              {item.provider ? (() => {
                                const pIcon = getProviderIcon(item.provider as string);
                                const ProviderIcon = pIcon.icon;
                                return (
                                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${pIcon.bg} ${pIcon.text} ${CHIP_CLASS}`}>
                                    <ProviderIcon className="h-3 w-3" strokeWidth={2.5} />
                                    {item.provider}
                                  </span>
                                );
                              })() : null}
                              {item.purpose ? (
                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600 bg-emerald-500/10 dark:text-emerald-400 ${CHIP_CLASS}`}>
                                  <Activity className="h-3 w-3" strokeWidth={2.5} />
                                  {item.purpose.replace(/_/g, " ")}
                                </span>
                              ) : null}
                              {item.secondaryLabel ? (
                                <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                                  {item.secondaryLabel}
                                </span>
                              ) : null}
                              {item.status ? (
                                <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${getStatusChipTone(item.status)} ${CHIP_CLASS}`}>
                                  {item.status.replace(/_/g, " ")}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="hidden shrink-0 grid-cols-3 gap-6 text-right lg:grid">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Tokens</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{formatTokens(item.usage.totalTokens)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Active</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{formatDuration(item.usage.activeTimeMs)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Calls</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{item.usage.invocationCount.toLocaleString()}</div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 lg:hidden">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Tokens</div>
                          <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{formatTokens(item.usage.totalTokens)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Active</div>
                          <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{formatDuration(item.usage.activeTimeMs)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Calls</div>
                          <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{item.usage.invocationCount.toLocaleString()}</div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2.5">
                        <TokenFlowBar
                          input={item.usage.inputTokens}
                          cached={item.usage.cachedInputTokens}
                          output={item.usage.outputTokens}
                          reasoning={item.usage.reasoningOutputTokens}
                          total={item.usage.totalTokens}
                        />
                        <div className="h-1 rounded-full bg-black/[0.04] dark:bg-white/[0.05]">
                          <div
                            className="h-1 rounded-full bg-signal-500/60 transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.max(shareOfLeader > 0 ? 3 : 0, shareOfLeader))}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap gap-2">
                            <TokenChip icon={ArrowDownRight} label="In" value={item.usage.inputTokens} tone="border-signal-500/16 bg-signal-500/8 text-signal-600 dark:text-signal-400" />
                            <TokenChip icon={Database} label="Cached" value={item.usage.cachedInputTokens} tone="border-cyan-500/16 bg-cyan-500/8 text-cyan-600 dark:text-cyan-400" />
                            <TokenChip icon={ArrowUpRight} label="Out" value={item.usage.outputTokens} tone="border-amber-500/16 bg-amber-500/8 text-amber-600 dark:text-amber-400" />
                            <TokenChip icon={Brain} label="Reason" value={item.usage.reasoningOutputTokens} tone="border-rose-500/16 bg-rose-500/8 text-rose-600 dark:text-rose-400" />
                          </div>
                          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                            <span>{formatPercent(shareOfTotal)} of volume</span>
                            <span className="hidden sm:inline">{formatDateTime(item.lastActivityAt)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {visibleItems.length < filteredItems.length ? (
                <div ref={sentinelRef} className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-4 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:border-white/[0.08]">
                  Loading more telemetry lanes...
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
