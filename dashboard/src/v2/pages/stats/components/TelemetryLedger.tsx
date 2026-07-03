import type { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  Clock3,
  Database,
  Hash,
  Search,
  X,
  Zap,
} from "lucide-preact";
import { useProgressiveList } from "../../../../hooks/use-progressive-list.js";
import type { ExecutionStatsEntitySummary } from "../../../types.js";
import { formatTokens, formatStatsDuration, formatDateTime, formatPercent } from "../stats-utils.js";
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
  type LedgerSortKey,
} from "./StatsShared.js";

export function getStatusChipTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("complete") || normalized.includes("done") || normalized.includes("merged")) {
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }
  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("blocked")) {
    return "bg-rose-500/10 text-rose-600 dark:text-rose-400";
  }
  if (normalized.includes("running") || normalized.includes("progress") || normalized.includes("active")) {
    return "bg-signal-500/[0.08] text-signal-700 dark:text-signal-300";
  }
  if (normalized.includes("cancel") || normalized.includes("paused")) {
    return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  }
  return "bg-slate-500/10 text-slate-500 dark:text-slate-300";
}

export const LedgerSummaryTile: FunctionComponent<{
  icon: typeof Zap;
  label: string;
  value: string;
  detail: string;
  tone?: string;
}> = ({ icon: Icon, label, value, detail, tone = "text-signal-500" }) => (
  <div className={`${SUBPANEL_CLASS} p-4`}>
    <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
      <Icon className={`h-3.5 w-3.5 ${tone}`} strokeWidth={2.2} />
      {label}
    </div>
    <div className="mt-2 text-xl font-black tracking-tight text-slate-900 dark:text-white">{value}</div>
    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{detail}</div>
  </div>
);

