import { describe, expect, it, vi } from "vitest";
import { JulesUsageService } from "../../../../src/domain/jules/jules-usage-service.js";

describe("JulesUsageService", () => {
  it("does not reuse a non-Jules provider invocation with the same session id", async () => {
    const existingCliUsage = {
      id: "cli-usage",
      provider: "qwen-code",
      totalTokens: 0,
      createdAt: "2026-07-05T09:00:00.000Z",
      sprintId: null,
      taskId: "task-1",
      sprintRunId: null,
      dispatchId: null,
      taskRunId: null,
      attentionItemId: null,
    };
    const createdJulesUsage = {
      id: "jules-usage",
      provider: "jules",
      createdAt: "2026-07-05T09:01:00.000Z",
      sprintId: null,
      taskId: "task-1",
      sprintRunId: null,
      dispatchId: null,
      taskRunId: null,
      attentionItemId: null,
    };
    const executionRepository = {
      getLatestProviderInvocationUsageBySession: vi.fn().mockReturnValue(existingCliUsage),
      createProviderInvocationUsage: vi.fn().mockReturnValue(createdJulesUsage),
      updateProviderInvocationUsage: vi.fn(),
      listExecutionInvocationsByProviderInvocationId: vi.fn().mockReturnValue([]),
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-1" }),
      clearExecutionInvocationMessages: vi.fn(),
      appendExecutionInvocationMessage: vi.fn(),
    };
    const service = new JulesUsageService(
      {
        getFullConversation: vi.fn().mockResolvedValue([
          { createTime: "2026-07-05T09:02:00.000Z", agentMessaged: { agentMessage: "done" } },
        ]),
      } as any,
      executionRepository as any,
      { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any,
    );

    await service.calculateAndSaveUsageForTask("project-1", "task-1", "cli-qwen-code-session", "prompt");

    expect(executionRepository.createProviderInvocationUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: "jules",
      sessionId: "cli-qwen-code-session",
    }));
    expect(executionRepository.updateProviderInvocationUsage).toHaveBeenCalledWith(
      "jules-usage",
      expect.objectContaining({ status: "completed" }),
    );
    expect(executionRepository.updateProviderInvocationUsage).not.toHaveBeenCalledWith(
      "cli-usage",
      expect.anything(),
    );
  });
});
