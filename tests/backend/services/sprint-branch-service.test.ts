import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildMockSettings } from "../../builders/settings-builder.js";
import { SprintBranchService } from "../../../src/services/sprint-branch-service.js";

const mocks = vi.hoisted(() => ({
  prepareBranchForOrchestration: vi.fn(),
}));

vi.mock("../../../src/sprint/steps/branch-preflight-step.js", () => ({
  prepareBranchForOrchestration: mocks.prepareBranchForOrchestration,
}));

describe("SprintBranchService", () => {
  const projectManagementRepository = {
    getProject: vi.fn(),
    getSprint: vi.fn(),
    listTasks: vi.fn(),
    updateSprint: vi.fn(),
  };
  const executionRepository = {
    listLatestTaskRuns: vi.fn(),
  };
  const settingsRepository = {
    resolveSprintDashboardSettings: vi.fn(),
  };
  const service = new SprintBranchService({
    projectManagementRepository: projectManagementRepository as never,
    executionRepository: executionRepository as never,
    settingsRepository: settingsRepository as never,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    projectManagementRepository.getProject.mockReturnValue({
      id: "project-1",
      baseDir: "/repo",
      defaultBranch: "main",
    });
    projectManagementRepository.getSprint.mockReturnValue({
      id: "sprint-1",
      projectId: "project-1",
      number: 1,
      name: "Sprint One",
      slug: "sprint-one",
      featureBranch: "feature/sprint-one",
    });
    projectManagementRepository.listTasks.mockReturnValue([{ id: "task-1" }]);
    executionRepository.listLatestTaskRuns.mockReturnValue(new Map());
    settingsRepository.resolveSprintDashboardSettings.mockReturnValue({
      settings: buildMockSettings({
        git: {
          githubMode: "LOCAL",
          defaultBranch: "main",
        },
      }),
    });
    mocks.prepareBranchForOrchestration.mockResolvedValue({
      existsLocal: true,
      existsRemote: false,
      hasRemoteOrigin: false,
      createdLocal: false,
      checkedOutLocal: true,
      pushedRemote: false,
      baseCommitSha: "default-sha",
      defaultBranchSync: "advanced",
    });
  });

  it("updates sprint metadata after a safe manual fast-forward", async () => {
    const result = await service.updateFromDefault("project-1", "sprint-1");

    expect(mocks.prepareBranchForOrchestration).toHaveBeenCalledWith(
      "/repo",
      "feature/sprint-one",
      "main",
      { localOnly: true, fastForwardFromDefault: true },
    );
    expect(projectManagementRepository.updateSprint).toHaveBeenCalledWith("sprint-1", {
      featureBranch: "feature/sprint-one",
      baseCommitSha: "default-sha",
    });
    expect(result).toEqual({
      status: "advanced",
      featureBranch: "feature/sprint-one",
      defaultBranch: "main",
      commitSha: "default-sha",
    });
  });

  it("refuses a manual update after any task execution has started", async () => {
    executionRepository.listLatestTaskRuns.mockReturnValue(new Map([
      ["task-1", { id: "run-1" }],
    ]));

    await expect(service.updateFromDefault("project-1", "sprint-1"))
      .rejects.toThrow("cannot be updated after task work has started");
    expect(mocks.prepareBranchForOrchestration).not.toHaveBeenCalled();
    expect(projectManagementRepository.updateSprint).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a branch with feature-only commits", async () => {
    mocks.prepareBranchForOrchestration.mockResolvedValue({
      existsLocal: true,
      existsRemote: false,
      hasRemoteOrigin: false,
      createdLocal: false,
      checkedOutLocal: true,
      pushedRemote: false,
      baseCommitSha: null,
      defaultBranchSync: "preserved_feature_changes",
    });

    await expect(service.updateFromDefault("project-1", "sprint-1"))
      .rejects.toThrow("has commits that are not on the default branch");
    expect(projectManagementRepository.updateSprint).not.toHaveBeenCalled();
  });
});