const LedgerComparisonCard: FunctionComponent<{
  kindLabel: string;
  filteredItems: ExecutionStatsEntitySummary[];
  totals: {
    filteredInputTokens: number;
    filteredCachedTokens: number;
    filteredOutputTokens: number;
    filteredReasoningTokens: number;
    filteredTokens: number;
    totalTokens: number;
  };
}> = ({ kindLabel, filteredItems, totals }) => {
  const topItem = filteredItems[0] ?? null;

  return (
    <div className={`${SUBPANEL_CLASS} p-4 lg:col-span-2`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Token Flow Comparison</div>
          <div className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
            Filtered {kindLabel} vs leading lane
          </div>
        </div>
        <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
          {filteredItems.length.toLocaleString()} visible
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            <span>Filtered mix</span>
            <span>{formatTokens(totals.filteredTokens)} total tokens</span>
          </div>
          <TokenFlowBar
            input={totals.filteredInputTokens}
            cached={totals.filteredCachedTokens}
            output={totals.filteredOutputTokens}
            reasoning={totals.filteredReasoningTokens}
            total={Math.max(1, totals.filteredTokens)}
          />
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Combined filtered throughput across the current view.
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            <span>Top lane</span>
            <span>{topItem ? topItem.label : "No lane yet"}</span>
          </div>
          {topItem ? (
            <>
              <TokenFlowBar
                input={topItem.usage.inputTokens}
                cached={topItem.usage.cachedInputTokens}
                output={topItem.usage.outputTokens}
                reasoning={topItem.usage.reasoningOutputTokens}
                total={topItem.usage.totalTokens}
              />
              <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                {formatTokens(topItem.usage.totalTokens)} tokens, {formatPercent(totals.totalTokens > 0 ? (topItem.usage.totalTokens / totals.totalTokens) * 100 : 0)} of all window tokens.
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-5 text-sm text-slate-400 dark:border-white/[0.08]">
              No top lane to compare yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

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
        return leftValue.localeCompare(rightValue) * (sortDir === "desc" ? 1 : -1);
      }

      return (Number(rightValue) - Number(leftValue)) * directionFactor;
    });
  }, [items, query, sortKey, sortDir]);

  const totals = useMemo(() => {
    let totalTokens = 0;
    let totalActiveMs = 0;
    let calls = 0;
    let leaderTokens = 0;
    let inputTokens = 0;
    let cachedTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;

    for (const item of filteredItems) {
      totalTokens += item.usage.totalTokens;
      totalActiveMs += item.usage.activeTimeMs;
      calls += item.usage.invocationCount;
      leaderTokens = Math.max(leaderTokens, item.usage.totalTokens);
      inputTokens += item.usage.inputTokens;
      cachedTokens += item.usage.cachedInputTokens;
      outputTokens += item.usage.outputTokens;
      reasoningTokens += item.usage.reasoningOutputTokens;
    }

    return { totalTokens, totalActiveMs, calls, leaderTokens, inputTokens, cachedTokens, outputTokens, reasoningTokens };
  }, [filteredItems]);

  const overallTotals = useMemo(() => {
    let totalTokens = 0;
    let totalActiveTimeMs = 0;
    let invocationCount = 0;
    let newestActivityMs = 0;
    let newestActivityAt: string | null = null;

    for (const item of items) {
      totalTokens += item.usage.totalTokens;
      totalActiveTimeMs += item.usage.activeTimeMs;
      invocationCount += item.usage.invocationCount;
      const activityMs = item.lastActivityAt ? new Date(item.lastActivityAt).getTime() : 0;
      if (!Number.isNaN(activityMs) && activityMs > newestActivityMs) {
        newestActivityMs = activityMs;
        newestActivityAt = item.lastActivityAt;
      }
    }

    return { totalTokens, totalActiveTimeMs, invocationCount, newestActivityAt };
  }, [items]);

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

  const searchHasResults = filteredItems.length > 0;
  const queryIsActive = query.trim().length > 0;
  const averageTokens = items.length > 0 ? overallTotals.totalTokens / items.length : 0;
  const averageActiveTime = items.length > 0 ? overallTotals.totalActiveTimeMs / items.length : 0;
  const averageCalls = items.length > 0 ? overallTotals.invocationCount / items.length : 0;
  const filteredShare = overallTotals.totalTokens > 0 ? (totals.totalTokens / overallTotals.totalTokens) * 100 : 0;
  const singularKind = kindLabel.replace(/s$/, "");

  return (
    <div className={`${PANEL_CLASS} p-6 md:p-7`}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{eyebrow}</div>
            <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</div>
            <div className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
              Search, sort, and compare {kindLabel} by recency, tokens, active time, and directional token flow.
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/72 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-300">
            <Hash className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
            {filteredItems.length.toLocaleString()} visible / {items.length.toLocaleString()} total
          </div>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <LedgerSummaryTile
              icon={Hash}
              label="Entities"
              value={items.length.toLocaleString()}
              detail={kindLabel}
            />
            <LedgerSummaryTile
              icon={Database}
              label="Total Tokens"
              value={formatTokens(overallTotals.totalTokens)}
              detail={`${overallTotals.invocationCount.toLocaleString()} calls`}
              tone="text-cyan-500"
            />
            <LedgerSummaryTile
              icon={Zap}
              label="Avg Tokens"
              value={formatTokens(averageTokens)}
              detail={`per ${singularKind}`}
            />
            <LedgerSummaryTile
              icon={Clock3}
              label="Avg Active"
              value={formatStatsDuration(averageActiveTime)}
              detail={`${averageCalls.toFixed(1)} calls/${singularKind}`}
            />
            <LedgerSummaryTile
              icon={Activity}
              label="Most Recent"
              value={overallTotals.newestActivityAt ? formatDateTime(overallTotals.newestActivityAt) : "—"}
              detail="last activity"
            />
            <LedgerSummaryTile
              icon={Brain}
              label="Top Contributor"
              value={topItem ? topItem.label : "—"}
              detail={topItem ? `${formatTokens(topItem.usage.totalTokens)} tokens` : "no leader"}
              tone="text-indigo-500"
            />
          </div>
        ) : (
          <div className={`${SUBPANEL_CLASS} px-4 py-8 text-center text-sm text-slate-400`}>
            No {kindLabel} telemetry is available in this window yet.
          </div>
        )}

        <div className={`${SUBPANEL_CLASS} sticky top-3 z-20 grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center`}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" strokeWidth={2} />
            <input
              type="text"
              value={query}
              onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
              placeholder={`Search ${kindLabel}`}
              className={`${INPUT_CLASS} w-full pl-10 pr-10`}
            />
            {queryIsActive ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-black/[0.05] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:hover:bg-white/[0.06] dark:hover:text-slate-200 dark:focus-visible:ring-offset-void-900"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1 pr-1 scrollbar-hide lg:flex-wrap lg:justify-end">
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

        {items.length > 0 ? (
          searchHasResults ? (
            <div className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]">
              <LedgerComparisonCard
                kindLabel={kindLabel}
                filteredItems={filteredItems}
                totals={{
                  filteredInputTokens: totals.inputTokens,
                  filteredCachedTokens: totals.cachedTokens,
                  filteredOutputTokens: totals.outputTokens,
                  filteredReasoningTokens: totals.reasoningTokens,
                  filteredTokens: totals.totalTokens,
                  totalTokens: overallTotals.totalTokens,
                }}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <LedgerSummaryTile
                  icon={Activity}
                  label="Search Results"
                  value={filteredItems.length.toLocaleString()}
                  detail={queryIsActive ? `matching "${query.trim()}"` : "all visible"}
                  tone="text-amber-500"
                />
                <LedgerSummaryTile
                  icon={Brain}
                  label="Top Lane"
                  value={topItem ? topItem.label : "—"}
                  detail={topItem ? `${formatTokens(topItem.usage.totalTokens)} tokens` : "no lane yet"}
                  tone="text-indigo-500"
                />
                <LedgerSummaryTile
                  icon={Database}
                  label="Visible Share"
                  value={totals.totalTokens > 0 ? formatPercent(filteredShare) : "—"}
                  detail="of current window tokens"
                  tone="text-cyan-500"
                />
              </div>
            </div>
          ) : null
        ) : null}

        {searchHasResults ? (
          <div ref={scrollContainerRef} className="max-h-[42rem] overflow-y-auto pr-2 dashboard-scrollbar">
            <div className="space-y-3">
              {visibleItems.map((item, index) => {
                const shareOfTotal = totals.totalTokens > 0 ? (item.usage.totalTokens / totals.totalTokens) * 100 : 0;
                const shareOfLeader = totals.leaderTokens > 0 ? (item.usage.totalTokens / totals.leaderTokens) * 100 : 0;
                const tokenPerCall = item.usage.invocationCount > 0 ? item.usage.totalTokens / item.usage.invocationCount : 0;
                const providerLabel = item.provider ? String(item.provider) : "No provider";
                const purposeLabel = item.purpose ? item.purpose.replace(/_/g, " ") : "No purpose";
                const statusLabel = item.status ? item.status.replace(/_/g, " ") : "No status";

                return (
                  <div key={item.id} className={`${LEDGER_ROW_MODERN_CLASS} !p-4`} aria-label={`${item.label} ${kindLabel} telemetry row`}>
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] text-xs font-black text-slate-900 shadow-sm backdrop-blur-xl dark:text-white">
                            {index + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-base font-black tracking-tight text-slate-900 dark:text-white">{item.label}</div>
                            <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                              {formatTokens(tokenPerCall)}/call · last {formatDateTime(item.lastActivityAt)}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 min-w-0">
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
                        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4 xl:w-auto xl:min-w-[34rem] xl:grid-cols-4 xl:text-right">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Tokens</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{formatTokens(item.usage.totalTokens)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Active</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{formatStatsDuration(item.usage.activeTimeMs)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Calls</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{item.usage.invocationCount.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Share</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{formatPercent(shareOfTotal)}</div>
                          </div>
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
                            className="h-1 rounded-full bg-emerald-500/60 transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.max(shareOfLeader > 0 ? 3 : 0, shareOfLeader))}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap gap-2">
                            <TokenChip icon={ArrowDownRight} label="Input" value={item.usage.inputTokens} tone="border-signal-500/16 bg-signal-500/8 text-signal-600 dark:text-signal-400" />
                            <TokenChip icon={Database} label="Cached" value={item.usage.cachedInputTokens} tone="border-cyan-500/16 bg-cyan-500/8 text-cyan-600 dark:text-cyan-400" />
                            <TokenChip icon={ArrowUpRight} label="Output" value={item.usage.outputTokens} tone="border-amber-500/16 bg-amber-500/8 text-amber-600 dark:text-amber-400" />
                            <TokenChip icon={Brain} label="Reasoning" value={item.usage.reasoningOutputTokens} tone="border-rose-500/16 bg-rose-500/8 text-rose-600 dark:text-rose-400" />
                          </div>
                          <div className="max-w-full text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                            {providerLabel} · {purposeLabel} · {statusLabel}
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
        ) : items.length > 0 && queryIsActive ? (
          <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-12 text-center text-sm text-slate-400 dark:border-white/[0.08]">
            <div className="space-y-3">
              <div>No {kindLabel} match “{query.trim()}”.</div>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="inline-flex items-center rounded-full border border-black/[0.06] bg-white/72 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-300 dark:hover:text-white"
              >
                Clear search
              </button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-12 text-center text-sm text-slate-400 dark:border-white/[0.08]">
            {emptyLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
};
