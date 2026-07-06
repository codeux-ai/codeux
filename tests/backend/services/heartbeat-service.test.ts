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
  const sprintRunLifecycleService = {
    renewHeartbeat: vi.fn(({ sprintRunId, sprintId, leaseToken }: { sprintRunId: string; sprintId: string; leaseToken?: string }) => {
      const latest = executionRepository.getSprintRun(sprintRunId);
      if (latest.status === "completed" || latest.status === "failed" || latest.status === "cancelled" || latest.status === "paused" || latest.status === "cancel_requested") {
        return false;
      }
      if (leaseToken) {
        executionRepository.renewLease({ scopeType: "sprint", scopeId: sprintId, leaseToken });
      }
      executionRepository.updateSprintRun(sprintRunId, { status: "running", lastHeartbeatAt: new Date().toISOString() });
      return true;
    }),
  };
  return { run, executionRepository, sprintRunLifecycleService, logger };
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
    const { executionRepository, sprintRunLifecycleService, logger } = createDeps("running");
    const service = new HeartbeatService({ sprintRunLifecycleService, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1", "lease-token");

    expect(executionRepository.updateSprintRun).toHaveBeenCalledWith("run-1", expect.objectContaining({ status: "running" }));
    expect(executionRepository.renewLease).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: "sprint", scopeId: "sprint-1", leaseToken: "lease-token" }),
    );

    service.stopAll();
  });

  it("repairs an idle sprint summary row during heartbeat renewal", () => {
    const { sprintRunLifecycleService, logger } = createDeps("running");
    const projectManagementRepository = {
      getRawSprintStatus: vi.fn().mockReturnValue("idle"),
      updateSprint: vi.fn(),
    };
    const service = new HeartbeatService({
      sprintRunLifecycleService: {
        renewHeartbeat: vi.fn(() => {
          projectManagementRepository.updateSprint("sprint-1", { status: "running" });
          return true;
        }),
      },
      logger: logger as never,
      intervalMs: 1000,
    });

    service.startHeartbeat("run-1", "sprint-1");

    expect(projectManagementRepository.updateSprint).toHaveBeenCalledWith("sprint-1", {
      status: "running",
    });
    service.stopAll();
  });

  it("renews again on each interval tick", () => {
    const { executionRepository, sprintRunLifecycleService, logger } = createDeps("running");
    const service = new HeartbeatService({ sprintRunLifecycleService, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1");
    expect(executionRepository.updateSprintRun).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    expect(executionRepository.updateSprintRun).toHaveBeenCalledTimes(4);

    service.stopHeartbeat("run-1");
  });

  it("ignores duplicate start calls for the same run", () => {
    const { executionRepository, sprintRunLifecycleService, logger } = createDeps("running");
    const service = new HeartbeatService({ sprintRunLifecycleService, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1");
    service.startHeartbeat("run-1", "sprint-1");

    expect(executionRepository.updateSprintRun).toHaveBeenCalledTimes(1);
    service.stopAll();
  });

  it("uses the default interval when none is provided", () => {
    const { executionRepository, sprintRunLifecycleService, logger } = createDeps("running");
    const service = new HeartbeatService({ sprintRunLifecycleService, logger: logger as never });

    service.startHeartbeat("run-1", "sprint-1");
    executionRepository.updateSprintRun.mockClear();

    vi.advanceTimersByTime(29_000);
    expect(executionRepository.updateSprintRun).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(executionRepository.updateSprintRun).toHaveBeenCalledTimes(1);

    service.stopAll();
  });

  it("stops the heartbeat when the run has reached a terminal status", () => {
    const { executionRepository, sprintRunLifecycleService, logger } = createDeps("completed");
    const service = new HeartbeatService({ sprintRunLifecycleService, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1");

    // Terminal status short-circuits before any update happens, and the timer is cleared.
    expect(executionRepository.updateSprintRun).not.toHaveBeenCalled();
    executionRepository.getSprintRun.mockClear();
    vi.advanceTimersByTime(5000);
    expect(executionRepository.getSprintRun).not.toHaveBeenCalled();
  });

  it("logs and keeps running when the initial renewal throws", () => {
    const { sprintRunLifecycleService, logger } = createDeps("running");
    sprintRunLifecycleService.renewHeartbeat.mockImplementationOnce(() => {
      throw new Error("db offline");
    });
    const service = new HeartbeatService({ sprintRunLifecycleService, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1");

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to execute initial sprint run heartbeat",
      expect.objectContaining({ sprintRunId: "run-1", error: "db offline" }),
    );
    service.stopAll();
  });

  it("logs interval renewal failures without throwing", () => {
    const { sprintRunLifecycleService, logger } = createDeps("running");
    const service = new HeartbeatService({ sprintRunLifecycleService, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1");
    sprintRunLifecycleService.renewHeartbeat.mockImplementationOnce(() => {
      throw "boom";
    });

    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to renew sprint run heartbeat",
      expect.objectContaining({ sprintRunId: "run-1", error: "boom" }),
    );
    service.stopAll();
  });

  it("does not refresh the sprint run heartbeat after losing the lease", () => {
    const { executionRepository, sprintRunLifecycleService, logger } = createDeps("running");
    executionRepository.renewLease.mockImplementation(() => {
      throw new Error("Lease token mismatch for sprint:sprint-1");
    });
    const service = new HeartbeatService({ sprintRunLifecycleService, logger: logger as never, intervalMs: 1000 });

    service.startHeartbeat("run-1", "sprint-1", "old-token");

    expect(executionRepository.renewLease).toHaveBeenCalledTimes(1);
    expect(executionRepository.updateSprintRun).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to execute initial sprint run heartbeat",
      expect.objectContaining({
        sprintRunId: "run-1",
        error: "Lease token mismatch for sprint:sprint-1",
      }),
    );

    vi.advanceTimersByTime(5000);
    expect(executionRepository.renewLease).toHaveBeenCalledTimes(1);
    expect(executionRepository.updateSprintRun).not.toHaveBeenCalled();
  });

  it("stopHeartbeat is a no-op for unknown runs and stopAll clears every timer", () => {
    const { executionRepository, sprintRunLifecycleService, logger } = createDeps("running");
    const service = new HeartbeatService({ sprintRunLifecycleService, logger: logger as never, intervalMs: 1000 });

    expect(() => service.stopHeartbeat("missing")).not.toThrow();

    service.startHeartbeat("run-1", "sprint-1");
    service.startHeartbeat("run-2", "sprint-2");
    executionRepository.updateSprintRun.mockClear();
    service.stopAll();

    vi.advanceTimersByTime(5000);
    expect(executionRepository.updateSprintRun).not.toHaveBeenCalled();
  });
});
