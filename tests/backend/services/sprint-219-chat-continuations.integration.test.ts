import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentSchedulerActions } from "../../../src/mcp/management/agent-scheduler-actions.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../src/repositories/project-worker-assignment-repository.js";
import { SchedulerRepository } from "../../../src/repositories/scheduler-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { getCurrentMcpAgentId, runWithMcpAgentContext } from "../../../src/server/mcp-agent-context.js";
import { ChatThreadRuntimeService } from "../../../src/services/chat-thread-runtime-service.js";
import { SchedulerService } from "../../../src/services/scheduler-service.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

const storages: AppDbStorage[] = [];

afterEach(() => {
  for (const storage of storages.splice(0)) storage.close();
});

describe("SPR-219 scheduled chat continuation fan-in", () => {
  it("keeps omitted-thread wakeups in the originating single-flight thread without duplicate replies", async () => {
    const storage = new AppDbStorage(":memory:");
    storages.push(storage);
    const settingsRepository = new SettingsRepository(":memory:");
    const assignmentRepository = new ProjectWorkerAssignmentRepository(storage);
    const projectRepository = new ProjectManagementRepository(
      storage,
      undefined,
      settingsRepository,
      assignmentRepository,
    );
    const connectionChatRepository = new ConnectionChatRepository(storage);
    const schedulerRepository = new SchedulerRepository(storage);
    const project = projectRepository.createProject({
      name: "Scheduled continuation fixture",
      sourceType: "local",
      sourceRef: "/tmp/code-ux-spr-219-fixture",
    });
    const thread = connectionChatRepository.createThread(project.id, {
      title: "Originating thread",
      runtimeState: {
        routeKind: "virtual",
        virtualProvider: "codex",
        modelLabel: "fixture-model",
        sessionIds: ["fixture-session"],
        replayRequired: false,
      },
    });

    const firstScheduledReply = deferred<{
      replyMarkdown: string;
      action: null;
      approvalRequired: false;
      nativeSessionId: string;
    }>();
    const providerBoundary = vi.fn((input: { signal: AbortSignal }) => {
      const callNumber = providerBoundary.mock.calls.length;
      if (callNumber === 1) {
        return new Promise((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
        });
      }
      if (callNumber === 2) {
        return Promise.resolve({
          replyMarkdown: "Combined active-turn reply.",
          action: null,
          approvalRequired: false,
          nativeSessionId: "fixture-session",
        });
      }
      if (callNumber === 3) return firstScheduledReply.promise;
      return Promise.resolve({
        replyMarkdown: "Second scheduled continuation reply.",
        action: null,
        approvalRequired: false,
        nativeSessionId: "fixture-session",
      });
    });

    const dueAt = new Date("2026-07-13T12:00:01.000Z");
    let schedulerService!: SchedulerService;
    const chatThreadRuntimeService = new ChatThreadRuntimeService({
      connectionChatRepository,
      projectWorkerAssignmentRepository: assignmentRepository,
      executionRepository: {},
      taskService: {
        resolveInvocationProvider: () => ({
          provider: "codex",
          providerConfigId: "codex",
          providers: { codex: { model: "fixture-model", apiKey: "fixture-key" } },
        }),
      },
      getDashboardSettings: () => ({ cliWorkflow: {} }),
      getGithubToken: () => undefined,
      agentPresetSyncService: {
        getWorkerAgent: async () => ({
          id: "agent-1",
          instructionMarkdown: "",
          providerConfigId: null,
          model: null,
        }),
      },
      projectManagementRepository: projectRepository,
      providerRunner: {},
      providerExecutionService: {},
      chatManagementActionService: {
        processManagementAction: providerBoundary,
      },
      knowledgeService: {},
      runDueSchedulerEntriesAfterReply: () => schedulerService.runDueEntries(dueAt),
      logger,
    } as unknown as ConstructorParameters<typeof ChatThreadRuntimeService>[0]);
    schedulerService = new SchedulerService({
      schedulerRepository,
      projectManagementRepository: projectRepository,
      quicksprintService: {} as never,
      chatThreadRuntimeService,
      executionControlService: {} as never,
      planningAgentService: { planSprint: vi.fn() },
      logger,
    });
    const schedulerCodeUx = new AgentSchedulerActions(
      schedulerService,
      () => new Date("2026-07-13T12:00:00.000Z"),
    );

    const activeTurn = chatThreadRuntimeService.postMessage(project.id, {
      threadId: thread.id,
      bodyMarkdown: "Start the active turn.",
    });
    await vi.waitFor(() => expect(providerBoundary).toHaveBeenCalledTimes(1));
    const activeSignal = providerBoundary.mock.calls[0]?.[0].signal;

    const scheduleWakeup = (scheduledFor: string, bodyMarkdown: string) => (
      runWithMcpAgentContext("agent-1", thread.id, () => schedulerCodeUx.handleSchedulerAction({
        action: "schedule_wakeup",
        projectId: project.id,
        scheduledFor,
        bodyMarkdown,
      }, getCurrentMcpAgentId()))
    );
    scheduleWakeup("2026-07-13T12:00:00.000Z", "First scheduled continuation.");
    scheduleWakeup("2026-07-13T12:00:00.500Z", "Second scheduled continuation.");

    const scheduledEntries = schedulerRepository.listEntries(project.id);
    expect(scheduledEntries).toHaveLength(2);
    expect(scheduledEntries.map((entry) => entry.agentWakeupTarget?.threadId)).toEqual([
      thread.id,
      thread.id,
    ]);

    await schedulerService.runDueEntries(dueAt);
    await schedulerService.runDueEntries(dueAt);
    expect(connectionChatRepository.listMessages(thread.id)).toHaveLength(1);
    expect(scheduledEntries.map((entry) => schedulerRepository.getEntry(entry.id)?.runCount)).toEqual([0, 0]);

    await chatThreadRuntimeService.postMessage(project.id, {
      threadId: thread.id,
      bodyMarkdown: "Supersede the active request without changing threads.",
    });
    expect(activeSignal?.aborted).toBe(true);
    await activeTurn;

    await vi.waitFor(() => expect(providerBoundary).toHaveBeenCalledTimes(3));
    const messagesDuringFirstWakeup = connectionChatRepository.listMessages(thread.id);
    const firstScheduledMessage = messagesDuringFirstWakeup.find((message) => (
      message.metadata?.schedulerEntryId === scheduledEntries[0]?.id
    ));
    expect(firstScheduledMessage).toMatchObject({
      threadId: thread.id,
      bodyMarkdown: "First scheduled continuation.",
      deliveryStatus: "pending",
    });

    await schedulerService.runDueEntries(dueAt);
    expect(providerBoundary).toHaveBeenCalledTimes(3);
    expect(connectionChatRepository.listMessages(thread.id).filter((message) => (
      message.metadata?.source === "agent_scheduler"
    ))).toHaveLength(2);
    expect(scheduledEntries.map((entry) => schedulerRepository.getEntry(entry.id)?.runCount)).toEqual([1, 1]);
    const secondScheduledMessage = connectionChatRepository.listMessages(thread.id).find((message) => (
      message.metadata?.schedulerEntryId === scheduledEntries[1]?.id
    ));
    if (!secondScheduledMessage) throw new Error("Second scheduled message was not persisted.");
    storage.getDatabase().prepare(`
      UPDATE conversation_messages
      SET created_at = ?
      WHERE id = ?
    `).run("2099-07-13T12:00:00.000Z", secondScheduledMessage.id);

    firstScheduledReply.resolve({
      replyMarkdown: "First scheduled continuation reply.",
      action: null,
      approvalRequired: false,
      nativeSessionId: "fixture-session",
    });

    await vi.waitFor(() => {
      expect(providerBoundary).toHaveBeenCalledTimes(4);
      expect(connectionChatRepository.listMessages(thread.id).filter((message) => (
        message.direction === "connection_to_dashboard"
      ))).toHaveLength(3);
    });

    const allMessages = connectionChatRepository.listMessages(thread.id);
    const scheduledMessages = allMessages.filter((message) => message.metadata?.source === "agent_scheduler");
    const assistantReplies = allMessages.filter((message) => message.direction === "connection_to_dashboard");
    const prompts = providerBoundary.mock.calls.map(([input]) => (
      input as unknown as { prompt: string }
    ).prompt);

    expect(connectionChatRepository.listThreads(project.id)).toHaveLength(1);
    expect(scheduledMessages.map((message) => message.bodyMarkdown)).toEqual([
      "First scheduled continuation.",
      "Second scheduled continuation.",
    ]);
    expect(new Set(scheduledMessages.map((message) => message.metadata?.schedulerEntryId)).size).toBe(2);
    expect(new Set(assistantReplies.map((message) => message.bodyMarkdown))).toEqual(new Set([
      "Combined active-turn reply.",
      "First scheduled continuation reply.",
      "Second scheduled continuation reply.",
    ]));
    expect(prompts[1]?.indexOf("Start the active turn.")).toBeLessThan(
      prompts[1]?.indexOf("Supersede the active request without changing threads.") ?? -1,
    );
    expect(prompts[2]).toContain("First scheduled continuation.");
    expect(prompts[3]).toContain("Second scheduled continuation.");
    expect(allMessages.some((message) => message.bodyMarkdown.includes("Worker execution failed"))).toBe(false);
    expect(scheduledEntries.map((entry) => schedulerRepository.getEntry(entry.id)?.runCount)).toEqual([1, 1]);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
