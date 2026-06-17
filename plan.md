1. **Create Sprints Page View Models File**
   - Use the `write_file` tool to create `dashboard/src/v2/pages/sprints/sprints-page-view-models.ts`.
   - Export pure functions (e.g., `buildActualActiveRunsMap`, `buildActiveRunsMap`, `buildPauseResumeRunsMap`, `buildDisplaySprints`, `buildSortedSprints`, `buildShowcaseSprints`, `countSprintsByStatus`, `buildPlanningConnection`, `buildPlanningRoute`, `buildVirtualProviders`).
   - Move the logic from `useSprintsPageData`'s `useMemo` hooks into these pure functions.

2. **Update `useSprintsPageData.ts`**
   - Use the `replace_with_git_merge_diff` tool to replace the `useMemo` blocks with calls to the extracted pure functions.
   - Import the new view-model helper functions into `dashboard/src/v2/pages/sprints/use-sprints-page-data.ts`.

3. **Add Tests for View Models**
   - Use the `write_file` tool to create `tests/dashboard/v2/pages/sprints/sprints-page-view-models.test.ts`.
   - Write tests covering connection role/status priority ordering, virtual worker route labeling, suppressed running sprint handling, optimistic status override, and sprint count calculations.

4. **Update Dashboard Guide**
   - Use the `replace_with_git_merge_diff` tool to update `docs/dashboard/dashboard-guide.md` with a note regarding the Sprints page data/view-model split under the Frontend Architecture Notes section.

5. **Update `TelemetrySectionsSection.tsx`**
   - Add the necessary `import { formatDuration } from "../stats-utils.js";` and `CHIP_CLASS` import.
   - Use `replace_with_git_merge_diff` with this exact block:
```
<<<<<<< SEARCH
import { Layers3 } from "lucide-preact";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";
import {
  PANEL_CLASS,
  StudioHeader,
} from "./StatsShared.js";
import { TelemetryLedgerTabs } from "./TelemetryLedgerTabs.js";

export interface TelemetrySectionsSectionProps {
  stats: ProjectExecutionStatsSnapshot;
}

export const TelemetrySectionsSection: FunctionComponent<TelemetrySectionsSectionProps> = ({ stats }) => {
  return (
    <section className="space-y-6">
      <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
        <StudioHeader
          icon={Layers3}
          eyebrow="Telemetry Ledgers"
          title="Task and sprint telemetry"
          description="Deep operational ledgers for execution scopes, redesigned around search, recency, sort controls, and richer usage breakdowns."
        />
      </div>
=======
import { Layers3 } from "lucide-preact";
import type { ProjectExecutionStatsSnapshot } from "../../../types.js";
import { formatDuration } from "../stats-utils.js";
import {
  PANEL_CLASS,
  StudioHeader,
  CHIP_CLASS,
} from "./StatsShared.js";
import { TelemetryLedgerTabs } from "./TelemetryLedgerTabs.js";

export interface TelemetrySectionsSectionProps {
  stats: ProjectExecutionStatsSnapshot;
}

export const TelemetrySectionsSection: FunctionComponent<TelemetrySectionsSectionProps> = ({ stats }) => {
  return (
    <section className="space-y-6">
      <div className={`${PANEL_CLASS} rounded-[2.2rem] p-6 md:p-7`}>
        <div className="mb-6 flex flex-wrap gap-2">
          <span className={CHIP_CLASS}>{stats.purposes.length} Purpose Types</span>
          <span className={CHIP_CLASS}>{formatDuration(stats.usage.activeTimeMs)} Active Time</span>
        </div>
        <StudioHeader
          icon={Layers3}
          eyebrow="Telemetry Ledgers"
          title="Task and sprint telemetry"
          description={`Deep operational ledgers for execution scopes, redesigned around search, recency, sort controls, and richer usage breakdowns. — ${stats.range.label}`}
        />
      </div>
>>>>>>> REPLACE
```

6. **Update `GitTelemetryTab.tsx`**
   - Import `SUBPANEL_CLASS` and add the new calculations/blocks. We will perform multiple replacements.

First:
```
<<<<<<< SEARCH
import {
  CHIP_CLASS,
  INPUT_CLASS,
  LEDGER_ROW_MODERN_CLASS,
  PANEL_CLASS,
  SignalMetricCard,
  SortButton,
  TokenChip,
  ChurnFlowBar,
} from "./StatsShared.js";
=======
import {
  CHIP_CLASS,
  INPUT_CLASS,
  LEDGER_ROW_MODERN_CLASS,
  PANEL_CLASS,
  SUBPANEL_CLASS,
  SignalMetricCard,
  SortButton,
  TokenChip,
  ChurnFlowBar,
} from "./StatsShared.js";
>>>>>>> REPLACE
```

