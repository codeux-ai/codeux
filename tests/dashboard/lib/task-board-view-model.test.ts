import { expect, test } from "vitest";
import { buildTaskBoardSprintScopeState, buildTaskBoardViewModel } from "../../../dashboard/src/v2/lib/tasks/task-board-view-model.js";
import type { Sprint, Task } from "../../../dashboard/src/v2/types.js";
import type {
  ExecutionAttentionItemSummary,
  ExecutionRuntimeEventSummary,
  ExecutionTaskDispatchSummary,
  Subtask,
} from "../../../dashboard/src/types.js";
import type { TaskSelfReflectionRating } from "../../../src/contracts/task-self-reflection-types.js";

function createMockTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    recordId: id,
    title: `Task ${id}`,
    description: "",
    status: "pending",
    priority: "medium",
    executorType: "auto",
    source: "test",
    sprint: "sprint-1",
    sprintId: "sprint-1",
    assignee: "user",
    time: "0h",
    createdAt: new Date().toISOString(),
    promptMarkdown: "",
    dependsOnTaskIds: [],
    isIndependent: true,
    isMerged: false,
    mergeIndicator: null,
    ...overrides,
  };
}

function createRating(overrides: Partial<TaskSelfReflectionRating> = {}): TaskSelfReflectionRating {
  return {
    id: "rating-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    taskId: "task-1",
    sourceTaskRunId: "run-1",
    overallRating: 4.5,
    sections: [
      {
        label: "Implementation",
        normalizedLabel: "implementation",
        rating: 4.5,
        note: "Covered edge cases.",
      },
      {
        label: "Scope control",
        normalizedLabel: "scope_control",
        rating: 4,
        note: "Stayed focused.",
      },
    ],
    capturedAt: "2026-07-07T00:00:00.000Z",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    ...overrides,
  };
}

function createRuntimeEvent(overrides: Partial<ExecutionRuntimeEventSummary> = {}): ExecutionRuntimeEventSummary {
  return {
    id: "event-1",
    scopeType: "task_run",
    taskRunId: "task-run-unrelated",
    sprintRunId: "run-unrelated",
    dispatchId: "dispatch-unrelated",
    projectId: "project-1",
    sprintId: "sprint-unrelated",
    sprintName: "Sprint unrelated",
    sprintNumber: 99,
    sprintRunStatus: "running",
    taskId: "task-unrelated",
    taskKey: "TASK-UNRELATED",
    taskTitle: "Unrelated task",
    taskRunState: "running",
    eventType: "heartbeat",
    originator: "worker",
    sourceEventKey: null,
    provider: null,
    sessionId: null,
    sessionName: null,
    workerBranch: null,
    prUrl: null,
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    createdAt: "2026-07-03T10:05:00.000Z",
    payload: null,
    ...overrides,
  };
}

function createAttentionItem(overrides: Partial<ExecutionAttentionItemSummary> = {}): ExecutionAttentionItemSummary {
  return {
    id: "attention-1",
    sprintId: "sprint-1",
    taskId: "task-1",
    sprintRunId: "run-1",
    dispatchId: "dispatch-1",
    attentionType: "ci_fix_required",
    severity: "high",
    ownerType: "worker",
    status: "open",
    assignedWorkerEndpointId: null,
    title: "CI checks failed",
    summaryMarkdown: "The build workflow failed.",
    payload: { projectId: "project-1", taskId: "task-1", prNumber: 42 },
    openedAt: "2026-07-03T10:00:00.000Z",
    claimedAt: null,
    resolvedAt: null,
    updatedAt: "2026-07-03T10:00:00.000Z",
    ...overrides,
  };
}

test("buildTaskBoardViewModel combines optimistic and normal tasks, filters, and builds view models", () => {
  const normalTask = createMockTask("t1", { status: "pending" });
  const optimisticTask = createMockTask("t2", { status: "in_progress" });

  const vm = buildTaskBoardViewModel({
    tasks: [normalTask],
    optimisticTasks: [optimisticTask],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });

  expect(vm.boardState.filteredTasks).toHaveLength(2);
  expect(vm.boardState.stats.total).toBe(2);

  expect(vm.taskViewModels.has("t1")).toBe(true);
  expect(vm.taskViewModels.has("t2")).toBe(true);

  const vm1 = vm.taskViewModels.get("t1");
  expect(vm1?.task.id).toBe("t1");
});

