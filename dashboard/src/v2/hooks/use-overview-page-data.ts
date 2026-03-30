import { useMemo } from "preact/hooks";
import { useProjectData } from "../context/project-data.js";
import { useSprints } from "../../hooks/useSprints.js";
import { useProjectTasks } from "./use-project-tasks.js";
import { useProjectStats } from "./use-project-stats.js";

export function useOverviewPageData() {
  const { projects, selectedProject, loading: projectsLoading } = useProjectData();
  const projectId = selectedProject?.id || null;

  const { data: sprints, loading: sprintsLoading } = useSprints(projectId);
  const { tasks, loading: tasksLoading } = useProjectTasks(projectId, projects, sprints);
  const { stats, loading: statsLoading } = useProjectStats(projectId, "7d");

  const isLoading = projectsLoading || sprintsLoading || tasksLoading || statsLoading;

  return useMemo(() => ({
    projects,
    selectedProject,
    sprints,
    tasks,
    stats,
    isLoading
  }), [projects, selectedProject, sprints, tasks, stats, isLoading]);
}
