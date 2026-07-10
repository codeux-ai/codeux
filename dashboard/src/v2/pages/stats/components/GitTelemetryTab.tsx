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
    <div className={`${PANEL_CLASS} !overflow-visible p-4 md:p-5`}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">{eyebrow}</div>
            <div className="mt-2 text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">{title}</div>
            <div className="mt-2 text-sm text-[color:var(--stats-detail-color)]">
              Search, sort, and compare {kindLabel} by code churn, PRs opened, and changes merged.
            </div>
          </div>
          <div aria-live="polite" aria-atomic="true" className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
            {filteredItems.length.toLocaleString()} visible / {items.length.toLocaleString()} total
          </div>
        </div>

        <div className="grid min-w-0 overflow-hidden rounded-[var(--stats-subpanel-radius)] border border-[color:var(--stats-border-hairline)] sm:grid-cols-2 xl:grid-cols-6 [&>div]:!rounded-none [&>div]:!border-0 [&>div]:border-l [&>div]:border-[color:var(--stats-border-hairline)]">
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Insertions</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">+{totalInsertions.toLocaleString()}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]">lines added</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Deletions</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">-{totalDeletions.toLocaleString()}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]">lines removed</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Files</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">{totalFiles.toLocaleString()}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]">changed</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">PRs</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">{totalPRs.toLocaleString()}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]">opened</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Merged</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">{mergedPRs.toLocaleString()}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]">{formatPercent(mergeRate)} merge rate</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Visible Churn</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-[color:var(--stats-value-color)]">{totals.churn.toLocaleString()}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-label-color)]">{formatPercent(filteredShare)} in view</div>
          </div>
        </div>

        <div className={`${SUBPANEL_CLASS} sticky top-[4.25rem] z-20 grid gap-2 p-2 xl:grid-cols-[minmax(14rem,0.75fr)_minmax(0,1.25fr)] xl:items-center`}>
          <div className="relative">
            <label htmlFor={`${kindLabel}-git-ledger-search`} className="sr-only">
              Search {kindLabel} git telemetry
            </label>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--stats-detail-color)]" strokeWidth={2} />
            <input
              id={`${kindLabel}-git-ledger-search`}
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
                className={`absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--stats-label-color)] transition-colors hover:bg-[color:var(--stats-surface-chip-hover)] hover:text-[color:var(--stats-value-color)] ${CONTROL_FOCUS_CLASS}`}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1 pr-1 scrollbar-hide xl:flex-wrap xl:justify-end">
            {([
              ["insertions", "Insertions"],
              ["deletions", "Deletions"],
              ["filesChanged", "Files"],
              ["prCount", "PRs"],
              ["mergedCount", "Merged"],
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
                <div>No {kindLabel} match “{query.trim()}”.</div>
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className={`inline-flex items-center rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] transition-colors hover:text-[color:var(--stats-value-color)] ${CHIP_CLASS} ${CONTROL_FOCUS_CLASS}`}
                >
                  Clear search
                </button>
              </div>
            ) : emptyLabel}
          </div>
        ) : (
          <div ref={scrollContainerRef} className="max-h-[42rem] min-w-0 overflow-y-auto rounded-[var(--stats-subpanel-radius)] border border-[color:var(--stats-border-hairline)] dashboard-scrollbar">
            <div className="divide-y divide-[color:var(--stats-border-hairline)]">
              {visibleItems.map((item, index) => {
                const itemChurn = item.metrics.insertions + item.metrics.deletions;
                const shareOfTotal = totals.churn > 0 ? (itemChurn / totals.churn) * 100 : 0;
                const shareOfLeader = totals.leaderChurn > 0 ? (itemChurn / totals.leaderChurn) * 100 : 0;

                return (
                  <div key={item.id} className="group min-w-0 p-3 transition-colors hover:bg-[color:var(--stats-surface-subpanel-hover)] motion-reduce:transition-none" aria-label={`${item.label} git telemetry row`}>
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--stats-chip-radius)] border border-[color:var(--stats-card-border)] bg-[color:var(--stats-surface-subpanel)] text-xs font-semibold text-[color:var(--stats-value-color)]">
                            {index + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="break-words text-base font-semibold tracking-tight text-[color:var(--stats-value-color)] [overflow-wrap:anywhere]">{item.label}</div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              {item.secondaryLabel ? (
                                <span className={`max-w-full break-words px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)] [overflow-wrap:anywhere] ${CHIP_CLASS}`}>
                                  {item.secondaryLabel}
                                </span>
                              ) : null}
                              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
                                {item.metrics.filesChanged} Files Changed
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="grid w-full min-w-0 max-w-full grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6 xl:text-right">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Code Churn</div>
                            <div className="mt-1 flex items-center gap-3 text-base font-semibold tracking-tight text-[color:var(--stats-value-color)] xl:justify-end text-[color:var(--stats-value-color)]">
                              {itemChurn.toLocaleString()}
                              <div className="w-16 h-1.5">
                                <ChurnFlowBar insertions={item.metrics.insertions} deletions={item.metrics.deletions} />
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">PRs</div>
                            <div className="mt-1 text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{item.metrics.prCount.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Merged</div>
                            <div className="mt-1 text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{item.metrics.mergedCount.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Files</div>
                            <div className="mt-1 text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{item.metrics.filesChanged.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Share</div>
                            <div className="mt-1 text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatPercent(shareOfTotal)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Leader</div>
                            <div className="mt-1 text-base font-semibold tracking-tight text-[color:var(--stats-value-color)]">{formatPercent(shareOfLeader)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">
                          <span>Churn mix</span>
                          <span>Insertions vs deletions</span>
                        </div>
                        <ChurnFlowBar
                          insertions={item.metrics.insertions}
                          deletions={item.metrics.deletions}
                        />
                        <div className={`h-1 rounded-full ${TRACK_CLASS}`}>
                          <div
                            className="h-1 rounded-full bg-[color:var(--stats-positive-text)] transition-[width] duration-500 motion-reduce:transition-none"
                            style={{ width: `${Math.min(100, Math.max(shareOfLeader > 0 ? 3 : 0, shareOfLeader))}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap gap-2">
                            <TokenChip icon={PlusSquare} label="Insertions" value={`+${item.metrics.insertions.toLocaleString()}`} tone={STATUS_TONE_CLASS.positive} />
                            <TokenChip icon={MinusSquare} label="Deletions" value={`-${item.metrics.deletions.toLocaleString()}`} tone={STATUS_TONE_CLASS.negative} />
                            <TokenChip icon={FileEdit} label="Files" value={item.metrics.filesChanged.toLocaleString()} tone={STATUS_TONE_CLASS.cyan} />
                            <TokenChip icon={GitPullRequest} label="PRs" value={item.metrics.prCount.toLocaleString()} tone={STATUS_TONE_CLASS.warning} />
                            <TokenChip icon={GitMerge} label="Merged" value={item.metrics.mergedCount.toLocaleString()} tone={STATUS_TONE_CLASS.signal} />
                            <TokenChip icon={AlertTriangle} label="Conflicts" value={getMetricCount(item.metrics.mergeConflictCount).toLocaleString()} tone={STATUS_TONE_CLASS.warning} />
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">
                            {formatPercent(shareOfTotal)} of visible churn · {formatPercent(shareOfLeader)} of leader
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {visibleItems.length < filteredItems.length ? (
                <div ref={sentinelRef} role="status" aria-live="polite" className={`${DASHED_EMPTY_CLASS} py-4 text-[11px] font-bold uppercase tracking-[0.16em]`}>
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
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">Ranking Snapshot</div>
          <div className="mt-2 text-sm font-bold text-[color:var(--stats-value-color)]">Buckets and entity leaders</div>
        </div>
        <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
          {rankedBuckets.length} buckets
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_0.95fr]">
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Busiest buckets</div>
          <div className="space-y-2">
            {rankedBuckets.map((bucket, index) => {
              const churn = bucket.metrics.insertions + bucket.metrics.deletions;
              return (
                <div key={bucket.bucketStart} className={`${SUBPANEL_CLASS} p-3`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[color:var(--stats-value-color)]">
                        {index + 1}. {bucket.label}
                      </div>
                      <div className="mt-1 text-[11px] text-[color:var(--stats-detail-color)]">
                        {bucket.metrics.prCount.toLocaleString()} PRs · {getMetricCount(bucket.metrics.mergeConflictCount).toLocaleString()} conflicts
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-[color:var(--stats-value-color)]">{churn.toLocaleString()}</div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">churn</div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">
                    <span>+{bucket.metrics.insertions.toLocaleString()}</span>
                    <span>-{bucket.metrics.deletions.toLocaleString()}</span>
                    <span>{bucket.metrics.filesChanged.toLocaleString()} files</span>
                    <span>{bucket.metrics.mergedCount.toLocaleString()} merged</span>
                  </div>
                </div>
              );
            })}
            {rankedBuckets.length === 0 ? (
              <div className={`${DASHED_EMPTY_CLASS} py-6 text-left`}>
                No bucket data is available yet.
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Entity leaders</div>
          <div className={`${SUBPANEL_CLASS} p-3`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">Top task</div>
            <div className="mt-1 text-sm font-bold text-[color:var(--stats-value-color)]">{topTask ? topTask.label : "No task leader yet"}</div>
            {topTask ? (
              <div className="mt-2 text-[11px] text-[color:var(--stats-detail-color)]">
                {topTask.metrics.prCount.toLocaleString()} PRs · {topTask.metrics.mergedCount.toLocaleString()} merged · {getMetricCount(topTask.metrics.mergeConflictCount).toLocaleString()} conflicts
              </div>
            ) : null}
          </div>
          <div className={`${SUBPANEL_CLASS} p-3`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">Top sprint</div>
            <div className="mt-1 text-sm font-bold text-[color:var(--stats-value-color)]">{topSprint ? topSprint.label : "No sprint leader yet"}</div>
            {topSprint ? (
              <div className="mt-2 text-[11px] text-[color:var(--stats-detail-color)]">
                {topSprint.metrics.prCount.toLocaleString()} PRs · {topSprint.metrics.filesChanged.toLocaleString()} files changed
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export const GitTelemetryTab: FunctionComponent<{ gitStats: ExecutionGitStatsSummary }> = ({ gitStats }) => {
  const [activeTab, setActiveTab] = useState<"tasks" | "sprints">("tasks");
  const tabRefs = useRef<Record<"tasks" | "sprints", HTMLButtonElement | null>>({
    tasks: null,
    sprints: null,
  });

  if (!gitStats.totals.insertions && !gitStats.totals.deletions && !gitStats.totals.filesChanged && !gitStats.totals.prCount && !gitStats.totals.mergedCount && !gitStats.tasks.length && !gitStats.sprints.length) {
    return (
      <div className={`${DASHED_EMPTY_CLASS} rounded-[var(--stats-panel-radius)] px-8 py-16`}>
        No git telemetry available in this window.
      </div>
    );
  }

  const leaderboardTabs = [
    { id: "tasks" as const, label: "Task Leaderboard", count: gitStats.tasks.length, icon: ListTodo },
    { id: "sprints" as const, label: "Sprint Leaderboard", count: gitStats.sprints.length, icon: Flag },
  ];
  const totalChurn = gitStats.totals.insertions + gitStats.totals.deletions;
  const conflictCount = getMetricCount(gitStats.totals.mergeConflictCount);
  const mergeRate = gitStats.totals.prCount > 0 ? (gitStats.totals.mergedCount / gitStats.totals.prCount) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      <section className={`${PANEL_CLASS} p-5 md:p-6`} aria-label="Git telemetry overview">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)] xl:items-center">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">
              <GitPullRequest className="h-3.5 w-3.5 text-[color:var(--stats-warning-text)]" strokeWidth={2.2} aria-hidden="true" />
              Git Operational Ledger
            </div>
            <div className="mt-2 text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">
              Churn, pull requests, and merge pressure
            </div>
            <div className="mt-2 max-w-3xl text-sm text-[color:var(--stats-detail-color)]">
              Review task and sprint git output by code churn, changed files, PR throughput, merges, and conflict signals.
            </div>
          </div>
          <div className={`${SUBPANEL_CLASS} p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Total Churn</div>
                <div className="mt-1 text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">{totalChurn.toLocaleString()}</div>
              </div>
              <div className={`inline-flex items-center gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
                <Hash className="h-3 w-3 text-[color:var(--stats-accent-cyan)]" strokeWidth={2.3} aria-hidden="true" />
                {gitStats.tasks.length.toLocaleString()} tasks · {gitStats.sprints.length.toLocaleString()} sprints
              </div>
            </div>
            <div className="mt-4">
              <ChurnFlowBar insertions={gitStats.totals.insertions} deletions={gitStats.totals.deletions} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-positive-text)] ${CHIP_CLASS}`}>+{gitStats.totals.insertions.toLocaleString()} insertions</span>
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-negative-text)] ${CHIP_CLASS}`}>-{gitStats.totals.deletions.toLocaleString()} deletions</span>
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-warning-text)] ${CHIP_CLASS}`}>{conflictCount.toLocaleString()} conflicts</span>
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-signal-text)] ${CHIP_CLASS}`}>{formatPercent(mergeRate)} merge rate</span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Git telemetry totals">
        <GitStatCard
          icon={PlusSquare}
          label="Insertions"
          value={gitStats.totals.insertions.toLocaleString()}
          detail={`${(gitStats.totals.insertions + gitStats.totals.deletions).toLocaleString()} total churn`}
          tone="bg-[color:var(--stats-accent-emerald-fill)] text-[color:var(--stats-positive-text)]"
        />
        <GitStatCard
          icon={MinusSquare}
          label="Deletions"
          value={gitStats.totals.deletions.toLocaleString()}
          detail={`${gitStats.totals.filesChanged.toLocaleString()} files changed`}
          tone="bg-[color:var(--stats-accent-rose-fill)] text-[color:var(--stats-negative-text)]"
        />
        <GitStatCard
          icon={FileEdit}
          label="Files Changed"
          value={gitStats.totals.filesChanged.toLocaleString()}
          detail={`${gitStats.totals.prCount.toLocaleString()} PRs in scope`}
          tone="bg-[color:var(--stats-accent-cyan-fill)] text-[color:var(--stats-accent-cyan)]"
        />
        <GitStatCard
          icon={GitPullRequest}
          label="Pull Requests"
          value={gitStats.totals.prCount.toLocaleString()}
          detail={`${gitStats.totals.mergedCount.toLocaleString()} merged`}
          tone="bg-[color:var(--stats-accent-amber-fill)] text-[color:var(--stats-warning-text)]"
        />
        <GitStatCard
          icon={GitMerge}
          label="Merges"
          value={gitStats.totals.mergedCount.toLocaleString()}
          detail={`${getMetricCount(gitStats.totals.mergeConflictCount).toLocaleString()} conflicts in scope`}
          tone="bg-[color:var(--stats-accent-signal-fill)] text-[color:var(--stats-signal-text)]"
        />
        <GitStatCard
          icon={AlertTriangle}
          label="Merge Conflicts"
          value={getMetricCount(gitStats.totals.mergeConflictCount).toLocaleString()}
          detail={`${gitStats.totals.prCount > 0 ? Math.round((getMetricCount(gitStats.totals.mergeConflictCount) / gitStats.totals.prCount) * 100) : 0}% of PRs`}
          tone="bg-[color:var(--stats-accent-amber-fill)] text-[color:var(--stats-warning-text)]"
        />
      </section>

      <GitRankingPanel buckets={gitStats.buckets} tasks={gitStats.tasks} sprints={gitStats.sprints} />

      <div
        role="tablist"
        aria-label="Git telemetry leaderboards"
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
                {tab.count.toLocaleString()}
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
            title="Task Git Telemetry"
            eyebrow="Task Git Ledger"
            items={gitStats.tasks}
            kindLabel="tasks"
            emptyLabel="No task git telemetry landed in this window yet."
          />
        ) : (
          <GitTelemetryLedger
            title="Sprint Git Telemetry"
            eyebrow="Sprint Git Ledger"
            items={gitStats.sprints}
            kindLabel="sprints"
            emptyLabel="No sprint git telemetry active in this window."
          />
        )}
      </div>
    </div>
  );
};
