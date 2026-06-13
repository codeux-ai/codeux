import type {
    ExecutionRuntimeEventSummary,
    ExecutionSprintRunSummary,
    ExecutionTaskDispatchSummary,
    Subtask,
} from "../../types.js";
import { projectLiveTask, pickLatestTaskDispatch, findActiveQuotaWait } from "./live-task-runtime.js";
import { getTaskProgressPhase, getLiveTaskProgressPhase, type TaskProgressPhase } from "../../lib/task-progress.js";
import { EMPTY_RUNTIME_STATS } from "./live-session-config.js";
import type { LiveTaskTimingSummary } from "./live-stats.js";

export type TaskFilter = "All" | "Running" | "Completed" | "Failed" | "Pending";

const FILTER_STATUS_MAP: Record<TaskFilter, string | null> = {
    All: null,
    Running: "RUNNING",
    Completed: "COMPLETED",
    Failed: "FAILED",
    Pending: "PENDING",
};

export interface TaskCardItem {
    key: string;
    task: Subtask;
    phase: TaskProgressPhase;
    taskTiming: LiveTaskTimingSummary | null;
    events: ExecutionRuntimeEventSummary[];
    isRerunning: boolean;
    isForceCompleting: boolean;
    forceCompleteError: string | null;
    dispatchInfo: {
        errorMessage: string | null;
        startedAt: string | null;
        finishedAt: string | null;
        status: string | null;
    } | null;
}

export interface LiveSessionRuntimeStateArgs {
    tasksWithLiveActivities: Subtask[];
    sprintDispatches: ExecutionTaskDispatchSummary[];
    sprintEvents: ExecutionRuntimeEventSummary[];
    activeFilter: TaskFilter;
    optimisticallyCompletedTaskIds: Set<string>;
    rerunningIds: Set<string>;
    forceCompletePendingIds: Set<string>;
    forceCompleteErrorByTaskId: Map<string, string>;
    taskTimingMap: Map<string, LiveTaskTimingSummary>;
    hasSprintContext: boolean;
}

