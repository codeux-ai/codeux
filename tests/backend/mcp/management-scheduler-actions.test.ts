import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SchedulerActions } from "../../../src/mcp/management/scheduler-actions.js";
import { AgentSchedulerActions } from "../../../src/mcp/management/agent-scheduler-actions.js";
import { ManagementToolHandler } from "../../../src/mcp/management-tool-handler.js";
import { runWithMcpAgentContext } from "../../../src/server/mcp-agent-context.js";
import type { ManageCodeUxArgs } from "../../../src/contracts/internal-management-types.js";
import type { SchedulerEntryRecord } from "../../../src/contracts/scheduler-types.js";
import type { SchedulerService } from "../../../src/services/scheduler-service.js";

describe("SchedulerActions", () => {
  let schedulerService: SchedulerService;
  let actions: SchedulerActions;

  const makeArgs = (action: string, payload: Record<string, unknown>, approval?: { confirmed: boolean }): ManageCodeUxArgs => ({
    domain: "scheduler",
    action,
    payload,
    approval,
  });

  beforeEach(() => {
    schedulerService = {
      listProjectSchedule: vi.fn(),
      createEntry: vi.fn(),
      getEntry: vi.fn(),
      updateEntry: vi.fn(),
      deleteEntry: vi.fn(),
      runDueEntries: vi.fn(),
    } as unknown as SchedulerService;
    actions = new SchedulerActions(schedulerService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists scheduler entries with explicit range", async () => {
    vi.mocked(schedulerService.listProjectSchedule).mockReturnValue({ entries: [], occurrences: [], from: "2026-06-01T00:00:00.000Z", to: "2026-06-30T00:00:00.000Z" });

    const result = await actions.handleSchedulerAction(makeArgs("list", {
      projectId: "p1",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-30T00:00:00.000Z",
    }));

    expect(schedulerService.listProjectSchedule).toHaveBeenCalledWith("p1", "2026-06-01T00:00:00.000Z", "2026-06-30T00:00:00.000Z");
    expect(result.result).toEqual({ entries: [], occurrences: [], from: "2026-06-01T00:00:00.000Z", to: "2026-06-30T00:00:00.000Z" });
  });

  it("schedules chat messages from flattened MCP fields", async () => {
    vi.mocked(schedulerService.createEntry).mockReturnValue({ id: "entry-1" } as any);

    const result = await actions.handleSchedulerAction(makeArgs("schedule_chat", {
      projectId: "p1",
      scheduledFor: "2026-06-09T12:00:00.000Z",
      timezone: "Europe/Berlin",
      title: "Daily check-in",
      bodyMarkdown: "Please summarize progress.",
      threadId: "thread-1",
      connectionId: "conn-1",
      recurrence: { frequency: "daily", interval: 1, endMode: "never" },
    }));

    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", {
      targetType: "chat",
      scheduledFor: "2026-06-09T12:00:00.000Z",
      timezone: "Europe/Berlin",
      title: "Daily check-in",
      recurrence: { frequency: "daily", interval: 1, endMode: "never", count: null, until: null },
      chatTarget: {
        bodyMarkdown: "Please summarize progress.",
        title: "Daily check-in",
        threadId: "thread-1",
        connectionId: "conn-1",
      },
    });
    expect(result.result).toEqual({ entry: { id: "entry-1" } });
  });

  it("schedules wakeups from flattened MCP fields with delay seconds and invocation context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"));
    vi.mocked(schedulerService.createEntry).mockReturnValue({ id: "entry-1" } as any);

    const result = await runWithMcpAgentContext("agent-1", () =>
      actions.handleSchedulerAction(makeArgs("schedule_wakeup", {
        projectId: "p1",
        delaySeconds: 90,
        timezone: "Europe/Berlin",
        title: "Review wakeup",
        bodyMarkdown: "Please resume the review.",
        threadId: "thread-1",
        connectionId: "conn-1",
      })),
    "invocation-1");

    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", {
      targetType: "wakeup",
      scheduledFor: "2026-06-09T12:01:30.000Z",
      timezone: "Europe/Berlin",
      title: "Review wakeup",
      wakeupTarget: {
        bodyMarkdown: "Please resume the review.",
        title: "Review wakeup",
        threadId: "thread-1",
        connectionId: "conn-1",
        sourceInvocationId: "invocation-1",
      },
    });
    expect(result.result).toEqual({ entry: { id: "entry-1" } });
  });

  it("schedules wakeups from nested target fields and preserves explicit source invocation ids", async () => {
    vi.mocked(schedulerService.createEntry).mockReturnValue({ id: "entry-1" } as any);

    await actions.handleSchedulerAction(makeArgs("schedule_wakeup", {
      projectId: "p1",
      scheduledFor: "2026-06-09T12:00:00.000Z",
      wakeupTarget: {
        bodyMarkdown: "Resume after current work.",
        title: "Nested wakeup",
        threadId: "thread-2",
        connectionId: null,
        sourceInvocationId: "explicit-invocation",
        resumeAfterInvocationCompletion: false,
      },
    }));

    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", {
      targetType: "wakeup",
      scheduledFor: "2026-06-09T12:00:00.000Z",
      wakeupTarget: {
        bodyMarkdown: "Resume after current work.",
        title: "Nested wakeup",
        threadId: "thread-2",
        connectionId: null,
        sourceInvocationId: "explicit-invocation",
        resumeAfterInvocationCompletion: false,
      },
    });
  });

  it("accepts positive numeric-string delay seconds for wakeups", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"));
    vi.mocked(schedulerService.createEntry).mockReturnValue({ id: "entry-1" } as any);

    await actions.handleSchedulerAction(makeArgs("schedule_wakeup", {
      projectId: "p1",
      delaySeconds: "45",
      bodyMarkdown: "Wake up soon.",
    }));

    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", {
      targetType: "wakeup",
      scheduledFor: "2026-06-09T12:00:45.000Z",
      wakeupTarget: {
        bodyMarkdown: "Wake up soon.",
      },
    });
  });

  it("requires a body when scheduling wakeups", async () => {
    await expect(actions.handleSchedulerAction(makeArgs("schedule_wakeup", {
      projectId: "p1",
      scheduledFor: "2026-06-09T12:00:00.000Z",
    }))).rejects.toThrow("bodyMarkdown or wakeupTarget.bodyMarkdown is required");
    expect(schedulerService.createEntry).not.toHaveBeenCalled();
  });

  it("schedules sprint entries with minute-based recurrence", async () => {
    vi.mocked(schedulerService.createEntry).mockReturnValue({ id: "entry-1" } as any);

    await actions.handleSchedulerAction(makeArgs("schedule_sprint", {
      projectId: "p1",
      scheduledFor: "2026-06-09T12:00:00.000Z",
      sprintId: "sprint-1",
      recurrence: { frequency: "minutely", interval: 15, endMode: "never" },
    }));

    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", {
      targetType: "sprint",
      scheduledFor: "2026-06-09T12:00:00.000Z",
      recurrence: { frequency: "minutely", interval: 15, endMode: "never", count: null, until: null },
      sprintTarget: { sprintId: "sprint-1" },
    });
  });

  it("schedules anchored sprint entries from flattened MCP fields", async () => {
    vi.mocked(schedulerService.createEntry).mockReturnValue({ id: "entry-1" } as any);

    await actions.handleSchedulerAction(makeArgs("schedule_sprint", {
      projectId: "p1",
      scheduleMode: "after_sprint_end",
      sourceSprintId: "source-sprint",
      offsetMinutes: "15",
      sprintId: "target-sprint",
    }));

    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", {
      targetType: "sprint",
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: "source-sprint",
        offsetMinutes: 15,
      },
      sprintTarget: { sprintId: "target-sprint" },
    });
  });

  it("schedules anchored chat entries from nested MCP fields", async () => {
    vi.mocked(schedulerService.createEntry).mockReturnValue({ id: "entry-1" } as any);

    await actions.handleSchedulerAction(makeArgs("schedule_chat", {
      projectId: "p1",
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: "source-sprint",
        offsetMinutes: 0,
      },
      bodyMarkdown: "Follow up now.",
    }));

    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", {
      targetType: "chat",
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: "source-sprint",
        offsetMinutes: 0,
      },
      chatTarget: {
        bodyMarkdown: "Follow up now.",
      },
    });
  });

  it("schedules quicksprints from flattened MCP fields", async () => {
    vi.mocked(schedulerService.createEntry).mockReturnValue({ id: "entry-1" } as any);

    await actions.handleSchedulerAction(makeArgs("schedule_quicksprint", {
      projectId: "p1",
      scheduledFor: "2026-06-09T12:00:00.000Z",
      templateId: "qs-maintenance",
      taskCount: 6,
      submitMode: "plan_only",
      additionalPrompt: "Focus tests",
    }));

    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", {
      targetType: "quicksprint",
      scheduledFor: "2026-06-09T12:00:00.000Z",
      quicksprintTarget: {
        templateId: "qs-maintenance",
        taskCount: 6,
        submitMode: "plan_only",
        additionalPrompt: "Focus tests",
      },
    });
  });

  it("schedules quicksprints with string taskCount values", async () => {
    vi.mocked(schedulerService.createEntry).mockReturnValue({ id: "entry-1" } as any);

    await actions.handleSchedulerAction(makeArgs("schedule_quicksprint", {
      projectId: "p1",
      scheduledFor: "2026-06-09T12:00:00.000Z",
      templateId: "qs-maintenance",
      taskCount: "9",
    }));

    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", {
      targetType: "quicksprint",
      scheduledFor: "2026-06-09T12:00:00.000Z",
      quicksprintTarget: {
        templateId: "qs-maintenance",
        taskCount: 9,
        submitMode: "plan_and_start",
      },
    });
  });

  it("updates chat target fields", async () => {
    vi.mocked(schedulerService.updateEntry).mockReturnValue({ id: "entry-1", chatTarget: { bodyMarkdown: "new" } } as any);

    const result = await actions.handleSchedulerAction(makeArgs("update", {
      entryId: "entry-1",
      bodyMarkdown: "new",
      threadId: null,
    }));

    expect(schedulerService.updateEntry).toHaveBeenCalledWith("entry-1", {
      chatTarget: {
        bodyMarkdown: "new",
        threadId: null,
      },
    });
    expect(result.result).toEqual({ entry: { id: "entry-1", chatTarget: { bodyMarkdown: "new" } } });
  });

  it("normalizes minute-based recurrence on update", async () => {
    vi.mocked(schedulerService.updateEntry).mockReturnValue({ id: "entry-1" } as any);

    await actions.handleSchedulerAction(makeArgs("update", {
      entryId: "entry-1",
      recurrence: { frequency: "minutely", interval: 30, endMode: "after_count", count: 3 },
    }));

    expect(schedulerService.updateEntry).toHaveBeenCalledWith("entry-1", {
      recurrence: { frequency: "minutely", interval: 30, endMode: "after_count", count: 3, until: null },
    });
  });

  it("updates scheduler anchors from MCP fields", async () => {
    vi.mocked(schedulerService.updateEntry).mockReturnValue({ id: "entry-1" } as any);

    await actions.handleSchedulerAction(makeArgs("update", {
      entryId: "entry-1",
      anchorMode: "after_sprint_end",
      anchorSourceSprintId: "source-sprint",
      anchorOffsetMinutes: 3,
    }));

    expect(schedulerService.updateEntry).toHaveBeenCalledWith("entry-1", {
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: "source-sprint",
        offsetMinutes: 3,
      },
    });
  });

  it("clears scheduler anchors when update switches to absolute mode", async () => {
    vi.mocked(schedulerService.updateEntry).mockReturnValue({ id: "entry-1" } as any);

    await actions.handleSchedulerAction(makeArgs("update", {
      entryId: "entry-1",
      scheduleMode: "absolute",
      scheduledFor: "2026-06-09T12:00:00.000Z",
    }));

    expect(schedulerService.updateEntry).toHaveBeenCalledWith("entry-1", {
      scheduledFor: "2026-06-09T12:00:00.000Z",
      scheduleAnchor: null,
    });
  });

  it("requires approval before deleting a scheduler entry", async () => {
    const result = await actions.handleSchedulerAction(makeArgs("delete", { entryId: "entry-1" }));

    expect(result.approvalRequired).toBe(true);
    expect(schedulerService.deleteEntry).not.toHaveBeenCalled();
  });

  it("runs due entries with a provided clock", async () => {
    await actions.handleSchedulerAction(makeArgs("run_due", { now: "2026-06-09T12:00:00.000Z" }));

    expect(schedulerService.runDueEntries).toHaveBeenCalledWith(new Date("2026-06-09T12:00:00.000Z"));
  });
});

