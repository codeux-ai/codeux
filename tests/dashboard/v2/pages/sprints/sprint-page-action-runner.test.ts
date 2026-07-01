import { describe, it, expect, vi, beforeEach } from "vitest";
import { SprintPageActionRunner } from "../../../../../dashboard/src/v2/lib/sprint-page-action-runner.js";

describe("SprintPageActionRunner", () => {
  let deps: any;
  let runner: SprintPageActionRunner;

  beforeEach(() => {
    deps = {
      pendingActionIds: new Set<string>(),
      setPendingActionIds: vi.fn((updater) => {
        deps.pendingActionIds = updater(deps.pendingActionIds);
      }),
      setOptimisticStatuses: vi.fn(),
      setSuppressedRunningSprintIds: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      refreshExecution: vi.fn().mockResolvedValue(undefined),
      setError: vi.fn(),
      checkActiveRun: vi.fn().mockResolvedValue(true),
    };
    runner = new SprintPageActionRunner(deps);
  });

  it("should successfully execute an operation and clean up", async () => {
    const operation = vi.fn().mockResolvedValue(undefined);
    await runner.runAction("action-1", "sprint-1", operation);

    expect(operation).toHaveBeenCalledWith(["action-1"]);
    expect(deps.setPendingActionIds).toHaveBeenCalled();
    expect(deps.refresh).toHaveBeenCalled();
    expect(deps.refreshExecution).toHaveBeenCalled();
    expect(deps.pendingActionIds.has("action-1")).toBe(false);
  });

  it("should apply and remove optimistic status", async () => {
    const operation = vi.fn().mockResolvedValue(undefined);
    await runner.runAction("action-1", "sprint-1", operation, {
      optimisticStatus: "running",
    });

    expect(deps.setOptimisticStatuses).toHaveBeenCalledTimes(2);
  });

  it("should prevent duplicate pending actions", async () => {
    deps.pendingActionIds.add("action-1");
    const operation = vi.fn().mockResolvedValue(undefined);

    await runner.runAction("action-1", "sprint-1", operation);

    expect(operation).not.toHaveBeenCalled();
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it("should handle failure, clean up, and show error", async () => {
    const error = new Error("test error");
    const operation = vi.fn().mockRejectedValue(error);

    await runner.runAction("action-1", "sprint-1", operation);

    expect(operation).toHaveBeenCalled();
    expect(deps.refresh).toHaveBeenCalled();
    expect(deps.refreshExecution).toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledWith("test error");
    expect(deps.pendingActionIds.has("action-1")).toBe(false);
  });

  it("should rethrow error if options.rethrow is true", async () => {
    const error = new Error("test error");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(
      runner.runAction("action-1", "sprint-1", operation, { rethrow: true }),
    ).rejects.toThrow("test error");

    expect(deps.refresh).toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledWith("test error");
    expect(deps.pendingActionIds.has("action-1")).toBe(false);
  });
});
