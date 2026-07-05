import { expect, test } from "vitest";
import { buildTaskBoardSprintScopeState, buildTaskBoardViewModel } from "../../../dashboard/src/v2/lib/tasks/task-board-view-model.js";
import type { Sprint, Task } from "../../../dashboard/src/v2/types.js";
import type { ExecutionTaskDispatchSummary, Subtask } from "../../../dashboard/src/types.js";

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
