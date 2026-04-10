import { describe, expect, it, vi } from "vitest";
import { StructuredAgentWorkflowService } from "../../../src/services/structured-agent-workflow-service.js";
import { StructuredProviderResponseService } from "../../../src/services/structured-provider-response-service.js";
import type { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";

describe("StructuredAgentWorkflowService", () => {
  it("executes provider and parses valid JSON output successfully without retrying", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: '{"goal": "success", "tasks": []}',
        nativeSessionId: "native-123",
      }),
    } as unknown as ProviderExecutionService;

    const mockExecutionRepository = {
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "inv-123" }),
      updateExecutionInvocation: vi.fn(),
    };

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });
    const service = new StructuredAgentWorkflowService({
      executionRepository: mockExecutionRepository as any,
      structuredProviderResponseService,
    });

    const result = await service.executeRequest<{ goal: string }>({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      prompt: "my prompt",
      model: "model-1",
      apiKey: "test-key",
      sessionId: "session-1",
      settings: {} as any,
      providerPrompt: "my prompt",
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: (err) => `Failed: ${err.message}`,
      providerLabel: "Claude",
      sessionIdPrefix: "test",
    });

    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(1);
    expect(result.parsed).toEqual({ goal: "success", tasks: [] });
    expect(result.nativeSessionId).toBe("native-123");
    expect(mockExecutionRepository.updateExecutionInvocation).toHaveBeenCalledWith("inv-123", expect.objectContaining({
      status: "completed",
    }));
  });

  it("retries on parse failure using the native session id and succeeds", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: 'invalid json',
          nativeSessionId: "native-123",
        })
        .mockResolvedValueOnce({
          ok: true,
          text: '{"fixed": true}',
          nativeSessionId: "native-123",
        }),
    } as unknown as ProviderExecutionService;

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });
    const service = new StructuredAgentWorkflowService({
      structuredProviderResponseService,
    });

    const result = await service.executeRequest<{ fixed: boolean }>({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      prompt: "initial prompt",
      model: "model-1",
      apiKey: "test-key",
      sessionId: "session-1",
      settings: {} as any,
      providerPrompt: "initial prompt",
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: (err) => `Retry prompt: ${err.message}`,
      providerLabel: "Claude",
      sessionIdPrefix: "test",
    });

    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(mockProviderExecutionService.executeProvider).mock.calls;
    expect(calls[0]?.[0].prompt).toBe("initial prompt");
    expect(calls[1]?.[0].prompt).toMatch(/Retry prompt/);
    expect(calls[1]?.[0].continueSessionId).toBe("native-123");
    expect(result.parsed).toEqual({ fixed: true });
  });

  it("exhausts retries and throws the final parse error, updating status to failed", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: 'invalid json over and over',
        nativeSessionId: "native-123",
      }),
    } as unknown as ProviderExecutionService;

    const mockExecutionRepository = {
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "inv-abc" }),
      updateExecutionInvocation: vi.fn(),
    };

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });
    const service = new StructuredAgentWorkflowService({
      executionRepository: mockExecutionRepository as any,
      structuredProviderResponseService,
    });

    await expect(service.executeRequest({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      prompt: "initial prompt",
      model: "model-1",
      apiKey: "test-key",
      sessionId: "session-1",
      settings: {} as any,
      maxRetries: 2,
      providerPrompt: "initial prompt",
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "Retry please",
      providerLabel: "Claude",
      sessionIdPrefix: "test",
    })).rejects.toThrow(/Unexpected token 'i'/);

    // 1 initial + 2 retries = 3 calls
    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(3);

    expect(mockExecutionRepository.updateExecutionInvocation).toHaveBeenCalledWith("inv-abc", expect.objectContaining({
      status: "failed",
      errorMessage: expect.stringMatching(/Unexpected token 'i'/),
    }));
  });


  it("creates a new execution invocation and appends initial prompt if none provided", async () => {
    const mockExecutionRepository = {
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "new-invocation-123" }),
      appendExecutionInvocationMessage: vi.fn(),
      updateExecutionInvocation: vi.fn(),
    };

    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: '{"result": "ok"}',
        nativeSessionId: "native-234",
      }),
    };

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService as any,
    });

    const service = new StructuredAgentWorkflowService({
      executionRepository: mockExecutionRepository as any,
      structuredProviderResponseService,
    });

    const result = await service.executeRequest<{ result: string }>({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      model: "model-1",
      apiKey: "test-key",
      providerPrompt: "test prompt",
      repoPath: "/repo",
      settings: {} as any,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Claude",
      sessionIdPrefix: "test",
      systemRoutingMessage: "System route message",
    });

    expect(mockExecutionRepository.createExecutionInvocation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "proj-1",
      provider: "claude-code",
      model: "model-1",
    }));

    expect(mockExecutionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("new-invocation-123", expect.objectContaining({
      role: "system",
      contentMarkdown: "System route message",
    }));

    expect(result.parsed).toEqual({ result: "ok" });
    expect(result.invocationId).toBe("new-invocation-123");
    expect(result.sessionId).toMatch(/^test-claude-code-/);
  });

  it("uses provided invocationId and updates it", async () => {
    const mockExecutionRepository = {
      createExecutionInvocation: vi.fn(),
      appendExecutionInvocationMessage: vi.fn(),
      updateExecutionInvocation: vi.fn(),
    };

    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: '{"result": "existing"}',
        nativeSessionId: null,
      }),
    };

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService as any,
    });

    const service = new StructuredAgentWorkflowService({
      executionRepository: mockExecutionRepository as any,
      structuredProviderResponseService,
    });

    const result = await service.executeRequest<{ result: string }>({
      projectId: "proj-2",
      sprintId: "sprint-2",
      taskId: "task-2",
      sprintRunId: "run-2",
      taskRunId: "trun-2",
      purpose: "qa_review",
      type: "qa_review",
      provider: "codex",
      model: "model-2",
      apiKey: "test-key",
      providerPrompt: "test prompt",
      repoPath: "/repo",
      settings: { cliWorkflow: { executionMode: "HOST" } } as any,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Codex",
      sessionIdPrefix: "qa",
      invocationId: "existing-invocation-abc",
      systemRoutingMessage: "Updated route message",
    });

    expect(mockExecutionRepository.createExecutionInvocation).not.toHaveBeenCalled();
    expect(mockExecutionRepository.updateExecutionInvocation).toHaveBeenCalledWith("existing-invocation-abc", {
      provider: "codex",
      model: "model-2",
    });
    expect(mockExecutionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("existing-invocation-abc", expect.objectContaining({
      role: "system",
      contentMarkdown: "Updated route message",
    }));

    expect(result.parsed).toEqual({ result: "existing" });
    expect(result.invocationId).toBe("existing-invocation-abc");
    expect(result.sessionId).toMatch(/^qa-codex-/);
  });

  it("handles schema validation failures inside parseFn", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: '{"wrong_schema": true}',
        nativeSessionId: null,
      }),
    } as unknown as ProviderExecutionService;

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });
    const service = new StructuredAgentWorkflowService({
      structuredProviderResponseService,
    });

    await expect(service.executeRequest({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      prompt: "initial prompt",
      model: "model-1",
      apiKey: "test-key",
      sessionId: "session-1",
      settings: {} as any,
      maxRetries: 1,
      providerPrompt: "initial prompt",
      parseFn: (text) => {
        const obj = JSON.parse(text);
        if (!obj.goal) throw new Error("Missing goal property");
        return obj;
      },
      buildRetryPrompt: (err) => `Fix schema: ${err.message}`,
      providerLabel: "Claude",
      sessionIdPrefix: "test",
    })).rejects.toThrow("Missing goal property");

    const calls = vi.mocked(mockProviderExecutionService.executeProvider).mock.calls;
    expect(calls[1]?.[0].prompt).toBe("Fix schema: Missing goal property");
    expect(calls[1]?.[0].continueSessionId).toMatch(/test-claude-code-/); // Uses fallback generated session ID if no native session
  });

  it("calls captureMemory optionally on success", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: '{"result": "ok"}',
        nativeSessionId: "native-123",
      }),
    } as unknown as ProviderExecutionService;

    const mockExecutionRepository = {
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "inv-abc" }),
      updateExecutionInvocation: vi.fn(),
    };

    const captureMemory = vi.fn().mockResolvedValue(undefined);

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });
    const service = new StructuredAgentWorkflowService({
      executionRepository: mockExecutionRepository as any,
      structuredProviderResponseService,
    });

    await service.executeRequest<{ result: string }>({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      prompt: "prompt",
      model: "model-1",
      apiKey: "key",
      sessionId: "session-1",
      settings: {} as any,
      providerPrompt: "prompt",
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Claude",
      sessionIdPrefix: "test",
      captureMemory,
    });

    expect(captureMemory).toHaveBeenCalledTimes(1);
    expect(captureMemory).toHaveBeenCalledWith(expect.stringMatching(/^test-claude-code-/), "inv-abc");
  });
});
