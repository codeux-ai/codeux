import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Source, Sprint, Task, TaskRecord } from "../types.js";
import type { DashboardRealtimeServerMessage } from "../../types.js";
import { fetchTasks } from "../lib/project-api.js";
import { toTaskViewModel } from "../lib/view-models.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { areTaskRecordListsEqual, shouldUseForegroundLoading } from "./project-resource-utils.js";

const taskCache = new Map<string, TaskRecord[]>();

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
  sprintId?: string | null,
  activeSprintsOnly?: boolean
): UseProjectTasksResult {
  const [taskRecords, setTaskRecords] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const refreshInternal = useCallback(async (options?: { silent?: boolean }): Promise<void> => {
    if (!projectId) {
      setTaskRecords([]);
      setError(null);
      setLoading(false);
      hasLoadedRef.current = false;
      return;
    }

    const shouldUseForegroundState = shouldUseForegroundLoading(hasLoadedRef.current, options?.silent);
    if (shouldUseForegroundState) {
      setLoading(true);
    }
    try {
      const nextTaskRecords = await fetchTasks(projectId, sprintId || undefined, activeSprintsOnly);
      const cacheKey = `${projectId}:${sprintId || 'all'}:${activeSprintsOnly ? 'active' : 'all'}`;
      taskCache.set(cacheKey, nextTaskRecords);
      setTaskRecords((current) => (areTaskRecordListsEqual(current, nextTaskRecords) ? current : nextTaskRecords));
      hasLoadedRef.current = true;
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (shouldUseForegroundState) {
        setLoading(false);
      }
    }
  }, [projectId, sprintId, activeSprintsOnly]);

  useEffect(() => {
    if (!projectId) {
      hasLoadedRef.current = false;
      void refreshInternal();
      return;
    }

    const cacheKey = `${projectId}:${sprintId || 'all'}:${activeSprintsOnly ? 'active' : 'all'}`;
    const cachedTasks = taskCache.get(cacheKey);

    if (cachedTasks) {
      setTaskRecords(cachedTasks);
      setLoading(false);
      setError(null);
      hasLoadedRef.current = true;
      void refreshInternal({ silent: true });
      return;
    }

    hasLoadedRef.current = false;
    void refreshInternal();
  }, [projectId, sprintId, activeSprintsOnly, refreshInternal]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    return subscribeToDashboardRealtime([`project:${projectId}`], (message: DashboardRealtimeServerMessage) => {
      if (message.type === "snapshot_required") {
        void refreshInternal({ silent: true });
        return;
      }

      if (message.type === "event" && message.event.eventType === "project.structure.updated") {
        void refreshInternal({ silent: true });
      }
    });
  }, [projectId, refreshInternal]);

  const tasks = useMemo(() => {
    const sourcesById = new Map(sources.map((source) => [source.id, source]));
    const sprintsById = new Map(sprints.map((sprint) => [sprint.id, sprint]));
    return taskRecords.map((task) => toTaskViewModel(task, sourcesById, sprintsById));
  }, [sources, sprints, taskRecords]);

  const refresh = useCallback(async (): Promise<void> => {
    await refreshInternal({ silent: true });
  }, [refreshInternal]);

  return { tasks, loading, error, refresh };
}
