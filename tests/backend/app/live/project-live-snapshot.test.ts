import { describe, it, expect, vi, beforeEach } from "vitest";
import { getProjectLiveSnapshot, type ProjectLiveSnapshotDeps } from "../../../../src/app/live/project-live-snapshot.js";
import type { GitTrackingStatus } from "../../../../src/contracts/app-types.js";

describe("getProjectLiveSnapshot", () => {
  let deps: ProjectLiveSnapshotDeps;

  beforeEach(() => {
    deps = {
      projectManagementRepository: {
        getSelectedProjectId: vi.fn().mockReturnValue("proj-1"),
        getSelectedSprintId: vi.fn().mockReturnValue("sprint-1"),
        sprintBelongsToProject: vi.fn().mockReturnValue(true),
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

  it("assembles full snapshot for a valid project and logs structural counts", async () => {
    const snapshot = await getProjectLiveSnapshot(deps);

    expect(snapshot.projectId).toBe("proj-1");
    expect(snapshot.selectedSprintId).toBe("sprint-1");
    expect(snapshot.status).toEqual({ subtasks: [], timestamp: "2024-01-01T00:00:00.000Z" });
    expect(snapshot.execution).toEqual({ sprintRuns: [] });
    expect(snapshot.gitStatus).toEqual({ status: "clean" });
    expect(snapshot.gitStatusError).toBeNull();
    expect(snapshot.updatedAt).toBeDefined();

    expect(deps.projectManagementRepository.getSelectedProjectId).toHaveBeenCalled();
    expect(deps.projectManagementRepository.getSelectedSprintId).toHaveBeenCalledWith("proj-1");
    expect(deps.projectManagementRepository.sprintBelongsToProject).toHaveBeenCalledWith("proj-1", "sprint-1");
    expect(deps.projectManagementRepository.listSprints).not.toHaveBeenCalled();
    expect(deps.projectRuntimeRepository.getProjectStatus).toHaveBeenCalledWith("proj-1", "sprint-1");
    expect(deps.getProjectExecutionSnapshot).toHaveBeenCalledWith("proj-1", { selectedSprintId: "sprint-1" });
    expect(deps.getGitStatus).toHaveBeenCalled();

    expect(deps.logger.info).toHaveBeenCalledWith(
      "project_live_snapshot_assembled",
      expect.objectContaining({
        projectId: "proj-1",
        executionItemCount: 0,
        statusSubtaskCount: 0,
        hasGitStatus: true,
      })
    );
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
    expect(deps.projectManagementRepository.getSelectedSprintId).toHaveBeenCalledWith("proj-hint");
    expect(deps.projectRuntimeRepository.getProjectStatus).toHaveBeenCalledWith("proj-hint", "sprint-1");
    expect(deps.getProjectExecutionSnapshot).toHaveBeenCalledWith("proj-hint", { selectedSprintId: "sprint-1" });
  });

  it("uses generic error message if gitStatus promise rejection is not an Error instance", async () => {
    deps.getGitStatus = vi.fn().mockRejectedValue("Not an error object");

    const snapshot = await getProjectLiveSnapshot(deps);

    expect(snapshot.gitStatus).toBeNull();
    expect(snapshot.gitStatusError).toBe("Unable to load git/ci/pr tracking.");
  });

  it("handles missing project array edge cases for execution item count", async () => {
    deps.getProjectExecutionSnapshot = vi.fn().mockReturnValue({
      sprintRuns: undefined,
      taskDispatches: undefined,
      connections: undefined,
      attentionItems: undefined,
      recentEvents: undefined,
      projectId: "proj-1"
    } as any);

    deps.projectRuntimeRepository.getProjectStatus = vi.fn().mockReturnValue({
      subtasks: undefined
    } as any);

    const snapshot = await getProjectLiveSnapshot(deps);

    expect(deps.logger.info).toHaveBeenCalledWith(
      "project_live_snapshot_assembled",
      expect.objectContaining({
        executionItemCount: 0,
        statusSubtaskCount: 0,
      })
    );
  });

  it("keeps observability durations non-negative if the wall clock moves backwards", async () => {
    const dateNowSpy = vi.spyOn(Date, "now")
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(9_000)
      .mockReturnValueOnce(8_000)
      .mockReturnValueOnce(7_000)
      .mockReturnValueOnce(6_000)
      .mockReturnValue(5_000);

    await getProjectLiveSnapshot(deps);

    const [, fields] = (deps.logger.info as any).mock.calls.find(([event]: [string]) => event === "project_live_snapshot_assembled");
    expect(fields.buildTimeMs).toBeGreaterThanOrEqual(0);
    expect(fields.projectMgmtMs).toBeGreaterThanOrEqual(0);
    expect(fields.runtimeMs).toBeGreaterThanOrEqual(0);
    expect(fields.executionMs).toBeGreaterThanOrEqual(0);
    expect(fields.gitMs).toBeGreaterThanOrEqual(0);
    dateNowSpy.mockRestore();
  });
});
