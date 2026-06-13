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
});