test("buildTaskBoardViewModel passes task PR availability into card view models", () => {
  const task = createMockTask("t1", { status: "pending" });

  const vm = buildTaskBoardViewModel({
    tasks: [task],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
    taskPullRequestsEnabled: false,
  });

  const taskVm = vm.taskViewModels.get("t1");
  expect(taskVm?.hasPullRequestMetadata).toBe(false);
  expect(taskVm?.actions?.some((action) => action.kind === "pull_request")).toBe(false);
});

test("buildTaskBoardViewModel applies sprint scope correctly", () => {
  const t1 = createMockTask("t1", { sprintId: "sprint-1" });
  const d1: ExecutionTaskDispatchSummary = { id: "d1", sprintId: "sprint-1", executionId: "", taskId: "t1", status: "completed", queuedAt: "", workerBranch: "b" };
  const d2: ExecutionTaskDispatchSummary = { id: "d2", sprintId: "sprint-2", executionId: "", taskId: "t2", status: "completed", queuedAt: "", workerBranch: "b" };

  const vm = buildTaskBoardViewModel({
    tasks: [t1],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: "sprint-1",
    taskDispatches: [d1, d2],
    recentEvents: [],
    subtasks: [{ id: "t1", record_id: "t1", title: "", sprint_id: "sprint-1", execution_id: "", session_id: "" }],
  });

  const vm1 = vm.taskViewModels.get("t1");
  expect(vm1).toBeDefined();
});

test("buildTaskBoardViewModel applies status and priority filters and column ordering", () => {
  const tasks = [
    createMockTask("t1", { status: "pending", priority: "high" }),
    createMockTask("t2", { status: "in_progress", priority: "low" }),
    createMockTask("t3", { status: "completed", priority: "critical" }),
  ];

  const vm = buildTaskBoardViewModel({
    tasks,
    optimisticTasks: [],
    statusFilter: "in_progress",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });

  expect(vm.boardState.filteredTasks).toHaveLength(1);
  expect(vm.boardState.filteredTasks[0].id).toBe("t2");
  expect(vm.boardState.columns[0].status).toBe("in_progress"); // Should be filtered column
});

test("buildTaskBoardViewModel gives optimistic task precedence", () => {
  const normalTask = createMockTask("t1", { title: "Old Title", status: "pending" });
  const optimisticTask = createMockTask("t1", {
    title: "New Title",
    status: "in_progress",
    isOptimistic: true,
  });

  const vm = buildTaskBoardViewModel({
    tasks: [normalTask],
    optimisticTasks: [optimisticTask],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });

  expect(vm.boardState.filteredTasks).toHaveLength(1);
  expect(vm.boardState.filteredTasks[0]).toMatchObject({
    recordId: "t1",
    title: "New Title",
    status: "in_progress",
    isOptimistic: true,
  });
  expect(vm.boardState.stats).toMatchObject({
    total: 1,
    inProgress: 1,
  });
  expect(vm.boardState.columns.find((column) => column.status === "pending")?.count).toBe(0);
  expect(vm.boardState.columns.find((column) => column.status === "in_progress")?.count).toBe(1);

  const taskVm = vm.taskViewModels.get("t1");
  expect(taskVm?.task.title).toBe("New Title");
  expect(taskVm?.task.status).toBe("in_progress");
});

