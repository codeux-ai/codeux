import { describe, expect, it, vi } from "vitest";
import { StructuredAgentRequestService } from "../../../src/services/structured-agent-request-service.js";
import { StructuredProviderResponseService } from "../../../src/services/structured-provider-response-service.js";
import type { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";
import { normalizeQaReviewResult } from "../../../src/domain/qa-review/qa-review-result-normalizer.js";
import { parsePlannedSprintReply } from "../../../src/services/planning-json-extractor.js";

const reflectionSettings = (maxImprovementAttempts = 1) => ({
  cliWorkflow: {
    maxParsingRetries: 0,
    maxPlanningJsonRetries: 0,
  },
  agents: {
    selfReflection: {
      planning: {
        enabled: true,
        criteria: [
          {
            id: "correctness",
            label: "Correctness",
            prompt: "The output is correct.",
            threshold: 0.8,
          },
        ],
        maxImprovementAttempts,
      },
      qualityAssurance: {
        enabled: true,
        criteria: [
          {
            id: "correctness",
            label: "Correctness",
            prompt: "The review is correct.",
            threshold: 0.8,
          },
        ],
        maxImprovementAttempts,
      },
    },
  },
});

const reflectionPass = (score = 9) => JSON.stringify({
  criteria: [
    {
      id: "correctness",
      score,
      rationale: "Meets the requested criteria.",
      improvementInstructions: "",
    },
  ],
});

const reflectionFail = JSON.stringify({
  criteria: [
    {
      id: "correctness",
      score: 5,
      rationale: "The output is incomplete.",
      improvementInstructions: "Add the missing required detail.",
    },
  ],
});

const validPromptMarkdown = [
  "## Objective",
  "Do the work.",
  "",
  "## Scope",
  "- src/example.ts",
  "",
  "## Implementation Requirements",
  "1. Implement the change.",
  "",
  "## Constraints",
  "- Keep scope tight.",
  "",
  "## Verification",
  "- Run the focused test.",
].join("\n");

const planningPayload = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  goal: "Plan the sprint.",
  tasks: [
    {
      key: "T01",
      title: "Implement first task",
      description: "Implement the first task.",
      promptMarkdown: validPromptMarkdown,
      priority: "medium",
      executorType: "auto",
      dependsOn: [],
      ...overrides,
    },
  ],
});

