import { describe, expect, it, vi, beforeEach } from "vitest";
import { SchedulerActions } from "../../../src/mcp/management/scheduler-actions.js";
import type { ManageCodeUxArgs } from "../../../src/contracts/internal-management-types.js";
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
      updateEntry: vi.fn(),
      deleteEntry: vi.fn(),
      runDueEntries: vi.fn(),
    } as unknown as SchedulerService;
    actions = new SchedulerActions(schedulerService);
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
      recurrence: { frequency: "daily", interval: 1, endMode: "never" },
      chatTarget: {
        bodyMarkdown: "Please summarize progress.",
        title: "Daily check-in",
        threadId: "thread-1",
        connectionId: "conn-1",
      },
    });
    expect(result.result).toEqual({ entry: { id: "entry-1" } });
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
