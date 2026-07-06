import { describe, expect, it, vi } from "vitest";
import {
  mapSprintRunStatusToSprintStatus,
  SprintRunLifecycleService,
} from "../../../src/services/sprint-run-lifecycle-service.js";

describe("sprint status sync", () => {
  it("maps active sprint run states to running sprint status", () => {
    expect(mapSprintRunStatusToSprintStatus("queued")).toBe("running");
    expect(mapSprintRunStatusToSprintStatus("running")).toBe("running");
    expect(mapSprintRunStatusToSprintStatus("cancel_requested")).toBe("running");
  });

  it("maps paused and terminal sprint run states to matching sprint statuses", () => {
    expect(mapSprintRunStatusToSprintStatus("paused")).toBe("paused");
    expect(mapSprintRunStatusToSprintStatus("completed")).toBe("completed");
    expect(mapSprintRunStatusToSprintStatus("failed")).toBe("failed");
    expect(mapSprintRunStatusToSprintStatus("cancelled")).toBe("cancelled");
  });

  it("updates the sprint row only when it drifted from the run state", () => {
    const projectManagementRepository = {
      getRawSprintStatus: vi.fn().mockReturnValue("idle"),
      updateSprint: vi.fn(),
    };

    const service = new SprintRunLifecycleService({
      executionRepository: {} as never,
      projectManagementRepository: projectManagementRepository as never,
    });
    service.syncSprintStatus("sprint-1", "running");

    expect(projectManagementRepository.updateSprint).toHaveBeenCalledWith("sprint-1", {
      status: "running",
    });
  });

  it("does not write when the sprint row already matches the run state", () => {
    const projectManagementRepository = {
      getRawSprintStatus: vi.fn().mockReturnValue("running"),
      updateSprint: vi.fn(),
    };

    const service = new SprintRunLifecycleService({
      executionRepository: {} as never,
      projectManagementRepository: projectManagementRepository as never,
    });
    service.syncSprintStatus("sprint-1", "running");

    expect(projectManagementRepository.updateSprint).not.toHaveBeenCalled();
  });
});
