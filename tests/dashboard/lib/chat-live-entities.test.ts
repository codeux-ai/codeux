import { describe, expect, it } from "vitest";
import { resolveChatLiveEntities } from "../../../dashboard/src/v2/lib/chat-live-entities.js";
import type {
  ChatMessageRecord,
  ExecutionInvocationMessageRecord,
  ExecutionInvocationRecord,
  Sprint,
  Task,
} from "../../../dashboard/src/v2/types.js";

const createSprint = (overrides: Partial<Sprint> = {}): Sprint => ({
  id: "sprint-1",
  projectId: "project-1",
  number: 1,
  slug: "sprint-1",
  name: "Sprint One",
  isGeneratedName: false,
  originalPrompt: null,
  goal: "Ship sprint one",
  status: "running",
  showcasePinned: false,
  startDate: null,
  endDate: null,
  featureBranch: null,
  baseCommitSha: null,
  tasksCount: 2,
  completion: 50,
  linkedIssues: [],
  date: "Schedule TBD",
  createdAt: "2026-03-10T12:00:00.000Z",
  updatedAt: "2026-03-10T12:00:00.000Z",
  ...overrides,
});

const createTask = (overrides: Partial<Task> = {}): Task => ({
  recordId: "task-1",
  id: "T01",
  source: "Project",
  sprint: "Sprint One",
  sprintId: "sprint-1",
  title: "Build chat card",
  status: "pending",
  priority: "medium",
  executorType: "docker_cli",
  assignee: "CLI",
  time: "--",
  createdAt: "2026-03-10T12:00:00.000Z",
  updatedAt: "2026-03-10T12:00:00.000Z",
  promptMarkdown: "Build it",
  description: "",
  dependsOnTaskIds: [],
  isIndependent: true,
  isMerged: false,
  mergeIndicator: null,
  ...overrides,
});

const createInvocation = (overrides: Partial<ExecutionInvocationRecord> = {}): ExecutionInvocationRecord => ({
  id: "invocation-1",
  projectId: "project-1",
  sprintId: null,
  taskId: null,
  sprintRunId: null,
  dispatchId: null,
  taskRunId: null,
  attentionItemId: null,
  providerInvocationId: null,
  type: "dashboard_reply",
  status: "completed",
  provider: "codex",
  model: "gpt-5",
  systemPrompt: null,
  startedAt: "2026-03-10T12:00:00.000Z",
  finishedAt: "2026-03-10T12:01:00.000Z",
  errorMessage: null,
  lastErrorCategory: null,
  lastErrorMessage: null,
  lastRetryAfterIso: null,
  messageCount: 1,
  lastMessageAt: "2026-03-10T12:01:00.000Z",
  sprintNumber: null,
  sprintName: null,
  sprintSlug: null,
  taskKey: null,
  taskTitle: null,
  createdAt: "2026-03-10T12:00:00.000Z",
  updatedAt: "2026-03-10T12:01:00.000Z",
  ...overrides,
});

