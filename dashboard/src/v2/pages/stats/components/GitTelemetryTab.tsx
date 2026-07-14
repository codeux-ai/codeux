import type { ComponentType, FunctionComponent } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import { AlertTriangle, GitMerge, GitPullRequest, FileEdit, Flag, ListTodo, PlusSquare, MinusSquare, Search, X, Hash } from "lucide-preact";
import { useProgressiveList } from "../../../../hooks/use-progressive-list.js";
import type { ExecutionGitStatsEntitySummary, ExecutionGitStatsSummary } from "../../../types.js";
import { formatPercent } from "../stats-utils.js";
import {
  CHIP_CLASS,
  CONTROL_FOCUS_CLASS,
  DASHED_EMPTY_CLASS,
  INPUT_CLASS,
  LEDGER_ROW_MODERN_CLASS,
  PANEL_CLASS,
  STATUS_TONE_CLASS,
  SUBPANEL_CLASS,
  SortButton,
  TAB_ACTIVE_CLASS,
  TAB_COUNT_ACTIVE_CLASS,
  TAB_COUNT_IDLE_CLASS,
  TAB_IDLE_CLASS,
  TRACK_CLASS,
  TokenChip,
  ChurnFlowBar,
} from "./StatsShared.js";
import { useStatsI18n } from "../stats-i18n.js";

type GitLedgerSortKey = "insertions" | "deletions" | "filesChanged" | "prCount" | "mergedCount" | "name";

const getMetricCount = (value: number | null | undefined): number => value ?? 0;

