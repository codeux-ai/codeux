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

  it("retries provider failures when enabled and reuses the original prompt", async () => {
    const mockExecution = {
      executeProvider: vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          stderr: "Command aborted",
          stdout: "",
          nativeSessionId: null,
        })
        .mockResolvedValueOnce({
          ok: true,
          text: '{"status":"ok"}',
          nativeSessionId: "native-2",
        })
    } as unknown as ProviderExecutionService;

    const mockRepo = {
      appendExecutionInvocationMessage: vi.fn()
    } as any;

    const service = new StructuredProviderResponseService({
      providerExecutionService: mockExecution,
      executionRepository: mockRepo,
    });

    const result = await service.executeAndParse({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "opencode",
      model: "test-model",
      apiKey: "123",
      prompt: "plan this sprint",
      sessionId: "planning-opencode-1",
      invocationId: "inv-1",
      settings: {} as any,
      maxProviderAttempts: 2,
      retryProviderFailures: true,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry json",
      providerLabel: "OpenCode"
    });

    expect(result.parsed).toEqual({ status: "ok" });
    expect(mockExecution.executeProvider).toHaveBeenCalledTimes(2);
    expect(mockExecution.executeProvider).toHaveBeenNthCalledWith(2, expect.objectContaining({
      prompt: "plan this sprint",
      continueSessionId: undefined,
    }));
    expect(mockRepo.appendExecutionInvocationMessage).toHaveBeenCalledWith("inv-1", expect.objectContaining({
      role: "system",
      contentMarkdown: expect.stringContaining("Retrying OpenCode planning provider invocation after a failed run")
    }));
  });

  it("stops retrying provider failures at the provider attempt cap", async () => {
    const mockExecution = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: false,
        stderr: "Command aborted",
        stdout: "",
        nativeSessionId: null,
      })
    } as unknown as ProviderExecutionService;

    const service = new StructuredProviderResponseService({
      providerExecutionService: mockExecution,
    });

    await expect(service.executeAndParse({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "opencode",
      model: "test-model",
      apiKey: "123",
      prompt: "plan this sprint",
      sessionId: "planning-opencode-1",
      settings: {} as any,
      maxProviderAttempts: 2,
      retryProviderFailures: true,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry json",
      providerLabel: "OpenCode"
    })).rejects.toThrow("Virtual OpenCode worker failed again: Command aborted");

    expect(mockExecution.executeProvider).toHaveBeenCalledTimes(2);
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

  it("does not promote logical session ids to native OpenCode session ids during retries", async () => {
    const mockExecution = {
      executeProvider: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: "invalid json",
          nativeSessionId: null,
        })
        .mockResolvedValueOnce({
          ok: true,
          text: '{"status":"fixed"}',
          nativeSessionId: null,
        })
    } as unknown as ProviderExecutionService;

    const service = new StructuredProviderResponseService({
      providerExecutionService: mockExecution,
    });

    const result = await service.executeAndParse({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "opencode",
      model: "anthropic/claude-sonnet-4-5",
      apiKey: "123",
      prompt: "hi",
      sessionId: "planning-opencode-logical",
      settings: {} as any,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "fix it",
      providerLabel: "OpenCode"
    });

    expect(result.parsed).toEqual({ status: "fixed" });
    expect(result.nativeSessionId).toBeNull();
    expect(mockExecution.executeProvider).toHaveBeenNthCalledWith(2, expect.objectContaining({
      continueSessionId: "planning-opencode-logical",
    }));
  });
});
