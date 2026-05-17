import { describe, expect, it, vi } from "vitest";
import { SprintIssueService } from "../../../src/services/sprint-issue-service.js";
import type { ProjectSummary, SprintLinkedIssueRecord } from "../../../src/contracts/project-management-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const project: ProjectSummary = {
  id: "project-1",
  slug: "project",
  name: "Project",
  baseDir: "/repo",
  repoUrl: "https://github.com/acme/widgets.git",
  sourceType: "git",
  sourceRef: "https://github.com/acme/widgets.git",
  gitProvider: "github",
  gitHostDomain: "github.com",
  defaultBranch: "main",
  featureBranchPrefix: "feature/",
  status: "idle",
  sprintsCount: 0,
  openTasks: 0,
  completedTasks: 0,
  isRunning: false,
  settingsOverrides: {},
  agentBindings: [],
  createdAt: "2026-05-17T00:00:00.000Z",
  updatedAt: "2026-05-17T00:00:00.000Z",
};

describe("SprintIssueService", () => {
  it("falls back to local gh auth when GitHub token is empty", async () => {
    const runCommand = vi.fn(async () => ({
      ok: true,
      stderr: "",
      stdout: JSON.stringify([
        {
          number: 42,
          title: "Improve import UX",
          url: "https://github.com/acme/widgets/issues/42",
          state: "OPEN",
          body: "Make importing issues easier.",
          updatedAt: "2026-05-17T00:00:00.000Z",
          labels: [{ name: "ux" }],
          assignees: [{ login: "pierre" }],
        },
      ]),
    }));

    const service = new SprintIssueService({
      projectManagementRepository: {
        getProject: () => project,
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          githubToken: "",
        },
      }),
      runCommand,
    });

    const issues = await service.searchIssues(project.id, {
      provider: "github",
      search: "import",
      labels: ["ux"],
    });

    expect(runCommand).toHaveBeenCalledWith("gh", expect.arrayContaining([
      "issue",
      "list",
      "--repo",
      "acme/widgets",
      "--search",
      "import",
      "--label",
      "ux",
    ]));
    expect(issues).toEqual([
      expect.objectContaining({
        provider: "github",
        repository: "acme/widgets",
        issueNumber: 42,
        title: "Improve import UX",
        labels: ["ux"],
        assignees: ["pierre"],
      }),
    ]);
  });

  it("falls back to local gh auth when auto-closing linked GitHub issues", async () => {
    const linkedIssue: SprintLinkedIssueRecord = {
      id: "issue-1",
      projectId: project.id,
      sprintId: "sprint-1",
      provider: "github",
      hostDomain: "github.com",
      repository: "acme/widgets",
      issueNumber: 42,
      issueKey: "#42",
      title: "Improve import UX",
      url: "https://github.com/acme/widgets/issues/42",
      state: "open",
      labels: ["ux"],
      assignees: ["pierre"],
      closeState: "open",
      closeError: null,
      closedAt: null,
      createdAt: "2026-05-17T00:00:00.000Z",
    };
    const runCommand = vi.fn(async () => ({ ok: true, stderr: "", stdout: "" }));
    const updateSprintLinkedIssueCloseState = vi.fn();

    const service = new SprintIssueService({
      projectManagementRepository: {
        listSprintLinkedIssues: () => [linkedIssue],
        updateSprintLinkedIssueCloseState,
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          autoCloseLinkedIssues: true,
          githubToken: "",
        },
      }),
      runCommand,
    });

    const result = await service.closeLinkedIssues(project.id, "sprint-1");

    expect(runCommand).toHaveBeenCalledWith("gh", [
      "issue",
      "close",
      "42",
      "--repo",
      "acme/widgets",
    ]);
    expect(updateSprintLinkedIssueCloseState).toHaveBeenCalledWith("issue-1", expect.objectContaining({
      closeState: "closed",
      issueState: "closed",
    }));
    expect(result.closed).toBe(1);
  });
});