test("buildTaskBoardViewModel keeps optimistic tasks ahead of cached base task view models", () => {
  const normalTask = createMockTask("t1", { title: "Persisted Title", status: "pending" });
  const initial = buildTaskBoardViewModel({
    tasks: [normalTask],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });
  const previousTaskVm = initial.taskViewModels.get("t1");
  const optimisticTask = createMockTask("t1", {
    title: "Optimistic Title",
    status: "in_progress",
    isOptimistic: true,
  });

  const next = buildTaskBoardViewModel({
    tasks: [normalTask],
    optimisticTasks: [optimisticTask],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
    previousTaskViewModels: initial.taskViewModels,
  });

  expect(next.boardState.filteredTasks).toHaveLength(1);
  expect(next.boardState.filteredTasks[0]).toBe(optimisticTask);
  expect(next.taskViewModels.get("t1")).not.toBe(previousTaskVm);
  expect(next.taskViewModels.get("t1")?.task).toBe(optimisticTask);
});

test("buildTaskBoardViewModel reuses unchanged card view models across unrelated live events", () => {
  const dependency = createMockTask("dep-1", { status: "completed", title: "Prepare API" });
  const task = createMockTask("task-1", {
    status: "in_progress",
    dependsOnTaskIds: ["dep-1"],
  });
  const initial = buildTaskBoardViewModel({
    tasks: [dependency, task],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: "sprint-1",
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });

  const next = buildTaskBoardViewModel({
    tasks: [dependency, task],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: "sprint-1",
    taskDispatches: [],
    recentEvents: [createRuntimeEvent()],
    subtasks: [],
    previousTaskViewModels: initial.taskViewModels,
  });

  expect(next.taskViewModels.get("task-1")).toBe(initial.taskViewModels.get("task-1"));
  expect(next.taskViewModels.get("dep-1")).toBe(initial.taskViewModels.get("dep-1"));
});

test("buildTaskBoardViewModel derives task-scoped CI progress from matching execution events", () => {
  const task = createMockTask("TASK-1", {
    recordId: "task-1",
    sprintId: "sprint-1",
  });
  const event = createRuntimeEvent({
    id: "ci-progress",
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintRunId: "run-1",
    taskId: "task-1",
    taskKey: "TASK-1",
    eventType: "ci_gate_status",
    prUrl: "https://example.com/pr/42",
    payload: { state: "waiting_checks", hasPendingChecks: true, prNumber: 42 },
  });

  const vm = buildTaskBoardViewModel({
    tasks: [task],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    projectId: "project-1",
    taskScopeSprintId: "sprint-1",
    taskDispatches: [],
    attentionItems: [],
    recentEvents: [event],
    subtasks: [],
  });

  expect(vm.taskViewModels.get("task-1")?.ciStatusPresentation).toMatchObject({
    scope: "task",
    state: "in_progress",
    label: "CI running",
  });
  expect(vm.taskViewModels.get("task-1")?.ciStatusPresentation?.steps[1]).toMatchObject({
    id: "checks",
    state: "in_progress",
    statusLabel: "Checks running",
  });
});

test("buildTaskBoardViewModel shows active CI attention as failure and removes it after resolution", () => {
  const task = createMockTask("TASK-1", {
    recordId: "task-1",
    sprintId: "sprint-1",
    mergeIndicator: "CI",
  });
  const openAttention = createAttentionItem();
  const failed = buildTaskBoardViewModel({
    tasks: [task],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    projectId: "project-1",
    taskScopeSprintId: "sprint-1",
    taskDispatches: [],
    attentionItems: [openAttention],
    recentEvents: [],
    subtasks: [],
  });
  expect(failed.taskViewModels.get("task-1")?.ciStatusPresentation).toMatchObject({
    state: "failed",
    label: "CI failed",
  });

  const resolved = buildTaskBoardViewModel({
    tasks: [task],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    projectId: "project-1",
    taskScopeSprintId: "sprint-1",
    taskDispatches: [],
    attentionItems: [{
      ...openAttention,
      status: "resolved",
      resolvedAt: "2026-07-03T10:05:00.000Z",
      updatedAt: "2026-07-03T10:05:00.000Z",
    }],
    recentEvents: [],
    subtasks: [],
    previousTaskViewModels: failed.taskViewModels,
  });

  expect(resolved.taskViewModels.get("task-1")).not.toBe(failed.taskViewModels.get("task-1"));
  expect(resolved.taskViewModels.get("task-1")?.ciStatusPresentation?.state).not.toBe("failed");
});

