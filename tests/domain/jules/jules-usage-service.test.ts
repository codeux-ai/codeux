import { describe, it, expect, vi, beforeEach } from "vitest";
import { JulesUsageService } from "../../../src/domain/jules/jules-usage-service.js";
import type { JulesClient } from "../../../src/domain/jules/jules-client.js";
import type { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import type { Logger } from "../../../src/shared/logging/logger.js";
import type { JulesActivity } from "../../../src/contracts/app-types.js";
import {
  MAX_MESSAGE_CONTENT_CHARS,
  MAX_TOOL_PAYLOAD_CHARS,
} from "../../../src/services/invocation-message-limits.js";

describe("JulesUsageService", () => {
  let getFullConversationMock: ReturnType<typeof vi.fn>;
  let getSessionMock: ReturnType<typeof vi.fn>;

  let getLatestMock: ReturnType<typeof vi.fn>;
  let createUsageMock: ReturnType<typeof vi.fn>;
  let updateUsageMock: ReturnType<typeof vi.fn>;
  let listExecMock: ReturnType<typeof vi.fn>;
  let createExecMock: ReturnType<typeof vi.fn>;
  let updateExecMock: ReturnType<typeof vi.fn>;
  let syncMessagesMock: ReturnType<typeof vi.fn>;

  let loggerInfoMock: ReturnType<typeof vi.fn>;
  let loggerErrorMock: ReturnType<typeof vi.fn>;
  let loggerWarnMock: ReturnType<typeof vi.fn>;

  let julesClient: JulesClient;
  let executionRepository: ExecutionRepository;
  let logger: Logger;
  let service: JulesUsageService;

  beforeEach(() => {
    getFullConversationMock = vi.fn().mockResolvedValue([]);
    getSessionMock = vi.fn().mockResolvedValue({ prompt: "Initial prompt for testing" });

    getLatestMock = vi.fn().mockReturnValue(null);
    createUsageMock = vi.fn().mockReturnValue({ id: "mock-record-id", createdAt: "2026-05-21T07:29:52.209Z" });
    updateUsageMock = vi.fn();
    listExecMock = vi.fn().mockReturnValue([]);
    createExecMock = vi.fn().mockReturnValue({ id: "mock-exec-id" });
    updateExecMock = vi.fn();
    syncMessagesMock = vi.fn().mockReturnValue({
      inserted: 0,
      updated: 0,
      deleted: 0,
      unchanged: 0,
    });

    loggerInfoMock = vi.fn();
    loggerErrorMock = vi.fn();
    loggerWarnMock = vi.fn();

    julesClient = {
      getFullConversation: getFullConversationMock,
      getSession: getSessionMock,
    } as unknown as JulesClient;

    executionRepository = {
      getLatestProviderInvocationUsageBySession: getLatestMock,
      createProviderInvocationUsage: createUsageMock,
      updateProviderInvocationUsage: updateUsageMock,
      listExecutionInvocationsByProviderInvocationId: listExecMock,
      createExecutionInvocation: createExecMock,
      updateExecutionInvocation: updateExecMock,
      syncExecutionInvocationMessages: syncMessagesMock,
    } as unknown as ExecutionRepository;

    logger = {
      info: loggerInfoMock,
      error: loggerErrorMock,
      debug: vi.fn(),
      warn: loggerWarnMock,
      child: vi.fn().mockReturnThis(),
    } as unknown as Logger;

    service = new JulesUsageService(julesClient, executionRepository, logger);
  });

  describe("calculateAndSaveUsageForTask (terminal)", () => {
    it("estimates usage and saves an estimated, completed record with tool-call tracking", async () => {
      const activities: JulesActivity[] = [
        { id: "1", name: "1", createTime: "2026-06-01T00:00:00Z", userMessaged: { userMessage: "Hello Jules" } },
        { id: "2", name: "2", createTime: "2026-06-01T00:00:01Z", agentMessaged: { agentMessage: "Hello! How can I help?" } },
        {
          id: "3",
          name: "3",
          createTime: "2026-06-01T00:00:02Z",
          progressUpdated: { title: "Editing files", description: "Applying changes" },
        },
      ];
      getFullConversationMock.mockResolvedValue(activities);

      await service.calculateAndSaveUsageForTask("proj-1", "task-1", "session-1");

      expect(getFullConversationMock).toHaveBeenCalledWith("session-1");
      expect(getSessionMock).toHaveBeenCalledWith("session-1");

      expect(createUsageMock).toHaveBeenCalledWith({
        projectId: "proj-1",
        taskId: "task-1",
        sessionId: "session-1",
        provider: "jules",
        purpose: "task_coding",
        status: "completed",
        invocationSource: "EXTERNAL_API",
      });

      const update = updateUsageMock.mock.calls[0];
      expect(update[0]).toBe("mock-record-id");
      const payload = update[1];
      expect(payload.status).toBe("completed");
      expect(payload.usageSource).toBe("estimated");
      expect(payload.invocationSource).toBe("EXTERNAL_API");
      // Agentic runs are input-heavy: input (context replay) exceeds output.
      expect(payload.inputTokens).toBeGreaterThan(payload.outputTokens);
      expect(payload.totalTokens).toBe(payload.inputTokens + payload.outputTokens);
      expect(payload.julesTokens).toBe(payload.totalTokens);
      // One progress update => one tool-style operation.
      expect(payload.toolCallCount).toBe(1);
      expect(payload.rawUsageJson.estimator).toBe("activity-snapshot-v2");

      // Transcript reconciled atomically: prompt + 3 activity messages.
      expect(syncMessagesMock).toHaveBeenCalledTimes(1);
      const [invocationId, messages] = syncMessagesMock.mock.calls[0];
      expect(invocationId).toBe("mock-exec-id");
      expect(messages).toHaveLength(4);
      const roles = messages.map((message: { role: string }) => message.role);
      expect(roles).toEqual(["user", "user", "assistant", "tool"]);
      // Progress updates carry the tool_call chat indicator.
      const progressMsg = messages[3];
      expect(progressMsg.metadata.kind).toBe("tool_call");
    });

    it("is idempotent once a completed snapshot-aware estimate exists", async () => {
      getLatestMock.mockReturnValue({
        id: "existing",
        createdAt: "2026-05-21T07:29:52.209Z",
        status: "completed",
        totalTokens: 1500,
        rawUsageJson: { estimator: "activity-snapshot-v2" },
      });

      await service.calculateAndSaveUsageForTask("proj-1", "task-1", "session-1");

      expect(getFullConversationMock).not.toHaveBeenCalled();
      expect(getSessionMock).not.toHaveBeenCalled();
      expect(createUsageMock).not.toHaveBeenCalled();
      expect(updateUsageMock).not.toHaveBeenCalled();
      expect(loggerInfoMock).toHaveBeenCalledWith(
        "Jules usage telemetry already calculated and saved for session",
        { sessionId: "session-1" },
      );
    });

    it("recalculates legacy completed estimates with snapshot-aware parsing", async () => {
      getLatestMock.mockReturnValue({
        id: "existing",
        provider: "jules",
        createdAt: "2026-05-21T07:29:52.209Z",
        status: "completed",
        totalTokens: 46_000_000,
        rawUsageJson: { estimator: "turn-accumulation-v1" },
      });
      getFullConversationMock.mockResolvedValue([
        {
          id: "1",
          name: "1",
          createTime: "2026-06-01T00:00:00Z",
          progressUpdated: { title: "Done" },
        },
      ] as JulesActivity[]);

      await service.calculateAndSaveUsageForTask(
        "proj-1",
        "task-1",
        "session-1",
        "Safe prompt",
      );

      expect(getFullConversationMock).toHaveBeenCalledTimes(1);
      expect(updateUsageMock).toHaveBeenCalledWith(
        "existing",
        expect.objectContaining({
          status: "completed",
          rawUsageJson: expect.objectContaining({ estimator: "activity-snapshot-v2" }),
        }),
      );
    });

    it("defers terminal history parsing while the V8 heap is under pressure", async () => {
      vi.useFakeTimers();
      try {
        const pressureService = new JulesUsageService(
          julesClient,
          executionRepository,
          logger,
          () => ({
            heapUsedBytes: 3 * 1024 * 1024 * 1024,
            heapLimitBytes: 4 * 1024 * 1024 * 1024,
            headroomBytes: 1024 * 1024 * 1024,
            usageRatio: 0.75,
            underPressure: true,
          }),
        );

        await pressureService.calculateAndSaveUsageForTask(
          "proj-1",
          "task-1",
          "session-1",
          "Safe prompt",
        );

        expect(getFullConversationMock).not.toHaveBeenCalled();
        expect(updateUsageMock).not.toHaveBeenCalled();
        expect(loggerWarnMock).toHaveBeenCalledWith(
          "Deferred Jules usage telemetry because the Node.js heap is under pressure",
          expect.objectContaining({ kind: "terminal", heapUsagePercent: 75 }),
        );
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });

    it("renders code artifacts as tool_result messages", async () => {
      getFullConversationMock.mockResolvedValue([
        {
          id: "1",
          name: "1",
          createTime: "2026-06-01T00:00:00Z",
          artifacts: [{ changeSet: { gitPatch: { unidiffPatch: "diff --git a/f b/f\n+const a = 1;" } } }],
        },
      ] as JulesActivity[]);

      await service.calculateAndSaveUsageForTask("proj-1", "task-1", "session-1", "Initial prompt for testing");

      const messages = syncMessagesMock.mock.calls[0][1];
      const toolMsg = messages.find((message: { metadata?: { kind?: string } }) =>
        message.metadata?.kind === "tool_result"
      );
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.metadata.toolName).toBe("apply_patch");
    });

    it("bounds patch messages and releases raw activities before persistence", async () => {
      const patch = `+${"generated asset data".repeat(20_000)}`;
      const activities = [
        {
          id: "1",
          name: "1",
          createTime: "2026-06-01T00:00:00Z",
          artifacts: [{ changeSet: { gitPatch: { unidiffPatch: patch } } }],
        },
      ] as JulesActivity[];
      getFullConversationMock.mockResolvedValue(activities);
      syncMessagesMock.mockImplementation((_invocationId, messages) => {
        expect(activities).toHaveLength(0);
        const toolMessage = messages.find(
          (message: { metadata?: { kind?: string } }) => message.metadata?.kind === "tool_result",
        );
        expect(toolMessage.contentMarkdown.length).toBeLessThanOrEqual(MAX_MESSAGE_CONTENT_CHARS);
        expect(toolMessage.toolCallsJson.output.length).toBeLessThanOrEqual(MAX_TOOL_PAYLOAD_CHARS);
        return { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };
      });

      await service.calculateAndSaveUsageForTask(
        "proj-1",
        "task-1",
        "session-1",
        "Initial prompt for testing",
      );

      expect(syncMessagesMock).toHaveBeenCalledTimes(1);
    });

    it("handles API failure gracefully and logs an error", async () => {
      getFullConversationMock.mockRejectedValue(new Error("API Error"));

      await service.calculateAndSaveUsageForTask("proj-1", "task-1", "session-1");

      expect(createUsageMock).not.toHaveBeenCalled();
      expect(loggerErrorMock).toHaveBeenCalledWith(
        "Failed to calculate and save Jules usage telemetry",
        expect.objectContaining({ projectId: "proj-1", taskId: "task-1", sessionId: "session-1", error: expect.any(Error) }),
      );
    });

    it("skips and does not create usage record when 404 occurs and no safe context exists", async () => {
      const error404 = new Error("Request failed with status code 404");
      (error404 as any).status = 404;
      getFullConversationMock.mockRejectedValue(error404);

      await service.calculateAndSaveUsageForTask("proj-1", "task-1", "session-1");

      expect(createUsageMock).not.toHaveBeenCalled();
      expect(loggerInfoMock).toHaveBeenCalledWith(
        "Skipping Jules usage telemetry for missing session (no existing prompt/record)",
        { sessionId: "session-1" }
      );
    });

    it("proceeds with empty activities when 404 occurs but safe context exists (passed prompt)", async () => {
      const error404 = new Error("Request failed with status code 404");
      (error404 as any).status = 404;
      getFullConversationMock.mockRejectedValue(error404);

      await service.calculateAndSaveUsageForTask("proj-1", "task-1", "session-1", "Safe prompt");

      expect(createUsageMock).toHaveBeenCalled();
      expect(updateUsageMock).toHaveBeenCalled();
      expect(loggerErrorMock).not.toHaveBeenCalled();
    });

    it("proceeds with empty activities when 404 occurs but safe context exists (existing record)", async () => {
      const error404 = new Error("Request failed with status code 404");
      (error404 as any).status = 404;
      getFullConversationMock.mockRejectedValue(error404);

      getLatestMock.mockReturnValue({ id: "existing-id", createdAt: "2026-05-21T07:29:52.209Z" });

      await service.calculateAndSaveUsageForTask("proj-1", "task-1", "session-1");

      expect(updateUsageMock).toHaveBeenCalled();
      expect(loggerErrorMock).not.toHaveBeenCalled();
    });
  });

  describe("syncLiveInvocation", () => {
    it("persists a running estimate and is throttled per session", async () => {
      getFullConversationMock.mockResolvedValue([
        { id: "1", name: "1", createTime: "2026-06-01T00:00:00Z", agentMessaged: { agentMessage: "working" } },
      ] as JulesActivity[]);

      await service.syncLiveInvocation("proj-1", "task-1", "session-1", "Build it");
      // Second immediate call is throttled — no additional fetch.
      await service.syncLiveInvocation("proj-1", "task-1", "session-1", "Build it");

      expect(getFullConversationMock).toHaveBeenCalledTimes(1);
      expect(getSessionMock).not.toHaveBeenCalled();
      expect(createUsageMock).toHaveBeenCalledWith(expect.objectContaining({ status: "running" }));
      expect(updateUsageMock.mock.calls[0][1].status).toBe("running");
    });

    it("updates the dispatch-created execution invocation instead of creating a duplicate", async () => {
      getLatestMock.mockReturnValue({
        id: "provider-record-1",
        provider: "jules",
        createdAt: "2026-05-21T07:29:52.209Z",
      });
      listExecMock.mockReturnValue([{ id: "exec-existing" }]);
      getFullConversationMock.mockResolvedValue([
        { id: "1", name: "1", createTime: "2026-06-01T00:00:00Z", agentMessaged: { agentMessage: "working" } },
      ] as JulesActivity[]);

      await service.syncLiveInvocation("proj-1", "task-1", "session-1", "Build it");

      expect(createUsageMock).not.toHaveBeenCalled();
      expect(createExecMock).not.toHaveBeenCalled();
      expect(updateExecMock).toHaveBeenCalledWith("exec-existing", expect.objectContaining({
        status: "running",
        taskId: "task-1",
        finishedAt: null,
      }));
      expect(syncMessagesMock).toHaveBeenCalledWith(
        "exec-existing",
        expect.arrayContaining([expect.objectContaining({
          role: "user",
          contentMarkdown: "Build it",
        })]),
      );
    });

    it("does not throttle distinct sessions", async () => {
      getFullConversationMock.mockResolvedValue([]);
      await service.syncLiveInvocation("proj-1", "task-1", "session-a", "x");
      await service.syncLiveInvocation("proj-1", "task-2", "session-b", "y");
      expect(getFullConversationMock).toHaveBeenCalledTimes(2);
    });

    it("deduplicates concurrent syncs for the same session", async () => {
      let resolveConversation!: (activities: JulesActivity[]) => void;
      getFullConversationMock.mockImplementation(() => new Promise<JulesActivity[]>((resolve) => {
        resolveConversation = resolve;
      }));

      const first = service.syncLiveInvocation("proj-1", "task-1", "session-a", "x");
      const second = service.syncLiveInvocation("proj-1", "task-1", "session-a", "x");
      await vi.waitFor(() => expect(getFullConversationMock).toHaveBeenCalledTimes(1));
      resolveConversation([]);
      await Promise.all([first, second]);

      expect(getFullConversationMock).toHaveBeenCalledTimes(1);
    });

    it("serializes full-conversation fetches across distinct sessions", async () => {
      const resolvers = new Map<string, (activities: JulesActivity[]) => void>();
      getFullConversationMock.mockImplementation((sessionId: string) => (
        new Promise<JulesActivity[]>((resolve) => {
          resolvers.set(sessionId, resolve);
        })
      ));

      const first = service.syncLiveInvocation("proj-1", "task-1", "session-a", "x");
      const second = service.syncLiveInvocation("proj-1", "task-2", "session-b", "y");
      await vi.waitFor(() => expect(getFullConversationMock).toHaveBeenCalledTimes(1));
      expect(getFullConversationMock).toHaveBeenLastCalledWith("session-a");

      resolvers.get("session-a")?.([]);
      await vi.waitFor(() => expect(getFullConversationMock).toHaveBeenCalledTimes(2));
      expect(getFullConversationMock).toHaveBeenLastCalledWith("session-b");
      resolvers.get("session-b")?.([]);
      await Promise.all([first, second]);
    });

    it("handles 404 gracefully without logging a warning during live sync", async () => {
      const error404 = new Error("Request failed with status code 404");
      (error404 as any).status = 404;
      getFullConversationMock.mockRejectedValue(error404);

      await service.syncLiveInvocation("proj-1", "task-1", "session-1", "Build it");

      expect(loggerWarnMock).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        "Live Jules session is not available (404), skipping live sync",
        { sessionId: "session-1" }
      );
      expect(createUsageMock).not.toHaveBeenCalled();
    });

    it("logs a warning for non-404 errors during live sync", async () => {
      const error500 = new Error("Internal Server Error");
      (error500 as any).status = 500;
      getFullConversationMock.mockRejectedValue(error500);

      await service.syncLiveInvocation("proj-1", "task-1", "session-1", "Build it");

      expect(loggerWarnMock).toHaveBeenCalledWith(
        "Failed live Jules invocation sync",
        expect.objectContaining({ error: error500, sessionId: "session-1" })
      );
    });

    it("skips unchanged provider revisions after the throttle window", async () => {
      const nowSpy = vi.spyOn(Date, "now");
      nowSpy.mockReturnValue(10_000);
      getFullConversationMock.mockResolvedValue([
        { id: "1", name: "1", createTime: "2026-06-01T00:00:00Z", agentMessaged: { agentMessage: "working" } },
      ] as JulesActivity[]);

      await service.syncLiveInvocation(
        "proj-1",
        "task-1",
        "session-1",
        "Build it",
        null,
        "revision-1",
      );
      nowSpy.mockReturnValue(30_000);
      await service.syncLiveInvocation(
        "proj-1",
        "task-1",
        "session-1",
        "Build it",
        null,
        "revision-1",
      );
      await service.syncLiveInvocation(
        "proj-1",
        "task-1",
        "session-1",
        "Build it",
        null,
        "revision-2",
      );

      nowSpy.mockRestore();
      expect(getFullConversationMock).toHaveBeenCalledTimes(2);
    });

    it("does not start a live history read while the V8 heap is under pressure", async () => {
      const pressureService = new JulesUsageService(
        julesClient,
        executionRepository,
        logger,
        () => ({
          heapUsedBytes: 3 * 1024 * 1024 * 1024,
          heapLimitBytes: 4 * 1024 * 1024 * 1024,
          headroomBytes: 1024 * 1024 * 1024,
          usageRatio: 0.75,
          underPressure: true,
        }),
      );

      await pressureService.syncLiveInvocation(
        "proj-1",
        "task-1",
        "session-1",
        "Build it",
      );

      expect(getFullConversationMock).not.toHaveBeenCalled();
      expect(loggerWarnMock).toHaveBeenCalledWith(
        "Deferred Jules usage telemetry because the Node.js heap is under pressure",
        expect.objectContaining({ kind: "live", heapUsagePercent: 75 }),
      );
    });
  });
});
