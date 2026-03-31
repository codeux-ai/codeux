import { describe, it, expect, vi, beforeEach } from "vitest";
import { getProjectLiveSnapshot, type ProjectLiveSnapshotDeps } from "../../../../src/app/live/project-live-snapshot.js";
import type { GitTrackingStatus } from "../../../../src/contracts/app-types.js";

describe("getProjectLiveSnapshot", () => {
  let deps: ProjectLiveSnapshotDeps;

  beforeEach(() => {
    deps = {
      projectManagementRepository: {
        getSelectedProjectId: vi.fn().mockReturnValue("proj-1"),
        listSprints: vi.fn().mockReturnValue({ selectedSprintId: "sprint-1", sprints: [{ id: "sprint-1" }] }),
      } as any,
      projectRuntimeRepository: {
        getProjectStatus: vi.fn().mockReturnValue({ subtasks: [], timestamp: "2024-01-01T00:00:00.000Z" }),
      } as any,
      getProjectExecutionSnapshot: vi.fn().mockReturnValue({ sprintRuns: [] }),
      getGitStatus: vi.fn().mockResolvedValue({ status: "clean" } as unknown as GitTrackingStatus),
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() } as any,
    };
  });

  it("assembles full snapshot for a valid project", async () => {
    const snapshot = await getProjectLiveSnapshot(deps);

    expect(snapshot.projectId).toBe("proj-1");
    expect(snapshot.selectedSprintId).toBe("sprint-1");
    expect(snapshot.status).toEqual({ subtasks: [], timestamp: "2024-01-01T00:00:00.000Z" });
    expect(snapshot.execution).toEqual({ sprintRuns: [] });
    expect(snapshot.gitStatus).toEqual({ status: "clean" });
    expect(snapshot.gitStatusError).toBeNull();
    expect(snapshot.updatedAt).toBeDefined();

    expect(deps.projectManagementRepository.getSelectedProjectId).toHaveBeenCalled();
    expect(deps.projectManagementRepository.listSprints).toHaveBeenCalledWith("proj-1");
    expect(deps.projectRuntimeRepository.getProjectStatus).toHaveBeenCalledWith("proj-1", "sprint-1");
    expect(deps.getProjectExecutionSnapshot).toHaveBeenCalledWith("proj-1");
    expect(deps.getGitStatus).toHaveBeenCalled();
  });

  it("returns empty/null snapshot when no project id is provided or selected", async () => {
    deps.projectManagementRepository.getSelectedProjectId = vi.fn().mockReturnValue(null);

    const snapshot = await getProjectLiveSnapshot(deps);

    expect(snapshot.projectId).toBeNull();
    expect(snapshot.selectedSprintId).toBeNull();
    expect(snapshot.status).toEqual({ subtasks: [], timestamp: null });
    expect(snapshot.execution.projectId).toBeNull();
    expect(snapshot.gitStatus).toBeNull();
    expect(snapshot.updatedAt).toBeNull();
  });

  it("handles git status errors gracefully and sets gitStatusError", async () => {
    deps.getGitStatus = vi.fn().mockRejectedValue(new Error("Git is broken"));

    const snapshot = await getProjectLiveSnapshot(deps);

    expect(snapshot.gitStatus).toBeNull();
    expect(snapshot.gitStatusError).toBe("Git is broken");
  });

  it("returns current project ID when no hint is provided", async () => {
    const snapshot = await getProjectLiveSnapshot(deps);
    expect(snapshot.projectId).toBe("proj-1");
    expect(deps.projectManagementRepository.getSelectedProjectId).toHaveBeenCalled();
  });

  it("uses projectIdHint if provided instead of selected project ID", async () => {
    const snapshot = await getProjectLiveSnapshot(deps, "proj-hint");

    expect(snapshot.projectId).toBe("proj-hint");
    expect(deps.projectManagementRepository.getSelectedProjectId).not.toHaveBeenCalled();
    expect(deps.projectManagementRepository.listSprints).toHaveBeenCalledWith("proj-hint");
    expect(deps.projectRuntimeRepository.getProjectStatus).toHaveBeenCalledWith("proj-hint", "sprint-1");
    expect(deps.getProjectExecutionSnapshot).toHaveBeenCalledWith("proj-hint");
  });
});
