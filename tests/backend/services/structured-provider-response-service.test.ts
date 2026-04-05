import { describe, expect, it, vi } from "vitest";
import { StructuredProviderResponseService } from "../../../src/services/structured-provider-response-service.js";
import type { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";

describe("StructuredProviderResponseService", () => {
  it("parses valid JSON output successfully without retrying", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: '{"goal": "success", "tasks": []}',
        nativeSessionId: "native-123",
      }),
    } as unknown as ProviderExecutionService;

    const service = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });

    const result = await service.executeAndParse<{ goal: string }>({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      prompt: "my prompt",
      model: "model-1",
      apiKey: "test-key",
      sessionId: "session-1",
      settings: {} as any,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: (err) => `Failed: ${err.message}`,
      providerLabel: "Claude",
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

    const service = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });

    const result = await service.executeAndParse<{ fixed: boolean }>({
      projectId: "proj-1",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      prompt: "initial prompt",
      model: "model-1",
      apiKey: "test-key",
      sessionId: "session-1",
      settings: {} as any,
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: (err) => `Retry prompt: ${err.message}`,
      providerLabel: "Claude",
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

    const service = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });

    await expect(service.executeAndParse({
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
      parseFn: (text) => JSON.parse(text),
      buildRetryPrompt: () => "Retry please",
      providerLabel: "Claude",
    })).rejects.toThrow(/Unexpected token 'i'/);

    // 1 initial + 2 retries = 3 calls
    expect(mockProviderExecutionService.executeProvider).toHaveBeenCalledTimes(3);
  });

  it("handles schema validation failures inside parseFn", async () => {
    const mockProviderExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: '{"wrong_schema": true}',
        nativeSessionId: null,
      }),
    } as unknown as ProviderExecutionService;

    const service = new StructuredProviderResponseService({
      providerExecutionService: mockProviderExecutionService,
    });

    await expect(service.executeAndParse({
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
      parseFn: (text) => {
        const obj = JSON.parse(text);
        if (!obj.goal) throw new Error("Missing goal property");
        return obj;
      },
      buildRetryPrompt: (err) => `Fix schema: ${err.message}`,
      providerLabel: "Claude",
    })).rejects.toThrow("Missing goal property");

    const calls = vi.mocked(mockProviderExecutionService.executeProvider).mock.calls;
    expect(calls[1]?.[0].prompt).toBe("Fix schema: Missing goal property");
    expect(calls[1]?.[0].continueSessionId).toBe("session-1"); // Uses fallback session-1 if no native session
  });
});
