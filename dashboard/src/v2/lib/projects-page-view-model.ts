import type { Source, SourceStatus } from "../types.js";

export type ProjectFilter = "All" | "Running" | "Idle" | "Failed";

export interface ProjectFilterDefinition {
  filter: ProjectFilter;
  status: SourceStatus | null;
}

export const PROJECT_FILTER_DEFINITIONS: readonly ProjectFilterDefinition[] = [
  { filter: "All", status: null },
  { filter: "Running", status: "running" },
  { filter: "Idle", status: "idle" },
  { filter: "Failed", status: "failed" },
];

export interface ProjectsPageViewModel {
  visibleProjects: Source[];
  counts: Record<ProjectFilter, number>;
  runningCount: number;
  totalCount: number;
  isEmpty: boolean;
  isFilteredEmpty: boolean;
}

export function buildProjectsPageViewModel(
  sources: readonly Source[],
  activeFilter: ProjectFilter,
): ProjectsPageViewModel {
  const counts: Record<ProjectFilter, number> = {
    All: 0,
    Running: 0,
    Idle: 0,
    Failed: 0,
  };
  const visibleProjects: Source[] = [];
  const activeStatus = PROJECT_FILTER_DEFINITIONS.find(
    (definition) => definition.filter === activeFilter,
  )?.status ?? null;

  for (const source of sources) {
    counts.All += 1;

    if (source.status === "running") {
      counts.Running += 1;
    } else if (source.status === "idle") {
      counts.Idle += 1;
    } else if (source.status === "failed") {
      counts.Failed += 1;
    }

    if (activeFilter === "All" || source.status === activeStatus) {
      visibleProjects.push(source);
    }
  }

  const totalCount = counts.All;

  return {
    visibleProjects,
    counts,
    runningCount: counts.Running,
    totalCount,
    isEmpty: totalCount === 0,
    isFilteredEmpty: totalCount > 0 && visibleProjects.length === 0,
  };
}