test("buildTaskBoardViewModel replaces stale failed CI events with newer success", () => {
  const task = createMockTask("TASK-1", { recordId: "task-1", sprintId: "sprint-1" });
  const failedEvent = createRuntimeEvent({
    id: "ci-failed",
    projectId: "project-1",
    sprintId: "sprint-1",
    taskId: "task-1",
    taskKey: "TASK-1",
    eventType: "ci_gate_status",
    createdAt: "2026-07-03T10:05:00.000Z",
    payload: { state: "waiting_checks", hasFailedChecks: true, prNumber: 42 },
  });
  const successfulEvent = createRuntimeEvent({
    ...failedEvent,
    id: "ci-success",
    createdAt: "2026-07-03T10:06:00.000Z",
    payload: { state: "merge_confirmed", prNumber: 42 },
  });

  const vm = buildTaskBoardViewModel({
    tasks: [task],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    projectId: "project-1",
    taskScopeSprintId: "sprint-1",
    taskDispatches: [],
    attentionItems: [],
    recentEvents: [failedEvent, successfulEvent],
    subtasks: [],
  });

  expect(vm.taskViewModels.get("task-1")?.ciStatusPresentation).toMatchObject({
    state: "successful",
    label: "CI passed",
  });
});

test("buildTaskBoardViewModel excludes CI evidence from other projects, sprints, and task records", () => {
  const task = createMockTask("TASK-1", { recordId: "task-1", sprintId: "sprint-1" });
  const baseCiEvent = createRuntimeEvent({
    eventType: "ci_gate_status",
    payload: { state: "waiting_checks", hasFailedChecks: true },
  });
  const vm = buildTaskBoardViewModel({
    tasks: [task],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    projectId: "project-1",
    taskScopeSprintId: "sprint-1",
    taskDispatches: [],
    attentionItems: [
      createAttentionItem({ id: "other-project", payload: { projectId: "project-2", taskId: "task-1" } }),
      createAttentionItem({ id: "other-sprint", sprintId: "sprint-2" }),
      createAttentionItem({ id: "other-task", taskId: "task-2", payload: { projectId: "project-1", taskId: "task-2" } }),
    ],
    recentEvents: [
      { ...baseCiEvent, id: "other-project", projectId: "project-2", sprintId: "sprint-1", taskId: "task-1" },
      { ...baseCiEvent, id: "other-sprint", projectId: "project-1", sprintId: "sprint-2", taskId: "task-1" },
      { ...baseCiEvent, id: "other-task", projectId: "project-1", sprintId: "sprint-1", taskId: "task-2", taskKey: "TASK-1" },
    ],
    subtasks: [],
  });

  expect(vm.taskViewModels.get("task-1")?.ciStatusPresentation).toBeNull();
});

