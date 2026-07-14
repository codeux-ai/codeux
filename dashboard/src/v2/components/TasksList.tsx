import type { FunctionComponent } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";

import { TaskRow } from "./ui/TaskRow.js";
import { SprintStreamRow } from "./ui/SprintStreamRow.js";
import { FilterStrip } from "./ui/FilterStrip.js";
import { SkeletonRow } from "./layout/SkeletonLoader.js";
import { EmptyState } from "./ui/EmptyState.js";
import { deriveActiveSprintIds, filterOverviewTasks, filterTasksToActiveSprints, type OverviewTaskFilter } from "../lib/overview-streams.js";
import { useOverviewStreamActions } from "../hooks/use-overview-stream-actions.js";
import { useListReorder } from "../lib/motion/use-list-reorder.js";
import { useProgressiveList } from "../hooks/use-progressive-list.js";
import { DEFAULT_LIST_WINDOW } from "../lib/list-window.js";
import { useDashboardI18n } from "../i18n/index.js";
import { overviewMessages } from "../i18n/messages/overview.js";

export const TasksList: FunctionComponent<{ pageData: ReturnType<typeof import("../hooks/use-overview-page-data.js").useOverviewPageData> }> = ({ pageData }) => {
    const listRef = useRef<HTMLDivElement>(null);
    const [activeFilter, setActiveFilter] = useState<OverviewTaskFilter>("all");
    const { formatNumber, locale, translate, translatePlural } = useDashboardI18n();

    const filterOptions = useMemo(() => [
        { value: "all", label: translate(overviewMessages, "filterAllTasks") },
        { value: "running", label: translate(overviewMessages, "filterRunning") },
        { value: "queued", label: translate(overviewMessages, "filterQueued") },
        { value: "completed", label: translate(overviewMessages, "filterCompleted") },
    ] as const, [translate]);

    const handleFilterChange = (newFilter: OverviewTaskFilter) => {
        setActiveFilter(newFilter);
    };

    const handleClearFilter = () => {
        setActiveFilter("all");
    };

    const { sprints, tasks, execution, selectedProject, isLoading } = pageData;

    const streamActions = useOverviewStreamActions(selectedProject?.id ?? null, execution);

    const sprintById = useMemo(() => new Map(sprints.map((sprint) => [sprint.id, sprint])), [sprints]);
    const activeSprintIds = useMemo(() => deriveActiveSprintIds(sprints), [sprints]);
    const activeTasks = useMemo(() => filterTasksToActiveSprints(tasks, activeSprintIds), [tasks, activeSprintIds]);

    const filteredTasks = useMemo(() => filterOverviewTasks(activeTasks, activeFilter), [activeTasks, activeFilter]);
    const visibleTasks = useProgressiveList(filteredTasks, {
        initialCount: DEFAULT_LIST_WINDOW,
        incrementCount: DEFAULT_LIST_WINDOW,
        delay: 100,
        resetKey: activeFilter,
    });

    const sprintTaskCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const task of filteredTasks) {
            counts.set(task.sprintId, (counts.get(task.sprintId) ?? 0) + 1);
        }
        return counts;
    }, [filteredTasks]);

    // Group the active-sprint tasks under their sprint so each task visibly belongs to a
    // sprint. Most recent sprint first; only sprints with matching tasks appear.
    const sprintGroups = useMemo(() => {
        const grouped = new Map<string, typeof visibleTasks>();
        for (const task of visibleTasks) {
            const list = grouped.get(task.sprintId) ?? [];
            list.push(task);
            grouped.set(task.sprintId, list);
        }
        return Array.from(grouped.entries())
            .map(([sprintId, groupedTasks]) => ({
                sprintId,
                sprint: sprintById.get(sprintId) ?? null,
                tasks: groupedTasks,
                totalTasks: sprintTaskCounts.get(sprintId) ?? groupedTasks.length,
            }))
            .sort((a, b) => (b.sprint?.number ?? 0) - (a.sprint?.number ?? 0));
    }, [visibleTasks, sprintById, sprintTaskCounts]);

    useListReorder(listRef, [activeFilter, visibleTasks], {
        flipIdSelector: '[data-flip-id]',
        stagger: 0.03
    });

    return (
        <div className="w-full relative z-10 px-2">
            {/* Section Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 md:mb-12 gap-6 sm:gap-8">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
                    <h2 className="text-lg md:text-xl font-bold tracking-tight text-slate-900 dark:text-white font-display">{translate(overviewMessages, "activeStreams")}</h2>
                    <div className="w-full sm:w-auto">
                        <FilterStrip
                            options={filterOptions}
                            active={activeFilter}
                            onChange={handleFilterChange}
                            showClear={activeFilter !== "all"}
                            onClear={handleClearFilter}
                            ariaLabel={translate(overviewMessages, "activeStreamFilters")}
                            clearLabel={translate(overviewMessages, "clearFilters")}
                            clearAriaLabel={translate(overviewMessages, "clearFilters")}
                        />
                    </div>
                </div>
                <div className="text-xs font-semibold text-slate-400 dark:text-slate-600 font-mono hidden sm:block">
                    {translatePlural(overviewMessages, "activeCount", filteredTasks.length, { formattedCount: formatNumber(filteredTasks.length) })}
                </div>
            </div>

            {/* Task rows */}
            <div ref={listRef} className="flex flex-col w-full space-y-3" role="region" aria-label={translate(overviewMessages, "activeStreamTasks")} aria-busy={isLoading ? "true" : undefined}>
                {isLoading ? (
                    <div role="status" aria-live="polite" aria-busy="true" aria-label={translate(overviewMessages, "loadingActiveStreamTasks")}>
                        <SkeletonRow />
                        <SkeletonRow />
                        <SkeletonRow />
                        <SkeletonRow />
                        <SkeletonRow />
                    </div>
                ) : filteredTasks.length > 0 ? (
                    sprintGroups.flatMap((group) => [
                        group.sprint ? (
                            <div key={`sprint-${group.sprintId}`} data-flip-id={`sprint-${group.sprintId}`}>
                                <SprintStreamRow
                                    sprint={group.sprint}
                                    taskCount={group.totalTasks}
                                    state={streamActions.getSprintState(group.sprintId)}
                                    onStartStop={() => streamActions.startStopSprint(group.sprintId)}
                                    onPauseResume={() => streamActions.pauseResumeSprint(group.sprintId)}
                                />
                            </div>
                        ) : null,
                        ...group.tasks.map((task) => (
                            <div key={task.id} data-flip-id={task.id} className="task-flip-item sm:pl-4">
                                <TaskRow
                                    task={task}
                                    state={streamActions.getTaskState(task)}
                                    onPlayStop={() => streamActions.playStopTask(task)}
                                />
                            </div>
                        )),
                    ])
                ) : (
                    <div data-flip-id="empty-state" role="status" aria-label={translate(overviewMessages, "noActiveStreams")} aria-live="polite">
                        <EmptyState
                            title={translate(overviewMessages, "noActiveStreams")}
                            description={translate(overviewMessages, "noActiveStreamsDescription")}
                            icon={
                                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                                </svg>
                            }
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
