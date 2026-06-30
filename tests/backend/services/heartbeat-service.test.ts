import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeartbeatService } from "../../../src/services/heartbeat-service.js";

interface FakeRun {
  status: string;
}

function createDeps(initialStatus = "running") {
  const run: FakeRun = { status: initialStatus };
  const executionRepository = {
    getSprintRun: vi.fn(() => ({ ...run })),
    renewLease: vi.fn(),
    updateSprintRun: vi.fn(),
  };
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  return { run, executionRepository, logger };
}

describe("HeartbeatService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renews immediately on start and refreshes the lease when a token is supplied", () => {
    const { executionRepository, logger } = createDeps("running");
    const service = new HeartbeatService({ executionRepository, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1", "lease-token");

    expect(executionRepository.updateSprintRun).toHaveBeenCalledWith("run-1", expect.objectContaining({ status: "running" }));
    expect(executionRepository.renewLease).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: "sprint", scopeId: "sprint-1", leaseToken: "lease-token" }),
    );

    service.stopAll();
  });

  it("renews again on each interval tick", () => {
    const { executionRepository, logger } = createDeps("running");
    const service = new HeartbeatService({ executionRepository, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1");
    expect(executionRepository.updateSprintRun).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    expect(executionRepository.updateSprintRun).toHaveBeenCalledTimes(4);

    service.stopHeartbeat("run-1");
  });

  it("ignores duplicate start calls for the same run", () => {
    const { executionRepository, logger } = createDeps("running");
    const service = new HeartbeatService({ executionRepository, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1");
    service.startHeartbeat("run-1", "sprint-1");

    expect(executionRepository.updateSprintRun).toHaveBeenCalledTimes(1);
    service.stopAll();
  });

  it("uses the default interval when none is provided", () => {
    const { executionRepository, logger } = createDeps("running");
    const service = new HeartbeatService({ executionRepository, logger: logger as never });

    service.startHeartbeat("run-1", "sprint-1");
    executionRepository.updateSprintRun.mockClear();

    vi.advanceTimersByTime(29_000);
    expect(executionRepository.updateSprintRun).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(executionRepository.updateSprintRun).toHaveBeenCalledTimes(1);

    service.stopAll();
  });

  it("stops the heartbeat when the run has reached a terminal status", () => {
    const { executionRepository, logger } = createDeps("completed");
    const service = new HeartbeatService({ executionRepository, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1");

    // Terminal status short-circuits before any update happens, and the timer is cleared.
    expect(executionRepository.updateSprintRun).not.toHaveBeenCalled();
    executionRepository.getSprintRun.mockClear();
    vi.advanceTimersByTime(5000);
    expect(executionRepository.getSprintRun).not.toHaveBeenCalled();
  });

  it("logs and keeps running when the initial renewal throws", () => {
    const { executionRepository, logger } = createDeps("running");
    executionRepository.getSprintRun.mockImplementationOnce(() => {
      throw new Error("db offline");
    });
    const service = new HeartbeatService({ executionRepository, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1");

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to execute initial sprint run heartbeat",
      expect.objectContaining({ sprintRunId: "run-1", error: "db offline" }),
    );
    service.stopAll();
  });

  it("logs interval renewal failures without throwing", () => {
    const { executionRepository, logger } = createDeps("running");
    const service = new HeartbeatService({ executionRepository, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1");
    executionRepository.getSprintRun.mockImplementationOnce(() => {
      throw "boom";
    });

    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to renew sprint run heartbeat",
      expect.objectContaining({ sprintRunId: "run-1", error: "boom" }),
    );
    service.stopAll();
  });

  it("stopHeartbeat is a no-op for unknown runs and stopAll clears every timer", () => {
    const { executionRepository, logger } = createDeps("running");
    const service = new HeartbeatService({ executionRepository, logger: logger as never, intervalMs: 1000 });

    expect(() => service.stopHeartbeat("missing")).not.toThrow();

    service.startHeartbeat("run-1", "sprint-1");
    service.startHeartbeat("run-2", "sprint-2");
    executionRepository.updateSprintRun.mockClear();
    service.stopAll();

    vi.advanceTimersByTime(5000);
    expect(executionRepository.updateSprintRun).not.toHaveBeenCalled();
  });
});
