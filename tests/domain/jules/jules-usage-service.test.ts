import { describe, it, expect, vi, beforeEach } from "vitest";
import { JulesUsageService } from "../../../src/domain/jules/jules-usage-service.js";
import type { JulesClient } from "../../../src/domain/jules/jules-client.js";
import type { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import type { Logger } from "../../../src/shared/logging/logger.js";
import type { JulesActivity } from "../../../src/contracts/app-types.js";

describe("JulesUsageService", () => {
  let getFullConversationMock: ReturnType<typeof vi.fn>;
  let getSessionMock: ReturnType<typeof vi.fn>;

  let getLatestMock: ReturnType<typeof vi.fn>;
  let createUsageMock: ReturnType<typeof vi.fn>;
  let updateUsageMock: ReturnType<typeof vi.fn>;
  let listExecMock: ReturnType<typeof vi.fn>;
  let createExecMock: ReturnType<typeof vi.fn>;
  let updateExecMock: ReturnType<typeof vi.fn>;
  let clearMessagesMock: ReturnType<typeof vi.fn>;
  let appendMessageMock: ReturnType<typeof vi.fn>;

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
    clearMessagesMock = vi.fn();
    appendMessageMock = vi.fn();

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
      clearExecutionInvocationMessages: clearMessagesMock,
      appendExecutionInvocationMessage: appendMessageMock,
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
      expect(payload.rawUsageJson.estimator).toBe("turn-accumulation-v1");

      // Transcript rebuilt: prompt + 3 activity messages.
      expect(clearMessagesMock).toHaveBeenCalledWith("mock-exec-id");
      expect(appendMessageMock).toHaveBeenCalledTimes(4);
      const roles = appendMessageMock.mock.calls.map((c) => c[1].role);
      expect(roles).toEqual(["user", "user", "assistant", "tool"]);
      // Progress updates carry the tool_call chat indicator.
      const progressMsg = appendMessageMock.mock.calls[3][1];
      expect(progressMsg.metadata.kind).toBe("tool_call");
    });

    it("is idempotent — skips remote calls when a non-zero estimate already exists", async () => {
      getLatestMock.mockReturnValue({ id: "existing", createdAt: "2026-05-21T07:29:52.209Z", totalTokens: 1500 });

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

      const toolMsg = appendMessageMock.mock.calls.find((c) => c[1].metadata?.kind === "tool_result");
      expect(toolMsg).toBeDefined();
      expect(toolMsg![1].metadata.toolName).toBe("apply_patch");
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

    it("does not throttle distinct sessions", async () => {
      getFullConversationMock.mockResolvedValue([]);
      await service.syncLiveInvocation("proj-1", "task-1", "session-a", "x");
      await service.syncLiveInvocation("proj-1", "task-2", "session-b", "y");
      expect(getFullConversationMock).toHaveBeenCalledTimes(2);
    });
  });
});
