import { describe, expect, it } from "vitest";
import { deriveLiveSessionRuntimeStateHelper } from "../../../dashboard/src/v2/lib/live-session-runtime-state.js";
import type { ExecutionRuntimeEventSummary, ExecutionTaskDispatchSummary, Subtask } from "../../../dashboard/src/types.js";
import { EMPTY_RUNTIME_STATS } from "../../../dashboard/src/v2/lib/live-session-config.js";

function createSubtask(overrides: Partial<Subtask> = {}): Subtask {
    return {
        id: "T01",
        title: "Test Task",
        prompt: "Do something",
        depends_on: [],
        is_independent: true,
        status: "PENDING",
        ...overrides,
    };
}

function createDispatch(overrides: Partial<ExecutionTaskDispatchSummary> = {}): ExecutionTaskDispatchSummary {
    return {
        id: "D01",
        taskId: "T01",
        status: "running",
        startedAt: "2026-06-13T10:00:00Z",
        ...overrides,
    };
}

function createEvent(overrides: Partial<ExecutionRuntimeEventSummary> = {}): ExecutionRuntimeEventSummary {
    return {
        id: "E01",
        eventType: "provider_activity",
        createdAt: "2026-06-13T10:00:05Z",
        payload: {},
        ...overrides,
    };
}

describe("deriveLiveSessionRuntimeStateHelper", () => {
    const defaultArgs = {
        tasksWithLiveActivities: [],
        sprintDispatches: [],
        sprintEvents: [],
        activeFilter: "All" as const,
        optimisticallyCompletedTaskIds: new Set<string>(),
        rerunningIds: new Set<string>(),
        forceCompletePendingIds: new Set<string>(),
        forceCompleteErrorByTaskId: new Map<string, string>(),
        taskTimingMap: new Map(),
        hasSprintContext: true,
    };

    it("returns empty state when no sprint context is present", () => {
        const result = deriveLiveSessionRuntimeStateHelper({ ...defaultArgs, hasSprintContext: false });
        expect(result.visibleStats).toEqual(EMPTY_RUNTIME_STATS);
        expect(result.taskCardItems).toEqual([]);
    });

    it("computes pending counts correctly", () => {
        const tasks = [
            createSubtask({ id: "T1", status: "PENDING" }),
            createSubtask({ id: "T2", status: "RUNNING" }),
            createSubtask({ id: "T3", status: "COMPLETED" }),
            createSubtask({ id: "T4", status: "BLOCKED" }),
        ];
        const result = deriveLiveSessionRuntimeStateHelper({ ...defaultArgs, tasksWithLiveActivities: tasks });
        expect(result.taskCounts.Pending).toBe(2); // T1 and T4
        expect(result.taskCounts.All).toBe(4);
    });

    it("computes merge indicator counts correctly", () => {
        const tasks = [
            createSubtask({ id: "T1", status: "COMPLETED", merge_indicator: "CI" }),
            createSubtask({ id: "T2", status: "COMPLETED", merge_indicator: "QA_PENDING" }),
            createSubtask({ id: "T3", status: "COMPLETED", merge_indicator: "AUTOMERGE" }),
            createSubtask({ id: "T4", status: "COMPLETED", is_merged: true }),
        ];
        const result = deriveLiveSessionRuntimeStateHelper({ ...defaultArgs, tasksWithLiveActivities: tasks });
        expect(result.visibleStats.ci).toBe(1);
        expect(result.visibleStats.qa).toBe(1);
        expect(result.visibleStats.automerge).toBe(1);
        expect(result.visibleStats.merged).toBe(1);
    });

    it("scopes quota wait to the current dispatch", () => {
        const task = createSubtask({ id: "T1", record_id: "R1", status: "RUNNING" });
        const oldDispatch = createDispatch({ id: "D1", taskId: "R1", taskRunId: "RUN1", status: "failed" });
        const currentDispatch = createDispatch({ id: "D2", taskId: "R1", taskRunId: "RUN2", status: "running" });
        
        const events = [
            // Old dispatch event
            createEvent({ eventType: "cli_provider_quota_wait", taskId: "R1", taskRunId: "RUN1", payload: { retryAfterIso: "2026-06-13T14:00:00Z" } }),
            // Current dispatch event (not quota)
            createEvent({ eventType: "provider_activity", taskId: "R1", taskRunId: "RUN2" }),
        ];

        const result = deriveLiveSessionRuntimeStateHelper({
            ...defaultArgs,
            tasksWithLiveActivities: [task],
            sprintDispatches: [oldDispatch, currentDispatch],
            sprintEvents: events,
        });

        const card = result.taskCardItems.find(c => c.key === "R1");
        expect(card?.phase).toBe("RUNNING");
    });

    it("identifies QUOTA when current dispatch has a quota event", () => {
        const task = createSubtask({ id: "T1", record_id: "R1", status: "RUNNING" });
        const currentDispatch = createDispatch({ id: "D1", taskId: "R1", taskRunId: "RUN1", status: "running" });
        
        const events = [
            createEvent({ eventType: "cli_provider_quota_wait", taskId: "R1", taskRunId: "RUN1", payload: { retryAfterIso: "2026-06-13T14:00:00Z" } }),
        ];

        const result = deriveLiveSessionRuntimeStateHelper({
            ...defaultArgs,
            tasksWithLiveActivities: [task],
            sprintDispatches: [currentDispatch],
            sprintEvents: events,
        });

        const card = result.taskCardItems.find(c => c.key === "R1");
        expect(card?.phase).toBe("QUOTA");
        expect(card?.dispatchInfo?.errorMessage).toContain("Provider quota exhausted");
    });

    it("applies optimistic force-complete state", () => {
        const task = createSubtask({ id: "T1", record_id: "R1", status: "RUNNING" });
        const result = deriveLiveSessionRuntimeStateHelper({
            ...defaultArgs,
            tasksWithLiveActivities: [task],
            optimisticallyCompletedTaskIds: new Set(["R1"]),
        });

        const card = result.taskCardItems.find(c => c.key === "R1");
        expect(card?.task.status).toBe("COMPLETED");
        expect(card?.phase).toBe("COMPLETED");
    });
});