test("buildTaskBoardViewModel keeps CI source signatures stable and refreshes on workflow changes", () => {
  const task = createMockTask("TASK-1", { recordId: "task-1", sprintId: "sprint-1" });
  const event = createRuntimeEvent({
    id: "ci-event",
    projectId: "project-1",
    sprintId: "sprint-1",
    taskId: "task-1",
    eventType: "ci_gate_status",
    payload: { state: "waiting_checks", hasPendingChecks: true, nested: { b: 2, a: 1 } },
  });
  const initial = buildTaskBoardViewModel({
    tasks: [task], optimisticTasks: [], statusFilter: "all", priorityFilter: "all", listWindow: 50,
    projectId: "project-1", taskScopeSprintId: "sprint-1", taskDispatches: [], attentionItems: [], recentEvents: [event], subtasks: [],
  });
  const contentEquivalent = buildTaskBoardViewModel({
    tasks: [task], optimisticTasks: [], statusFilter: "all", priorityFilter: "all", listWindow: 50,
    projectId: "project-1", taskScopeSprintId: "sprint-1", taskDispatches: [], attentionItems: [],
    recentEvents: [{ ...event, payload: { nested: { a: 1, b: 2 }, hasPendingChecks: true, state: "waiting_checks" } }],
    subtasks: [], previousTaskViewModels: initial.taskViewModels,
  });
  expect(contentEquivalent.taskViewModels.get("task-1")).toBe(initial.taskViewModels.get("task-1"));

  const changed = buildTaskBoardViewModel({
    tasks: [task], optimisticTasks: [], statusFilter: "all", priorityFilter: "all", listWindow: 50,
    projectId: "project-1", taskScopeSprintId: "sprint-1", taskDispatches: [], attentionItems: [],
    recentEvents: [{ ...event, id: "ci-success", createdAt: "2026-07-03T10:06:00.000Z", payload: { state: "merge_confirmed" } }],
    subtasks: [], previousTaskViewModels: contentEquivalent.taskViewModels,
  });
  expect(changed.taskViewModels.get("task-1")).not.toBe(contentEquivalent.taskViewModels.get("task-1"));
  expect(changed.taskViewModels.get("task-1")?.ciStatusPresentation?.state).toBe("successful");
});

test("buildTaskBoardViewModel refreshes cards when structured QA follow-up content changes", () => {
  const review: NonNullable<Task["latestReview"]> = {
    status: "completed",
    outcome: "changes_requested",
    summary: "Follow-up work is required.",
    findings: ["Keyboard focus regressed."],
    reviewer: "QA Reviewer",
    finishedAt: "2026-07-13T12:00:00.000Z",
    followUpTasks: [{
      title: "Repair focus",
      promptMarkdown: "Restore focus after closing the menu.",
      description: "Keep focus on the action trigger.",
      priority: "high",
      dependsOnTaskKeys: [],
    }],
  };
  const task = createMockTask("task-1", { latestReview: review });
  const initial = buildTaskBoardViewModel({
    tasks: [task], optimisticTasks: [], statusFilter: "all", priorityFilter: "all", listWindow: 50,
    taskScopeSprintId: "sprint-1", taskDispatches: [], recentEvents: [], subtasks: [],
  });
  const updatedTask = createMockTask("task-1", {
    latestReview: {
      ...review,
      followUpTasks: [{
        ...review.followUpTasks[0],
        promptMarkdown: "Restore focus and add keyboard regression coverage.",
      }],
    },
  });
  const updated = buildTaskBoardViewModel({
    tasks: [updatedTask], optimisticTasks: [], statusFilter: "all", priorityFilter: "all", listWindow: 50,
    taskScopeSprintId: "sprint-1", taskDispatches: [], recentEvents: [], subtasks: [],
    previousTaskViewModels: initial.taskViewModels,
  });

  expect(updated.taskViewModels.get("task-1")).not.toBe(initial.taskViewModels.get("task-1"));
});

test("buildTaskBoardViewModel refreshes card view models when self-reflection rating content changes", () => {
  const task = createMockTask("task-1");
  const initial = buildTaskBoardViewModel({
    tasks: [task],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: "sprint-1",
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });
  const ratedTask = createMockTask("task-1", {
    selfReflectionRating: createRating({
      overallRating: 4.5,
    }),
  });

  const next = buildTaskBoardViewModel({
    tasks: [ratedTask],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: "sprint-1",
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
    previousTaskViewModels: initial.taskViewModels,
  });

  expect(next.taskViewModels.get("task-1")).not.toBe(initial.taskViewModels.get("task-1"));
  expect(next.taskViewModels.get("task-1")?.selfReflectionRating?.overallRating).toBe(4.5);
  expect(next.taskViewModels.get("task-1")?.selfReflectionRating?.sections).toHaveLength(2);
});

test("buildTaskBoardViewModel handles empty states", () => {
  const vm = buildTaskBoardViewModel({
    tasks: [],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: null,
    taskDispatches: [],
    recentEvents: [],
    subtasks: [],
  });

  expect(vm.boardState.filteredTasks).toHaveLength(0);
  expect(vm.boardState.stats.total).toBe(0);
  expect(vm.taskViewModels.size).toBe(0);
  expect(vm.boardState.columns).toEqual([
    { status: "pending", count: 0, tasks: [] },
    { status: "in_progress", count: 0, tasks: [] },
    { status: "completed", count: 0, tasks: [] },
  ]);
});

