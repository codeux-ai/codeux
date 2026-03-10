import { useCallback, useEffect, useState } from "preact/hooks";
import type { Source, Sprint, Task } from "../types.js";
import type { DashboardRealtimeServerMessage } from "../../types.js";
import { fetchTasks } from "../lib/project-api.js";
import { toTaskViewModel } from "../lib/view-models.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";

interface UseProjectTasksResult {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useProjectTasks(
  projectId: string | null,
  sources: Source[],
  sprints: Sprint[],
  sprintId?: string | null
): UseProjectTasksResult {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setTasks([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const taskRecords = await fetchTasks(projectId, sprintId || undefined);
      const sourcesById = new Map(sources.map((source) => [source.id, source]));
      const sprintsById = new Map(sprints.map((sprint) => [sprint.id, sprint]));
      setTasks(taskRecords.map((task) => toTaskViewModel(task, sourcesById, sprintsById)));
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }, [projectId, sprintId, sources, sprints]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    return subscribeToDashboardRealtime([`project:${projectId}`], (message: DashboardRealtimeServerMessage) => {
      if (message.type === "snapshot_required") {
        void refresh();
        return;
      }

      if (message.type === "event" && message.event.eventType === "project.structure.updated") {
        void refresh();
      }
    });
  }, [projectId, refresh]);

  return { tasks, loading, error, refresh };
}
