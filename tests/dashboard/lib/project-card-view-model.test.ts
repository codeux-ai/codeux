import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "../../../src/contracts/project-management-types.js";
import {
  PROJECT_CARD_EMPTY_VALUE,
  buildProjectCardActions,
  buildProjectCardViewModel,
  formatProjectCardDisplayValue,
  formatProjectCardTimestamp,
  getProjectCardGitUrl,
  getProjectCardLocalDirectory,
  getProjectCardSourceBadge,
  getProjectCardTaskCompletion,
} from "../../../dashboard/src/v2/lib/project-card-view-model.js";

function createProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: "project-1",
    slug: "project-1",
    name: "Project One",
    baseDir: "/workspace/project-one",
    repoUrl: null,
    sourceType: "local",
    sourceRef: "/workspace/project-one",
    gitProvider: "local",
    gitHostDomain: null,
    defaultBranch: null,
    featureBranchPrefix: null,
    status: "idle",
    sprintsCount: 0,
    openTasks: 0,
    completedTasks: 0,
    isRunning: false,
    settingsOverrides: {},
    agentBindings: [],
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("project-card-view-model", () => {
  it("builds display-ready values for a remote git project", () => {
    const project = createProject({
      sourceType: "git",
      sourceRef: "https://github.com/acme/widgets.git",
      repoUrl: "https://github.com/acme/widgets.git",
      gitProvider: "github",
      gitHostDomain: "github.com",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      baseDir: "/workspace/clones/widgets",
      completedTasks: 6,
      openTasks: 2,
      lastRunAt: "2026-01-04T05:06:07.000Z",
      lastRunStatus: "running",
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-03T04:05:06.000Z",
    });

    const viewModel = buildProjectCardViewModel(project);

    expect(viewModel.sourceBadge).toEqual({
      kind: "remote-git",
      label: "Remote Git",
      description: "GitHub repository hosted on github.com.",
    });
    expect(viewModel.sourceTypeLabel).toBe("Remote Git");
    expect(viewModel.providerLabel).toEqual({ value: "GitHub", isEmpty: false });
    expect(viewModel.hostLabel).toEqual({ value: "github.com", isEmpty: false });
    expect(viewModel.gitUrl).toEqual({ value: "https://github.com/acme/widgets.git", isEmpty: false });
    expect(viewModel.localDirectory).toEqual({ value: "/workspace/clones/widgets", isEmpty: false });
    expect(viewModel.branch).toEqual({ value: "main", isEmpty: false });
    expect(viewModel.featureBranchPrefix).toEqual({ value: "feature/", isEmpty: false });
    expect(viewModel.createdAt.value).toBe("Jan 2, 2026, 3:04 AM");
    expect(viewModel.updatedAt.value).toBe("Jan 3, 2026, 4:05 AM");
    expect(viewModel.lastRunAt.value).toBe("Jan 4, 2026, 5:06 AM");
    expect(viewModel.lastRunStatus).toEqual({ value: "running", isEmpty: false });
    expect(viewModel.taskCompletion).toEqual({
      value: "75%",
      percentage: 75,
      completedTasks: 6,
      openTasks: 2,
      totalTasks: 8,
      isEmpty: false,
    });
    expect(viewModel.actions.map((action) => action.label)).toEqual([
      "Open project",
      "Settings",
      "Setup agent",
      "Open invocation",
      "Delete project",
    ]);
  });

  it("treats local projects with inferred origins as local repositories", () => {
    const project = createProject({
      sourceType: "local",
      sourceRef: "/workspace/project-one",
      repoUrl: "git@github.com:acme/widgets.git",
      gitProvider: "github",
      gitHostDomain: "github.com",
    });

    expect(getProjectCardSourceBadge(project)).toEqual({
      kind: "local-repository",
      label: "Local repo",
      description: "Local project with inferred GitHub origin on github.com.",
    });
    expect(getProjectCardGitUrl(project)).toEqual({
      value: "git@github.com:acme/widgets.git",
      isEmpty: false,
    });
    expect(buildProjectCardViewModel(project).sourceTypeLabel).toBe("Local repo");
  });

  it("falls back to sourceRef for git projects when repoUrl is missing", () => {
    const project = createProject({
      sourceType: "git",
      repoUrl: null,
      sourceRef: "https://gitlab.com/acme/widgets.git",
      gitProvider: "gitlab",
      gitHostDomain: "gitlab.com",
      baseDir: "/workspace/clones/widgets",
    });

    expect(getProjectCardGitUrl(project)).toEqual({
      value: "https://gitlab.com/acme/widgets.git",
      isEmpty: false,
    });
    expect(getProjectCardLocalDirectory(project)).toEqual({
      value: "/workspace/clones/widgets",
      isEmpty: false,
    });
    expect(getProjectCardSourceBadge(project)).toEqual({
      kind: "remote-git",
      label: "Remote Git",
      description: "GitLab repository hosted on gitlab.com.",
    });
  });

  it("returns empty-value fallbacks for missing last runs and invalid timestamps", () => {
    const project = createProject({
      createdAt: "",
      updatedAt: "not-a-date",
      lastRunAt: null,
      lastRunStatus: null,
      defaultBranch: null,
      featureBranchPrefix: null,
      repoUrl: null,
      sourceType: "local",
    });

    expect(formatProjectCardDisplayValue("   ")).toEqual({
      value: PROJECT_CARD_EMPTY_VALUE,
      isEmpty: true,
    });
    expect(formatProjectCardTimestamp("")).toEqual({
      value: PROJECT_CARD_EMPTY_VALUE,
      isEmpty: true,
    });
    expect(formatProjectCardTimestamp("not-a-date")).toEqual({
      value: PROJECT_CARD_EMPTY_VALUE,
      isEmpty: true,
    });
    expect(buildProjectCardViewModel(project).lastRunAt).toEqual({
      value: PROJECT_CARD_EMPTY_VALUE,
      isEmpty: true,
    });
    expect(buildProjectCardViewModel(project).branch).toEqual({
      value: PROJECT_CARD_EMPTY_VALUE,
      isEmpty: true,
    });
    expect(buildProjectCardViewModel(project).featureBranchPrefix).toEqual({
      value: PROJECT_CARD_EMPTY_VALUE,
      isEmpty: true,
    });
    expect(buildProjectCardViewModel(project).taskCompletion).toEqual({
      value: PROJECT_CARD_EMPTY_VALUE,
      percentage: null,
      completedTasks: 0,
      openTasks: 0,
      totalTasks: 0,
      isEmpty: true,
    });
  });

  it("exposes pure action descriptors without JSX", () => {
    expect(buildProjectCardActions()).toEqual([
      {
        kind: "open-project",
        label: "Open project",
        ariaLabel: "Open project",
        title: "Open project",
        tone: "default",
      },
      {
        kind: "settings",
        label: "Settings",
        ariaLabel: "Project settings",
        title: "Project settings",
        tone: "default",
      },
      {
        kind: "setup-agent",
        label: "Setup agent",
        ariaLabel: "Setup agent",
        title: "Setup agent",
        tone: "default",
      },
      {
        kind: "invocation",
        label: "Open invocation",
        ariaLabel: "Open invocation",
        title: "Open invocation",
        tone: "default",
      },
      {
        kind: "delete",
        label: "Delete project",
        ariaLabel: "Delete project",
        title: "Delete project",
        tone: "danger",
      },
    ]);
  });

  it("formats task completion percentages deterministically", () => {
    expect(getProjectCardTaskCompletion(createProject({ completedTasks: 3, openTasks: 1 }))).toEqual({
      value: "75%",
      percentage: 75,
      completedTasks: 3,
      openTasks: 1,
      totalTasks: 4,
      isEmpty: false,
    });
  });
});
