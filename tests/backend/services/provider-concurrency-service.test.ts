import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProviderConcurrencyService } from "../../../src/services/provider-concurrency-service.js";
import type { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import type { Logger } from "../../../src/shared/logging/logger.js";

describe("ProviderConcurrencyService", () => {
  let executionRepository: any;
  let logger: Logger;
  let service: ProviderConcurrencyService;

  beforeEach(() => {
    executionRepository = {
      listRunningProviderInvocationUsages: vi.fn(),
      tryCreateProviderInvocationUsage: vi.fn(),
      createProviderInvocationUsage: vi.fn(),
      updateProviderInvocationUsage: vi.fn(),
      listExecutionInvocationsByProviderInvocationId: vi.fn().mockReturnValue([]),
      updateExecutionInvocation: vi.fn(),
      appendExecutionInvocationMessage: vi.fn(),
    };
    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as any;
    service = new ProviderConcurrencyService({ executionRepository, logger });
  });

  describe("waitForSlot", () => {
    it("should return immediately if limit is 0", async () => {
      await service.waitForSlot("jules", 0);
      expect(executionRepository.listRunningProviderInvocationUsages).not.toHaveBeenCalled();
    });

    it("should return immediately if current count is less than limit", async () => {
      executionRepository.listRunningProviderInvocationUsages.mockReturnValue([{}, {}]); // 2 running
      await service.waitForSlot("jules", 5);
      expect(executionRepository.listRunningProviderInvocationUsages).toHaveBeenCalledWith(["jules"]);
    });

    it("should wait and retry if limit is reached", async () => {
      vi.useFakeTimers();
      try {
        executionRepository.listRunningProviderInvocationUsages
          .mockReturnValueOnce([{}, {}, {}]) // 3 running, limit 3
          .mockReturnValueOnce([{}, {}]);    // 2 running, limit 3 (free slot)

        const start = Date.now();
        const waitPromise = service.waitForSlot("jules", 3);
        await vi.advanceTimersByTimeAsync(2000);
        await waitPromise;
        const duration = Date.now() - start;

        expect(executionRepository.listRunningProviderInvocationUsages).toHaveBeenCalledTimes(2);
        expect(duration).toBeGreaterThanOrEqual(1900); // 2 seconds sleep
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("waitForSlotAndClaim", () => {
    it("should claim immediately if limit is 0", async () => {
      const input = { provider: "jules" } as any;
      executionRepository.createProviderInvocationUsage.mockReturnValue({ id: "inv-1" });

      const result = await service.waitForSlotAndClaim("jules", 0, input);

      expect(result.id).toBe("inv-1");
      expect(executionRepository.createProviderInvocationUsage).toHaveBeenCalledWith(input);
    });

    it("should claim immediately if tryCreate returns a record", async () => {
      const input = { provider: "jules" } as any;
      executionRepository.tryCreateProviderInvocationUsage.mockReturnValue({ id: "inv-1" });

      const result = await service.waitForSlotAndClaim("jules", 5, input);

      expect(result.id).toBe("inv-1");
      expect(executionRepository.tryCreateProviderInvocationUsage).toHaveBeenCalledWith(input, 5);
    });

    it("should wait and retry if tryCreate returns null", async () => {
      const input = { provider: "jules" } as any;
      executionRepository.tryCreateProviderInvocationUsage
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ id: "inv-2" });
      
      executionRepository.listRunningProviderInvocationUsages.mockReturnValue([{}, {}, {}, {}, {}]); // 5 running

      const result = await service.waitForSlotAndClaim("jules", 5, input);

      expect(result.id).toBe("inv-2");
      expect(executionRepository.tryCreateProviderInvocationUsage).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("cap reached"), expect.anything());
    });

    it("should handle simultaneous claims by retrying if tryCreate fails", async () => {
      vi.useFakeTimers();
      try {
        const input1 = { provider: "jules", sessionId: "s1" } as any;
        const input2 = { provider: "jules", sessionId: "s2" } as any;

        // Simulate a race where two calls try to claim the last slot.
        // The first call to tryCreateProviderInvocationUsage succeeds, the second fails (returns null).
        executionRepository.tryCreateProviderInvocationUsage
          .mockReturnValueOnce({ id: "inv-1" }) // First call succeeds
          .mockReturnValueOnce(null)             // Second call fails (simulated race)
          .mockReturnValueOnce({ id: "inv-2" }); // Second call succeeds on retry

        executionRepository.listRunningProviderInvocationUsages.mockReturnValue([{}, {}, {}, {}, {}]); // 5 running

        const p1 = service.waitForSlotAndClaim("jules", 5, input1);
        const p2 = service.waitForSlotAndClaim("jules", 5, input2);

        // Advance timers to trigger the retry for the second call
        await vi.advanceTimersByTimeAsync(2000);

        const [res1, res2] = await Promise.all([p1, p2]);

        expect(res1.id).toBe("inv-1");
        expect(res2.id).toBe("inv-2");
        expect(executionRepository.tryCreateProviderInvocationUsage).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("releases stale Docker provider slots before claiming", async () => {
      const staleInvocation = {
        id: "provider-stale",
        provider: "qwen-code",
        purpose: "qa_review",
        status: "running",
        executionMode: "DOCKER",
        sessionId: "qa-review-qwen-code-stale",
        startedAt: "2000-01-01T00:00:00.000Z",
        durationMs: null,
      };
      executionRepository.listRunningProviderInvocationUsages.mockReturnValue([staleInvocation]);
      executionRepository.listExecutionInvocationsByProviderInvocationId.mockReturnValue([
        { id: "exec-stale", status: "running", startedAt: "2000-01-01T00:00:00.000Z", lastMessageAt: null },
      ]);
      executionRepository.tryCreateProviderInvocationUsage.mockReturnValue({ id: "provider-new" });
      service = new ProviderConcurrencyService({
        executionRepository,
        logger,
        dockerService: {
          isAvailable: vi.fn().mockResolvedValue(true),
          listContainers: vi.fn().mockResolvedValue([]),
        },
      });

      const result = await service.waitForSlotAndClaim("qwen-code", 2, { provider: "qwen-code" } as any);

      expect(result.id).toBe("provider-new");
      expect(executionRepository.updateProviderInvocationUsage).toHaveBeenCalledWith("provider-stale", expect.objectContaining({
        status: "failed",
      }));
      expect(executionRepository.updateExecutionInvocation).toHaveBeenCalledWith("exec-stale", expect.objectContaining({
        status: "failed",
        errorMessage: expect.stringContaining("Docker container disappeared"),
      }));
      expect(executionRepository.tryCreateProviderInvocationUsage).toHaveBeenCalledWith({ provider: "qwen-code" }, 2);
    });

    it("keeps Docker provider slots with recent linked execution activity", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-14T18:00:00.000Z"));
      try {
        const activeInvocation = {
          id: "provider-active",
          provider: "qwen-code",
          purpose: "qa_review",
          status: "running",
          executionMode: "DOCKER",
          sessionId: "qa-review-qwen-code-starting",
          startedAt: "2026-06-14T17:58:00.000Z",
          durationMs: null,
        };
        executionRepository.listRunningProviderInvocationUsages.mockReturnValue([activeInvocation, activeInvocation]);
        executionRepository.listExecutionInvocationsByProviderInvocationId.mockReturnValue([
          {
            id: "exec-active",
            status: "running",
            startedAt: "2026-06-14T17:59:30.000Z",
            lastMessageAt: "2026-06-14T17:59:45.000Z",
          },
        ]);
        executionRepository.tryCreateProviderInvocationUsage.mockReturnValueOnce(null).mockReturnValueOnce({ id: "provider-new" });
        service = new ProviderConcurrencyService({
          executionRepository,
          logger,
          dockerService: {
            isAvailable: vi.fn().mockResolvedValue(true),
            listContainers: vi.fn().mockResolvedValue([]),
          },
        });

        const wait = service.waitForSlotAndClaim("qwen-code", 1, { provider: "qwen-code" } as any);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await wait;

        expect(result.id).toBe("provider-new");
        expect(executionRepository.updateProviderInvocationUsage).not.toHaveBeenCalled();
        expect(executionRepository.updateExecutionInvocation).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("getGlobalRunningCounts", () => {
    it("should return counts per provider", () => {
      executionRepository.listRunningProviderInvocationUsages.mockReturnValue([
        { provider: "jules" },
        { provider: "gemini" },
        { provider: "jules" },
      ]);

      const counts = service.getGlobalRunningCounts();

      expect(counts).toEqual({
        jules: 2,
        gemini: 1,
      });
    });
  });
});
