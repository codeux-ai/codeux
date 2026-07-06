import { describe, expect, it, vi } from "vitest";
import { SchedulerService } from "../../../src/services/scheduler-service.js";
import { normalizeRecurrenceRule } from "../../../src/domain/scheduler/schedule-time.js";
import type { SchedulerEntryRecord } from "../../../src/contracts/scheduler-types.js";

const createLogger = () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => createLogger()),
});

const createEntry = (overrides: Partial<SchedulerEntryRecord> = {}): SchedulerEntryRecord => ({
  id: "entry-1",
  projectId: "project-1",
  title: "Run sprint",
  targetType: "sprint",
  status: "scheduled",
  scheduledFor: "2026-05-18T09:00:00.000Z",
  timezone: "UTC",
  recurrence: normalizeRecurrenceRule({ frequency: "daily", interval: 1, endMode: "after_count", count: 2 }),
  nextRunAt: "2026-05-18T09:00:00.000Z",
  lastRunAt: null,
  runCount: 0,
  lastError: null,
  sprintTarget: { sprintId: "sprint-1" },
  createdAt: "2026-05-18T08:00:00.000Z",
  updatedAt: "2026-05-18T08:00:00.000Z",
  ...overrides,
});

describe("SchedulerService", () => {
  it("runs due sprint entries and advances recurrence", async () => {
    const entry = createEntry();
    const schedulerRepository = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const executionControlService = {
      orchestrateSprint: vi.fn().mockResolvedValue({ ok: true }),
    };
    const service = new SchedulerService({
      schedulerRepository: schedulerRepository as any,
      projectManagementRepository: {} as any,
      quicksprintService: {} as any,
      chatThreadRuntimeService: {} as any,
      executionControlService: executionControlService as any,
      logger: createLogger() as any,
    });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));

    expect(executionControlService.orchestrateSprint).toHaveBeenCalledWith("project-1", "sprint-1");
    expect(schedulerRepository.markRunSucceeded).toHaveBeenCalledWith(
      "entry-1",
      "2026-05-18T09:00:00.000Z",
      "2026-05-19T09:00:00.000Z",
    );
  });

  it("posts due chat messages through the chat runtime", async () => {
    const entry = createEntry({
      targetType: "chat",
      sprintTarget: undefined,
      chatTarget: { bodyMarkdown: "Prepare the daily status.", title: "Daily status" },
      recurrence: normalizeRecurrenceRule(),
    });
    const schedulerRepository = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const chatThreadRuntimeService = {
      postMessage: vi.fn().mockResolvedValue({ id: "message-1" }),
    };
    const service = new SchedulerService({
      schedulerRepository: schedulerRepository as any,
      projectManagementRepository: {} as any,
      quicksprintService: {} as any,
      chatThreadRuntimeService: chatThreadRuntimeService as any,
      executionControlService: {} as any,
      logger: createLogger() as any,
    });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));

    expect(chatThreadRuntimeService.postMessage).toHaveBeenCalledWith("project-1", expect.objectContaining({
      bodyMarkdown: "Prepare the daily status.",
      title: "Daily status",
      metadata: expect.objectContaining({ source: "scheduler", schedulerEntryId: "entry-1" }),
    }));
    expect(schedulerRepository.markRunSucceeded).toHaveBeenCalledWith("entry-1", "2026-05-18T09:00:00.000Z", null);
  });

  it("runs anchored entries only after the source sprint terminal time plus offset", async () => {
    const entry = createEntry({
      targetType: "chat",
      sprintTarget: undefined,
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: "source-sprint",
        offsetMinutes: 10,
      },
      recurrence: normalizeRecurrenceRule(),
      nextRunAt: null,
      chatTarget: { bodyMarkdown: "Start follow-up." },
    });
    const repo = {
      listDueEntries: vi.fn(() => []),
      listScheduledAnchoredEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const projectManagementRepository = {
      getSprint: vi.fn(() => ({
        id: "source-sprint",
        projectId: "project-1",
        status: "completed",
        endDate: "2026-05-18T09:00:00.000Z",
      })),
    };
    const chatThreadRuntimeService = {
      postMessage: vi.fn().mockResolvedValue({ id: "message-1" }),
    };
    const service = buildService(repo, { projectManagementRepository, chatThreadRuntimeService });

    await service.runDueEntries(new Date("2026-05-18T09:09:59.000Z"));
    expect(chatThreadRuntimeService.postMessage).not.toHaveBeenCalled();
    expect(repo.markRunSucceeded).not.toHaveBeenCalled();

    await service.runDueEntries(new Date("2026-05-18T09:10:00.000Z"));

    expect(chatThreadRuntimeService.postMessage).toHaveBeenCalledWith("project-1", expect.objectContaining({
      bodyMarkdown: "Start follow-up.",
    }));
    expect(repo.markRunSucceeded).toHaveBeenCalledWith("entry-1", "2026-05-18T09:10:00.000Z", null);
  });

  it("prefers the latest terminal sprint run finish time for anchored due checks", async () => {
    const entry = createEntry({
      targetType: "chat",
      sprintTarget: undefined,
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: "source-sprint",
        offsetMinutes: 5,
      },
      recurrence: normalizeRecurrenceRule(),
      nextRunAt: null,
      chatTarget: { bodyMarkdown: "Start follow-up." },
    });
    const repo = {
      listDueEntries: vi.fn(() => []),
      listScheduledAnchoredEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const projectManagementRepository = {
      getSprint: vi.fn(() => ({
        id: "source-sprint",
        projectId: "project-1",
        status: "completed",
        endDate: "2026-05-18T08:00:00.000Z",
      })),
    };
    const executionRepository = {
      listSprintRuns: vi.fn(() => [
        { status: "completed", finishedAt: "2026-05-18T09:30:00.000Z" },
        { status: "failed", finishedAt: "2026-05-18T09:45:00.000Z" },
      ]),
    };
    const chatThreadRuntimeService = {
      postMessage: vi.fn().mockResolvedValue({ id: "message-1" }),
    };
    const service = buildService(repo, { projectManagementRepository, executionRepository, chatThreadRuntimeService });

    await service.runDueEntries(new Date("2026-05-18T09:49:59.000Z"));
    expect(chatThreadRuntimeService.postMessage).not.toHaveBeenCalled();

    await service.runDueEntries(new Date("2026-05-18T09:50:00.000Z"));
    expect(repo.markRunSucceeded).toHaveBeenCalledWith("entry-1", "2026-05-18T09:50:00.000Z", null);
  });

  const buildService = (repo: Record<string, unknown>, extra: Partial<Record<string, unknown>> = {}) =>
    new SchedulerService({
      schedulerRepository: repo as any,
      projectManagementRepository: (extra.projectManagementRepository ?? {}) as any,
      executionRepository: extra.executionRepository as any,
      quicksprintService: (extra.quicksprintService ?? {}) as any,
      chatThreadRuntimeService: (extra.chatThreadRuntimeService ?? {}) as any,
      executionControlService: (extra.executionControlService ?? {}) as any,
      logger: createLogger() as any,
      tickIntervalMs: (extra.tickIntervalMs as number) ?? 30_000,
    });

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it("executes quicksprint targets", async () => {
    const entry = createEntry({
      targetType: "quicksprint",
      sprintTarget: undefined,
      quicksprintTarget: { prompt: "do it" } as any,
    });
    const repo = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const quicksprintService = { executeQuicksprint: vi.fn().mockResolvedValue({ ok: true }) };
    const service = buildService(repo, { quicksprintService });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));
    expect(quicksprintService.executeQuicksprint).toHaveBeenCalledWith("project-1", { prompt: "do it" });
  });

  it("creates a settings-managed memory remediation schedule", () => {
    const created = createEntry({
      targetType: "memory_remediation",
      sprintTarget: undefined,
      title: "Long-term memory remediation",
      recurrence: normalizeRecurrenceRule({ frequency: "daily", interval: 1 }),
      memoryRemediationTarget: { mode: "ai", source: "memory_settings" },
    });
    const repo = {
      listEntries: vi.fn(() => []),
      createEntry: vi.fn(() => created),
    };
    const service = buildService(repo);

    const result = service.setMemoryRemediationSchedule("project-1", {
      cadence: "daily",
      mode: "ai",
      scheduledFor: "2026-05-18T03:00:00.000Z",
      timezone: "Europe/Berlin",
    });

    expect(repo.createEntry).toHaveBeenCalledWith("project-1", expect.objectContaining({
      title: "Long-term memory remediation",
      targetType: "memory_remediation",
      recurrence: { frequency: "daily", interval: 1, endMode: "never" },
      memoryRemediationTarget: { mode: "ai", source: "memory_settings" },
    }));
    expect(result).toEqual({ entry: created, cadence: "daily", mode: "ai" });
  });

  it("updates and pauses an existing settings-managed memory remediation schedule", () => {
    const existing = createEntry({
      targetType: "memory_remediation",
      sprintTarget: undefined,
      recurrence: normalizeRecurrenceRule({ frequency: "daily", interval: 1 }),
      memoryRemediationTarget: { mode: "deterministic", source: "memory_settings" },
    });
    const updated = { ...existing, recurrence: normalizeRecurrenceRule({ frequency: "weekly", interval: 1 }), memoryRemediationTarget: { mode: "ai" as const, source: "memory_settings" as const } };
    const paused = { ...updated, status: "paused" as const };
    const repo = {
      listEntries: vi.fn(() => [existing]),
      updateEntry: vi.fn()
        .mockReturnValueOnce(updated)
        .mockReturnValueOnce(paused),
    };
    const service = buildService(repo);

    const weekly = service.setMemoryRemediationSchedule("project-1", {
      cadence: "weekly",
      mode: "ai",
      scheduledFor: "2026-05-18T03:00:00.000Z",
    });
    const off = service.setMemoryRemediationSchedule("project-1", {
      cadence: "off",
      mode: "ai",
    });

    expect(repo.updateEntry).toHaveBeenNthCalledWith(1, existing.id, expect.objectContaining({
      status: "scheduled",
      recurrence: { frequency: "weekly", interval: 1, endMode: "never" },
      memoryRemediationTarget: { mode: "ai", source: "memory_settings" },
    }));
    expect(repo.updateEntry).toHaveBeenNthCalledWith(2, existing.id, { status: "paused" });
    expect(weekly.cadence).toBe("weekly");
    expect(off.cadence).toBe("off");
  });

  it("marks the run as failed when execution rejects", async () => {
    const entry = createEntry({ sprintTarget: { sprintId: "sprint-1" } });
    const repo = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const executionControlService = { orchestrateSprint: vi.fn().mockRejectedValue(new Error("boom")) };
    const service = buildService(repo, { executionControlService });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));
    await flush();

    expect(repo.markRunFailed).toHaveBeenCalledWith("entry-1", "boom");
  });

  it("throws (and records failure) when a scheduled target is missing", async () => {
    const entry = createEntry({ targetType: "sprint", sprintTarget: undefined });
    const repo = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const service = buildService(repo);

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));
    await flush();
    expect(repo.markRunFailed).toHaveBeenCalledWith("entry-1", "Scheduled sprint target is missing.");
  });

  it("skips entries that are no longer scheduled or are now in the future", async () => {
    const entry = createEntry();
    const repo = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => ({ ...entry, status: "paused" })),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const executionControlService = { orchestrateSprint: vi.fn() };
    const service = buildService(repo, { executionControlService });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));
    expect(executionControlService.orchestrateSprint).not.toHaveBeenCalled();
    expect(repo.markRunSucceeded).not.toHaveBeenCalled();
  });

  it("lists a project's schedule with computed occurrences and normalized bounds", () => {
    const entry = createEntry();
    const repo = { listEntries: vi.fn(() => [entry]) };
    const service = buildService(repo);

    const result = service.listProjectSchedule("project-1", "2026-05-18T00:00:00Z", "2026-05-25T00:00:00Z");
    expect(repo.listEntries).toHaveBeenCalledWith("project-1");
    expect(result.entries).toEqual([entry]);
    expect(result.from).toBe("2026-05-18T00:00:00.000Z");
    expect(Array.isArray(result.occurrences)).toBe(true);
  });

  it("does not expose anchored schedule occurrences before the source sprint is terminal", () => {
    const entry = createEntry({
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: "source-sprint",
        offsetMinutes: 0,
      },
      scheduledFor: "2026-05-18T09:00:00.000Z",
      recurrence: normalizeRecurrenceRule(),
      nextRunAt: null,
    });
    const repo = { listEntries: vi.fn(() => [entry]) };
    const projectManagementRepository = {
      getSprint: vi.fn(() => ({
        id: "source-sprint",
        projectId: "project-1",
        status: "active",
        endDate: null,
      })),
    };
    const service = buildService(repo, { projectManagementRepository });

    const result = service.listProjectSchedule("project-1", "2026-05-18T00:00:00Z", "2026-05-19T00:00:00Z");

    expect(result.occurrences).toEqual([]);
  });

  it("exposes an anchored schedule occurrence when the source sprint is terminal", () => {
    const entry = createEntry({
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: "source-sprint",
        offsetMinutes: 0,
      },
      scheduledFor: "2026-05-18T09:00:00.000Z",
      recurrence: normalizeRecurrenceRule(),
      nextRunAt: null,
    });
    const repo = { listEntries: vi.fn(() => [entry]) };
    const projectManagementRepository = {
      getSprint: vi.fn(() => ({
        id: "source-sprint",
        projectId: "project-1",
        status: "completed",
        endDate: "2026-05-18T11:30:00.000Z",
      })),
    };
    const service = buildService(repo, { projectManagementRepository });

    const result = service.listProjectSchedule("project-1", "2026-05-18T00:00:00Z", "2026-05-19T00:00:00Z");

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toEqual(expect.objectContaining({
      entryId: entry.id,
      startsAt: "2026-05-18T11:30:00.000Z",
      occurrenceIndex: 1,
    }));
  });

  it("exposes anchored schedule occurrences at terminal run finish time plus offset", () => {
    const entry = createEntry({
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: "source-sprint",
        offsetMinutes: 45,
      },
      scheduledFor: "2026-05-18T09:00:00.000Z",
      recurrence: normalizeRecurrenceRule(),
      nextRunAt: null,
    });
    const repo = { listEntries: vi.fn(() => [entry]) };
    const projectManagementRepository = {
      getSprint: vi.fn(() => ({
        id: "source-sprint",
        projectId: "project-1",
        status: "failed",
        endDate: "2026-05-18T10:00:00.000Z",
      })),
    };
    const executionRepository = {
      listSprintRuns: vi.fn(() => [
        { status: "completed", finishedAt: "2026-05-18T12:05:00.000Z" },
        { status: "active", finishedAt: "2026-05-18T12:30:00.000Z" },
      ]),
    };
    const service = buildService(repo, { projectManagementRepository, executionRepository });

    const result = service.listProjectSchedule("project-1", "2026-05-18T00:00:00Z", "2026-05-19T00:00:00Z");

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]?.startsAt).toBe("2026-05-18T12:50:00.000Z");
  });

  it("validates sprint targets on create against the owning project and status", () => {
    const projectManagementRepository = {
      getSprint: vi.fn(() => ({ id: "sprint-1", projectId: "other-project", status: "active" })),
    };
    const repo = { createEntry: vi.fn() };
    const service = buildService(repo, { projectManagementRepository });

    expect(() =>
      service.createEntry("project-1", { targetType: "sprint", sprintTarget: { sprintId: "sprint-1" } } as any),
    ).toThrow(/Only sprints in the selected project/);
    expect(repo.createEntry).not.toHaveBeenCalled();
  });

  it("validates after-sprint-end anchors against project ownership and target sprint identity", () => {
    const projectManagementRepository = {
      getSprint: vi.fn((sprintId: string) => {
        if (sprintId === "source-other") {
          return { id: sprintId, projectId: "other-project", status: "completed" };
        }
        return { id: sprintId, projectId: "project-1", status: "idle" };
      }),
    };
    const repo = { createEntry: vi.fn() };
    const service = buildService(repo, { projectManagementRepository });

    expect(() => service.createEntry("project-1", {
      targetType: "chat",
      scheduleAnchor: { mode: "after_sprint_end", sourceSprintId: "source-other" },
      chatTarget: { bodyMarkdown: "hi" },
    })).toThrow(/selected project/);

    expect(() => service.createEntry("project-1", {
      targetType: "sprint",
      scheduleAnchor: { mode: "after_sprint_end", sourceSprintId: "sprint-1" },
      sprintTarget: { sprintId: "sprint-1" },
    })).toThrow(/own completion/);

    expect(repo.createEntry).not.toHaveBeenCalled();
  });

  it("rejects recurrence on after-sprint-end anchors before persistence", () => {
    const projectManagementRepository = {
      getSprint: vi.fn(() => ({ id: "source-sprint", projectId: "project-1", status: "completed" })),
    };
    const repo = { createEntry: vi.fn() };
    const service = buildService(repo, { projectManagementRepository });

    expect(() => service.createEntry("project-1", {
      targetType: "chat",
      scheduleAnchor: { mode: "after_sprint_end", sourceSprintId: "source-sprint" },
      recurrence: { frequency: "daily", interval: 1 },
      chatTarget: { bodyMarkdown: "hi" },
    })).toThrow(/do not support recurrence/);
    expect(repo.createEntry).not.toHaveBeenCalled();
  });

  it("rejects scheduling completed sprints", () => {
    const projectManagementRepository = {
      getSprint: vi.fn(() => ({ id: "sprint-1", projectId: "project-1", status: "completed" })),
    };
    const service = buildService({ createEntry: vi.fn() }, { projectManagementRepository });
    expect(() =>
      service.createEntry("project-1", { targetType: "sprint", sprintTarget: { sprintId: "sprint-1" } } as any),
    ).toThrow(/Completed sprints cannot be scheduled/);
  });

  it("creates non-sprint entries without sprint validation", () => {
    const repo = { createEntry: vi.fn(() => createEntry({ targetType: "chat" })) };
    const service = buildService(repo);
    const created = service.createEntry("project-1", { targetType: "chat", chatTarget: { bodyMarkdown: "hi" } } as any);
    expect(repo.createEntry).toHaveBeenCalled();
    expect(created.targetType).toBe("chat");
  });

  it("updates an existing entry by re-validating the merged target", () => {
    const current = createEntry();
    const projectManagementRepository = {
      getSprint: vi.fn(() => ({ id: "sprint-1", projectId: "project-1", status: "active" })),
    };
    const repo = {
      getEntry: vi.fn(() => current),
      updateEntry: vi.fn((id: string, input: unknown) => ({ ...current, ...(input as object) })),
    };
    const service = buildService(repo, { projectManagementRepository });

    service.updateEntry("entry-1", { title: "renamed" } as any);
    expect(projectManagementRepository.getSprint).toHaveBeenCalledWith("sprint-1");
    expect(repo.updateEntry).toHaveBeenCalledWith("entry-1", { title: "renamed" });
  });

  it("updates a missing entry by delegating straight to the repository", () => {
    const repo = {
      getEntry: vi.fn(() => null),
      updateEntry: vi.fn(() => createEntry()),
    };
    const service = buildService(repo);
    service.updateEntry("entry-1", { title: "x" } as any);
    expect(repo.updateEntry).toHaveBeenCalledWith("entry-1", { title: "x" });
  });

  it("deletes entries through the repository", () => {
    const repo = { deleteEntry: vi.fn() };
    const service = buildService(repo);
    service.deleteEntry("entry-1");
    expect(repo.deleteEntry).toHaveBeenCalledWith("entry-1");
  });

  it("start schedules a recurring tick and stop clears it (idempotent)", () => {
    vi.useFakeTimers();
    try {
      const repo = {
        listDueEntries: vi.fn(() => []),
        getEntry: vi.fn(),
        markRunSucceeded: vi.fn(),
        markRunFailed: vi.fn(),
      };
      const service = buildService(repo, { tickIntervalMs: 1000 });

      service.start();
      service.start(); // second start is a no-op
      expect(repo.listDueEntries).toHaveBeenCalledTimes(1); // immediate run

      vi.advanceTimersByTime(2000);
      expect(repo.listDueEntries).toHaveBeenCalledTimes(3);

      service.stop();
      service.stop(); // second stop is a no-op
      vi.advanceTimersByTime(5000);
      expect(repo.listDueEntries).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs start tick failures instead of leaving an unhandled rejection", async () => {
    let service: SchedulerService | null = null;
    try {
      const error = new Error("scheduler db unavailable");
      const repo = {
        listDueEntries: vi.fn(() => {
          throw error;
        }),
        getEntry: vi.fn(),
        markRunSucceeded: vi.fn(),
        markRunFailed: vi.fn(),
      };
      const logger = createLogger();
      service = new SchedulerService({
        schedulerRepository: repo as any,
        projectManagementRepository: {} as any,
        quicksprintService: {} as any,
        chatThreadRuntimeService: {} as any,
        executionControlService: {} as any,
        logger: logger as any,
        tickIntervalMs: 1000,
      });

      service.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalledWith("Scheduler run-due tick failed", { error });
    } finally {
      service?.stop();
    }
  });
});