export const GitTelemetryLedger: FunctionComponent<{
  title: string;
  eyebrow: string;
  items: ExecutionGitStatsEntitySummary[];
  kindLabel: string;
  emptyLabel: string;
  defaultSortKey?: GitLedgerSortKey;
}> = ({
  title,
  eyebrow,
  items,
  kindLabel,
  emptyLabel,
  defaultSortKey = "insertions",
}) => {
  const { locale, formatNumber } = useStatsI18n();
  const displayKind = locale === "de" ? (kindLabel === "tasks" ? "Aufgaben" : "Sprints") : kindLabel;
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<GitLedgerSortKey>(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const base = normalizedQuery.length === 0
      ? items
      : items.filter((item) => {
        const haystack = [
          item.label,
          item.secondaryLabel || "",
        ].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      });

    const directionFactor = sortDir === "desc" ? 1 : -1;
    return [...base].sort((left, right) => {
      let leftValue: number | string = 0;
      let rightValue: number | string = 0;

      if (sortKey === "insertions") { leftValue = left.metrics.insertions; rightValue = right.metrics.insertions; }
      else if (sortKey === "deletions") { leftValue = left.metrics.deletions; rightValue = right.metrics.deletions; }
      else if (sortKey === "filesChanged") { leftValue = left.metrics.filesChanged; rightValue = right.metrics.filesChanged; }
      else if (sortKey === "prCount") { leftValue = left.metrics.prCount; rightValue = right.metrics.prCount; }
      else if (sortKey === "mergedCount") { leftValue = left.metrics.mergedCount; rightValue = right.metrics.mergedCount; }
      else if (sortKey === "name") { leftValue = left.label; rightValue = right.label; }

      if (typeof leftValue === "string" && typeof rightValue === "string") {
        // First click on a text sort reads A→Z; toggling flips it.
        return leftValue.localeCompare(rightValue) * (sortDir === "desc" ? 1 : -1);
      }
      return (Number(rightValue) - Number(leftValue)) * directionFactor;
    });
  }, [items, query, sortKey, sortDir]);

  const totals = useMemo(() => {
    let churn = 0;
    let leaderChurn = 0;
    for (const item of filteredItems) {
      const itemChurn = item.metrics.insertions + item.metrics.deletions;
      churn += itemChurn;
      leaderChurn = Math.max(leaderChurn, itemChurn);
    }
    return { churn, leaderChurn };
  }, [filteredItems]);

  const handleSort = (key: GitLedgerSortKey) => {
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

  const totalPRs = items.reduce((s, i) => s + i.metrics.prCount, 0);
  const mergedPRs = items.reduce((s, i) => s + i.metrics.mergedCount, 0);
  const totalInsertions = items.reduce((s, i) => s + i.metrics.insertions, 0);
  const totalDeletions = items.reduce((s, i) => s + i.metrics.deletions, 0);
  const totalFiles = items.reduce((s, i) => s + i.metrics.filesChanged, 0);
  const queryIsActive = query.trim().length > 0;
  const mergeRate = totalPRs > 0 ? (mergedPRs / totalPRs) * 100 : 0;
  const filteredShare = (totalInsertions + totalDeletions) > 0 ? (totals.churn / (totalInsertions + totalDeletions)) * 100 : 0;

  return (
    <div className={`${PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">{eyebrow}</div>
            <div className="mt-2 text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">{title}</div>
            <div className="mt-2 text-sm text-[color:var(--stats-detail-color)]">
              {locale === "de" ? `${displayKind} nach Codeänderungen, geöffneten PRs und zusammengeführten Änderungen durchsuchen, sortieren und vergleichen.` : `Search, sort, and compare ${kindLabel} by code churn, PRs opened, and changes merged.`}
            </div>
          </div>
          <div aria-live="polite" aria-atomic="true" className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
            {formatNumber(filteredItems.length)} {locale === "de" ? "sichtbar" : "visible"} / {formatNumber(items.length)} {locale === "de" ? "gesamt" : "total"}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Einfügungen" : "Insertions"}</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">+{formatNumber(totalInsertions)}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Zeilen hinzugefügt" : "lines added"}</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Löschungen" : "Deletions"}</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">-{formatNumber(totalDeletions)}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Zeilen entfernt" : "lines removed"}</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Dateien" : "Files"}</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatNumber(totalFiles)}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]">{locale === "de" ? "geändert" : "changed"}</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">PRs</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatNumber(totalPRs)}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]">{locale === "de" ? "geöffnet" : "opened"}</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Zusammengeführt" : "Merged"}</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatNumber(mergedPRs)}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]">{formatPercent(mergeRate, locale)} {locale === "de" ? "Merge-Rate" : "merge rate"}</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Sichtbare Änderungen" : "Visible Churn"}</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatNumber(totals.churn)}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]">{formatPercent(filteredShare, locale)} {locale === "de" ? "in Ansicht" : "in view"}</div>
          </div>
        </div>

        <div className={`${SUBPANEL_CLASS} sticky top-3 z-20 grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center`}>
          <div className="relative">
            <label htmlFor={`${kindLabel}-git-ledger-search`} className="sr-only">
              {locale === "de" ? `Git-Telemetrie für ${displayKind} durchsuchen` : `Search ${kindLabel} git telemetry`}
            </label>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--stats-detail-color)]" strokeWidth={2} />
            <input
              id={`${kindLabel}-git-ledger-search`}
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
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1 pr-1 scrollbar-hide xl:flex-wrap xl:justify-end">
            {([
              ["insertions", locale === "de" ? "Einfügungen" : "Insertions"],
              ["deletions", locale === "de" ? "Löschungen" : "Deletions"],
              ["filesChanged", locale === "de" ? "Dateien" : "Files"],
              ["prCount", "PRs"],
              ["mergedCount", locale === "de" ? "Zusammengeführt" : "Merged"],
              ["name", "Name"],
            ] as const).map(([value, label]) => (
              <SortButton
                key={value}
                label={label}
                active={sortKey === value}
                direction={sortKey === value ? sortDir : null}
                onClick={() => handleSort(value)}
              />
            ))}
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className={`${DASHED_EMPTY_CLASS} py-12`}>
            {queryIsActive ? (
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
            ) : emptyLabel}
          </div>
        ) : (
          <div ref={scrollContainerRef} className="max-h-[42rem] overflow-y-auto border-t border-[color:var(--stats-border-hairline)] dashboard-scrollbar">
            <div className="space-y-1.5 bg-[color:var(--stats-surface-subpanel)] p-1.5">
              {visibleItems.map((item, index) => {
                const itemChurn = item.metrics.insertions + item.metrics.deletions;
                const shareOfTotal = totals.churn > 0 ? (itemChurn / totals.churn) * 100 : 0;
                const shareOfLeader = totals.leaderChurn > 0 ? (itemChurn / totals.leaderChurn) * 100 : 0;

                return (
                  <div key={item.id} className={LEDGER_ROW_MODERN_CLASS} aria-label={locale === "de" ? `${item.label}, Git-Telemetriezeile` : `${item.label} git telemetry row`}>
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--stats-control-radius)] border border-[color:var(--stats-card-border)] bg-[color:var(--stats-surface-subpanel)] font-mono text-xs font-semibold text-[color:var(--stats-value-color)]">
                            {formatNumber(index + 1)}
                          </div>
                          <div className="min-w-0">
                            <div className="break-words text-base font-semibold tracking-tight text-[color:var(--stats-value-color)] [overflow-wrap:anywhere]">{item.label}</div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              {item.secondaryLabel ? (
                                <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
                                  {item.secondaryLabel}
                                </span>
                              ) : null}
                              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
                                {formatNumber(item.metrics.filesChanged)} {locale === "de" ? "Dateien geändert" : "Files Changed"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 xl:w-auto xl:min-w-[46rem] xl:grid-cols-6 xl:text-right">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Codeänderungen" : "Code Churn"}</div>
                            <div className="mt-1 flex items-center gap-3 text-base font-semibold tracking-tight text-[color:var(--stats-value-color)] xl:justify-end text-[color:var(--stats-value-color)]">
                              {formatNumber(itemChurn)}
                              <div className="w-16 h-1.5">
                                <ChurnFlowBar insertions={item.metrics.insertions} deletions={item.metrics.deletions} />
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">PRs</div>
                            <div className="mt-1 text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatNumber(item.metrics.prCount)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Zusammengeführt" : "Merged"}</div>
                            <div className="mt-1 text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatNumber(item.metrics.mergedCount)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Dateien" : "Files"}</div>
                            <div className="mt-1 text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatNumber(item.metrics.filesChanged)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Anteil" : "Share"}</div>
                            <div className="mt-1 text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatPercent(shareOfTotal, locale)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Führung" : "Leader"}</div>
                            <div className="mt-1 text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatPercent(shareOfLeader, locale)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">
                          <span>{locale === "de" ? "Änderungsmix" : "Churn mix"}</span>
                          <span>{locale === "de" ? "Einfügungen gegenüber Löschungen" : "Insertions vs deletions"}</span>
                        </div>
                        <ChurnFlowBar
                          insertions={item.metrics.insertions}
                          deletions={item.metrics.deletions}
                        />
                        <div className={`h-1 rounded-full ${TRACK_CLASS}`}>
                          <div
                            className="h-1 rounded-full bg-[color:var(--stats-positive-text)] transition-[width] duration-500"
                            style={{ width: `${Math.min(100, Math.max(shareOfLeader > 0 ? 3 : 0, shareOfLeader))}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap gap-2">
                            <TokenChip icon={PlusSquare} label={locale === "de" ? "Einfügungen" : "Insertions"} value={`+${formatNumber(item.metrics.insertions)}`} tone={STATUS_TONE_CLASS.positive} />
                            <TokenChip icon={MinusSquare} label={locale === "de" ? "Löschungen" : "Deletions"} value={`-${formatNumber(item.metrics.deletions)}`} tone={STATUS_TONE_CLASS.negative} />
                            <TokenChip icon={FileEdit} label={locale === "de" ? "Dateien" : "Files"} value={formatNumber(item.metrics.filesChanged)} tone={STATUS_TONE_CLASS.cyan} />
                            <TokenChip icon={GitPullRequest} label="PRs" value={formatNumber(item.metrics.prCount)} tone={STATUS_TONE_CLASS.warning} />
                            <TokenChip icon={GitMerge} label={locale === "de" ? "Zusammengeführt" : "Merged"} value={formatNumber(item.metrics.mergedCount)} tone={STATUS_TONE_CLASS.signal} />
                            <TokenChip icon={AlertTriangle} label={locale === "de" ? "Konflikte" : "Conflicts"} value={formatNumber(getMetricCount(item.metrics.mergeConflictCount))} tone={STATUS_TONE_CLASS.warning} />
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">
                            {formatPercent(shareOfTotal, locale)} {locale === "de" ? "der sichtbaren Änderungen" : "of visible churn"} · {formatPercent(shareOfLeader, locale)} {locale === "de" ? "der Führung" : "of leader"}
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
        )}
      </div>
    </div>
  );
};

