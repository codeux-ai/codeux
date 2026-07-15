import type { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import {
  Activity,
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
import { formatTokens, formatStatsDuration, formatDateTime, formatPercent, formatCost } from "../stats-utils.js";
import {
  CHIP_CLASS,
  CONTROL_FOCUS_CLASS,
  DASHED_EMPTY_CLASS,
  INPUT_CLASS,
  LEDGER_ROW_MODERN_CLASS,
  STATUS_TONE_CLASS,
  SortButton,
  TEXT_DETAIL_CLASS,
  TRACK_CLASS,
  TokenFlowBar,
  getProviderIcon,
  getLedgerSortValue,
  type LedgerSortKey,
  type ExecutionStatsEntityWithDuration,
} from "./StatsShared.js";
import { useInteractionTokens } from "../../../lib/motion/index.js";
import { useStatsI18n } from "../stats-i18n.js";

export function getStatusChipTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("complete") || normalized.includes("done") || normalized.includes("merged")) {
    return STATUS_TONE_CLASS.positive;
  }
  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("blocked")) {
    return STATUS_TONE_CLASS.negative;
  }
  if (normalized.includes("running") || normalized.includes("progress") || normalized.includes("active")) {
    return STATUS_TONE_CLASS.signal;
  }
  if (normalized.includes("cancel") || normalized.includes("paused")) {
    return STATUS_TONE_CLASS.warning;
  }
  return STATUS_TONE_CLASS.neutral;
}

