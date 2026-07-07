import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";
import { ProviderQuotaError } from "../../../src/shared/providers/provider-error-classifier.js";
import { runWithCorrelationId } from "../../../src/shared/logging/correlation-id.js";
import type { IProviderRunner, ProviderRunResult } from "../../../src/infrastructure/providers/cli/provider-runner.js";
import type { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import type { DashboardSettings } from "../../../src/contracts/app-types.js";
import { SERVER_SHUTDOWN_STOP_REASON } from "../../../src/services/active-dispatch-registry.js";

// Mock dependencies
vi.mock("../../../src/shared/providers/provider-error-classifier.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../src/shared/providers/provider-error-classifier.js")>();
  return {
    ...mod,
    classifyProviderError: vi.fn(),
  };
});

vi.mock("../../../src/shared/providers/provider-retry-policy.js", () => ({
  resolveProviderRetryDecision: vi.fn(),
  sleepWithSignal: vi.fn(),
}));

vi.mock("../../../src/services/cli-workflow-text-utils.js", () => ({
  isReadFileNotFoundToolError: vi.fn(),
  buildReadFileRetryPrompt: vi.fn(),
}));

import { classifyProviderError } from "../../../src/shared/providers/provider-error-classifier.js";
import { resolveProviderRetryDecision, sleepWithSignal } from "../../../src/shared/providers/provider-retry-policy.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "../../../src/services/cli-workflow-text-utils.js";

