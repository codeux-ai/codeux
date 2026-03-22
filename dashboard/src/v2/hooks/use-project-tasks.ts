import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { Source, Sprint, Task, TaskRecord } from "../types.js";
import type { DashboardRealtimeServerMessage } from "../../types.js";
import { fetchTasks } from "../lib/project-api.js";
import { toTaskViewModel } from "../lib/view-models.js";
import { areTaskRecordListsEqual } from "./project-resource-utils.js";
import { ProjectResourceStore } from "./project-resource-store.js";

interface UseProjectTasksResult {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const projectTasksStore = new ProjectResourceStore<TaskRecord[]>({
  resourceType: "tasks",
  fetcher: async (projectId: string, args: { sprintId?: string | null }) => {
    return await fetchTasks(projectId, args.sprintId || undefined);
  },
  isEqual: areTaskRecordListsEqual,
  emptyData: [],
  getRealtimeScopes: (projectId: string) => [`project:${projectId}`],
  shouldRefreshOnRealtimeEvent: (message: DashboardRealtimeServerMessage) => {
    if (message.type === "snapshot_required") {
      return true;
    }
    if (message.type === "event" && message.event.eventType === "project.structure.updated") {
      return true;
    }
    return false;
  },
});

export function useProjectTasks(
  projectId: string | null,
  sources: Source[],
  sprints: Sprint[],
  sprintId?: string | null
): UseProjectTasksResult {
  const [taskRecords, setTaskRecords] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const keySuffix = sprintId || "";
    return projectTasksStore.subscribe(
      projectId,
      keySuffix,
      { sprintId },
      (data, errorStr, isLoading) => {
        setTaskRecords(data);
        setError(errorStr);
        setLoading(isLoading);
      }
    );
  }, [projectId, sprintId]);

  const tasks = useMemo(() => {
    const sourcesById = new Map(sources.map((source) => [source.id, source]));
    const sprintsById = new Map(sprints.map((sprint) => [sprint.id, sprint]));
    return taskRecords.map((task) => toTaskViewModel(task, sourcesById, sprintsById));
  }, [sources, sprints, taskRecords]);

  const refresh = useCallback(async (): Promise<void> => {
    if (projectId) {
      await projectTasksStore.fetch(projectId, sprintId || "", { sprintId }, { silent: true });
    }
  }, [projectId, sprintId]);

  return { tasks, loading, error, refresh };
}
