import { describe, it, expect, vi } from "vitest";
import { getProjectLiveSnapshot, type ProjectLiveSnapshotDeps } from "../../../../src/app/live/project-live-snapshot.js";

describe("getProjectLiveSnapshot observability", () => {
  it("emits project_live_snapshot_assembled info log with execution item count", async () => {
    const loggerMock = {
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };

    const deps: ProjectLiveSnapshotDeps = {
      projectManagementRepository: {
        getSelectedProjectId: () => "proj-1",
        listSprints: () => ({ sprints: [{ id: "sprint-1", createdAt: "", updatedAt: "", sourcePath: null }], selectedSprintId: "sprint-1" }),
      } as any,
      projectRuntimeRepository: {
        getProjectStatus: () => ({ subtasks: [], timestamp: null }),
      } as any,
      getProjectExecutionSnapshot: () => ({
        projectId: "proj-1",
        projectName: null,
        sprintRuns: [],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: null,
      }),
      getGitStatus: async () => ({
        branch: "main",
        status: "clean",
        ahead: 0,
        behind: 0,
        modified: [],
        deleted: [],
        untracked: [],
      }),
      logger: loggerMock as any,
    };

    await getProjectLiveSnapshot(deps);

    expect(loggerMock.info).toHaveBeenCalledWith(
      "project_live_snapshot_assembled",
      expect.objectContaining({
        projectId: "proj-1",
        buildTimeMs: expect.any(Number),
        executionItemCount: expect.any(Number), statusSubtaskCount: expect.any(Number), hasGitStatus: expect.any(Boolean),
      })
    );
  });

  it("warns on malformed_snapshot_identity", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const deps: ProjectLiveSnapshotDeps = {
      projectManagementRepository: { getSelectedProjectId: () => null } as any,
      projectRuntimeRepository: {} as any,
      getProjectExecutionSnapshot: () => ({} as any),
      getGitStatus: async () => ({} as any),
      logger: loggerMock as any,
    };

    await getProjectLiveSnapshot(deps);
    expect(loggerMock.warn).toHaveBeenCalledWith("malformed_snapshot_identity", expect.any(Object));
  });

  it("warns on selected_sprint_missing_while_active", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const deps: ProjectLiveSnapshotDeps = {
      projectManagementRepository: {
        getSelectedProjectId: () => "proj-1",
        listSprints: () => ({ sprints: [], selectedSprintId: null }),
      } as any,
      projectRuntimeRepository: { getProjectStatus: () => ({}) } as any,
      getProjectExecutionSnapshot: () => ({
        projectId: "proj-1",
        sprintRuns: [{ status: "running" }],
      } as any),
      getGitStatus: async () => ({} as any),
      logger: loggerMock as any,
    };

    await getProjectLiveSnapshot(deps);
    expect(loggerMock.warn).toHaveBeenCalledWith("selected_sprint_missing_while_active", expect.any(Object));
  });

  it("warns on selected_sprint_outside_project", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const deps: ProjectLiveSnapshotDeps = {
      projectManagementRepository: {
        getSelectedProjectId: () => "proj-1",
        listSprints: () => ({ sprints: [{ id: "sprint-2" }], selectedSprintId: "sprint-1" }),
      } as any,
      projectRuntimeRepository: { getProjectStatus: () => ({}) } as any,
      getProjectExecutionSnapshot: () => ({
        projectId: "proj-1",
        sprintRuns: [],
      } as any),
      getGitStatus: async () => ({} as any),
      logger: loggerMock as any,
    };

    await getProjectLiveSnapshot(deps);
    expect(loggerMock.warn).toHaveBeenCalledWith("selected_sprint_outside_project", expect.any(Object));
  });

  it("warns on active_runs_mismatch_snapshot_scope", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const deps: ProjectLiveSnapshotDeps = {
      projectManagementRepository: {
        getSelectedProjectId: () => "proj-1",
        listSprints: () => ({ sprints: [{ id: "sprint-1" }], selectedSprintId: "sprint-1" }),
      } as any,
      projectRuntimeRepository: { getProjectStatus: () => ({}) } as any,
      getProjectExecutionSnapshot: () => ({
        projectId: "proj-different",
        sprintRuns: [],
      } as any),
      getGitStatus: async () => ({} as any),
      logger: loggerMock as any,
    };

    await getProjectLiveSnapshot(deps);
    expect(loggerMock.warn).toHaveBeenCalledWith("active_runs_mismatch_snapshot_scope", expect.any(Object));
  });
});
