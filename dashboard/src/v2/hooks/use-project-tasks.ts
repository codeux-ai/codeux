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

  const sourcesByIdRef = useRef<Map<string, Source>>(new Map());
  const sprintsByIdRef = useRef<Map<string, Sprint>>(new Map());
  const prevTasksMapRef = useRef<Map<string, Task>>(new Map());

  const tasks = useMemo(() => {
    const sourcesById = sourcesByIdRef.current;
    sourcesById.clear();
    for (const source of sources) {
      sourcesById.set(source.id, source);
    }

    const sprintsById = sprintsByIdRef.current;
    sprintsById.clear();
    for (const sprint of sprints) {
      sprintsById.set(sprint.id, sprint);
    }

    const prevTasksMap = prevTasksMapRef.current;
    const nextTasksMap = new Map<string, Task>();

    const nextTasks = taskRecords.map((taskRecord) => {
      const prevTask = prevTasksMap.get(taskRecord.id);
      const nextTask = toTaskViewModel(taskRecord, sourcesById, sprintsById, prevTask);
      nextTasksMap.set(taskRecord.id, nextTask);
      return nextTask;
    });

    prevTasksMapRef.current = nextTasksMap;
    return nextTasks;
  }, [sources, sprints, taskRecords]);

  const refresh = useCallback(async (): Promise<void> => {
    await refreshInternal({ silent: true });
  }, [refreshInternal]);

  return { tasks, loading, error, refresh };
}