const GitStatCard: FunctionComponent<{
  icon: ComponentType<any>;
  label: string;
  value: string;
  detail: string;
  tone: string;
}> = ({ icon: Icon, label, value, detail, tone }) => (
  <div className={`${SUBPANEL_CLASS} p-4`}>
    <div className="flex items-center gap-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-[var(--stats-chip-radius)] ${tone}`}>
        <Icon className="h-4 w-4" strokeWidth={2.25} />
      </div>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">{label}</div>
        <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">{value}</div>
      </div>
    </div>
    <div className="mt-3 text-[11px] font-medium text-[color:var(--stats-detail-color)]">{detail}</div>
  </div>
);

const GitRankingPanel: FunctionComponent<{
  buckets: ExecutionGitStatsSummary["buckets"];
  tasks: ExecutionGitStatsSummary["tasks"];
  sprints: ExecutionGitStatsSummary["sprints"];
}> = ({ buckets, tasks, sprints }) => {
  const { locale, formatNumber } = useStatsI18n();
  const rankedBuckets = [...buckets]
    .sort((left, right) => (right.metrics.insertions + right.metrics.deletions) - (left.metrics.insertions + left.metrics.deletions))
    .slice(0, 4);
  const topTask = [...tasks]
    .sort((left, right) => (right.metrics.insertions + right.metrics.deletions) - (left.metrics.insertions + left.metrics.deletions))[0] ?? null;
  const topSprint = [...sprints]
    .sort((left, right) => (right.metrics.insertions + right.metrics.deletions) - (left.metrics.insertions + left.metrics.deletions))[0] ?? null;

  return (
    <div className={`${SUBPANEL_CLASS} p-4 lg:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Ranglistenübersicht" : "Ranking Snapshot"}</div>
          <div className="mt-2 text-sm font-bold text-[color:var(--stats-value-color)]">{locale === "de" ? "Zeitbereiche und führende Entitäten" : "Buckets and entity leaders"}</div>
        </div>
        <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
          {formatNumber(rankedBuckets.length)} {locale === "de" ? "Zeitbereiche" : "buckets"}
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_0.95fr]">
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Aktivste Zeitbereiche" : "Busiest buckets"}</div>
          <div className="space-y-2">
            {rankedBuckets.map((bucket, index) => {
              const churn = bucket.metrics.insertions + bucket.metrics.deletions;
              return (
                <div key={bucket.bucketStart} className={`${SUBPANEL_CLASS} p-3`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[color:var(--stats-value-color)]">
                        {formatNumber(index + 1)}. {bucket.label}
                      </div>
                      <div className="mt-1 text-[11px] text-[color:var(--stats-detail-color)]">
                        {formatNumber(bucket.metrics.prCount)} PRs · {formatNumber(getMetricCount(bucket.metrics.mergeConflictCount))} {locale === "de" ? "Konflikte" : "conflicts"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-[color:var(--stats-value-color)]">{formatNumber(churn)}</div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Änderungen" : "churn"}</div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">
                    <span>+{formatNumber(bucket.metrics.insertions)}</span>
                    <span>-{formatNumber(bucket.metrics.deletions)}</span>
                    <span>{formatNumber(bucket.metrics.filesChanged)} {locale === "de" ? "Dateien" : "files"}</span>
                    <span>{formatNumber(bucket.metrics.mergedCount)} {locale === "de" ? "zusammengeführt" : "merged"}</span>
                  </div>
                </div>
              );
            })}
            {rankedBuckets.length === 0 ? (
              <div className={`${DASHED_EMPTY_CLASS} py-6 text-left`}>
                {locale === "de" ? "Noch keine Zeitbereichsdaten verfügbar." : "No bucket data is available yet."}
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Führende Entitäten" : "Entity leaders"}</div>
          <div className={`${SUBPANEL_CLASS} p-3`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Führende Aufgabe" : "Top task"}</div>
            <div className="mt-1 text-sm font-bold text-[color:var(--stats-value-color)]">{topTask ? topTask.label : locale === "de" ? "Noch keine führende Aufgabe" : "No task leader yet"}</div>
            {topTask ? (
              <div className="mt-2 text-[11px] text-[color:var(--stats-detail-color)]">
                {formatNumber(topTask.metrics.prCount)} PRs · {formatNumber(topTask.metrics.mergedCount)} {locale === "de" ? "zusammengeführt" : "merged"} · {formatNumber(getMetricCount(topTask.metrics.mergeConflictCount))} {locale === "de" ? "Konflikte" : "conflicts"}
              </div>
            ) : null}
          </div>
          <div className={`${SUBPANEL_CLASS} p-3`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Führender Sprint" : "Top sprint"}</div>
            <div className="mt-1 text-sm font-bold text-[color:var(--stats-value-color)]">{topSprint ? topSprint.label : locale === "de" ? "Noch kein führender Sprint" : "No sprint leader yet"}</div>
            {topSprint ? (
              <div className="mt-2 text-[11px] text-[color:var(--stats-detail-color)]">
                {formatNumber(topSprint.metrics.prCount)} PRs · {formatNumber(topSprint.metrics.filesChanged)} {locale === "de" ? "Dateien geändert" : "files changed"}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export const GitTelemetryTab: FunctionComponent<{ gitStats: ExecutionGitStatsSummary }> = ({ gitStats }) => {
  const { locale, formatNumber } = useStatsI18n();
  const [activeTab, setActiveTab] = useState<"tasks" | "sprints">("tasks");
  const tabRefs = useRef<Record<"tasks" | "sprints", HTMLButtonElement | null>>({
    tasks: null,
    sprints: null,
  });

  if (!gitStats.totals.insertions && !gitStats.totals.deletions && !gitStats.totals.filesChanged && !gitStats.totals.prCount && !gitStats.totals.mergedCount && !gitStats.tasks.length && !gitStats.sprints.length) {
    return (
      <div className={`${DASHED_EMPTY_CLASS} rounded-[var(--stats-panel-radius)] px-8 py-16`}>
        {locale === "de" ? "In diesem Zeitraum ist keine Git-Telemetrie verfügbar." : "No git telemetry available in this window."}
      </div>
    );
  }

  const leaderboardTabs = [
    { id: "tasks" as const, label: locale === "de" ? "Aufgabenrangliste" : "Task Leaderboard", count: gitStats.tasks.length, icon: ListTodo },
    { id: "sprints" as const, label: locale === "de" ? "Sprintrangliste" : "Sprint Leaderboard", count: gitStats.sprints.length, icon: Flag },
  ];
  const totalChurn = gitStats.totals.insertions + gitStats.totals.deletions;
  const conflictCount = getMetricCount(gitStats.totals.mergeConflictCount);
  const mergeRate = gitStats.totals.prCount > 0 ? (gitStats.totals.mergedCount / gitStats.totals.prCount) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      <section className={`${PANEL_CLASS} p-5 md:p-6`} aria-label={locale === "de" ? "Git-Telemetrieübersicht" : "Git telemetry overview"}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)] xl:items-center">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">
              <GitPullRequest className="h-3.5 w-3.5 text-[color:var(--stats-warning-text)]" strokeWidth={2.2} aria-hidden="true" />
              {locale === "de" ? "Operatives Git-Ledger" : "Git Operational Ledger"}
            </div>
            <div className="mt-2 text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">
              {locale === "de" ? "Codeänderungen, Pull Requests und Merge-Druck" : "Churn, pull requests, and merge pressure"}
            </div>
            <div className="mt-2 max-w-3xl text-sm text-[color:var(--stats-detail-color)]">
              {locale === "de" ? "Git-Ausgaben von Aufgaben und Sprints nach Codeänderungen, geänderten Dateien, PR-Durchsatz, Merges und Konfliktsignalen prüfen." : "Review task and sprint git output by code churn, changed files, PR throughput, merges, and conflict signals."}
            </div>
          </div>
          <div className={`${SUBPANEL_CLASS} p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">{locale === "de" ? "Gesamte Änderungen" : "Total Churn"}</div>
                <div className="mt-1 text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatNumber(totalChurn)}</div>
              </div>
              <div className={`inline-flex items-center gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
                <Hash className="h-3 w-3 text-[color:var(--stats-accent-cyan)]" strokeWidth={2.3} aria-hidden="true" />
                {formatNumber(gitStats.tasks.length)} {locale === "de" ? "Aufgaben" : "tasks"} · {formatNumber(gitStats.sprints.length)} Sprints
              </div>
            </div>
            <div className="mt-4">
              <ChurnFlowBar insertions={gitStats.totals.insertions} deletions={gitStats.totals.deletions} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-positive-text)] ${CHIP_CLASS}`}>+{formatNumber(gitStats.totals.insertions)} {locale === "de" ? "Einfügungen" : "insertions"}</span>
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-negative-text)] ${CHIP_CLASS}`}>-{formatNumber(gitStats.totals.deletions)} {locale === "de" ? "Löschungen" : "deletions"}</span>
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-warning-text)] ${CHIP_CLASS}`}>{formatNumber(conflictCount)} {locale === "de" ? "Konflikte" : "conflicts"}</span>
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-signal-text)] ${CHIP_CLASS}`}>{formatPercent(mergeRate, locale)} {locale === "de" ? "Merge-Rate" : "merge rate"}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={locale === "de" ? "Summen der Git-Telemetrie" : "Git telemetry totals"}>
        <GitStatCard
          icon={PlusSquare}
          label={locale === "de" ? "Einfügungen" : "Insertions"}
          value={formatNumber(gitStats.totals.insertions)}
          detail={`${formatNumber(totalChurn)} ${locale === "de" ? "gesamte Änderungen" : "total churn"}`}
          tone="bg-[color:var(--stats-accent-emerald-fill)] text-[color:var(--stats-positive-text)]"
        />
        <GitStatCard
          icon={MinusSquare}
          label={locale === "de" ? "Löschungen" : "Deletions"}
          value={formatNumber(gitStats.totals.deletions)}
          detail={`${formatNumber(gitStats.totals.filesChanged)} ${locale === "de" ? "Dateien geändert" : "files changed"}`}
          tone="bg-[color:var(--stats-accent-rose-fill)] text-[color:var(--stats-negative-text)]"
        />
        <GitStatCard
          icon={FileEdit}
          label={locale === "de" ? "Geänderte Dateien" : "Files Changed"}
          value={formatNumber(gitStats.totals.filesChanged)}
          detail={`${formatNumber(gitStats.totals.prCount)} ${locale === "de" ? "PRs im Bereich" : "PRs in scope"}`}
          tone="bg-[color:var(--stats-accent-cyan-fill)] text-[color:var(--stats-accent-cyan)]"
        />
        <GitStatCard
          icon={GitPullRequest}
          label="Pull Requests"
          value={formatNumber(gitStats.totals.prCount)}
          detail={`${formatNumber(gitStats.totals.mergedCount)} ${locale === "de" ? "zusammengeführt" : "merged"}`}
          tone="bg-[color:var(--stats-accent-amber-fill)] text-[color:var(--stats-warning-text)]"
        />
        <GitStatCard
          icon={GitMerge}
          label="Merges"
          value={formatNumber(gitStats.totals.mergedCount)}
          detail={`${formatNumber(conflictCount)} ${locale === "de" ? "Konflikte im Bereich" : "conflicts in scope"}`}
          tone="bg-[color:var(--stats-accent-signal-fill)] text-[color:var(--stats-signal-text)]"
        />
        <GitStatCard
          icon={AlertTriangle}
          label={locale === "de" ? "Merge-Konflikte" : "Merge Conflicts"}
          value={formatNumber(conflictCount)}
          detail={`${formatPercent(gitStats.totals.prCount > 0 ? (conflictCount / gitStats.totals.prCount) * 100 : 0, locale)} ${locale === "de" ? "der PRs" : "of PRs"}`}
          tone="bg-[color:var(--stats-accent-amber-fill)] text-[color:var(--stats-warning-text)]"
        />
      </section>

      <GitRankingPanel buckets={gitStats.buckets} tasks={gitStats.tasks} sprints={gitStats.sprints} />

      <div
        role="tablist"
        aria-label={locale === "de" ? "Git-Telemetrieranglisten" : "Git telemetry leaderboards"}
        className={`${SUBPANEL_CLASS} sticky top-3 z-20 grid max-w-full grid-cols-1 gap-1 !p-1 sm:grid-cols-2`}
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowDown" && event.key !== "ArrowLeft" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
            return;
          }
          event.preventDefault();
          const focusedIndex = leaderboardTabs.findIndex((tab) => tabRefs.current[tab.id] === document.activeElement);
          const currentIndex = focusedIndex >= 0 ? focusedIndex : leaderboardTabs.findIndex((tab) => tab.id === activeTab);
          const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
              ? leaderboardTabs.length - 1
              : event.key === "ArrowRight" || event.key === "ArrowDown"
                ? (currentIndex + 1) % leaderboardTabs.length
                : (currentIndex - 1 + leaderboardTabs.length) % leaderboardTabs.length;
          const nextTab = leaderboardTabs[nextIndex]?.id ?? "tasks";
          setActiveTab(nextTab);
          tabRefs.current[nextTab]?.focus();
        }}
      >
        {leaderboardTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              id={`git-tab-${tab.id}`}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              role="tab"
              aria-selected={isActive}
              aria-controls={`git-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              aria-label={tab.label}
              className={`grid min-h-12 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--stats-control-radius)] px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.18em] transition-[background-color,border-color,color] motion-safe:duration-200 ${CONTROL_FOCUS_CLASS} ${
                isActive ? TAB_ACTIVE_CLASS : TAB_IDLE_CLASS
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
              <span className="truncate">{tab.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${CHIP_CLASS} ${isActive ? TAB_COUNT_ACTIVE_CLASS : TAB_COUNT_IDLE_CLASS}`}>
                {formatNumber(tab.count)}
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`git-panel-${activeTab}`}
        aria-labelledby={`git-tab-${activeTab}`}
        tabIndex={0}
        className={`${CONTROL_FOCUS_CLASS} rounded-[var(--stats-control-radius)]`}
      >
        {activeTab === "tasks" ? (
          <GitTelemetryLedger
            title={locale === "de" ? "Git-Telemetrie nach Aufgabe" : "Task Git Telemetry"}
            eyebrow={locale === "de" ? "Aufgaben-Git-Ledger" : "Task Git Ledger"}
            items={gitStats.tasks}
            kindLabel="tasks"
            emptyLabel={locale === "de" ? "In diesem Zeitraum ist noch keine Git-Telemetrie für Aufgaben eingegangen." : "No task git telemetry landed in this window yet."}
          />
        ) : (
          <GitTelemetryLedger
            title={locale === "de" ? "Git-Telemetrie nach Sprint" : "Sprint Git Telemetry"}
            eyebrow={locale === "de" ? "Sprint-Git-Ledger" : "Sprint Git Ledger"}
            items={gitStats.sprints}
            kindLabel="sprints"
            emptyLabel={locale === "de" ? "In diesem Zeitraum ist keine Git-Telemetrie für Sprints aktiv." : "No sprint git telemetry active in this window."}
          />
        )}
      </div>
    </div>
  );
};
