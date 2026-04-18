import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Source, Sprint, Task, TaskRecord } from "../types.js";
import type { DashboardRealtimeServerMessage } from "../../types.js";
import { fetchTasks } from "../lib/project-api.js";
import { toTaskViewModel } from "../lib/view-models.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { areTaskRecordListsEqual, shouldUseForegroundLoading } from "./project-resource-utils.js";

interface UseProjectTasksResult {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface UseProjectTasksOptions {
  enabled?: boolean;
}

export function useProjectTasks(
  projectId: string | null,
  sources: Source[],
  sprints: Sprint[],
  sprintId?: string | null,
  options?: UseProjectTasksOptions,
): UseProjectTasksResult {
  const [taskRecords, setTaskRecords] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const enabled = options?.enabled ?? true;

  const refreshInternal = useCallback(async (options?: { silent?: boolean }): Promise<void> => {
    if (!projectId || !enabled) {
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
      const nextTaskRecords = await fetchTasks(projectId, sprintId || undefined);
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
  }, [enabled, projectId, sprintId]);

  useEffect(() => {
    hasLoadedRef.current = false;
    void refreshInternal();
  }, [enabled, projectId, sprintId, refreshInternal]);

  useEffect(() => {
    if (!projectId || !enabled) {
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
  }, [enabled, projectId, refreshInternal]);

  const sourcesById = useMemo(() => {
    const map = new Map<string, Source>();
    for (const source of sources) {
      map.set(source.id, source);
    }
    return map;
  }, [sources]);

  const sprintsById = useMemo(() => {
    const map = new Map<string, Sprint>();
    for (const sprint of sprints) {
      map.set(sprint.id, sprint);
    }
    return map;
  }, [sprints]);

  const prevTasksMapRef = useRef<Map<string, Task>>(new Map());

  const tasks = useMemo(() => {
    const prevTasksMap = prevTasksMapRef.current;

    return taskRecords.map((taskRecord) => {
      const prevTask = prevTasksMap.get(taskRecord.id);
      return toTaskViewModel(taskRecord, sourcesById, sprintsById, prevTask);
    });
  }, [sourcesById, sprintsById, taskRecords]);

  useEffect(() => {
    const nextTasksMap = new Map<string, Task>();
    for (const task of tasks) {
      nextTasksMap.set(task.recordId, task);
    }
    prevTasksMapRef.current = nextTasksMap;
  }, [tasks]);

  const refresh = useCallback(async (): Promise<void> => {
    await refreshInternal({ silent: true });
  }, [refreshInternal]);

  return { tasks, loading, error, refresh };
}