describe("AgentSchedulerActions", () => {
  let schedulerService: SchedulerService;
  let actions: AgentSchedulerActions;
  const fixedNow = new Date("2026-06-09T12:00:00.000Z");

  const makeEntry = (overrides: Partial<SchedulerEntryRecord> = {}): SchedulerEntryRecord => ({
    id: "entry-1",
    projectId: "p1",
    title: "Scheduled agent wakeup",
    targetType: "agent_wakeup",
    status: "scheduled",
    scheduledFor: "2026-06-09T12:05:00.000Z",
    timezone: "UTC",
    recurrence: { frequency: "none", interval: 1, endMode: "never", count: null, until: null },
    nextRunAt: "2026-06-09T12:05:00.000Z",
    lastRunAt: null,
    runCount: 0,
    lastError: null,
    agentWakeupTarget: {
      bodyMarkdown: "Continue the review.",
      origin: "agent_scheduler",
      source: "agent_scheduler",
      createdByAgentId: "agent-1",
    },
    createdAt: "2026-06-09T12:00:00.000Z",
    updatedAt: "2026-06-09T12:00:00.000Z",
    ...overrides,
  });

  const createHandler = (): ManagementToolHandler => new ManagementToolHandler({
    schedulerService,
    projectManagementRepository: {},
    sprintPreviewService: {},
    executionRepository: {},
    getDashboardSettings: () => ({}),
    executionControlService: {},
    taskRerunService: {},
    settingsRepository: {},
    agentPresetSyncService: {},
    memoryService: {},
    memoryPromotionService: {},
    embeddingModelManager: {},
    skillService: {},
    knowledgeService: {},
    planningAgentService: {},
    sprintIssueService: {},
  } as any);

  const parseHandlerResponse = (response: { content: Array<{ text: string }> }): Record<string, any> =>
    JSON.parse(response.content[0].text) as Record<string, any>;

  beforeEach(() => {
    schedulerService = {
      listProjectSchedule: vi.fn(),
      createEntry: vi.fn(),
      getEntry: vi.fn(),
      updateEntry: vi.fn(),
      deleteEntry: vi.fn(),
      runDueEntries: vi.fn(),
    } as unknown as SchedulerService;
    actions = new AgentSchedulerActions(schedulerService, () => fixedNow);
  });

  it("lists only agent scheduler entries created by the calling agent", () => {
    const own = makeEntry();
    const other = makeEntry({
      id: "entry-2",
      agentWakeupTarget: {
        bodyMarkdown: "Other wakeup.",
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: "agent-2",
      },
    });
    vi.mocked(schedulerService.listProjectSchedule).mockReturnValue({
      entries: [own, other],
      occurrences: [
        { id: "occ-1", entryId: "entry-1", projectId: "p1", title: "one", targetType: "agent_wakeup", status: "scheduled", startsAt: own.scheduledFor, occurrenceIndex: 0, isNextRun: true, isCompletedRun: false },
        { id: "occ-2", entryId: "entry-2", projectId: "p1", title: "two", targetType: "agent_wakeup", status: "scheduled", startsAt: other.scheduledFor, occurrenceIndex: 0, isNextRun: true, isCompletedRun: false },
      ],
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-30T00:00:00.000Z",
    });

    const result = actions.handleSchedulerAction({
      action: "list",
      projectId: "p1",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-30T00:00:00.000Z",
    }, "agent-1");

    expect(schedulerService.listProjectSchedule).toHaveBeenCalledWith("p1", "2026-06-01T00:00:00.000Z", "2026-06-30T00:00:00.000Z");
    expect((result.result as any).entries).toEqual([own]);
    expect((result.result as any).occurrences).toHaveLength(1);
  });

  it("normalizes relative delay seconds for wakeup creation", () => {
    vi.mocked(schedulerService.createEntry).mockReturnValue(makeEntry());

    const result = actions.handleSchedulerAction({
      action: "schedule_wakeup",
      projectId: "p1",
      delaySeconds: 90,
      title: "Review wakeup",
      timezone: "Europe/Berlin",
      bodyMarkdown: "Continue the review.",
      threadId: "thread-1",
      connectionId: "conn-1",
    }, "agent-1");

    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", {
      targetType: "agent_wakeup",
      scheduledFor: "2026-06-09T12:01:30.000Z",
      title: "Review wakeup",
      timezone: "Europe/Berlin",
      agentWakeupTarget: {
        bodyMarkdown: "Continue the review.",
        title: "Review wakeup",
        threadId: "thread-1",
        connectionId: "conn-1",
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: "agent-1",
      },
    });
    expect(result.result).toEqual({ entry: makeEntry() });
  });

  it("normalizes relative delay minutes for task creation", () => {
    const taskEntry = makeEntry({
      targetType: "task",
      agentWakeupTarget: undefined,
      taskTarget: {
        taskId: "task-1",
        provider: "codex",
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: "agent-1",
      },
    });
    vi.mocked(schedulerService.createEntry).mockReturnValue(taskEntry);

    actions.handleSchedulerAction({
      action: "schedule_task",
      projectId: "p1",
      delayMinutes: "15",
      title: "Rerun task",
      taskId: "task-1",
      provider: "codex",
    }, "agent-1");

    expect(schedulerService.createEntry).toHaveBeenCalledWith("p1", {
      targetType: "task",
      scheduledFor: "2026-06-09T12:15:00.000Z",
      title: "Rerun task",
      taskTarget: {
        taskId: "task-1",
        provider: "codex",
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: "agent-1",
      },
    });
  });

  it("cancels only entries created by the calling agent", () => {
    const entry = makeEntry();
    vi.mocked(schedulerService.getEntry).mockReturnValue(entry);
    vi.mocked(schedulerService.updateEntry).mockReturnValue({ ...entry, status: "cancelled" });

    const result = actions.handleSchedulerAction({ action: "cancel", entryId: "entry-1" }, "agent-1");

    expect(schedulerService.updateEntry).toHaveBeenCalledWith("entry-1", { status: "cancelled" });
    expect(result.result).toEqual({ status: "success", entry: { ...entry, status: "cancelled" } });
  });

  it("returns a validation envelope for unauthorized cancellation", async () => {
    vi.mocked(schedulerService.getEntry).mockReturnValue(makeEntry({
      agentWakeupTarget: {
        bodyMarkdown: "Continue the review.",
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: "agent-2",
      },
    }));
    const handler = createHandler();

    const response = await runWithMcpAgentContext("agent-1", () =>
      handler.handleScheduler({ action: "cancel", entryId: "entry-1" }),
    );
    const parsed = parseHandlerResponse(response);

    expect(response.isError).toBe(true);
    expect(parsed.result).toMatchObject({
      status: "error",
      domain: "scheduler",
      action: "cancel",
      errorType: "validation",
      field: "entryId",
    });
    expect(schedulerService.updateEntry).not.toHaveBeenCalled();
  });

  it("rejects cancellation for non-agent scheduler entries", async () => {
    vi.mocked(schedulerService.getEntry).mockReturnValue(makeEntry({
      targetType: "chat",
      agentWakeupTarget: undefined,
      chatTarget: { bodyMarkdown: "Dashboard-created reminder." },
    }));
    const handler = createHandler();

    const response = await runWithMcpAgentContext("agent-1", () =>
      handler.handleScheduler({ action: "cancel", entryId: "entry-1" }),
    );
    const parsed = parseHandlerResponse(response);

    expect(response.isError).toBe(true);
    expect(parsed.result).toMatchObject({
      status: "error",
      domain: "scheduler",
      action: "cancel",
      errorType: "validation",
      field: "entryId",
    });
    expect(schedulerService.updateEntry).not.toHaveBeenCalled();
  });

  it("rejects scheduler calls without an agent context", async () => {
    const handler = createHandler();

    const response = await runWithMcpAgentContext(null, () =>
      handler.handleScheduler({ action: "schedule_wakeup", projectId: "p1", scheduledFor: "2026-06-09T12:00:00.000Z", bodyMarkdown: "Wake up." }),
    );
    const parsed = parseHandlerResponse(response);

    expect(response.isError).toBe(true);
    expect(parsed.result).toMatchObject({
      status: "error",
      domain: "scheduler",
      action: "schedule_wakeup",
      errorType: "validation",
      field: "agentId",
    });
    expect(schedulerService.createEntry).not.toHaveBeenCalled();
  });
});
