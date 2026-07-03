import type { ComponentType, FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { AlertTriangle, GitMerge, GitPullRequest, FileEdit, Flag, ListTodo, PlusSquare, MinusSquare, Search, X, Hash } from "lucide-preact";
import { useProgressiveList } from "../../../../hooks/use-progressive-list.js";
import type { ExecutionGitStatsEntitySummary, ExecutionGitStatsSummary } from "../../../types.js";
import { formatPercent } from "../stats-utils.js";
import {
  CHIP_CLASS,
  INPUT_CLASS,
  LEDGER_ROW_MODERN_CLASS,
  PANEL_CLASS,
  SUBPANEL_CLASS,
  SortButton,
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
    <div className={`${PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{eyebrow}</div>
            <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Search, sort, and compare {kindLabel} by code churn, PRs opened, and changes merged.
            </div>
          </div>
          <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
            {filteredItems.length.toLocaleString()} visible / {items.length.toLocaleString()} total
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Insertions</div>
            <div className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">+{totalInsertions.toLocaleString()}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">lines added</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Deletions</div>
            <div className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">-{totalDeletions.toLocaleString()}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">lines removed</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Files</div>
            <div className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">{totalFiles.toLocaleString()}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">changed</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">PRs</div>
            <div className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">{totalPRs.toLocaleString()}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">opened</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Merged</div>
            <div className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">{mergedPRs.toLocaleString()}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{formatPercent(mergeRate)} merge rate</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Visible Churn</div>
            <div className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">{totals.churn.toLocaleString()}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{formatPercent(filteredShare)} in view</div>
          </div>
        </div>

        <div className={`${SUBPANEL_CLASS} sticky top-3 z-20 grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center`}>
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
          <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-12 text-center text-sm text-slate-400 dark:border-white/[0.08]">
            {queryIsActive ? (
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
            ) : emptyLabel}
          </div>
        ) : (
          <div ref={scrollContainerRef} className="max-h-[42rem] overflow-y-auto pr-2 dashboard-scrollbar">
            <div className="space-y-3">
              {visibleItems.map((item, index) => {
                const itemChurn = item.metrics.insertions + item.metrics.deletions;
                const shareOfTotal = totals.churn > 0 ? (itemChurn / totals.churn) * 100 : 0;
                const shareOfLeader = totals.leaderChurn > 0 ? (itemChurn / totals.leaderChurn) * 100 : 0;

                return (
                  <div key={item.id} className={`${LEDGER_ROW_MODERN_CLASS} !p-4`} aria-label={`${item.label} git telemetry row`}>
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/[0.06] bg-white/75 text-xs font-black text-slate-900 shadow-[0_6px_16px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/55 dark:text-white">
                            {index + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-base font-black tracking-tight text-slate-900 dark:text-white">{item.label}</div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              {item.secondaryLabel ? (
                                <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                                  {item.secondaryLabel}
                                </span>
                              ) : null}
                              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                                {item.metrics.filesChanged} Files Changed
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 xl:w-auto xl:min-w-[46rem] xl:grid-cols-6 xl:text-right">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Code Churn</div>
                            <div className="mt-1 flex items-center gap-3 text-lg font-black tracking-tight text-slate-900 xl:justify-end dark:text-white">
                              {itemChurn.toLocaleString()}
                              <div className="w-16 h-1.5">
                                <ChurnFlowBar insertions={item.metrics.insertions} deletions={item.metrics.deletions} />
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">PRs</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{item.metrics.prCount.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Merged</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{item.metrics.mergedCount.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Files</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{item.metrics.filesChanged.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Share</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{formatPercent(shareOfTotal)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Leader</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{formatPercent(shareOfLeader)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                          <span>Churn mix</span>
                          <span>Insertions vs deletions</span>
                        </div>
                        <ChurnFlowBar
                          insertions={item.metrics.insertions}
                          deletions={item.metrics.deletions}
                        />
                        <div className="h-1 rounded-full bg-black/[0.04] dark:bg-white/[0.05]">
                          <div
                            className="h-1 rounded-full bg-emerald-500/55 transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.max(shareOfLeader > 0 ? 3 : 0, shareOfLeader))}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap gap-2">
                            <TokenChip icon={PlusSquare} label="Insertions" value={`+${item.metrics.insertions.toLocaleString()}`} tone="border-emerald-500/16 bg-emerald-500/8 text-emerald-600 dark:text-emerald-400" />
                            <TokenChip icon={MinusSquare} label="Deletions" value={`-${item.metrics.deletions.toLocaleString()}`} tone="border-rose-500/16 bg-rose-500/8 text-rose-600 dark:text-rose-400" />
                            <TokenChip icon={FileEdit} label="Files" value={item.metrics.filesChanged.toLocaleString()} tone="border-cyan-500/16 bg-cyan-500/8 text-cyan-600 dark:text-cyan-400" />
                            <TokenChip icon={GitPullRequest} label="PRs" value={item.metrics.prCount.toLocaleString()} tone="border-amber-500/16 bg-amber-500/8 text-amber-600 dark:text-amber-400" />
                            <TokenChip icon={GitMerge} label="Merged" value={item.metrics.mergedCount.toLocaleString()} tone="border-indigo-500/16 bg-indigo-500/8 text-indigo-600 dark:text-indigo-400" />
                            <TokenChip icon={AlertTriangle} label="Conflicts" value={getMetricCount(item.metrics.mergeConflictCount).toLocaleString()} tone="border-orange-500/16 bg-orange-500/8 text-orange-600 dark:text-orange-400" />
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                            {formatPercent(shareOfTotal)} of visible churn · {formatPercent(shareOfLeader)} of leader
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

const GitStatCard: FunctionComponent<{
  icon: ComponentType<any>;
  label: string;
  value: string;
  detail: string;
  tone: string;
}> = ({ icon: Icon, label, value, detail, tone }) => (
  <div className={`${SUBPANEL_CLASS} p-4`}>
    <div className="flex items-center gap-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${tone}`}>
        <Icon className="h-4 w-4" strokeWidth={2.25} />
      </div>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</div>
        <div className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">{value}</div>
      </div>
    </div>
    <div className="mt-3 text-[11px] font-medium text-slate-500 dark:text-slate-400">{detail}</div>
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
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Ranking Snapshot</div>
          <div className="mt-2 text-sm font-bold text-slate-900 dark:text-white">Buckets and entity leaders</div>
        </div>
        <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
          {rankedBuckets.length} buckets
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_0.95fr]">
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Busiest buckets</div>
          <div className="space-y-2">
            {rankedBuckets.map((bucket, index) => {
              const churn = bucket.metrics.insertions + bucket.metrics.deletions;
              return (
                <div key={bucket.bucketStart} className="rounded-2xl border border-black/[0.05] bg-white/60 p-3 dark:border-white/[0.05] dark:bg-void-900/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        {index + 1}. {bucket.label}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        {bucket.metrics.prCount.toLocaleString()} PRs · {getMetricCount(bucket.metrics.mergeConflictCount).toLocaleString()} conflicts
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-slate-900 dark:text-white">{churn.toLocaleString()}</div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">churn</div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    <span>+{bucket.metrics.insertions.toLocaleString()}</span>
                    <span>-{bucket.metrics.deletions.toLocaleString()}</span>
                    <span>{bucket.metrics.filesChanged.toLocaleString()} files</span>
                    <span>{bucket.metrics.mergedCount.toLocaleString()} merged</span>
                  </div>
                </div>
              );
            })}
            {rankedBuckets.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-6 text-sm text-slate-400 dark:border-white/[0.08]">
                No bucket data is available yet.
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Entity leaders</div>
          <div className="rounded-2xl border border-black/[0.05] bg-white/60 p-3 dark:border-white/[0.05] dark:bg-void-900/30">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Top task</div>
            <div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{topTask ? topTask.label : "No task leader yet"}</div>
            {topTask ? (
              <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                {topTask.metrics.prCount.toLocaleString()} PRs · {topTask.metrics.mergedCount.toLocaleString()} merged · {getMetricCount(topTask.metrics.mergeConflictCount).toLocaleString()} conflicts
              </div>
            ) : null}
          </div>
          <div className="rounded-2xl border border-black/[0.05] bg-white/60 p-3 dark:border-white/[0.05] dark:bg-void-900/30">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Top sprint</div>
            <div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{topSprint ? topSprint.label : "No sprint leader yet"}</div>
            {topSprint ? (
              <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
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

  if (!gitStats.totals.insertions && !gitStats.totals.deletions && !gitStats.totals.filesChanged && !gitStats.totals.prCount && !gitStats.totals.mergedCount && !gitStats.tasks.length && !gitStats.sprints.length) {
    return (
      <div className="rounded-[2rem] border border-dashed border-black/[0.08] px-8 py-16 text-center text-sm text-slate-400 dark:border-white/[0.08]">
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
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              <GitPullRequest className="h-3.5 w-3.5 text-amber-500" strokeWidth={2.2} aria-hidden="true" />
              Git Operational Ledger
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              Churn, pull requests, and merge pressure
            </div>
            <div className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
              Review task and sprint git output by code churn, changed files, PR throughput, merges, and conflict signals.
            </div>
          </div>
          <div className={`${SUBPANEL_CLASS} p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Total Churn</div>
                <div className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{totalChurn.toLocaleString()}</div>
              </div>
              <div className={`inline-flex items-center gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                <Hash className="h-3 w-3 text-cyan-500" strokeWidth={2.3} aria-hidden="true" />
                {gitStats.tasks.length.toLocaleString()} tasks · {gitStats.sprints.length.toLocaleString()} sprints
              </div>
            </div>
            <div className="mt-4">
              <ChurnFlowBar insertions={gitStats.totals.insertions} deletions={gitStats.totals.deletions} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400 ${CHIP_CLASS}`}>+{gitStats.totals.insertions.toLocaleString()} insertions</span>
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-rose-600 dark:text-rose-400 ${CHIP_CLASS}`}>-{gitStats.totals.deletions.toLocaleString()} deletions</span>
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-orange-600 dark:text-orange-400 ${CHIP_CLASS}`}>{conflictCount.toLocaleString()} conflicts</span>
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-400 ${CHIP_CLASS}`}>{formatPercent(mergeRate)} merge rate</span>
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
          tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        />
        <GitStatCard
          icon={MinusSquare}
          label="Deletions"
          value={gitStats.totals.deletions.toLocaleString()}
          detail={`${gitStats.totals.filesChanged.toLocaleString()} files changed`}
          tone="bg-rose-500/10 text-rose-600 dark:text-rose-400"
        />
        <GitStatCard
          icon={FileEdit}
          label="Files Changed"
          value={gitStats.totals.filesChanged.toLocaleString()}
          detail={`${gitStats.totals.prCount.toLocaleString()} PRs in scope`}
          tone="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
        />
        <GitStatCard
          icon={GitPullRequest}
          label="Pull Requests"
          value={gitStats.totals.prCount.toLocaleString()}
          detail={`${gitStats.totals.mergedCount.toLocaleString()} merged`}
          tone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
        />
        <GitStatCard
          icon={GitMerge}
          label="Merges"
          value={gitStats.totals.mergedCount.toLocaleString()}
          detail={`${getMetricCount(gitStats.totals.mergeConflictCount).toLocaleString()} conflicts in scope`}
          tone="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
        />
        <GitStatCard
          icon={AlertTriangle}
          label="Merge Conflicts"
          value={getMetricCount(gitStats.totals.mergeConflictCount).toLocaleString()}
          detail={`${gitStats.totals.prCount > 0 ? Math.round((getMetricCount(gitStats.totals.mergeConflictCount) / gitStats.totals.prCount) * 100) : 0}% of PRs`}
          tone="bg-orange-500/10 text-orange-600 dark:text-orange-400"
        />
      </section>

      <GitRankingPanel buckets={gitStats.buckets} tasks={gitStats.tasks} sprints={gitStats.sprints} />

      <div
        role="tablist"
        aria-label="Git telemetry leaderboards"
        className="sticky top-3 z-20 grid max-w-full grid-cols-1 gap-1 rounded-[var(--stats-subpanel-radius)] border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-subpanel)] p-1 shadow-[var(--stats-subpanel-shadow)] backdrop-blur-xl sm:grid-cols-2"
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") {
            return;
          }
          event.preventDefault();
          const currentIndex = leaderboardTabs.findIndex((tab) => tab.id === activeTab);
          const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
              ? leaderboardTabs.length - 1
              : event.key === "ArrowRight"
                ? (currentIndex + 1) % leaderboardTabs.length
                : (currentIndex - 1 + leaderboardTabs.length) % leaderboardTabs.length;
          setActiveTab(leaderboardTabs[nextIndex]?.id ?? "tasks");
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
              role="tab"
              aria-selected={isActive}
              aria-controls={`git-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={`grid min-h-12 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[calc(var(--stats-subpanel-radius)-0.35rem)] px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.18em] transition-all motion-safe:duration-200 ${
                isActive
                  ? "bg-slate-900 text-white shadow-sm dark:bg-white dark:text-void-900"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
              <span className="truncate">{tab.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums ${CHIP_CLASS}`}>
                {tab.count.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`git-panel-${activeTab}`} aria-labelledby={`git-tab-${activeTab}`}>
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
