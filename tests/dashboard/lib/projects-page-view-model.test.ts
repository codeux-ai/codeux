import { describe, expect, it } from "vitest";
import {
  PROJECT_FILTER_DEFINITIONS,
  buildProjectsPageViewModel,
  type ProjectFilter,
} from "../../../dashboard/src/v2/lib/projects-page-view-model.js";
import type { Source, SourceStatus } from "../../../dashboard/src/v2/types.js";

function createSource(id: string, status: SourceStatus): Source {
  return {
    id,
    slug: id,
    name: id,
    baseDir: `/workspace/${id}`,
    repoUrl: null,
    sourceType: "local",
    sourceRef: `/workspace/${id}`,
    gitProvider: "local",
    gitHostDomain: null,
    defaultBranch: null,
    featureBranchPrefix: null,
    status,
    sprintsCount: 0,
    openTasks: 0,
    completedTasks: 0,
    isRunning: status === "running",
    settingsOverrides: {},
    agentBindings: [],
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("projects-page-view-model", () => {
  it("defines filters in display order with their matching statuses", () => {
    expect(PROJECT_FILTER_DEFINITIONS).toEqual([
      { filter: "All", status: null, labelKey: "filterAll", emptyMessageKey: null },
      { filter: "Running", status: "running", labelKey: "filterRunning", emptyMessageKey: "noRunningProjects" },
      { filter: "Idle", status: "idle", labelKey: "filterIdle", emptyMessageKey: "noIdleProjects" },
      { filter: "Failed", status: "failed", labelKey: "filterFailed", emptyMessageKey: "noFailedProjects" },
    ]);
  });

  it("returns empty counts and the collection empty state for no projects", () => {
    expect(buildProjectsPageViewModel([], "All")).toEqual({
      visibleProjects: [],
      counts: { All: 0, Running: 0, Idle: 0, Failed: 0 },
      runningCount: 0,
      totalCount: 0,
      isEmpty: true,
      isFilteredEmpty: false,
    });
  });

  it("counts mixed statuses and preserves source order", () => {
    const sources = [
      createSource("idle-first", "idle"),
      createSource("running-second", "running"),
      createSource("failed-third", "failed"),
      createSource("running-fourth", "running"),
    ];

    const viewModel = buildProjectsPageViewModel(sources, "All");

    expect(viewModel.visibleProjects).toEqual(sources);
    expect(viewModel.counts).toEqual({ All: 4, Running: 2, Idle: 1, Failed: 1 });
    expect(viewModel.runningCount).toBe(2);
    expect(viewModel.totalCount).toBe(4);
    expect(viewModel.isEmpty).toBe(false);
    expect(viewModel.isFilteredEmpty).toBe(false);
  });

  it("includes intervention projects only in All", () => {
    const intervention = createSource("needs-review", "intervention");
    const sources = [intervention, createSource("running", "running")];

    expect(buildProjectsPageViewModel(sources, "All").visibleProjects).toEqual(sources);
    expect(buildProjectsPageViewModel(sources, "Running").visibleProjects).toEqual([sources[1]]);
    expect(buildProjectsPageViewModel([intervention], "Idle")).toMatchObject({
      visibleProjects: [],
      counts: { All: 1, Running: 0, Idle: 0, Failed: 0 },
      isEmpty: false,
      isFilteredEmpty: true,
    });
  });

  it.each<[ProjectFilter, string[]]>([
    ["All", ["running-1", "idle-1", "failed-1", "running-2"]],
    ["Running", ["running-1", "running-2"]],
    ["Idle", ["idle-1"]],
    ["Failed", ["failed-1"]],
  ])("returns the matching projects for the %s filter", (activeFilter, expectedIds) => {
    const sources = [
      createSource("running-1", "running"),
      createSource("idle-1", "idle"),
      createSource("failed-1", "failed"),
      createSource("running-2", "running"),
    ];

    const viewModel = buildProjectsPageViewModel(sources, activeFilter);

    expect(viewModel.visibleProjects.map((source) => source.id)).toEqual(expectedIds);
  });
});