export function deriveLiveSessionRuntimeStateHelper(args: LiveSessionRuntimeStateArgs) {
    const {
        tasksWithLiveActivities,
        sprintDispatches,
        sprintEvents,
        activeFilter,
        optimisticallyCompletedTaskIds,
        rerunningIds,
        forceCompletePendingIds,
        forceCompleteErrorByTaskId,
        taskTimingMap,
        hasSprintContext,
    } = args;

    if (!hasSprintContext) {
        return {
            visibleTasksWithLiveActivities: [],
            visibleStats: EMPTY_RUNTIME_STATS,
            filteredTasks: [],
            taskCounts: {
                All: 0,
                Running: 0,
                Completed: 0,
                Failed: 0,
                Pending: 0,
            },
            taskCardItems: [],
        };
    }

    const visibleTasksWithLiveActivities = tasksWithLiveActivities.map((task) =>
        projectLiveTask(task, sprintDispatches, sprintEvents)
    );

    const taskEventsByRecordId = new Map<string, ExecutionRuntimeEventSummary[]>();
    const taskEventsByTaskKey = new Map<string, ExecutionRuntimeEventSummary[]>();

    for (const event of sprintEvents) {
        if (event.taskId) {
            const existing = taskEventsByRecordId.get(event.taskId) || [];
            existing.push(event);
            taskEventsByRecordId.set(event.taskId, existing);
        }
        if (event.taskKey) {
            const existing = taskEventsByTaskKey.get(event.taskKey) || [];
            existing.push(event);
            taskEventsByTaskKey.set(event.taskKey, existing);
        }
    }

    const visibleStats = { ...EMPTY_RUNTIME_STATS };
    visibleStats.total = visibleTasksWithLiveActivities.length;

    let pendingCount = 0;
    const filteredTasks: Subtask[] = [];
    const targetStatus = FILTER_STATUS_MAP[activeFilter];

    for (const task of visibleTasksWithLiveActivities) {
        // Stats computation in one pass
        if (task.status === "RUNNING") visibleStats.running++;
        if (task.status === "CODING_COMPLETED") visibleStats.codingCompleted++;
        if (task.status === "COMPLETED") visibleStats.completed++;
        if (task.status === "FAILED") visibleStats.failed++;
        
        if (task.merge_indicator === "CI") visibleStats.ci++;
        if (task.merge_indicator === "QA_PENDING") visibleStats.qa++;
        if (task.merge_indicator === "AUTOMERGE") visibleStats.automerge++;
        if (task.merge_indicator === "MERGED" || task.is_merged) visibleStats.merged++;
        if (task.merge_indicator === "MERGE_BLOCKED") visibleStats.mergeBlocked++;
        if (task.merge_indicator === "MERGE_CONFLICT") visibleStats.mergeConflicts++;

        const phase = getTaskProgressPhase(task);
        const isPending = phase === "PENDING" || phase === "BLOCKED" || phase === "QUOTA";
        if (isPending) pendingCount++;

        if (
            activeFilter === "All" ||
            (activeFilter === "Pending" && isPending) ||
            (activeFilter !== "Pending" && targetStatus !== null && phase === targetStatus)
        ) {
            filteredTasks.push(task);
        }
    }

    const taskCounts = {
        All: visibleTasksWithLiveActivities.length,
        Running: visibleStats.running,
        Completed: visibleStats.completed,
        Failed: visibleStats.failed,
        Pending: pendingCount,
    };

    const taskCardItems: TaskCardItem[] = filteredTasks.map((task) => {
        const taskRuntimeId = task.record_id || task.id;
        const optimisticTask: Subtask = optimisticallyCompletedTaskIds.has(taskRuntimeId)
            ? { ...task, status: "COMPLETED" as const }
            : task;
        
        const latestDispatch = pickLatestTaskDispatch(task, sprintDispatches);
        const taskEvents = (task.record_id && taskEventsByRecordId.get(task.record_id))
            || taskEventsByTaskKey.get(task.id)
            || [];

        const dispatchPhase = optimisticallyCompletedTaskIds.has(taskRuntimeId)
            ? "COMPLETED" as const
            : getLiveTaskProgressPhase({ task: optimisticTask, dispatch: latestDispatch });

        const currentDispatchEvents = latestDispatch
            ? taskEvents.filter((e) =>
                (latestDispatch.taskRunId && e.taskRunId === latestDispatch.taskRunId)
                || (latestDispatch.id && e.dispatchId === latestDispatch.id),
              )
            : [];
        
        const activeQuotaWait = ["FAILED", "BLOCKED", "QUOTA", "COMPLETED"].includes(dispatchPhase)
            ? null
            : findActiveQuotaWait(currentDispatchEvents);
        
        const taskPhase = activeQuotaWait ? "QUOTA" as const : dispatchPhase;
        const showDispatchError = activeQuotaWait
            ? `Provider quota exhausted — waiting for reset. [RETRY_AFTER:${activeQuotaWait.retryAfterIso}]`
            : latestDispatch && ["FAILED", "BLOCKED", "QUOTA"].includes(taskPhase)
                ? latestDispatch.errorMessage
                : null;

        return {
            key: taskRuntimeId,
            task: optimisticTask,
            phase: taskPhase,
            taskTiming: taskTimingMap.get(taskRuntimeId) || taskTimingMap.get(task.id) || null,
            events: taskEvents,
            isRerunning: rerunningIds.has(taskRuntimeId),
            isForceCompleting: forceCompletePendingIds.has(taskRuntimeId),
            forceCompleteError: forceCompleteErrorByTaskId.get(taskRuntimeId) || null,
            dispatchInfo: (latestDispatch || activeQuotaWait) ? {
                errorMessage: showDispatchError || null,
                startedAt: latestDispatch?.startedAt ?? null,
                finishedAt: latestDispatch?.finishedAt ?? null,
                status: latestDispatch?.status ?? null,
            } : null,
        };
    });

    return {
        visibleTasksWithLiveActivities,
        visibleStats,
        filteredTasks,
        taskCounts,
        taskCardItems,
    };
}
