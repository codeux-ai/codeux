import { useMemo } from "preact/hooks";
import { useProjectData } from "../context/project-data.js";
import { useSprints } from "../../hooks/useSprints.js";
import { useExecutions } from "../../hooks/useExecutions.js";
import { useProjectTasks } from "./use-project-tasks.js";
import { useProjectStats } from "./use-project-stats.js";
import { useDashboardI18n } from "../i18n/index.js";
import { overviewMessages } from "../i18n/messages/overview.js";
import { formatSprintDateRange, localizeTaskViewModelFallbacks } from "../lib/view-models.js";

export function useOverviewPageData() {
  const { projects, selectedProject, loading: projectsLoading } = useProjectData();
  const { locale, translate } = useDashboardI18n();
  const projectId = selectedProject?.id || null;

  const { data: sprints, loading: sprintsLoading } = useSprints(projectId);
  const { tasks, loading: tasksLoading } = useProjectTasks(projectId, projects, sprints, null, { view: "overview" });
  const { stats, loading: statsLoading } = useProjectStats(projectId, "7d", 30_000, { realtime: false });
  const { data: execution } = useExecutions(projectId);

  const isLoading = projectsLoading || sprintsLoading || tasksLoading || statsLoading;
  const localizedSprints = useMemo(() => sprints.map((sprint) => ({
    ...sprint,
    date: formatSprintDateRange(sprint.startDate, sprint.endDate, {
      locale,
      scheduleTbd: translate(overviewMessages, "scheduleTbd"),
    }),
  })), [locale, sprints, translate]);
  const localizedTasks = useMemo(() => {
    const knownSourceNames = new Set(projects.map((project) => project.name));
    const knownSprintNames = new Set(sprints.map((sprint) => sprint.name));
    return tasks.map((task) => localizeTaskViewModelFallbacks(task, {
      knownSourceNames,
      knownSprintNames,
      unassigned: translate(overviewMessages, "unassigned"),
      sprint: translate(overviewMessages, "sprintFallback"),
    }));
  }, [projects, sprints, tasks, translate]);

  return useMemo(() => ({
    projects,
    selectedProject,
    sprints: localizedSprints,
    tasks: localizedTasks,
    stats,
    execution,
    isLoading
  }), [projects, selectedProject, localizedSprints, localizedTasks, stats, execution, isLoading]);
}