describe("resolveChatLiveEntities", () => {
  it("resolves explicit metadata ids into current sprint and task widgets", () => {
    const sprints = [createSprint()];
    const tasks = [
      createTask({ recordId: "task-1", status: "completed", isMerged: true, mergeIndicator: "merged" }),
      createTask({ recordId: "task-2", id: "T02", status: "pending" }),
    ];
    const message = {
      metadata: {
        sprintId: "sprint-1",
        taskId: "task-1",
      },
    } as unknown as ChatMessageRecord;

    const result = resolveChatLiveEntities({ sprints, tasks, sprintKeyPrefix: "SPR", message });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "sprint",
        recordId: "sprint-1",
        displayKey: "SPR-1",
        name: "Sprint One",
        status: "running",
        href: "/sprints?sprintId=sprint-1&sprintKey=SPR-1",
        tasksCount: 2,
        completedTasks: 1,
        completion: 50,
      }),
      expect.objectContaining({
        kind: "task",
        recordId: "task-1",
        displayKey: "T01",
        name: "Build chat card",
        status: "completed",
        href: "/tasks?sprintId=sprint-1&taskId=task-1",
        priority: "medium",
        executorType: "docker_cli",
        isMerged: true,
        mergeIndicator: "merged",
      }),
    ]);
  });

  it("reads snake_case references from nested widget metadata", () => {
    const message = {
      metadata: {
        sprint_id: "missing-sprint",
        widget_metadata: {
          sprint_id: "sprint-2",
          task_key: "T02",
        },
      },
    } as unknown as ExecutionInvocationMessageRecord;

    const result = resolveChatLiveEntities({
      sprints: [createSprint(), createSprint({ id: "sprint-2", number: 2, name: "Sprint Two" })],
      tasks: [createTask(), createTask({ recordId: "task-2", id: "T02", sprintId: "sprint-2", title: "Second task" })],
      sprintKeyPrefix: "SPR",
      message,
    });

    expect(result.map((entity) => `${entity.kind}:${entity.recordId}`)).toEqual(["sprint:sprint-2", "task:task-2"]);
  });

  it("uses invocation context fields when message metadata is absent", () => {
    const result = resolveChatLiveEntities({
      sprints: [createSprint({ id: "sprint-3", number: 3, name: "Invocation Sprint" })],
      tasks: [createTask({ recordId: "task-3", id: "T03", sprintId: "sprint-3", title: "Invocation task" })],
      sprintKeyPrefix: "SPR",
      invocation: createInvocation({
        sprintId: "sprint-3",
        taskId: "task-3",
        sprintNumber: 3,
        sprintName: "Invocation Sprint",
        taskKey: "T03",
        taskTitle: "Invocation task",
      }),
    });

    expect(result.map((entity) => `${entity.kind}:${entity.recordId}`)).toEqual(["sprint:sprint-3", "task:task-3"]);
  });

  it("parses sprint and task keys from markdown while returning only existing records", () => {
    const result = resolveChatLiveEntities({
      sprints: [createSprint({ id: "sprint-7", number: 7, name: "Markdown Sprint" })],
      tasks: [createTask({ recordId: "task-7", id: "T07", sprintId: "sprint-7", title: "Markdown task" })],
      sprintKeyPrefix: "SPR",
      bodyMarkdown: "The current scope is SPR-7 and T07, not SPR-999 or T99.",
    });

    expect(result.map((entity) => `${entity.kind}:${entity.recordId}`)).toEqual(["sprint:sprint-7", "task:task-7"]);
  });

  it("parses dashboard links with URLSearchParams and deduplicates repeated references", () => {
    const result = resolveChatLiveEntities({
      sprints: [createSprint({ id: "sprint-4", number: 4, name: "Linked Sprint" })],
      tasks: [createTask({ recordId: "task-4", id: "T04", sprintId: "sprint-4", title: "Linked task" })],
      sprintKeyPrefix: "SPR",
      contentMarkdown: [
        "[Sprint](/sprints?sprintKey=SPR-4)",
        "again /sprints?sprintKey=SPR-4",
        "[Task](/tasks?sprintId=sprint-4&taskId=task-4)",
        "again /tasks?sprintId=sprint-4&taskId=task-4.",
      ].join("\n"),
    });

    expect(result.map((entity) => `${entity.kind}:${entity.recordId}`)).toEqual(["sprint:sprint-4", "task:task-4"]);
  });

  it("ignores external absolute dashboard-shaped links while preserving relative dashboard links", () => {
    const sprints = [createSprint({ id: "sprint-8", number: 8, name: "Link Origin Sprint" })];
    const tasks = [createTask({ recordId: "task-8", id: "T08", sprintId: "sprint-8", title: "Link origin task" })];

    const externalResult = resolveChatLiveEntities({
      sprints,
      tasks,
      sprintKeyPrefix: "SPR",
      bodyMarkdown: "External link https://example.com/tasks?sprintId=sprint-8&taskId=task-8 should stay plain.",
    });
    const relativeResult = resolveChatLiveEntities({
      sprints,
      tasks,
      sprintKeyPrefix: "SPR",
      bodyMarkdown: "Relative link /tasks?sprintId=sprint-8&taskId=task-8 should resolve.",
    });

    expect(externalResult).toEqual([]);
    expect(relativeResult.map((entity) => `${entity.kind}:${entity.recordId}`)).toEqual(["task:task-8"]);
  });

  it("ignores stale ids, stale keys, and mismatched task links", () => {
    const result = resolveChatLiveEntities({
      sprints: [createSprint({ id: "sprint-1", number: 1 })],
      tasks: [createTask({ recordId: "task-1", sprintId: "sprint-1" })],
      sprintKeyPrefix: "SPR",
      message: {
        metadata: {
          sprintId: "missing-sprint",
          taskId: "missing-task",
          sprintKey: "SPR-404",
          taskKey: "T404",
        },
      } as unknown as ChatMessageRecord,
      bodyMarkdown: "/tasks?sprintId=missing-sprint&taskId=task-1",
    });

    expect(result).toEqual([]);
  });

  it("does not infer a duplicate task key without sprint context", () => {
    const result = resolveChatLiveEntities({
      sprints: [
        createSprint({ id: "sprint-1", number: 1 }),
        createSprint({ id: "sprint-2", number: 2 }),
      ],
      tasks: [
        createTask({ recordId: "task-1", id: "T01", sprintId: "sprint-1" }),
        createTask({ recordId: "task-2", id: "T01", sprintId: "sprint-2" }),
      ],
      sprintKeyPrefix: "SPR",
      bodyMarkdown: "Please inspect T01.",
    });

    expect(result).toEqual([]);
  });

  it("resolves a duplicate task key when sprint context disambiguates it", () => {
    const result = resolveChatLiveEntities({
      sprints: [
        createSprint({ id: "sprint-1", number: 1 }),
        createSprint({ id: "sprint-2", number: 2, name: "Second sprint" }),
      ],
      tasks: [
        createTask({ recordId: "task-1", id: "T01", sprintId: "sprint-1" }),
        createTask({ recordId: "task-2", id: "T01", sprintId: "sprint-2", title: "Scoped duplicate" }),
      ],
      sprintKeyPrefix: "SPR",
      message: {
        metadata: {
          sprintKey: "SPR-2",
          taskKey: "T01",
        },
      } as unknown as ChatMessageRecord,
    });

    expect(result.map((entity) => `${entity.kind}:${entity.recordId}`)).toEqual(["sprint:sprint-2", "task:task-2"]);
  });

  it("resolves task title from selected invocation context only when it matches a real scoped task", () => {
    const result = resolveChatLiveEntities({
      sprints: [createSprint({ id: "sprint-5", number: 5, name: "Title sprint" })],
      tasks: [createTask({ recordId: "task-5", sprintId: "sprint-5", title: "Title-only task" })],
      sprintKeyPrefix: "SPR",
      invocation: createInvocation({
        sprintNumber: 5,
        sprintName: "Title sprint",
        taskTitle: "Title-only task",
      }),
    });

    expect(result.map((entity) => `${entity.kind}:${entity.recordId}`)).toEqual(["sprint:sprint-5", "task:task-5"]);
  });

  it("returns no entities when project data is empty", () => {
    const result = resolveChatLiveEntities({
      sprints: [],
      tasks: [],
      sprintKeyPrefix: "SPR",
      bodyMarkdown: "SPR-1 T01 /tasks?sprintId=sprint-1&taskId=task-1",
    });

    expect(result).toEqual([]);
  });
});
