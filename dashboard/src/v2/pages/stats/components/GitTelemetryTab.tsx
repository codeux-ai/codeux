import type { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
import { GitCommit, GitMerge, GitPullRequest, FileEdit, PlusSquare, MinusSquare } from "lucide-preact";
import { useProgressiveList } from "../../../../hooks/use-progressive-list.js";
import type { ExecutionGitStatsEntitySummary, ExecutionGitStatsSummary } from "../../../types.js";
import {
  CHIP_CLASS,
  INPUT_CLASS,
  LEDGER_ROW_CLASS,
  PANEL_CLASS,
  SUBPANEL_CLASS,
  SignalMetricCard,
  SortButton,
  TokenChip,
} from "./StatsShared.js";

type GitLedgerSortKey = "insertions" | "deletions" | "filesChanged" | "prCount" | "mergedCount" | "name";

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
        return leftValue.localeCompare(rightValue);
      }
      return Number(rightValue) - Number(leftValue);
    });
  }, [items, query, sortKey]);

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
              Search, sort, and compare {kindLabel} by code churn, PRs opened, and changes merged.
            </div>
          </div>
          <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
            {filteredItems.length} {kindLabel}
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <input
            type="text"
            value={query}
            onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
            placeholder={`Search ${kindLabel}`}
            className={INPUT_CLASS}
          />
          <div className="flex flex-wrap gap-2">
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
                onClick={() => setSortKey(value)}
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
                return (
                  <div key={item.id} className={LEDGER_ROW_CLASS}>
                    <div className="flex items-start gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-black/[0.06] bg-white/75 text-sm font-black text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.07)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/55 dark:text-white dark:shadow-[0_12px_28px_rgba(0,0,0,0.22)]">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0">
                            <div className="truncate text-base font-black tracking-tight text-slate-900 dark:text-white">{item.label}</div>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {item.secondaryLabel ? (
                                <span className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                                  {item.secondaryLabel}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <TokenChip icon={PlusSquare} label="Insertions" value={`+${item.metrics.insertions}`} tone="border-emerald-500/16 bg-emerald-500/8 text-emerald-600 dark:text-emerald-400" />
                          <TokenChip icon={MinusSquare} label="Deletions" value={`-${item.metrics.deletions}`} tone="border-rose-500/16 bg-rose-500/8 text-rose-600 dark:text-rose-400" />
                          <TokenChip icon={FileEdit} label="Files" value={item.metrics.filesChanged} tone="border-cyan-500/16 bg-cyan-500/8 text-cyan-600 dark:text-cyan-400" />
                          <TokenChip icon={GitPullRequest} label="PRs" value={item.metrics.prCount} tone="border-amber-500/16 bg-amber-500/8 text-amber-600 dark:text-amber-400" />
                          <TokenChip icon={GitMerge} label="Merged" value={item.metrics.mergedCount} tone="border-indigo-500/16 bg-indigo-500/8 text-indigo-600 dark:text-indigo-400" />
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

export const GitTelemetryTab: FunctionComponent<{ gitStats: ExecutionGitStatsSummary }> = ({ gitStats }) => {
  const [activeTab, setActiveTab] = useState<"tasks" | "sprints">("tasks");

  const codeChurnSeries = useMemo(() => {
    const values = gitStats.buckets.map((b) => b.metrics.insertions + b.metrics.deletions);
    return values.some((v) => v > 0) ? values : new Array(Math.max(gitStats.buckets.length, 7)).fill(0);
  }, [gitStats.buckets]);

  const prSeries = useMemo(() => {
    const values = gitStats.buckets.map((b) => b.metrics.prCount);
    return values.some((v) => v > 0) ? values : new Array(Math.max(gitStats.buckets.length, 7)).fill(0);
  }, [gitStats.buckets]);

  const mergeSeries = useMemo(() => {
    const values = gitStats.buckets.map((b) => b.metrics.mergedCount);
    return values.some((v) => v > 0) ? values : new Array(Math.max(gitStats.buckets.length, 7)).fill(0);
  }, [gitStats.buckets]);

  if (!gitStats.totals.insertions && !gitStats.totals.deletions && !gitStats.totals.filesChanged && !gitStats.totals.prCount && !gitStats.totals.mergedCount && !gitStats.tasks.length && !gitStats.sprints.length) {
    return (
      <div className="rounded-[2rem] border border-dashed border-black/[0.08] px-8 py-16 text-center text-sm text-slate-400 dark:border-white/[0.08]">
        No git telemetry available in this window.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <SignalMetricCard
          label="Code Churn"
          value={(gitStats.totals.insertions + gitStats.totals.deletions).toLocaleString()}
          detail={`+${gitStats.totals.insertions.toLocaleString()} insertions · -${gitStats.totals.deletions.toLocaleString()} deletions`}
          accentHex="#10B981"
          hoverTint="group-hover:bg-emerald-500/[0.03]"
          sparkline={codeChurnSeries}
          signalLabel="Lines"
        />
        <SignalMetricCard
          label="Pull Requests"
          value={gitStats.totals.prCount.toLocaleString()}
          detail={`${gitStats.totals.filesChanged.toLocaleString()} files changed across ${gitStats.totals.prCount.toLocaleString()} PRs`}
          accentHex="#F59E0B"
          hoverTint="group-hover:bg-amber-500/[0.03]"
          sparkline={prSeries}
          signalLabel="Volume"
        />
        <SignalMetricCard
          label="Merges"
          value={gitStats.totals.mergedCount.toLocaleString()}
          detail={`${gitStats.totals.mergedCount.toLocaleString()} PRs merged successfully in this window`}
          accentHex="#6366F1"
          hoverTint="group-hover:bg-indigo-500/[0.03]"
          sparkline={mergeSeries}
          signalLabel="Confirmed"
        />
      </section>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setActiveTab("tasks")}
          className={`px-4 py-2 text-sm font-bold transition-colors ${
            activeTab === "tasks"
              ? "text-slate-900 dark:text-white"
              : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          }`}
        >
          Task Leaderboard
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("sprints")}
          className={`px-4 py-2 text-sm font-bold transition-colors ${
            activeTab === "sprints"
              ? "text-slate-900 dark:text-white"
              : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          }`}
        >
          Sprint Leaderboard
        </button>
      </div>

      <div>
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
