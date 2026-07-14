import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { SchedulerService } from "../../../src/services/scheduler-service.js";
import { normalizeRecurrenceRule } from "../../../src/domain/scheduler/schedule-time.js";
import type { SchedulerEntryRecord } from "../../../src/contracts/scheduler-types.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SchedulerRepository } from "../../../src/repositories/scheduler-repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

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
  it("routes planned due sprint entries through the normal start path and advances recurrence", async () => {
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
    const projectManagementRepository = {
      listTasks: vi.fn(() => [{ id: "task-1" }]),
    };
    const service = new SchedulerService({
      schedulerRepository: schedulerRepository as any,
      projectManagementRepository: projectManagementRepository as any,
      quicksprintService: {} as any,
      chatThreadRuntimeService: {} as any,
      executionControlService: executionControlService as any,
      logger: createLogger() as any,
    });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));

    expect(projectManagementRepository.listTasks).not.toHaveBeenCalled();
    expect(executionControlService.orchestrateSprint).toHaveBeenCalledOnce();
    expect(executionControlService.orchestrateSprint).toHaveBeenCalledWith("project-1", "sprint-1");
    expect(schedulerRepository.markRunSucceeded).toHaveBeenCalledWith(
      "entry-1",
      "2026-05-18T09:00:00.000Z",
      "2026-05-19T09:00:00.000Z",
    );
  });

  it("routes unplanned due sprint entries through the normal start path", async () => {
    const entry = createEntry();
    const schedulerRepository = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const executionControlService = { orchestrateSprint: vi.fn().mockResolvedValue({ ok: true }) };
    const projectManagementRepository = { listTasks: vi.fn(() => []) };
    const service = new SchedulerService({
      schedulerRepository: schedulerRepository as any,
      projectManagementRepository: projectManagementRepository as any,
      quicksprintService: {} as any,
      chatThreadRuntimeService: {} as any,
      executionControlService: executionControlService as any,
      logger: createLogger() as any,
    });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));
    await flush();

    expect(projectManagementRepository.listTasks).not.toHaveBeenCalled();
    expect(executionControlService.orchestrateSprint).toHaveBeenCalledOnce();
    expect(executionControlService.orchestrateSprint).toHaveBeenCalledWith("project-1", "sprint-1");
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

  it("posts due agent wakeups through the chat runtime with agent scheduler metadata", async () => {
    const entry = createEntry({
      targetType: "agent_wakeup",
      sprintTarget: undefined,
      agentWakeupTarget: {
        bodyMarkdown: "Wake up and continue the review.",
        threadId: "thread-1",
        title: "Review wakeup",
        connectionId: "connection-1",
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: "agent-1",
      },
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
    const service = buildService(schedulerRepository, { chatThreadRuntimeService });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));

    expect(chatThreadRuntimeService.postMessage).toHaveBeenCalledWith("project-1", {
      threadId: "thread-1",
      title: "Review wakeup",
      connectionId: "connection-1",
      bodyMarkdown: "Wake up and continue the review.",
      metadata: {
        source: "agent_scheduler",
        origin: "agent_scheduler",
        schedulerEntryId: "entry-1",
        scheduledFor: "2026-05-18T09:00:00.000Z",
        createdByAgentId: "agent-1",
      },
    });
    expect(schedulerRepository.markRunSucceeded).toHaveBeenCalledWith("entry-1", "2026-05-18T09:00:00.000Z", null);
  });

  it("keeps a due agent wakeup eligible while its originating thread is busy", async () => {
    const entry = createEntry({
      targetType: "agent_wakeup",
      sprintTarget: undefined,
      agentWakeupTarget: {
        bodyMarkdown: "Continue after the active reply.",
        threadId: "thread-1",
        origin: "agent_scheduler",
        source: "agent_scheduler",
      },
      recurrence: normalizeRecurrenceRule(),
    });
    const schedulerRepository = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    let busy = true;
    const chatThreadRuntimeService = {
      isThreadBusy: vi.fn(() => busy),
      postMessage: vi.fn().mockResolvedValue({ id: "message-1" }),
    };
    const service = buildService(schedulerRepository, { chatThreadRuntimeService });
    const now = new Date("2026-05-18T09:00:01.000Z");

    await service.runDueEntries(now);

    expect(chatThreadRuntimeService.isThreadBusy).toHaveBeenCalledWith("thread-1");
    expect(chatThreadRuntimeService.postMessage).not.toHaveBeenCalled();
    expect(schedulerRepository.markRunSucceeded).not.toHaveBeenCalled();
    expect(schedulerRepository.markRunFailed).not.toHaveBeenCalled();

    busy = false;
    await service.runDueEntries(now);

    expect(chatThreadRuntimeService.postMessage).toHaveBeenCalledTimes(1);
    expect(schedulerRepository.markRunSucceeded).toHaveBeenCalledWith(
      "entry-1",
      "2026-05-18T09:00:00.000Z",
      null,
    );
  });

  it("accepts multiple due wakeups for one thread one flight at a time", async () => {
    const firstEntry = createEntry({
      id: "entry-1",
      targetType: "agent_wakeup",
      sprintTarget: undefined,
      agentWakeupTarget: {
        bodyMarkdown: "First continuation.",
        threadId: "thread-1",
        origin: "agent_scheduler",
        source: "agent_scheduler",
      },
      recurrence: normalizeRecurrenceRule(),
    });
    const secondEntry = createEntry({
      id: "entry-2",
      targetType: "agent_wakeup",
      sprintTarget: undefined,
      agentWakeupTarget: {
        bodyMarkdown: "Second continuation.",
        threadId: "thread-1",
        origin: "agent_scheduler",
        source: "agent_scheduler",
      },
      recurrence: normalizeRecurrenceRule(),
    });
    const entries = new Map([
      [firstEntry.id, firstEntry],
      [secondEntry.id, secondEntry],
    ]);
    const schedulerRepository = {
      listDueEntries: vi.fn(() => [...entries.values()].filter((entry) => entry.status === "scheduled")),
      getEntry: vi.fn((entryId: string) => entries.get(entryId) ?? null),
      markRunSucceeded: vi.fn((entryId: string) => {
        const entry = entries.get(entryId)!;
        entries.set(entryId, { ...entry, status: "completed" });
      }),
      markRunFailed: vi.fn(),
    };
    let busy = false;
    const chatThreadRuntimeService = {
      isThreadBusy: vi.fn(() => busy),
      postMessage: vi.fn().mockImplementation(async () => {
        busy = true;
        return { id: "message-1" };
      }),
    };
    const service = buildService(schedulerRepository, { chatThreadRuntimeService });
    const now = new Date("2026-05-18T09:00:01.000Z");

    await service.runDueEntries(now);

    expect(chatThreadRuntimeService.postMessage).toHaveBeenCalledTimes(1);
    expect(chatThreadRuntimeService.postMessage.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      bodyMarkdown: "First continuation.",
    }));
    expect(schedulerRepository.markRunSucceeded).toHaveBeenCalledTimes(1);

    await flush();
    busy = false;
    await service.runDueEntries(now);

    expect(chatThreadRuntimeService.postMessage).toHaveBeenCalledTimes(2);
    expect(chatThreadRuntimeService.postMessage.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      bodyMarkdown: "Second continuation.",
    }));
    expect(schedulerRepository.markRunSucceeded).toHaveBeenCalledTimes(2);
  });

  it("reruns due task targets through the task rerun service", async () => {
    const entry = createEntry({
      targetType: "task",
      sprintTarget: undefined,
      taskTarget: {
        taskId: "task-1",
        provider: "codex",
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: "agent-1",
      },
      recurrence: normalizeRecurrenceRule(),
    });
    const schedulerRepository = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const taskRerunService = {
      rerunTask: vi.fn().mockResolvedValue({ id: "task-1" }),
    };
    const service = buildService(schedulerRepository, { taskRerunService });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));

    expect(taskRerunService.rerunTask).toHaveBeenCalledWith("task-1", { provider: "codex" });
    expect(schedulerRepository.markRunSucceeded).toHaveBeenCalledWith("entry-1", "2026-05-18T09:00:00.000Z", null);
  });

  it("runs anchored entries only after the source sprint completion time plus offset", async () => {
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
    const executionRepository = {
      listSprintRuns: vi.fn(() => [
        { status: "completed", finishedAt: "not-a-timestamp" },
        { status: "failed", finishedAt: "2026-05-18T09:30:00.000Z" },
        { status: "cancelled", finishedAt: "2026-05-18T09:45:00.000Z" },
      ]),
    };
    const service = buildService(repo, {
      projectManagementRepository,
      executionRepository,
      chatThreadRuntimeService,
    });

    await service.runDueEntries(new Date("2026-05-18T09:09:59.000Z"));
    expect(chatThreadRuntimeService.postMessage).not.toHaveBeenCalled();
    expect(repo.markRunSucceeded).not.toHaveBeenCalled();

    await service.runDueEntries(new Date("2026-05-18T09:10:00.000Z"));

    expect(chatThreadRuntimeService.postMessage).toHaveBeenCalledWith("project-1", expect.objectContaining({
      bodyMarkdown: "Start follow-up.",
    }));
    expect(repo.markRunSucceeded).toHaveBeenCalledWith("entry-1", "2026-05-18T09:10:00.000Z", null);
  });

  it("prefers the latest successful sprint run finish time for anchored due checks", async () => {
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
        { status: "cancelled", finishedAt: "2026-05-18T10:00:00.000Z" },
      ]),
    };
    const chatThreadRuntimeService = {
      postMessage: vi.fn().mockResolvedValue({ id: "message-1" }),
    };
    const service = buildService(repo, { projectManagementRepository, executionRepository, chatThreadRuntimeService });

    await service.runDueEntries(new Date("2026-05-18T09:34:59.000Z"));
    expect(chatThreadRuntimeService.postMessage).not.toHaveBeenCalled();

    await service.runDueEntries(new Date("2026-05-18T09:35:00.000Z"));
    expect(repo.markRunSucceeded).toHaveBeenCalledWith("entry-1", "2026-05-18T09:35:00.000Z", null);
  });

  it.each(["failed", "cancelled"])(
    "does not run sprint-anchored entries when the source sprint is %s",
    async (sourceStatus) => {
      const entry = createEntry({
        targetType: "chat",
        sprintTarget: undefined,
        scheduleAnchor: {
          mode: "after_sprint_end",
          sourceSprintId: "source-sprint",
          offsetMinutes: 0,
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
          status: sourceStatus,
          endDate: "2026-05-18T09:00:00.000Z",
        })),
      };
      const executionRepository = {
        listSprintRuns: vi.fn(() => [
          { status: "completed", finishedAt: "2026-05-18T08:30:00.000Z" },
          { status: sourceStatus, finishedAt: "2026-05-18T09:00:00.000Z" },
        ]),
      };
      const chatThreadRuntimeService = {
        postMessage: vi.fn().mockResolvedValue({ id: "message-1" }),
      };
      const service = buildService(repo, {
        projectManagementRepository,
        executionRepository,
        chatThreadRuntimeService,
      });

      await service.runDueEntries(new Date("2026-05-19T09:00:00.000Z"));

      expect(chatThreadRuntimeService.postMessage).not.toHaveBeenCalled();
      expect(repo.markRunSucceeded).not.toHaveBeenCalled();
      expect(executionRepository.listSprintRuns).not.toHaveBeenCalled();
    },
  );

  it("runs task-anchored wakeups after the source task completion time plus offset", async () => {
    const entry = createEntry({
      targetType: "agent_wakeup",
      sprintTarget: undefined,
      scheduleAnchor: {
        mode: "after_task_end",
        sourceTaskId: "task-1",
        offsetMinutes: 5,
      },
      recurrence: normalizeRecurrenceRule(),
      nextRunAt: null,
      agentWakeupTarget: {
        bodyMarkdown: "Send the task report.",
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: "agent-1",
      },
    });
    const repo = {
      listDueEntries: vi.fn(() => []),
      listScheduledAnchoredEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const projectManagementRepository = {
      getTask: vi.fn(() => ({
        id: "task-1",
        projectId: "project-1",
        status: "completed",
        updatedAt: "2026-05-18T09:00:00.000Z",
      })),
    };
    const executionRepository = {
      getLatestTaskRun: vi.fn(() => ({
        state: "COMPLETED",
        finishedAt: "2026-05-18T09:10:00.000Z",
      })),
      listTaskDispatches: vi.fn(() => []),
    };
    const chatThreadRuntimeService = {
      postMessage: vi.fn().mockResolvedValue({ id: "message-1" }),
    };
    const service = buildService(repo, { projectManagementRepository, executionRepository, chatThreadRuntimeService });

    await service.runDueEntries(new Date("2026-05-18T09:14:59.000Z"));
    expect(chatThreadRuntimeService.postMessage).not.toHaveBeenCalled();
    expect(repo.markRunSucceeded).not.toHaveBeenCalled();

    await service.runDueEntries(new Date("2026-05-18T09:15:00.000Z"));

    expect(chatThreadRuntimeService.postMessage).toHaveBeenCalledWith("project-1", expect.objectContaining({
      bodyMarkdown: "Send the task report.",
    }));
    expect(repo.markRunSucceeded).toHaveBeenCalledWith("entry-1", "2026-05-18T09:15:00.000Z", null);
  });

  it("rejects task anchors outside the selected project", () => {
    const repo = { createEntry: vi.fn() };
    const projectManagementRepository = {
      getTask: vi.fn(() => ({
        id: "task-1",
        projectId: "other-project",
        status: "completed",
        updatedAt: "2026-05-18T09:00:00.000Z",
      })),
    };
    const service = buildService(repo, { projectManagementRepository });

    expect(() => service.createEntry("project-1", {
      targetType: "agent_wakeup",
      scheduledFor: "2026-05-18T09:00:00.000Z",
      scheduleAnchor: {
        mode: "after_task_end",
        sourceTaskId: "task-1",
      },
      agentWakeupTarget: {
        bodyMarkdown: "Wake up.",
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: "agent-1",
      },
    })).toThrow("Schedule anchors must reference a task in the selected project.");
    expect(repo.createEntry).not.toHaveBeenCalled();
  });

  const buildService = (repo: Record<string, unknown>, extra: Partial<Record<string, unknown>> = {}) =>
    new SchedulerService({
      schedulerRepository: repo as any,
      projectManagementRepository: (extra.projectManagementRepository ?? { listTasks: vi.fn(() => [{ id: "task-1" }]) }) as any,
      executionRepository: extra.executionRepository as any,
      quicksprintService: (extra.quicksprintService ?? {}) as any,
      chatThreadRuntimeService: (extra.chatThreadRuntimeService ?? {}) as any,
      executionControlService: (extra.executionControlService ?? {}) as any,
      taskRerunService: extra.taskRerunService as any,
      nodeFlowRuntimeService: extra.nodeFlowRuntimeService as any,
      nodeFlowRepository: extra.nodeFlowRepository as any,
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

  it("runs due node flow targets through the node flow runtime with scheduler metadata", async () => {
    const entry = createEntry({
      targetType: "node_flow",
      sprintTarget: undefined,
      nodeFlowTarget: {
        flowId: "flow-1",
        input: { prompt: "Ship" },
        flowVersion: 2,
      },
      recurrence: normalizeRecurrenceRule(),
    });
    const repo = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const nodeFlowRuntimeService = {
      runFlow: vi.fn().mockResolvedValue({ run: { status: "succeeded" }, nodeRuns: [], output: {} }),
    };
    const nodeFlowRepository = {
      getFlow: vi.fn(() => ({ id: "flow-1", projectId: "project-1" })),
    };
    const service = buildService(repo, { nodeFlowRuntimeService, nodeFlowRepository });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));
    await flush();

    expect(nodeFlowRuntimeService.runFlow).toHaveBeenCalledWith("project-1", "flow-1", { prompt: "Ship" }, {
      triggerType: "scheduler",
      versionSelection: { mode: "pinned", version: 2 },
      triggerPayload: {
        schedulerEntryId: "entry-1",
        scheduledFor: "2026-05-18T09:00:00.000Z",
        targetType: "node_flow",
        flowVersion: 2,
      },
    });
    expect(repo.markRunSucceeded).toHaveBeenCalledWith("entry-1", "2026-05-18T09:00:00.000Z", null);
  });

  it("durably claims a due node flow occurrence before a long-running runtime resolves", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scheduler-service-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectManagementRepository = new ProjectManagementRepository(storage);
    const schedulerRepository = new SchedulerRepository(storage);
    const project = projectManagementRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const entry = schedulerRepository.createEntry(project.id, {
      targetType: "node_flow",
      scheduledFor: "2026-05-18T09:00:00.000Z",
      nodeFlowTarget: { flowId: "flow-1" },
    });
    let resolveRun: (value: { run: { status: "succeeded" }; nodeRuns: []; output: Record<string, never> }) => void = () => {};
    const nodeFlowRuntimeService = {
      runFlow: vi.fn(() => new Promise((resolve) => {
        resolveRun = resolve;
      })),
    };
    const nodeFlowRepository = {
      getFlow: vi.fn(() => ({ id: "flow-1", projectId: project.id })),
    };
    const firstScheduler = buildService(schedulerRepository, {
      projectManagementRepository,
      nodeFlowRuntimeService,
      nodeFlowRepository,
    });
    const restartedScheduler = buildService(schedulerRepository, {
      projectManagementRepository,
      nodeFlowRuntimeService,
      nodeFlowRepository,
    });
    const now = new Date("2026-05-18T09:00:01.000Z");

    await firstScheduler.runDueEntries(now);

    expect(nodeFlowRuntimeService.runFlow).toHaveBeenCalledTimes(1);
    expect(schedulerRepository.listDueEntries(now.toISOString()).find((due) => due.id === entry.id)).toBeUndefined();

    await restartedScheduler.runDueEntries(now);

    expect(nodeFlowRuntimeService.runFlow).toHaveBeenCalledTimes(1);

    resolveRun({ run: { status: "succeeded" }, nodeRuns: [], output: {} });
    await flush();

    const finalized = schedulerRepository.getEntry(entry.id);
    expect(finalized?.status).toBe("completed");
    expect(finalized?.lastRunAt).toBe("2026-05-18T09:00:00.000Z");
    expect(finalized?.runCount).toBe(1);
  });

  it("marks node flow schedules failed when the runtime resolves a failed run", async () => {
    const entry = createEntry({
      targetType: "node_flow",
      sprintTarget: undefined,
      nodeFlowTarget: { flowId: "flow-1" },
      recurrence: normalizeRecurrenceRule(),
    });
    const repo = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const service = buildService(repo, {
      nodeFlowRuntimeService: {
        runFlow: vi.fn().mockResolvedValue({
          run: { status: "failed", errorMessage: "node execution failed" },
          nodeRuns: [],
          output: {},
        }),
      },
      nodeFlowRepository: { getFlow: vi.fn(() => ({ id: "flow-1", projectId: "project-1" })) },
    });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));
    await flush();

    expect(repo.markRunSucceeded).not.toHaveBeenCalled();
    expect(repo.markRunFailed).toHaveBeenCalledWith(
      "entry-1",
      "node execution failed",
      "2026-05-18T09:00:00.000Z",
    );
  });

  it("does not execute node flow targets before nextRunAt is due", async () => {
    const entry = createEntry({
      targetType: "node_flow",
      sprintTarget: undefined,
      nextRunAt: "2026-05-18T09:05:00.000Z",
      nodeFlowTarget: { flowId: "flow-1" },
      recurrence: normalizeRecurrenceRule(),
    });
    const repo = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const nodeFlowRuntimeService = { runFlow: vi.fn() };
    const service = buildService(repo, {
      nodeFlowRuntimeService,
      nodeFlowRepository: { getFlow: vi.fn(() => ({ id: "flow-1", projectId: "project-1" })) },
    });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));

    expect(nodeFlowRuntimeService.runFlow).not.toHaveBeenCalled();
    expect(repo.markRunSucceeded).not.toHaveBeenCalled();
    expect(repo.markRunFailed).not.toHaveBeenCalled();
  });

  it("marks node flow schedules failed without marking success when runtime startup rejects", async () => {
    const entry = createEntry({
      targetType: "node_flow",
      sprintTarget: undefined,
      nodeFlowTarget: { flowId: "flow-1" },
      recurrence: normalizeRecurrenceRule(),
    });
    const repo = {
      listDueEntries: vi.fn(() => [entry]),
      getEntry: vi.fn(() => entry),
      markRunSucceeded: vi.fn(),
      markRunFailed: vi.fn(),
    };
    const service = buildService(repo, {
      nodeFlowRuntimeService: { runFlow: vi.fn().mockRejectedValue(new Error("flow unavailable")) },
      nodeFlowRepository: { getFlow: vi.fn(() => ({ id: "flow-1", projectId: "project-1" })) },
    });

    await service.runDueEntries(new Date("2026-05-18T09:00:01.000Z"));
    await flush();

    expect(repo.markRunSucceeded).not.toHaveBeenCalled();
    expect(repo.markRunFailed).toHaveBeenCalledWith("entry-1", "flow unavailable");
  });

  it("validates node flow targets on create and update against the owning project", () => {
    const current = createEntry({
      targetType: "node_flow",
      sprintTarget: undefined,
      nodeFlowTarget: { flowId: "flow-1" },
    });
    const repo = {
      createEntry: vi.fn(),
      getEntry: vi.fn(() => current),
      updateEntry: vi.fn(),
    };
    const nodeFlowRepository = {
      getFlow: vi.fn((flowId: string) => ({ id: flowId, projectId: "other-project" })),
    };
    const service = buildService(repo, { nodeFlowRepository });

    expect(() => service.createEntry("project-1", {
      targetType: "node_flow",
      nodeFlowTarget: { flowId: "flow-1" },
    } as any)).toThrow(/Only node flows in the selected project/);
    expect(() => service.updateEntry("entry-1", {
      nodeFlowTarget: { flowId: "flow-2" },
    })).toThrow(/Only node flows in the selected project/);
    expect(repo.createEntry).not.toHaveBeenCalled();
    expect(repo.updateEntry).not.toHaveBeenCalled();
  });

  it("lists node flow schedule entries with computed occurrences", () => {
    const entry = createEntry({
      targetType: "node_flow",
      sprintTarget: undefined,
      nodeFlowTarget: { flowId: "flow-1" },
      recurrence: normalizeRecurrenceRule(),
    });
    const repo = { listEntries: vi.fn(() => [entry]) };
    const service = buildService(repo);

    const result = service.listProjectSchedule("project-1", "2026-05-18T00:00:00Z", "2026-05-19T00:00:00Z");

    expect(result.entries).toEqual([entry]);
    expect(result.occurrences).toEqual([
      expect.objectContaining({
        entryId: "entry-1",
        targetType: "node_flow",
        startsAt: "2026-05-18T09:00:00.000Z",
      }),
    ]);
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

  it("does not expose anchored schedule occurrences before the source sprint is completed", () => {
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

  it("exposes an anchored schedule occurrence when the source sprint is completed", () => {
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

  it("exposes anchored schedule occurrences at successful run finish time plus offset", () => {
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
        status: "completed",
        endDate: "2026-05-18T10:00:00.000Z",
      })),
    };
    const executionRepository = {
      listSprintRuns: vi.fn(() => [
        { status: "completed", finishedAt: "2026-05-18T12:05:00.000Z" },
        { status: "failed", finishedAt: "2026-05-18T12:20:00.000Z" },
        { status: "active", finishedAt: "2026-05-18T12:30:00.000Z" },
      ]),
    };
    const service = buildService(repo, { projectManagementRepository, executionRepository });

    const result = service.listProjectSchedule("project-1", "2026-05-18T00:00:00Z", "2026-05-19T00:00:00Z");

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]?.startsAt).toBe("2026-05-18T12:50:00.000Z");
  });

  it.each(["failed", "cancelled"])(
    "does not expose sprint-anchored occurrences when the source sprint is %s",
    (sourceStatus) => {
      const entry = createEntry({
        scheduleAnchor: {
          mode: "after_sprint_end",
          sourceSprintId: "source-sprint",
          offsetMinutes: 15,
        },
        recurrence: normalizeRecurrenceRule(),
        nextRunAt: null,
      });
      const repo = { listEntries: vi.fn(() => [entry]) };
      const projectManagementRepository = {
        getSprint: vi.fn(() => ({
          id: "source-sprint",
          projectId: "project-1",
          status: sourceStatus,
          endDate: "2026-05-18T10:00:00.000Z",
        })),
      };
      const executionRepository = {
        listSprintRuns: vi.fn(() => [
          { status: "completed", finishedAt: "2026-05-18T09:30:00.000Z" },
          { status: sourceStatus, finishedAt: "2026-05-18T10:00:00.000Z" },
        ]),
      };
      const service = buildService(repo, { projectManagementRepository, executionRepository });

      const result = service.listProjectSchedule(
        "project-1",
        "2026-05-18T00:00:00Z",
        "2026-05-19T00:00:00Z",
      );

      expect(result.occurrences).toEqual([]);
      expect(executionRepository.listSprintRuns).not.toHaveBeenCalled();
    },
  );

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

  it("validates task targets on create against the owning project", () => {
    const projectManagementRepository = {
      getTask: vi.fn(() => ({ id: "task-1", projectId: "other-project", sprintId: "sprint-1" })),
    };
    const repo = { createEntry: vi.fn() };
    const service = buildService(repo, { projectManagementRepository });

    expect(() => service.createEntry("project-1", {
      targetType: "task",
      taskTarget: {
        taskId: "task-1",
        origin: "agent_scheduler",
        source: "agent_scheduler",
      },
    })).toThrow(/Only tasks in the selected project/);
    expect(repo.createEntry).not.toHaveBeenCalled();
  });

  it("rejects agent wakeups without body markdown before persistence", () => {
    const repo = { createEntry: vi.fn() };
    const service = buildService(repo);

    expect(() => service.createEntry("project-1", {
      targetType: "agent_wakeup",
      agentWakeupTarget: {
        bodyMarkdown: "   ",
        origin: "agent_scheduler",
        source: "agent_scheduler",
      },
    })).toThrow(/agentWakeupTarget.bodyMarkdown is required/);
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