export const LedgerSummaryTile: FunctionComponent<{
  icon: typeof Zap;
  label: string;
  value: string;
  detail: string;
  tone?: string;
}> = ({ icon: Icon, label, value, detail, tone = "text-[color:var(--stats-signal-text)]" }) => (
  <div className="min-w-0 bg-[color:var(--stats-surface-subpanel)] px-4 py-3">
    <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">
      <Icon className={`h-3.5 w-3.5 ${tone}`} strokeWidth={2} />
      {label}
    </div>
    <div className="mt-1.5 break-words text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{value}</div>
    <div className="mt-1 break-words text-xs leading-snug text-[color:var(--stats-detail-color)]">{detail}</div>
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
  const { locale, formatNumber, text } = useStatsI18n();
  const topItem = filteredItems[0] ?? null;

  return (
    <div className="border-y border-[color:var(--stats-border-hairline)] px-1 py-4 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Token-Fluss-Vergleich" : "Token flow comparison"}</div>
          <div className="mt-1 text-sm font-semibold text-[color:var(--stats-value-color)]">
            {locale === "de" ? `Gefilterte ${kindLabel === "tasks" ? "Aufgaben" : "Sprints"} gegenüber dem führenden Bereich` : `Filtered ${kindLabel} vs leading lane`}
          </div>
        </div>
        <div className="text-xs font-medium text-[color:var(--stats-detail-color)]">
          {formatNumber(filteredItems.length)} {locale === "de" ? "sichtbar" : "visible"}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
            <span>{locale === "de" ? "Gefilterter Mix" : "Filtered mix"}</span>
            <span>{formatTokens(totals.filteredTokens, locale)} {locale === "de" ? "Tokens gesamt" : "total tokens"}</span>
          </div>
          <TokenFlowBar
            input={totals.filteredInputTokens}
            cached={totals.filteredCachedTokens}
            output={totals.filteredOutputTokens}
            reasoning={totals.filteredReasoningTokens}
            total={Math.max(1, totals.filteredTokens)}
          />
          <div className="mt-2 text-[11px] text-[color:var(--stats-detail-color)]">
            {locale === "de" ? "Kombinierter gefilterter Durchsatz der aktuellen Ansicht." : "Combined filtered throughput across the current view."}
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
            <span>{locale === "de" ? "Führender Bereich" : "Top lane"}</span>
            <span>{topItem ? topItem.label : locale === "de" ? "Noch kein Bereich" : "No lane yet"}</span>
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
              <div className="mt-2 text-[11px] text-[color:var(--stats-detail-color)]">
                {formatTokens(topItem.usage.totalTokens, locale)} {text("tokens")}, {formatPercent(totals.totalTokens > 0 ? (topItem.usage.totalTokens / totals.totalTokens) * 100 : 0, locale)} {locale === "de" ? "aller Tokens im Zeitraum." : "of all window tokens."}
              </div>
            </>
          ) : (
          <div className={`${DASHED_EMPTY_CLASS} py-5 text-left text-sm`}>
              {locale === "de" ? "Noch kein führender Bereich zum Vergleichen." : "No top lane to compare yet."}
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
  const { locale, formatNumber } = useStatsI18n();
  const interactionTokens = useInteractionTokens();
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
    let totalCostUsd = 0;

    for (const item of filteredItems) {
      totalTokens += item.usage.totalTokens;
      totalActiveMs += item.usage.activeTimeMs;
      calls += item.usage.invocationCount;
      leaderTokens = Math.max(leaderTokens, item.usage.totalTokens);
      inputTokens += item.usage.inputTokens;
      cachedTokens += item.usage.cachedInputTokens;
      outputTokens += item.usage.outputTokens;
      reasoningTokens += item.usage.reasoningOutputTokens;
      totalCostUsd += item.usage.totalCostUsd;
    }

    return { totalTokens, totalActiveMs, calls, leaderTokens, inputTokens, cachedTokens, outputTokens, reasoningTokens, totalCostUsd };
  }, [filteredItems]);

  const overallTotals = useMemo(() => {
    let totalTokens = 0;
    let totalActiveTimeMs = 0;
    let invocationCount = 0;
    let totalCostUsd = 0;
    let newestActivityMs = 0;
    let newestActivityAt: string | null = null;

    for (const item of items) {
      totalTokens += item.usage.totalTokens;
      totalActiveTimeMs += item.usage.activeTimeMs;
      invocationCount += item.usage.invocationCount;
      totalCostUsd += item.usage.totalCostUsd;
      const activityMs = item.lastActivityAt ? new Date(item.lastActivityAt).getTime() : 0;
      if (!Number.isNaN(activityMs) && activityMs > newestActivityMs) {
        newestActivityMs = activityMs;
        newestActivityAt = item.lastActivityAt;
      }
    }

    return { totalTokens, totalActiveTimeMs, invocationCount, totalCostUsd, newestActivityAt };
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
  const displayKind = locale === "de" ? (kindLabel === "tasks" ? "Aufgaben" : "Sprints") : kindLabel;
  const displaySingularKind = locale === "de" ? (kindLabel === "tasks" ? "Aufgabe" : "Sprint") : singularKind;
  const sortLabelByKey: Record<LedgerSortKey, string> = {
    last: locale === "de" ? "Neueste" : "Latest",
    tokens: "Tokens",
    active: locale === "de" ? "Aktiv" : "Active",
    input: locale === "de" ? "Eingabe" : "Input",
    output: locale === "de" ? "Ausgabe" : "Output",
    name: locale === "de" ? "Name" : "Name",
    p50: "p50",
    p95: "p95",
  };
  const ledgerStatus = queryIsActive
    ? (locale === "de" ? `${formatNumber(filteredItems.length)} von ${formatNumber(items.length)} ${displayKind} passend zu ${query.trim()}, sortiert nach ${sortLabelByKey[sortKey]} ${sortDir === "desc" ? "absteigend" : "aufsteigend"}.` : `Showing ${formatNumber(filteredItems.length)} of ${formatNumber(items.length)} ${kindLabel} matching ${query.trim()}, sorted by ${sortLabelByKey[sortKey]} ${sortDir === "desc" ? "descending" : "ascending"}.`)
    : (locale === "de" ? `${formatNumber(filteredItems.length)} von ${formatNumber(items.length)} ${displayKind}, sortiert nach ${sortLabelByKey[sortKey]} ${sortDir === "desc" ? "absteigend" : "aufsteigend"}.` : `Showing ${formatNumber(filteredItems.length)} of ${formatNumber(items.length)} ${kindLabel}, sorted by ${sortLabelByKey[sortKey]} ${sortDir === "desc" ? "descending" : "ascending"}.`);

  return (
    <div className="stats-surface-panel overflow-hidden rounded-[var(--stats-panel-radius)]">
      <div className="flex flex-col">
        <div className="flex flex-col gap-4 px-5 py-5 xl:flex-row xl:items-end xl:justify-between md:px-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{eyebrow}</div>
            <div className="mt-1.5 font-display text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">{title}</div>
            <div className="mt-1.5 max-w-3xl text-sm leading-relaxed text-[color:var(--stats-detail-color)]">
              {locale === "de" ? `${displayKind} nach Aktualität, Tokens, aktiver Zeit und gerichtetem Token-Fluss durchsuchen, sortieren und vergleichen.` : `Search, sort, and compare ${kindLabel} by recency, tokens, active time, and directional token flow.`}
            </div>
          </div>
          <div aria-live="polite" aria-atomic="true" className={`inline-flex items-center gap-2 text-xs font-medium ${TEXT_DETAIL_CLASS}`}>
            <Hash className="h-3.5 w-3.5 text-[color:var(--stats-signal-text)]" strokeWidth={2.2} />
            {formatNumber(filteredItems.length)} {locale === "de" ? "sichtbar" : "visible"} / {formatNumber(items.length)} {locale === "de" ? "gesamt" : "total"}
          </div>
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {ledgerStatus}
          </div>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-px border-y border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-border-hairline)] sm:grid-cols-2 xl:grid-cols-6">
            <LedgerSummaryTile
              icon={Hash}
              label={locale === "de" ? "Einträge" : "Entities"}
              value={formatNumber(items.length)}
              detail={displayKind}
            />
            <LedgerSummaryTile
              icon={Database}
              label={locale === "de" ? "Tokens gesamt" : "Total Tokens"}
              value={formatTokens(overallTotals.totalTokens, locale)}
              detail={`${formatNumber(overallTotals.invocationCount)} ${locale === "de" ? "Aufrufe" : "calls"} · ${formatCost(overallTotals.totalCostUsd, locale)}`}
              tone="text-[color:var(--stats-accent-cyan)]"
            />
            <LedgerSummaryTile
              icon={Zap}
              label={locale === "de" ? "Ø Tokens" : "Avg Tokens"}
              value={formatTokens(averageTokens, locale)}
              detail={`${locale === "de" ? "pro" : "per"} ${displaySingularKind}`}
            />
            <LedgerSummaryTile
              icon={Clock3}
              label={locale === "de" ? "Ø aktiv" : "Avg Active"}
              value={formatStatsDuration(averageActiveTime, locale)}
              detail={`${formatNumber(averageCalls, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${locale === "de" ? "Aufrufe" : "calls"}/${displaySingularKind}`}
            />
            <LedgerSummaryTile
              icon={Activity}
              label={locale === "de" ? "Neueste Aktivität" : "Most Recent"}
              value={overallTotals.newestActivityAt ? formatDateTime(overallTotals.newestActivityAt, locale) : "—"}
              detail={locale === "de" ? "letzte Aktivität" : "last activity"}
            />
            <LedgerSummaryTile
              icon={Brain}
              label={locale === "de" ? "Führender Beitrag" : "Top Contributor"}
              value={topItem ? topItem.label : "—"}
              detail={topItem ? `${formatTokens(topItem.usage.totalTokens, locale)} Tokens` : locale === "de" ? "keine Führung" : "no leader"}
              tone="text-[color:var(--stats-signal-text)]"
            />
          </div>
        ) : (
          <div className="border-y border-[color:var(--stats-border-hairline)] px-4 py-8 text-center text-sm text-[color:var(--stats-label-color)]">
            {locale === "de" ? `In diesem Zeitraum ist noch keine ${displayKind}-Telemetrie verfügbar.` : `No ${kindLabel} telemetry is available in this window yet.`}
          </div>
        )}

        <div className="sticky top-3 z-20 grid gap-3 border-b border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-panel)] px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center md:px-5">
          <div className="relative">
            <label htmlFor={`${kindLabel}-ledger-search`} className="sr-only">
              {locale === "de" ? `${displayKind} durchsuchen` : `Search ${kindLabel}`}
            </label>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--stats-detail-color)]" strokeWidth={2} />
            <input
              id={`${kindLabel}-ledger-search`}
              type="text"
              value={query}
              onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
              placeholder={locale === "de" ? `${displayKind} durchsuchen` : `Search ${kindLabel}`}
              className={`${INPUT_CLASS} w-full pl-10 pr-10`}
            />
            {queryIsActive ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={locale === "de" ? "Suche leeren" : "Clear search"}
                className={`absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--stats-label-color)] transition-colors hover:bg-[color:var(--stats-surface-chip-hover)] hover:text-[color:var(--stats-value-color)] ${CONTROL_FOCUS_CLASS}`}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="flex max-w-full flex-wrap gap-2 pr-1 lg:justify-end" role="group" aria-label={locale === "de" ? `Sortiersteuerung für ${title}` : `${title} sort controls`}>
            {([
              ["last", locale === "de" ? "Neueste" : "Latest"],
              ["tokens", "Tokens"],
              ["active", locale === "de" ? "Aktiv" : "Active"],
              ["input", locale === "de" ? "Eingabe" : "Input"],
              ["output", locale === "de" ? "Ausgabe" : "Output"],
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
            <div className="grid gap-4 px-5 py-4 xl:grid-cols-[1.1fr_0.9fr] md:px-6">
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
              <div className="grid gap-px overflow-hidden rounded-[var(--stats-control-radius)] border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-border-hairline)] sm:grid-cols-3 xl:col-span-2">
                <LedgerSummaryTile
                  icon={Activity}
                  label={locale === "de" ? "Suchergebnisse" : "Search Results"}
                  value={formatNumber(filteredItems.length)}
                  detail={queryIsActive ? (locale === "de" ? `passend zu „${query.trim()}“` : `matching "${query.trim()}"`) : locale === "de" ? "alle sichtbar" : "all visible"}
                  tone="text-[color:var(--stats-warning-text)]"
                />
                <LedgerSummaryTile
                  icon={Brain}
                  label={locale === "de" ? "Führender Bereich" : "Top Lane"}
                  value={topItem ? topItem.label : "—"}
                  detail={topItem ? `${formatTokens(topItem.usage.totalTokens, locale)} Tokens` : locale === "de" ? "noch kein Bereich" : "no lane yet"}
                  tone="text-[color:var(--stats-signal-text)]"
                />
                <LedgerSummaryTile
                  icon={Database}
                  label={locale === "de" ? "Sichtbarer Anteil" : "Visible Share"}
                  value={totals.totalTokens > 0 ? formatPercent(filteredShare, locale) : "—"}
                  detail={locale === "de" ? "der Tokens im aktuellen Zeitraum" : "of current window tokens"}
                  tone="text-[color:var(--stats-accent-cyan)]"
                />
              </div>
            </div>
          ) : null
        ) : null}

        {searchHasResults ? (
          <div ref={scrollContainerRef} className="max-h-[42rem] overflow-y-auto border-t border-[color:var(--stats-border-hairline)] dashboard-scrollbar">
            <div className="bg-[color:var(--stats-surface-panel)]">
              {visibleItems.map((item, index) => {
                const shareOfTotal = totals.totalTokens > 0 ? (item.usage.totalTokens / totals.totalTokens) * 100 : 0;
                const shareOfLeader = totals.leaderTokens > 0 ? (item.usage.totalTokens / totals.leaderTokens) * 100 : 0;
                const tokenPerCall = item.usage.invocationCount > 0 ? item.usage.totalTokens / item.usage.invocationCount : 0;
                const providerLabel = item.provider ? String(item.provider) : locale === "de" ? "Kein Anbieter" : "No provider";
                const purposeLabel = item.purpose ? item.purpose : locale === "de" ? "Kein Zweck" : "No purpose";
                const statusLabel = item.status ? item.status : locale === "de" ? "Kein Status" : "No status";
                const duration = (item as ExecutionStatsEntityWithDuration).duration ?? null;
                const hasPercentiles = duration?.p50Ms != null || duration?.p95Ms != null;
                const percentileSummary = hasPercentiles
                  ? `p50 ${formatStatsDuration(duration?.p50Ms ?? 0, locale)} · p95 ${formatStatsDuration(duration?.p95Ms ?? 0, locale)}`
                  : locale === "de" ? "Keine Perzentile" : "No percentiles";

                return (
                  <div key={item.id} role="article" className={`${LEDGER_ROW_MODERN_CLASS} stats-ledger-row-joined`} aria-label={locale === "de" ? `${item.label}, Telemetriezeile für ${displaySingularKind}` : `${item.label} ${kindLabel} telemetry row`}>
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-[var(--stats-control-radius)] border border-[color:var(--stats-card-border)] bg-[color:var(--stats-surface-subpanel)] text-[10px] font-semibold uppercase leading-none text-[color:var(--stats-value-color)]">
                            <span className="text-[8px] tracking-[0.12em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Rang" : "Rank"}</span>
                            <span className="mt-0.5 text-xs">{formatNumber(index + 1)}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="break-words text-sm font-semibold tracking-tight text-[color:var(--stats-value-color)] [overflow-wrap:anywhere]">{item.label}</div>
                            <div className="mt-0.5 text-xs text-[color:var(--stats-detail-color)]">
                              {formatTokens(tokenPerCall, locale)}/{locale === "de" ? "Aufruf" : "call"} · {locale === "de" ? "zuletzt" : "last"} {formatDateTime(item.lastActivityAt, locale)}
                            </div>
                            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--stats-detail-color)]">
                              {item.provider ? (() => {
                                const pIcon = getProviderIcon(item.provider as string);
                                const ProviderIcon = pIcon.icon;
                                return (
                                  <span className={`inline-flex max-w-full items-center gap-1.5 ${pIcon.text}`}>
                                    <ProviderIcon className="h-3 w-3" strokeWidth={2} />
                                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.provider}</span>
                                  </span>
                                );
                              })() : null}
                              {item.purpose ? (
                                <span className="inline-flex items-center gap-1.5 capitalize">
                                  <Activity className="h-3 w-3" strokeWidth={2} />
                                  {item.purpose}
                                </span>
                              ) : null}
                              {item.secondaryLabel ? (
                                <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                                  {item.secondaryLabel}
                                </span>
                              ) : null}
                              {item.status ? (
                                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${getStatusChipTone(item.status)}`}>
                                  {item.status}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 xl:w-auto xl:min-w-[40rem] xl:grid-cols-6 xl:text-right">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Token" : "Tokens"}</div>
                            <div className="mt-1 font-mono text-sm font-semibold text-[color:var(--stats-value-color)]">{formatTokens(item.usage.totalTokens, locale)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Aktiv" : "Active"}</div>
                            <div className="mt-1 font-mono text-sm font-semibold text-[color:var(--stats-value-color)]">{formatStatsDuration(item.usage.activeTimeMs, locale)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Aufrufe" : "Calls"}</div>
                            <div className="mt-1 font-mono text-sm font-semibold text-[color:var(--stats-value-color)]">{formatNumber(item.usage.invocationCount)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Anteil" : "Share"}</div>
                            <div className="mt-1 font-mono text-sm font-semibold text-[color:var(--stats-value-color)]">{formatPercent(shareOfTotal, locale)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Führung" : "Leader"}</div>
                            <div className="mt-1 font-mono text-sm font-semibold text-[color:var(--stats-value-color)]">{formatPercent(shareOfLeader, locale)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Kosten" : "Cost"}</div>
                            <div className="mt-1 font-mono text-sm font-semibold text-[color:var(--stats-value-color)]">{formatCost(item.usage.totalCostUsd, locale)}</div>
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
                        <div
                          role="img"
                          aria-label={locale === "de" ? `${item.label} trägt ${formatPercent(shareOfLeader, locale)} zum Token-Volumen der führenden ${displaySingularKind} bei.` : `${item.label} contributes ${formatPercent(shareOfLeader, locale)} of the leading ${singularKind} token volume.`}
                          className={`h-1 rounded-full ${TRACK_CLASS}`}
                        >
                          <div
                            aria-hidden="true"
                            className="h-1 rounded-full bg-[color:var(--stats-positive-text)] motion-safe:transition-[width]"
                            style={{ transitionDuration: interactionTokens.listReorder.duration, transitionTimingFunction: interactionTokens.listReorder.ease, width: `${Math.min(100, Math.max(shareOfLeader > 0 ? 3 : 0, shareOfLeader))}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 text-xs leading-relaxed text-[color:var(--stats-detail-color)]">
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            <span><strong className="font-semibold text-[color:var(--stats-value-color)]">{locale === "de" ? "Eingabe" : "Input"}</strong> {formatTokens(item.usage.inputTokens, locale)}</span>
                            <span><strong className="font-semibold text-[color:var(--stats-value-color)]">{locale === "de" ? "Im Cache" : "Cached"}</strong> {formatTokens(item.usage.cachedInputTokens, locale)}</span>
                            <span><strong className="font-semibold text-[color:var(--stats-value-color)]">{locale === "de" ? "Ausgabe" : "Output"}</strong> {formatTokens(item.usage.outputTokens, locale)}</span>
                            <span><strong className="font-semibold text-[color:var(--stats-value-color)]">{locale === "de" ? "Schlussfolgerung" : "Reasoning"}</strong> {formatTokens(item.usage.reasoningOutputTokens, locale)}</span>
                            <span><strong className="font-semibold text-[color:var(--stats-value-color)]">p50</strong> {duration?.p50Ms != null ? formatStatsDuration(duration.p50Ms, locale) : "—"}</span>
                            <span><strong className="font-semibold text-[color:var(--stats-value-color)]">p95</strong> {duration?.p95Ms != null ? formatStatsDuration(duration.p95Ms, locale) : "—"}</span>
                          </div>
                          <div className="max-w-full text-xs text-[color:var(--stats-detail-color)]">
                            {providerLabel} · {purposeLabel} · {statusLabel} · {percentileSummary}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {visibleItems.length < filteredItems.length ? (
                <div ref={sentinelRef} className={`${DASHED_EMPTY_CLASS} py-4 text-[11px] font-bold uppercase tracking-[0.16em]`}>
                  {locale === "de" ? "Weitere Telemetriebereiche werden geladen …" : "Loading more telemetry lanes..."}
                </div>
              ) : null}
            </div>
          </div>
        ) : items.length > 0 && queryIsActive ? (
          <div className={`${DASHED_EMPTY_CLASS} py-12`}>
            <div className="space-y-3">
              <div>{locale === "de" ? `Keine ${displayKind} passen zu „${query.trim()}“. ` : `No ${kindLabel} match “${query.trim()}”.`}</div>
              <button
                type="button"
                onClick={() => setQuery("")}
                className={`inline-flex items-center rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] transition-colors hover:text-[color:var(--stats-value-color)] ${CHIP_CLASS} ${CONTROL_FOCUS_CLASS}`}
              >
                {locale === "de" ? "Suche leeren" : "Clear search"}
              </button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className={`${DASHED_EMPTY_CLASS} py-12`}>
            {emptyLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
};