test("buildTaskBoardViewModel carries dependency blockers and live duration into card view models", () => {
  const dependency = createMockTask("dep-1", { status: "pending", title: "Prepare contract" });
  const task = createMockTask("task-1", {
    status: "in_progress",
    dependsOnTaskIds: ["dep-1"],
  });
  const dispatch: ExecutionTaskDispatchSummary = {
    id: "dispatch-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintRunId: "run-1",
    sprintName: "Sprint 1",
    sprintNumber: 1,
    taskId: "task-1",
    taskKey: "TASK-1",
    taskTitle: "Task task-1",
    status: "running",
    executorType: "docker_cli",
    priority: 0,
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    taskRunId: "task-run-1",
    taskRunState: "running",
    provider: null,
    sessionId: "sessions/session-1",
    sessionName: null,
    workerBranch: null,
    prUrl: null,
    queuedAt: "2026-07-03T10:00:00.000Z",
    claimedAt: "2026-07-03T10:00:00.000Z",
    startedAt: "2026-07-03T10:00:00.000Z",
    finishedAt: "2026-07-03T10:02:05.000Z",
    lastHeartbeatAt: null,
    errorMessage: null,
    activeLeaseOwnerKey: null,
    activeLeaseExpiresAt: null,
  };
  const subtask: Subtask = {
    record_id: "task-1",
    id: "TASK-1",
    title: "Task task-1",
    prompt: "",
    depends_on: [],
    status: "in_progress",
    session_id: "sessions/session-1",
    is_independent: true,
  };

  const vm = buildTaskBoardViewModel({
    tasks: [dependency, task],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: 50,
    taskScopeSprintId: "sprint-1",
    taskDispatches: [dispatch],
    recentEvents: [],
    subtasks: [subtask],
  });

  const taskVm = vm.taskViewModels.get("task-1");
  expect(taskVm?.dependencyIndicators).toEqual([
    {
      recordId: "dep-1",
      id: "dep-1",
      title: "Prepare contract",
      status: "pending",
      isKnown: true,
      stateLabel: "Blocked",
      stateDescription: "Dependency is waiting to start",
      isBlocking: true,
    },
  ]);
  expect(taskVm?.liveRunningTime).toBe("2m 5s");
  expect(taskVm?.liveStartedAt).toBe("2026-07-03T10:00:00.000Z");
  expect(taskVm?.dependencyActionLabel).toBe("1 dependency blocker");
  expect(taskVm?.actions.find((action) => action.kind === "live_runtime")).toMatchObject({
    href: "/live",
    label: "Live",
  });
});

test("buildTaskBoardSprintScopeState exposes selected, loading, and empty scope states", () => {
  const sprints = [
    { id: "sprint-1", number: 1, name: "Sprint One", date: "Jan 1", tasksCount: 2, completion: 50, status: "running" },
  ] as Sprint[];

  expect(buildTaskBoardSprintScopeState({
    sprints,
    selectedSprintId: "sprint-1",
    selectedSprintLabel: "SPR-1: Sprint One",
    loading: false,
  })).toEqual({
    label: "SPR-1: Sprint One",
    description: "Task board scoped to SPR-1: Sprint One.",
    isScoped: true,
    isLoading: false,
    isEmpty: false,
  });

  expect(buildTaskBoardSprintScopeState({
    sprints: [],
    selectedSprintId: null,
    selectedSprintLabel: null,
    loading: true,
  })).toMatchObject({ label: "Loading sprints", isLoading: true });

  expect(buildTaskBoardSprintScopeState({
    sprints: [],
    selectedSprintId: null,
    selectedSprintLabel: null,
    loading: false,
  })).toMatchObject({ label: "No sprints", isEmpty: true });
});