describe("StructuredAgentRequestService", () => {
  it("parses valid JSON output successfully without retrying", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: '{"goal": "success", "tasks": []}',
        nativeSessionId: "native-123",
      }),
    } as unknown as ProviderExecutionService;

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });
    const service = new StructuredAgentRequestService({
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
    const service = new StructuredAgentRequestService({
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

  it("exhausts retries and throws the final parse error", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: 'invalid json over and over',
        nativeSessionId: "native-123",
      }),
    } as unknown as ProviderExecutionService;

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });
    const service = new StructuredAgentRequestService({
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
  });

  it("uses the planning JSON retry setting instead of the general parsing retry setting", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: "invalid json over and over",
        nativeSessionId: "native-123",
      }),
    } as unknown as ProviderExecutionService;

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });
    const service = new StructuredAgentRequestService({
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
      settings: {
        cliWorkflow: {
          maxParsingRetries: 0,
          maxPlanningJsonRetries: 2,
        },
      } as any,
      providerPrompt: "initial prompt",
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "Retry please",
      providerLabel: "Claude",
      sessionIdPrefix: "test",
    })).rejects.toThrow(/Unexpected token 'i'/);

    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(3);
  });


  it("creates a new execution invocation and appends initial prompt if none provided", async () => {
    const mockExecutionRepository = {
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "new-invocation-123" }),
      appendExecutionInvocationMessage: vi.fn(),
      updateExecutionInvocation: vi.fn(),
      listExecutionInvocationMessages: vi.fn().mockReturnValue([]),
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

    const service = new StructuredAgentRequestService({
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
      listExecutionInvocationMessages: vi.fn().mockReturnValue([]),
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

    const service = new StructuredAgentRequestService({
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
    const service = new StructuredAgentRequestService({
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

  it("re-throws ProviderTransportError correctly", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: false,
        stderr: "network error",
      }),
    } as unknown as ProviderExecutionService;

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });
    const service = new StructuredAgentRequestService({
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
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Claude",
      sessionIdPrefix: "test",
    })).rejects.toThrow("Virtual Claude worker failed again: network error");

    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(2);
  });

  it("re-throws ProviderEmptyOutputError correctly", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: "",
      }),
    } as unknown as ProviderExecutionService;

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });
    const service = new StructuredAgentRequestService({
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
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Claude",
      sessionIdPrefix: "test",
    })).rejects.toThrow("Virtual Claude worker returned empty output again.");

    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(2);
  });

    it("reuses invocationId and does not append duplicate system routing message", async () => {
    const mockExecutionRepository = {
      createExecutionInvocation: vi.fn(),
      appendExecutionInvocationMessage: vi.fn(),
      updateExecutionInvocation: vi.fn(),
      listExecutionInvocationMessages: vi.fn().mockReturnValue([
        {
          role: "system",
          contentMarkdown: "System route message",
          metadata: { routeKind: "virtual" }
        }
      ]),
    };

    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: '{"result": "ok"}',
        nativeSessionId: null,
      }),
    };

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService as any,
    });

    const service = new StructuredAgentRequestService({
      executionRepository: mockExecutionRepository as any,
      structuredProviderResponseService,
    });

    const result = await service.executeRequest({
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
      invocationId: "existing-invocation-123",
      systemRoutingMessage: "System route message",
    });

    expect(mockExecutionRepository.updateExecutionInvocation).toHaveBeenCalledWith("existing-invocation-123", {
      provider: "claude-code",
      model: "model-1",
    });

    // Should not append because message already exists
    expect(mockExecutionRepository.appendExecutionInvocationMessage).not.toHaveBeenCalled();

    expect(result.parsed).toEqual({ result: "ok" });
    expect(result.invocationId).toBe("existing-invocation-123");
  });

  it("appends system message on invocation reuse if it does not already exist", async () => {
    const mockExecutionRepository = {
      createExecutionInvocation: vi.fn(),
      appendExecutionInvocationMessage: vi.fn(),
      updateExecutionInvocation: vi.fn(),
      listExecutionInvocationMessages: vi.fn().mockReturnValue([
        {
          role: "system",
          contentMarkdown: "Different route message",
          metadata: { routeKind: "virtual" }
        }
      ]),
    };

    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: '{"result": "ok"}',
        nativeSessionId: null,
      }),
    };

    const structuredProviderResponseService = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService as any,
    });

    const service = new StructuredAgentRequestService({
      executionRepository: mockExecutionRepository as any,
      structuredProviderResponseService,
    });

    await service.executeRequest({
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
      invocationId: "existing-invocation-123",
      systemRoutingMessage: "System route message",
    });

    expect(mockExecutionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("existing-invocation-123", expect.objectContaining({
      role: "system",
      contentMarkdown: "System route message",
    }));
  });

  it("keeps self-reflection disabled by default", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: '{"result": "ok"}',
        nativeSessionId: "native-1",
      }),
    } as unknown as ProviderExecutionService;

    const service = new StructuredAgentRequestService({
      structuredProviderResponseService: new StructuredProviderResponseService({
        providerExecutionService: mockProviderExecutionService,
      }),
    });

    const result = await service.executeRequest<{ result: string }>({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      model: "model-1",
      apiKey: "test-key",
      providerPrompt: "initial prompt",
      repoPath: "/repo",
      settings: {} as any,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Claude",
      sessionIdPrefix: "test",
    });

    expect(result.parsed).toEqual({ result: "ok" });
    expect(result.selfReflection).toEqual({
      enabled: false,
      finalDecision: "disabled",
      attemptCount: 0,
      passed: true,
      scores: [],
    });
    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(1);
  });

  it("improves a below-threshold planning output in the same provider session", async () => {
    const mockExecutionRepository = {
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "inv-reflect" }),
      appendExecutionInvocationMessage: vi.fn(),
      listExecutionInvocationMessages: vi.fn().mockReturnValue([]),
    };
    const mockProviderExecutionService = {
      executeProvider: vi.fn()
        .mockResolvedValueOnce({ ok: true, text: '{"result": "rough"}', nativeSessionId: "native-1" })
        .mockResolvedValueOnce({ ok: true, text: reflectionFail, nativeSessionId: "native-1" })
        .mockResolvedValueOnce({ ok: true, text: '{"result": "better"}', nativeSessionId: "native-1" })
        .mockResolvedValueOnce({ ok: true, text: reflectionPass(), nativeSessionId: "native-1" }),
    } as unknown as ProviderExecutionService;

    const service = new StructuredAgentRequestService({
      executionRepository: mockExecutionRepository as any,
      structuredProviderResponseService: new StructuredProviderResponseService({
        providerExecutionService: mockProviderExecutionService,
      }),
    });

    const result = await service.executeRequest<{ result: string }>({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      model: "model-1",
      apiKey: "test-key",
      providerPrompt: "initial prompt",
      repoPath: "/repo",
      settings: reflectionSettings() as any,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Claude",
      sessionIdPrefix: "test",
    });

    expect(result.parsed).toEqual({ result: "better" });
    expect(result.selfReflection).toMatchObject({
      enabled: true,
      finalDecision: "passed",
      attemptCount: 1,
      passed: true,
    });
    expect(result.selfReflection.scores).toEqual([
      expect.objectContaining({
        id: "correctness",
        score: 9,
        threshold: 0.8,
        passed: true,
      }),
    ]);
    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(4);
    const calls = vi.mocked(mockProviderExecutionService.executeProvider).mock.calls;
    expect(calls[1]?.[0].continueSessionId).toBe("native-1");
    expect(calls[2]?.[0].prompt).toContain("Improve your previous structured JSON output");
    expect(mockExecutionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("inv-reflect", expect.objectContaining({
      metadata: expect.objectContaining({
        reflection: expect.objectContaining({ event: "reflection_improved" }),
      }),
    }));
  });

  it("stops at the max reflection attempt limit and keeps the last valid output", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn()
        .mockResolvedValueOnce({ ok: true, text: '{"result": "rough"}', nativeSessionId: "native-1" })
        .mockResolvedValueOnce({ ok: true, text: reflectionFail, nativeSessionId: "native-1" }),
    } as unknown as ProviderExecutionService;

    const service = new StructuredAgentRequestService({
      structuredProviderResponseService: new StructuredProviderResponseService({
        providerExecutionService: mockProviderExecutionService,
      }),
    });

    const result = await service.executeRequest<{ result: string }>({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      model: "model-1",
      apiKey: "test-key",
      providerPrompt: "initial prompt",
      repoPath: "/repo",
      settings: reflectionSettings(0) as any,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Claude",
      sessionIdPrefix: "test",
    });

    expect(result.parsed).toEqual({ result: "rough" });
    expect(result.selfReflection).toMatchObject({
      enabled: true,
      finalDecision: "max_attempts_reached",
      attemptCount: 0,
      passed: false,
    });
    expect(result.selfReflection.scores).toEqual([
      expect.objectContaining({
        id: "correctness",
        score: 5,
        passed: false,
      }),
    ]);
    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(2);
  });

  it("falls back to the accepted output when reflection JSON is malformed", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn()
        .mockResolvedValueOnce({ ok: true, text: '{"result": "accepted"}', nativeSessionId: "native-1" })
        .mockResolvedValueOnce({ ok: true, text: "not json", nativeSessionId: "native-1" }),
    } as unknown as ProviderExecutionService;

    const service = new StructuredAgentRequestService({
      structuredProviderResponseService: new StructuredProviderResponseService({
        providerExecutionService: mockProviderExecutionService,
      }),
    });

    const result = await service.executeRequest<{ result: string }>({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      model: "model-1",
      apiKey: "test-key",
      providerPrompt: "initial prompt",
      repoPath: "/repo",
      settings: reflectionSettings() as any,
      maxRetries: 0,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Claude",
      sessionIdPrefix: "test",
    });

    expect(result.parsed).toEqual({ result: "accepted" });
    expect(result.selfReflection).toEqual({
      enabled: true,
      finalDecision: "reflection_failed",
      attemptCount: 0,
      passed: false,
      scores: [],
    });
    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(2);
  });

  it("revalidates improved planning JSON and keeps the original when the DAG is invalid", async () => {
    const original = planningPayload();
    const invalidImprovement = JSON.stringify({
      goal: "Plan the sprint.",
      tasks: [
        {
          key: "T01",
          title: "Invalid task",
          description: "Invalid forward dependency.",
          promptMarkdown: validPromptMarkdown,
          priority: "medium",
          executorType: "auto",
          dependsOn: ["T02"],
        },
      ],
    });
    const mockProviderExecutionService = {
      executeProvider: vi.fn()
        .mockResolvedValueOnce({ ok: true, text: original, nativeSessionId: "native-1" })
        .mockResolvedValueOnce({ ok: true, text: reflectionFail, nativeSessionId: "native-1" })
        .mockResolvedValueOnce({ ok: true, text: invalidImprovement, nativeSessionId: "native-1" }),
    } as unknown as ProviderExecutionService;

    const service = new StructuredAgentRequestService({
      structuredProviderResponseService: new StructuredProviderResponseService({
        providerExecutionService: mockProviderExecutionService,
      }),
    });

    const result = await service.executeRequest({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      model: "model-1",
      apiKey: "test-key",
      providerPrompt: "initial prompt",
      repoPath: "/repo",
      settings: reflectionSettings() as any,
      maxRetries: 0,
      parseFn: (text) => parsePlannedSprintReply(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "Claude",
      sessionIdPrefix: "test",
    });

    expect(result.parsed.tasks[0]?.title).toBe("Implement first task");
    expect(result.selfReflection).toMatchObject({
      enabled: true,
      finalDecision: "improvement_failed",
      attemptCount: 1,
      passed: false,
    });
    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(3);
  });

  it("revalidates improved QA JSON and keeps the original when schema normalization fails", async () => {
    const original = JSON.stringify({ verdict: "pass", summary: "Looks good.", findings: [] });
    const invalidImprovement = JSON.stringify({ verdict: "maybe", summary: "Invalid.", findings: [] });
    const mockProviderExecutionService = {
      executeProvider: vi.fn()
        .mockResolvedValueOnce({ ok: true, text: original, nativeSessionId: "native-1" })
        .mockResolvedValueOnce({ ok: true, text: reflectionFail, nativeSessionId: "native-1" })
        .mockResolvedValueOnce({ ok: true, text: invalidImprovement, nativeSessionId: "native-1" }),
    } as unknown as ProviderExecutionService;

    const service = new StructuredAgentRequestService({
      structuredProviderResponseService: new StructuredProviderResponseService({
        providerExecutionService: mockProviderExecutionService,
      }),
    });

    const result = await service.executeRequest({
      projectId: "proj-1",
      purpose: "qa_review",
      type: "qa_review",
      provider: "claude-code",
      model: "model-1",
      apiKey: "test-key",
      providerPrompt: "qa prompt",
      repoPath: "/repo",
      settings: reflectionSettings() as any,
      maxRetries: 0,
      parseFn: (text) => normalizeQaReviewResult(text),
      buildRetryPrompt: () => "retry",
      providerLabel: "QA",
      sessionIdPrefix: "qa-review",
    });

    expect(result.parsed.verdict).toBe("pass");
    expect(result.parsed.summary).toBe("Looks good.");
    expect(result.selfReflection).toMatchObject({
      enabled: true,
      finalDecision: "improvement_failed",
      attemptCount: 1,
      passed: false,
    });
    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(3);
  });
});
