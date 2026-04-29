import { describe, it, expect, vi } from "vitest";
import { StructuredProviderResponseService, ProviderTransportError, ProviderEmptyOutputError } from "../../../src/services/structured-provider-response-service.js";
import type { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";

describe("StructuredProviderResponseService", () => {
  it("returns parsed result when provider succeeds on first attempt", async () => {
    const mockExecution = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: '{"status":"ok"}',
        nativeSessionId: "sess-1"
      })
    } as unknown as ProviderExecutionService;

    const service = new StructuredProviderResponseService({
      providerExecutionService: mockExecution
    });

    const result = await service.executeAndParse({
      projectId: "proj-1",
      purpose: "test",
      type: "test",
      provider: "claude-code",
      model: "test-model",
      apiKey: "123",
      prompt: "hi",
      settings: {} as any,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Claude"
    });

    expect(result.parsed).toEqual({ status: "ok" });
    expect(result.nativeSessionId).toBe("sess-1");
  });

  it("throws ProviderTransportError when ok=false", async () => {
    const mockExecution = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: false,
        stderr: "connection lost"
      })
    } as unknown as ProviderExecutionService;

    const service = new StructuredProviderResponseService({
      providerExecutionService: mockExecution
    });

    await expect(service.executeAndParse({
      projectId: "proj-1",
      purpose: "test",
      type: "test",
      provider: "claude-code",
      model: "test-model",
      apiKey: "123",
      prompt: "hi",
      settings: {} as any,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Claude"
    })).rejects.toThrow(ProviderTransportError);

    // Should short circuit, exactly 1 call
    expect(mockExecution.executeProvider).toHaveBeenCalledTimes(1);
  });

  it("throws ProviderEmptyOutputError when bodyMarkdown is empty", async () => {
    const mockExecution = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: "   \n"
      })
    } as unknown as ProviderExecutionService;

    const service = new StructuredProviderResponseService({
      providerExecutionService: mockExecution
    });

    await expect(service.executeAndParse({
      projectId: "proj-1",
      purpose: "test",
      type: "test",
      provider: "claude-code",
      model: "test-model",
      apiKey: "123",
      prompt: "hi",
      settings: {} as any,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Claude"
    })).rejects.toThrow(ProviderEmptyOutputError);

    // Should short circuit
    expect(mockExecution.executeProvider).toHaveBeenCalledTimes(1);
  });

  it("retries on parse error, appends system message, and succeeds", async () => {
    const mockExecution = {
      executeProvider: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: "invalid json"
        })
        .mockResolvedValueOnce({
          ok: true,
          text: '{"status":"fixed"}'
        })
    } as unknown as ProviderExecutionService;

    const mockRepo = {
      appendExecutionInvocationMessage: vi.fn()
    } as any;

    const service = new StructuredProviderResponseService({
      providerExecutionService: mockExecution,
      executionRepository: mockRepo
    });

    const result = await service.executeAndParse({
      projectId: "proj-1",
      purpose: "test",
      type: "test",
      provider: "claude-code",
      model: "test-model",
      apiKey: "123",
      prompt: "hi",
      sessionId: "session-abc",
      invocationId: "inv-1",
      settings: {} as any,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "fix it",
      providerLabel: "Claude"
    });

    expect(result.parsed).toEqual({ status: "fixed" });
    expect(mockExecution.executeProvider).toHaveBeenCalledTimes(2);
    expect(mockRepo.appendExecutionInvocationMessage).toHaveBeenCalledWith("inv-1", expect.objectContaining({
      role: "system",
      contentMarkdown: expect.stringContaining("Retrying JSON parse in same Claude session")
    }));
  });
});