describe("ProviderExecutionService", () => {
  let providerRunner: import("vitest").Mocked<IProviderRunner>;
  let executionRepository: import("vitest").Mocked<ExecutionRepository>;
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
  let service: ProviderExecutionService;
  let defaultArgs: any;
  let mockResult: ProviderRunResult;
  let executionInvocationState: Record<string, unknown>;

  beforeEach(() => {
    vi.resetAllMocks();

    providerRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn(),
    } as any;

    executionInvocationState = { id: "exec-inv-1", status: "running" };
    executionRepository = {
      createExecutionInvocation: vi.fn().mockReturnValue(executionInvocationState),
      getExecutionInvocation: vi.fn(() => executionInvocationState as any),
      appendExecutionInvocationMessage: vi.fn(),
      clearExecutionInvocationMessages: vi.fn(),
      createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "prov-inv-1" }),
      getProviderInvocationUsage: vi.fn().mockReturnValue({ id: "prov-inv-1", status: "running" }),
      updateProviderInvocationUsage: vi.fn(),
      getTaskDispatch: vi.fn().mockReturnValue({ id: "dispatch-1", status: "running" }),
      updateTaskDispatch: vi.fn(),
      updateExecutionInvocation: vi.fn((_id, input) => {
        Object.assign(executionInvocationState, input);
      }),
      appendTaskRunEvent: vi.fn(),
    } as any;

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    service = new ProviderExecutionService({
      providerRunner,
      executionRepository,
      logger: logger as any,
      getGithubToken: vi.fn(),
    });

    defaultArgs = {
      projectId: "proj-1",
      provider: "claude-code",
      model: "test-model",
      prompt: "test prompt",
      cwd: "/test",
      apiKey: "test-key",
      sessionId: "session-1",
      workflowSettings: {
        retryOnReadFileNotFound: true,
        maxRateLimitRetries: 3,
      } as DashboardSettings["cliWorkflow"],
      repoPath: "/repo",
      purpose: "test-purpose",
      type: "test-type",
    };

    mockResult = {
      ok: true,
      stdout: "output",
      stderr: "",
      exitCode: 0,
      usageTelemetry: {
        transcriptText: "transcript",
        inputTokens: 10,
        outputTokens: 20,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 30,
        usageSource: "api",
        rawUsageJson: "{}",
      },
      nativeSessionId: "native-1",
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Happy path: returns ok: true, creates invocation and usage", async () => {
    providerRunner.runProvider.mockResolvedValue(mockResult);

    const result = await service.executeProvider(defaultArgs);

    expect(result).toBe(mockResult);
    expect(executionRepository.createExecutionInvocation).toHaveBeenCalled();
    expect(executionRepository.createProviderInvocationUsage).toHaveBeenCalled();
    expect(providerRunner.runProvider).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "test prompt" })
    );
    expect(executionRepository.updateProviderInvocationUsage).toHaveBeenCalledWith(
      "prov-inv-1",
      expect.objectContaining({ status: "completed" })
    );
    expect(executionRepository.updateExecutionInvocation).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({ status: "completed" })
    );
  });

  it("logs provider subprocess crashes as invocation metadata without raw prompt, command payloads, or secrets", async () => {
    const rawPrompt = "implement the secret rollout transcript";
    const rawApiKey = "sk-provider-secret";
    const rawCommandPayload = `docker run provider --prompt "${rawPrompt}" OPENAI_API_KEY=${rawApiKey}`;
    providerRunner.runProvider.mockRejectedValueOnce(new Error(rawCommandPayload));

    await expect(runWithCorrelationId("corr-provider-crash", () => service.executeProvider({
      ...defaultArgs,
      prompt: rawPrompt,
      apiKey: rawApiKey,
      provider: "codex",
      purpose: "task_coding",
      type: "task_coding",
      workflowSettings: {
        ...defaultArgs.workflowSettings,
        executionMode: "DOCKER",
      },
    }))).rejects.toThrow(rawCommandPayload);

    expect(logger.error).toHaveBeenCalledWith(
      "Provider invocation crashed",
      expect.objectContaining({
        logPurpose: "invocation",
        correlationId: "corr-provider-crash",
        invocationId: "exec-inv-1",
        providerInvocationId: "prov-inv-1",
        projectId: "proj-1",
        provider: "codex",
        purpose: "task_coding",
        executionMode: "DOCKER",
        errorName: "Error",
      }),
    );
    const loggedMetadata = JSON.stringify(logger.error.mock.calls);
    expect(loggedMetadata).not.toContain(rawPrompt);
    expect(loggedMetadata).not.toContain(rawApiKey);
    expect(loggedMetadata).not.toContain("docker run provider");
    expect(loggedMetadata).not.toContain("OPENAI_API_KEY");
  });

  it("persists provider usage updates with deterministic counters and no raw usage payload on live telemetry", async () => {
    providerRunner.runProvider.mockImplementation(async (opts: any) => {
      opts.onTelemetry({
        transcriptText: "provider transcript with API key sk-live-secret",
        inputTokens: 11,
        outputTokens: 7,
        cachedInputTokens: 3,
        reasoningOutputTokens: 2,
        totalTokens: 23,
        usageSource: "reported",
        rawUsageJson: { apiKey: "raw-usage-secret", transcript: "raw transcript" },
        conversation: [
          { kind: "assistant", text: "working" },
          { kind: "tool_call", text: "", toolName: "read_file", toolCallId: "call-1", toolArguments: "{\"path\":\"src/index.ts\"}" },
        ],
      });
      return mockResult;
    });

    await runWithCorrelationId("corr-provider-usage", () => service.executeProvider({
      ...defaultArgs,
      trackPromptInInvocation: false,
    }));

    expect(executionRepository.updateProviderInvocationUsage).toHaveBeenCalledWith(
      "prov-inv-1",
      expect.objectContaining({
        status: "running",
        transcriptChars: "provider transcript with API key sk-live-secret".length,
        inputTokens: 11,
        cachedInputTokens: 3,
        outputTokens: 7,
        reasoningOutputTokens: 2,
        totalTokens: 23,
        toolCallCount: 1,
        usageSource: "reported",
      }),
    );
    const runningUsageUpdate = executionRepository.updateProviderInvocationUsage.mock.calls.find(([, update]) =>
      (update as { status?: string }).status === "running"
    )?.[1] as Record<string, unknown>;
    expect(runningUsageUpdate.rawUsageJson).toEqual({ apiKey: "raw-usage-secret", transcript: "raw transcript" });

    expect(logger.info).toHaveBeenCalledWith(
      "Provider invocation started",
      expect.objectContaining({
        logPurpose: "invocation",
        correlationId: "corr-provider-usage",
        provider: "claude-code",
        purpose: "test-purpose",
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Provider invocation finished",
      expect.objectContaining({
        logPurpose: "invocation",
        correlationId: "corr-provider-usage",
        ok: true,
        totalTokens: 30,
        usageSource: "api",
      }),
    );
    const loggedMetadata = JSON.stringify(logger.info.mock.calls);
    expect(loggedMetadata).not.toContain("raw-usage-secret");
    expect(loggedMetadata).not.toContain("raw transcript");
    expect(loggedMetadata).not.toContain("provider transcript");
  });

  it("does not rewrite provider usage after external recovery closes it", async () => {
    executionRepository.getProviderInvocationUsage.mockReturnValue({ id: "prov-inv-1", status: "failed" } as any);
    executionRepository.getExecutionInvocation.mockReturnValue({ id: "exec-inv-1", status: "failed" } as any);
    providerRunner.runProvider.mockImplementation(async (opts: any) => {
      opts.onTelemetry({
        transcriptText: "late telemetry",
        inputTokens: 1,
        outputTokens: 2,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 3,
        usageSource: "reported",
        rawUsageJson: {},
      });
      return mockResult;
    });

    await service.executeProvider({
      ...defaultArgs,
      trackPromptInInvocation: false,
    });

    expect(executionRepository.updateProviderInvocationUsage).not.toHaveBeenCalledWith(
      "prov-inv-1",
      expect.objectContaining({ status: "running" }),
    );
    expect(executionRepository.updateProviderInvocationUsage).not.toHaveBeenCalledWith(
      "prov-inv-1",
      expect.objectContaining({ status: "completed" }),
    );
    expect(executionRepository.updateExecutionInvocation).not.toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({ status: "completed" }),
    );
    expect(executionRepository.appendExecutionInvocationMessage).not.toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({ contentMarkdown: "late telemetry" }),
    );
  });

  it("preserves Docker provider usage for startup recovery when restart interrupts the spawner", async () => {
    providerRunner.runProviderForText.mockRejectedValue(
      new Error("Command spawner host exited (code=null, signal=SIGINT)"),
    );

    await expect(service.executeProvider({
      ...defaultArgs,
      expectTextOutput: true,
      workflowSettings: {
        ...defaultArgs.workflowSettings,
        executionMode: "DOCKER",
      },
    })).rejects.toThrow("Command spawner host exited");

    expect(executionRepository.updateProviderInvocationUsage).not.toHaveBeenCalledWith(
      "prov-inv-1",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("preserves Docker provider usage when server shutdown aborts the provider", async () => {
    const controller = new AbortController();
    providerRunner.runProvider.mockImplementation(async () => {
      controller.abort(SERVER_SHUTDOWN_STOP_REASON);
      throw new Error("Command aborted");
    });

    await expect(service.executeProvider({
      ...defaultArgs,
      signal: controller.signal,
      workflowSettings: {
        ...defaultArgs.workflowSettings,
        executionMode: "DOCKER",
      },
    })).rejects.toThrow("Command aborted");

    expect(executionRepository.updateProviderInvocationUsage).not.toHaveBeenCalledWith(
      "prov-inv-1",
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(executionRepository.updateProviderInvocationUsage).not.toHaveBeenCalledWith(
      "prov-inv-1",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("Text output mode: calls runProviderForText when expectTextOutput is true", async () => {
    const textMockResult = { ...mockResult, text: "text output" };
    providerRunner.runProviderForText.mockResolvedValue(textMockResult);

    const result = await service.executeProvider({ ...defaultArgs, expectTextOutput: true });

    expect(result).toBe(textMockResult);
    expect(providerRunner.runProviderForText).toHaveBeenCalled();
    expect(providerRunner.runProvider).not.toHaveBeenCalled();
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({ role: "assistant", contentMarkdown: "text output" })
    );
  });

  it("final success replaces placeholder messages with a parsed planning transcript", async () => {
    const textMockResult = {
      ...mockResult,
      text: "{\"verdict\":\"pass\"}",
      usageTelemetry: {
        ...mockResult.usageTelemetry,
        conversation: [
          { kind: "user", text: "Review this diff." },
          { kind: "reasoning", text: "I will inspect the diff and verify the rollout." },
          { kind: "tool_call", text: "", toolName: "read_file", toolCallId: "c1", toolArguments: "{\"path\":\"src/app.ts\"}", toolStatus: "completed" },
          { kind: "tool_result", text: "", toolCallId: "c1", toolName: "read_file", toolOutput: "file contents", toolStatus: "completed" },
          { kind: "assistant", text: "{\"verdict\":\"pass\"}" },
        ],
      },
    };
    providerRunner.runProviderForText.mockResolvedValue(textMockResult);

    await service.executeProvider({
      ...defaultArgs,
      purpose: "planning",
      type: "qa_review",
      expectTextOutput: true,
    });

    expect(providerRunner.runProviderForText).toHaveBeenCalled();
    expect(executionRepository.clearExecutionInvocationMessages).toHaveBeenCalledWith("exec-inv-1");
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        role: "user",
        contentMarkdown: "Review this diff.",
      }),
    );
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        role: "assistant",
        contentMarkdown: "I will inspect the diff and verify the rollout.",
        metadata: expect.objectContaining({
          kind: "reasoning",
          provider: "claude-code",
          model: "test-model",
        }),
      }),
    );
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        role: "tool",
        contentMarkdown: "",
        toolCallsJson: expect.objectContaining({
          arguments: "{\"path\":\"src/app.ts\"}",
          callId: "c1",
        }),
        metadata: expect.objectContaining({
          kind: "tool_call",
          toolName: "read_file",
          toolStatus: "completed",
          provider: "claude-code",
          model: "test-model",
        }),
      })
    );
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        role: "tool",
        toolCallsJson: expect.objectContaining({ output: "file contents" }),
        metadata: expect.objectContaining({
          kind: "tool_result",
          toolName: "read_file",
          provider: "claude-code",
          model: "test-model",
        }),
      })
    );
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        role: "assistant",
        contentMarkdown: "{\"verdict\":\"pass\"}",
      })
    );
  });

  it("rewrites live telemetry when reasoning or tool payloads change without changing counts", async () => {
    const firstConversation = [
      { kind: "user", text: "Do the task." },
      { kind: "reasoning", text: "alpha" },
      { kind: "tool_call", text: "", toolName: "read_file", toolCallId: "c1", toolArguments: "{\"a\":1}", toolStatus: "ready" },
      { kind: "tool_result", text: "", toolCallId: "c1", toolName: "read_file", toolOutput: "value", toolStatus: "ready" },
      { kind: "assistant", text: "done" },
    ];
    const secondConversation = [
      { kind: "user", text: "Do the task." },
      { kind: "reasoning", text: "bravo" },
      { kind: "tool_call", text: "", toolName: "read_file", toolCallId: "c1", toolArguments: "{\"b\":2}", toolStatus: "final" },
      { kind: "tool_result", text: "", toolCallId: "c1", toolName: "read_file", toolOutput: "other", toolStatus: "final" },
      { kind: "assistant", text: "done" },
    ];
    providerRunner.runProviderForText.mockImplementation(async (opts: any) => {
      opts.onTelemetry({
        ...mockResult.usageTelemetry,
        transcriptText: "same",
        conversation: firstConversation as any,
      });
      opts.onTelemetry({
        ...mockResult.usageTelemetry,
        transcriptText: "same",
        conversation: secondConversation as any,
      });
      return {
        ...mockResult,
        text: "",
        usageTelemetry: {
          ...mockResult.usageTelemetry,
          conversation: [],
          transcriptText: "",
        },
      } as ProviderRunResult & { text: string };
    });

    await service.executeProvider({
      ...defaultArgs,
      purpose: "remediation",
      type: "qa_review",
      expectTextOutput: true,
      trackPromptInInvocation: false,
    });

    expect(executionRepository.clearExecutionInvocationMessages).toHaveBeenCalledTimes(2);
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        role: "assistant",
        contentMarkdown: "bravo",
        metadata: expect.objectContaining({
          kind: "reasoning",
        }),
      }),
    );
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        role: "tool",
        toolCallsJson: expect.objectContaining({
          arguments: "{\"b\":2}",
        }),
        metadata: expect.objectContaining({
          kind: "tool_call",
          toolStatus: "final",
        }),
      }),
    );
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        role: "tool",
        toolCallsJson: expect.objectContaining({
          output: "other",
        }),
        metadata: expect.objectContaining({
          kind: "tool_result",
        }),
      }),
    );
  });

  it("skips the message rewrite when a telemetry tick repeats the same conversation", async () => {
    const sameConversation = [
      { kind: "user", text: "Do the task." },
      { kind: "assistant", text: "Working..." },
    ];
    const grownConversation = [
      ...sameConversation,
      { kind: "tool_call", text: "", toolName: "read_file", toolCallId: "c1", toolArguments: "{}" },
    ];
    providerRunner.runProvider.mockImplementation(async (opts: any) => {
      const tick = (conversation: any[], transcriptText: string) => opts.onTelemetry({
        ...mockResult.usageTelemetry,
        transcriptText,
        conversation,
      });
      tick(sameConversation, "abc");   // first state — should write
      tick(sameConversation, "abc");   // identical — should be skipped
      tick(grownConversation, "abcd"); // changed — should write again
      return {
        ...mockResult,
        usageTelemetry: {
          ...mockResult.usageTelemetry,
          transcriptText: "",
        },
      };
    });

    await service.executeProvider({
      ...defaultArgs,
      trackPromptInInvocation: false,
    });

    // Two distinct states persisted (the duplicate middle tick was skipped), not three.
    expect(executionRepository.clearExecutionInvocationMessages).toHaveBeenCalledTimes(2);
  });

  it("skips provider usage writes when a telemetry tick repeats the same usage state", async () => {
    providerRunner.runProvider.mockImplementation(async (opts: any) => {
      const tick = (totalTokens: number) => opts.onTelemetry({
        ...mockResult.usageTelemetry,
        transcriptText: "same transcript",
        inputTokens: totalTokens / 3,
        outputTokens: totalTokens / 3,
        totalTokens,
        usageSource: "estimated",
        rawUsageJson: { totalTokens },
        conversation: [
          { kind: "assistant", text: "Working..." },
        ],
      });
      tick(30);
      tick(30);
      tick(33);
      return {
        ...mockResult,
        usageTelemetry: {
          ...mockResult.usageTelemetry,
          transcriptText: "",
        },
      };
    });

    await service.executeProvider({
      ...defaultArgs,
      trackPromptInInvocation: false,
    });

    const runningUsageWrites = executionRepository.updateProviderInvocationUsage.mock.calls.filter(([, update]) => (
      (update as { status?: string }).status === "running"
    ));
    expect(runningUsageWrites).toHaveLength(2);
    expect(runningUsageWrites[0]?.[1]).toEqual(expect.objectContaining({ totalTokens: 30 }));
    expect(runningUsageWrites[1]?.[1]).toEqual(expect.objectContaining({ totalTokens: 33 }));
  });

  it("refreshes the linked active dispatch heartbeat when live telemetry is persisted", async () => {
    providerRunner.runProvider.mockImplementation(async (opts: any) => {
      opts.onTelemetry({
        ...mockResult.usageTelemetry,
        transcriptText: "live transcript",
        conversation: [
          { kind: "assistant", text: "Working..." },
        ],
      });
      return mockResult;
    });

    await service.executeProvider({
      ...defaultArgs,
      dispatchId: "dispatch-1",
      trackPromptInInvocation: false,
    });

    expect(executionRepository.getTaskDispatch).toHaveBeenCalledWith("dispatch-1");
    expect(executionRepository.updateTaskDispatch).toHaveBeenCalledWith(
      "dispatch-1",
      expect.objectContaining({
        lastHeartbeatAt: expect.any(String),
      }),
    );
  });

  it("allows structured callers to defer invocation completion and assistant transcript writes", async () => {
    const textMockResult = { ...mockResult, text: "text output" };
    providerRunner.runProviderForText.mockResolvedValue(textMockResult);

    const result = await service.executeProvider({
      ...defaultArgs,
      expectTextOutput: true,
      invocationId: "exec-inv-structured",
      finalizeExecutionInvocation: false,
      trackAssistantInInvocation: false,
      trackPromptInInvocation: false,
    });

    expect(result).toBe(textMockResult);
    expect(executionRepository.createExecutionInvocation).not.toHaveBeenCalled();
    expect(executionRepository.updateExecutionInvocation).toHaveBeenCalledWith("exec-inv-structured", {
      providerInvocationId: "prov-inv-1",
    });
    expect(executionRepository.updateExecutionInvocation).not.toHaveBeenCalledWith(
      "exec-inv-structured",
      expect.objectContaining({ status: "completed" })
    );
    expect(executionRepository.appendExecutionInvocationMessage).not.toHaveBeenCalledWith(
      "exec-inv-structured",
      expect.objectContaining({ role: "assistant" })
    );
    expect(executionRepository.appendExecutionInvocationMessage).not.toHaveBeenCalledWith(
      "exec-inv-structured",
      expect.objectContaining({ role: "user" })
    );
  });

  it("Read-file-not-found retry: retries once with modified prompt", async () => {
    const failedResult = { ...mockResult, ok: false };
    providerRunner.runProvider
      .mockResolvedValueOnce(failedResult)
      .mockResolvedValueOnce(mockResult);

    vi.mocked(isReadFileNotFoundToolError).mockReturnValueOnce(true);
    vi.mocked(buildReadFileRetryPrompt).mockReturnValueOnce("modified prompt");

    const result = await service.executeProvider(defaultArgs);

    expect(result).toBe(mockResult);
    expect(providerRunner.runProvider).toHaveBeenCalledTimes(2);
    expect(providerRunner.runProvider).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ prompt: "test prompt" })
    );
    expect(providerRunner.runProvider).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ prompt: "modified prompt" })
    );
  });

  it("Rate-limit retry and exhaustion: retries up to maxRateLimitRetries then throws ProviderQuotaError", async () => {
    const failedResult = { ...mockResult, ok: false };
    providerRunner.runProvider.mockResolvedValue(failedResult);

    vi.mocked(classifyProviderError).mockReturnValue({
      category: "RATE_LIMITED",
      userMessage: "Rate limited",
      resetAtIso: "2024-01-01T00:00:00Z",
      provider: "claude-code",
      resetAfter: null,
    });

    vi.mocked(resolveProviderRetryDecision).mockReturnValue({
      kind: "rate_limit",
      delayMs: 1000,
      retryAtIso: "2024-01-01T00:00:01Z",
    });

    await expect(service.executeProvider(defaultArgs)).rejects.toThrow(ProviderQuotaError);

    // Initial call + 3 retries = 4 calls total
    expect(providerRunner.runProvider).toHaveBeenCalledTimes(4);
    expect(sleepWithSignal.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("Quota-reset wait: emits a cli_provider_quota_wait task-run event while sleeping in-process", async () => {
    const failedResult = { ...mockResult, ok: false };
    // First call hits quota, the in-process wait elapses, the retry succeeds.
    providerRunner.runProvider
      .mockResolvedValueOnce(failedResult)
      .mockResolvedValueOnce(mockResult);

    vi.mocked(classifyProviderError).mockReturnValue({
      category: "QUOTA_EXHAUSTED",
      userMessage: "Quota exceeded",
      resetAtIso: "2026-06-01T12:00:00.000Z",
      provider: "claude-code",
      resetAfter: "2h0m0s",
    });
    vi.mocked(resolveProviderRetryDecision).mockReturnValue({
      kind: "quota_reset",
      delayMs: 1000,
      retryAtIso: "2026-06-01T12:30:00.000Z",
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:29:59.000Z"));
    vi.mocked(sleepWithSignal).mockImplementation(async (delayMs: number) => {
      vi.setSystemTime(new Date(Date.now() + delayMs));
    });

    const result = await service.executeProvider({ ...defaultArgs, taskRunId: "run-1" });

    expect(result).toBe(mockResult);
    expect(sleepWithSignal).toHaveBeenCalledTimes(1);
    expect(executionRepository.updateExecutionInvocation).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        lastRetryAfterIso: "2026-06-01T12:30:00.000Z",
      }),
    );
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          retryAfterIso: "2026-06-01T12:30:00.000Z",
        }),
      }),
    );
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_provider_quota_wait",
      "system",
      expect.objectContaining({
        kind: "quota_reset",
        errorCategory: "QUOTA_EXHAUSTED",
        retryAfterIso: "2026-06-01T12:30:00.000Z",
      }),
      expect.objectContaining({ sourceEventKey: expect.stringContaining("quota-wait") }),
    );
  });

  it("Quota-reset propagation: omits misleading retry metadata when no retry is scheduled", async () => {
    const failedResult = { ...mockResult, ok: false };
    providerRunner.runProvider.mockResolvedValue(failedResult);

    vi.mocked(classifyProviderError).mockReturnValue({
      category: "QUOTA_EXHAUSTED",
      userMessage: "Quota exceeded",
      resetAtIso: "2026-06-01T12:00:00.000Z",
      provider: "claude-code",
      resetAfter: "2h0m0s",
    });
    vi.mocked(resolveProviderRetryDecision).mockReturnValue(null);

    await expect(service.executeProvider(defaultArgs)).rejects.toMatchObject({
      name: "ProviderQuotaError",
      retryAfterIso: null,
    });

    expect(executionRepository.updateExecutionInvocation).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        lastRetryAfterIso: null,
      }),
    );
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          retryAfterIso: null,
        }),
      }),
    );
  });

  it("Quota error propagation: throws ProviderQuotaError on QUOTA_EXHAUSTED", async () => {
    const failedResult = { ...mockResult, ok: false };
    providerRunner.runProvider.mockResolvedValue(failedResult);

    vi.mocked(classifyProviderError).mockReturnValue({
      category: "QUOTA_EXHAUSTED",
      userMessage: "Quota exceeded",
      resetAtIso: null,
      provider: "claude-code",
      resetAfter: null,
    });

    vi.mocked(resolveProviderRetryDecision).mockReturnValue(null);

    await expect(service.executeProvider(defaultArgs)).rejects.toThrow(ProviderQuotaError);

    expect(providerRunner.runProvider).toHaveBeenCalledTimes(1);
    expect(sleepWithSignal).not.toHaveBeenCalled();
  });

  it("Unknown failure passthrough: returns result without throwing on UNKNOWN classification", async () => {
    const failedResult = { ...mockResult, ok: false };
    providerRunner.runProvider.mockResolvedValue(failedResult);

    vi.mocked(classifyProviderError).mockReturnValue({
      category: "UNKNOWN",
      userMessage: "Unknown error",
      resetAtIso: null,
      provider: "claude-code",
      resetAfter: null,
    });

    vi.mocked(resolveProviderRetryDecision).mockReturnValue(null);
    vi.mocked(isReadFileNotFoundToolError).mockReturnValue(false);

    const result = await service.executeProvider(defaultArgs);

    expect(result).toBe(failedResult);
    expect(providerRunner.runProvider).toHaveBeenCalledTimes(1);
  });

  it("sanitizes bootstrap-branch fatal lines before persisting fallback failure output", async () => {
    const failedResult = {
      ...mockResult,
      ok: false,
      stderr: [
        "fatal: your current branch 'code-ux-bootstrap-1' does not have any commits yet",
        "keep this line",
      ].join("\n"),
      stdout: "",
    };
    providerRunner.runProvider.mockResolvedValue(failedResult);

    vi.mocked(classifyProviderError).mockReturnValue({
      category: "UNKNOWN",
      userMessage: "Unknown error",
      resetAtIso: null,
      provider: "claude-code",
      resetAfter: null,
    });
    vi.mocked(resolveProviderRetryDecision).mockReturnValue(null);
    vi.mocked(isReadFileNotFoundToolError).mockReturnValue(false);

    await service.executeProvider(defaultArgs);

    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "exec-inv-1",
      expect.objectContaining({
        role: "tool",
        contentMarkdown: "keep this line",
      }),
    );
  });

  it("AbortSignal: passes signal to sleepWithSignal", async () => {
    const failedResult = { ...mockResult, ok: false };
    providerRunner.runProvider.mockResolvedValue(failedResult);

    vi.mocked(classifyProviderError).mockReturnValue({
      category: "RATE_LIMITED",
      userMessage: "Rate limited",
      resetAtIso: "2024-01-01T00:00:00Z",
      provider: "claude-code",
      resetAfter: null,
    });

    vi.mocked(resolveProviderRetryDecision).mockReturnValue({
      kind: "rate_limit",
      delayMs: 1000,
      retryAtIso: "2024-01-01T00:00:01Z",
    });

    // Make sleepWithSignal throw to short-circuit the loop simulating an abort
    vi.mocked(sleepWithSignal).mockRejectedValueOnce(new Error("Aborted"));

    const abortController = new AbortController();
    abortController.abort();

    await expect(service.executeProvider({ ...defaultArgs, signal: abortController.signal }))
      .rejects.toThrow("Aborted");

    expect(sleepWithSignal).toHaveBeenCalledWith(expect.any(Number), abortController.signal);
    expect(sleepWithSignal.mock.calls[0]?.[0]).toBeGreaterThan(0);
    expect(sleepWithSignal.mock.calls[0]?.[0]).toBeLessThanOrEqual(1000);
  });
});