Second (the metrics calculation & the new header block inside `GitTelemetryLedger`):
```
<<<<<<< SEARCH
  const {
    visibleItems,
    sentinelRef,
    scrollContainerRef,
  } = useProgressiveList(filteredItems, { initialCount: 12, stepCount: 8 });

  return (
    <div className={`${PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
=======
  const {
    visibleItems,
    sentinelRef,
    scrollContainerRef,
  } = useProgressiveList(filteredItems, { initialCount: 12, stepCount: 8 });

  const totalPRs = items.reduce((s, i) => s + i.metrics.prCount, 0);
  const mergedPRs = items.reduce((s, i) => s + i.metrics.mergedCount, 0);
  const totalInsertions = items.reduce((s, i) => s + i.metrics.insertions, 0);

  return (
    <div className={`${PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
>>>>>>> REPLACE
```

Third (injecting the 4 summary metric tiles):
```
<<<<<<< SEARCH
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="relative">
=======
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Total PRs</div>
            <div className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">{totalPRs.toLocaleString()}</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Merged PRs</div>
            <div className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">{mergedPRs.toLocaleString()}</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Merge Rate</div>
            <div className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">{formatPercent(mergedPRs / Math.max(1, totalPRs))}</div>
          </div>
          <div className={`${SUBPANEL_CLASS} flex flex-col items-center justify-center text-center !p-4`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">+lines</div>
            <div className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">{totalInsertions.toLocaleString()}</div>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="relative">
>>>>>>> REPLACE
```

Fourth (add the file count chip to the entity):
```
<<<<<<< SEARCH
                            <div className="truncate text-base font-black tracking-tight text-slate-900 dark:text-white">{item.label}</div>
                            {item.secondaryLabel ? (
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300 ${CHIP_CLASS}`}>
                                  {item.secondaryLabel}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="hidden shrink-0 grid-cols-3 gap-6 text-right lg:grid">
=======
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
                        <div className="hidden shrink-0 grid-cols-3 gap-6 text-right lg:grid">
>>>>>>> REPLACE
```

Fifth (updating "Churn" to "Code Churn" with an inline ChurnFlowBar in lg:grid view):
```
<<<<<<< SEARCH
                        <div className="hidden shrink-0 grid-cols-3 gap-6 text-right lg:grid">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Churn</div>
                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{itemChurn.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">PRs</div>
=======
                        <div className="hidden shrink-0 grid-cols-3 gap-6 text-right lg:grid">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Code Churn</div>
                            <div className="mt-1 flex items-center justify-end gap-3 text-lg font-black tracking-tight text-slate-900 dark:text-white">
                              {itemChurn.toLocaleString()}
                              <div className="w-16 h-1.5">
                                <ChurnFlowBar insertions={item.metrics.insertions} deletions={item.metrics.deletions} />
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">PRs</div>
>>>>>>> REPLACE
```

Sixth (updating "Churn" to "Code Churn" in lg:hidden view):
```
<<<<<<< SEARCH
                      <div className="grid grid-cols-3 gap-4 lg:hidden">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Churn</div>
                          <div className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">{itemChurn.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">PRs</div>
=======
                      <div className="grid grid-cols-3 gap-4 lg:hidden">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Code Churn</div>
                          <div className="mt-1 flex items-center gap-3 text-lg font-black tracking-tight text-slate-900 dark:text-white">
                            {itemChurn.toLocaleString()}
                            <div className="w-16 h-1.5">
                              <ChurnFlowBar insertions={item.metrics.insertions} deletions={item.metrics.deletions} />
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">PRs</div>
>>>>>>> REPLACE
```

7. **Pre-commit Steps**
   - Run `pre_commit_instructions` tool to execute pre commit steps to ensure proper testing, verification, review, and reflection are done.
   - Run technical quality gates: `cd dashboard && pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, and `pnpm run build`.

8. **Submit Changes**
   - Run verification (e.g., `pnpm run typecheck:dashboard`, `pnpm run test:dashboard -- tests/dashboard/v2/pages/sprints/sprints-page-view-models.test.ts`).
   - Use the `submit` tool to create a branch and push changes.
