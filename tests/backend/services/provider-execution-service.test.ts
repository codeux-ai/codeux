import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";
import { ProviderQuotaError } from "../../../src/shared/providers/provider-error-classifier.js";
import type { IProviderRunner, ProviderRunResult } from "../../../src/infrastructure/providers/cli/provider-runner.js";
import type { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import type { DashboardSettings } from "../../../src/contracts/app-types.js";

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
  let service: ProviderExecutionService;
  let defaultArgs: any;
  let mockResult: ProviderRunResult;

  beforeEach(() => {
    vi.resetAllMocks();

    providerRunner = {
      runProvider: vi.fn(),
      runProviderForText: vi.fn(),
    } as any;

    executionRepository = {
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-inv-1" }),
      appendExecutionInvocationMessage: vi.fn(),
      createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "prov-inv-1" }),
      updateProviderInvocationUsage: vi.fn(),
      updateExecutionInvocation: vi.fn(),
      appendTaskRunEvent: vi.fn(),
    } as any;

    service = new ProviderExecutionService({
      providerRunner,
      executionRepository,
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
    expect(sleepWithSignal).toHaveBeenCalledTimes(3);
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
      retryAtIso: "2026-06-01T12:00:00.000Z",
    });

    const result = await service.executeProvider({ ...defaultArgs, taskRunId: "run-1" });

    expect(result).toBe(mockResult);
    expect(sleepWithSignal).toHaveBeenCalledTimes(1);
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_provider_quota_wait",
      "system",
      expect.objectContaining({
        kind: "quota_reset",
        errorCategory: "QUOTA_EXHAUSTED",
        retryAfterIso: "2026-06-01T12:00:00.000Z",
      }),
      expect.objectContaining({ sourceEventKey: expect.stringContaining("quota-wait") }),
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

    expect(sleepWithSignal).toHaveBeenCalledWith(1000, abortController.signal);
  });
});
