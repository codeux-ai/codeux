import { useCallback, useMemo, useRef } from "preact/hooks";
import type { Source, Sprint, Task, TaskRecord } from "../types.js";
import { fetchTasks } from "../lib/project-api.js";
import { toTaskViewModel } from "../lib/view-models.js";
import { areTaskRecordListsEqual } from "./project-resource-utils.js";
import { useRealtimeResource } from "../../hooks/use-realtime-resource.js";
import type { DashboardRealtimeServerMessage } from "../../types.js";

interface UseProjectTasksResult {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface UseProjectTasksOptions {
  enabled?: boolean;
}

const EMPTY_TASK_RECORDS: TaskRecord[] = [];

export function useProjectTasks(
  projectId: string | null,
  sources: Source[],
  sprints: Sprint[],
  sprintId?: string | null,
  options?: UseProjectTasksOptions,
): UseProjectTasksResult {
  const enabled = options?.enabled ?? true;

  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    if (!projectId || !enabled) {
      return EMPTY_TASK_RECORDS;
    }
    return fetchTasks(projectId, sprintId || undefined);
  }, [projectId, sprintId, enabled]);

  const shouldRefetch = useCallback((message: DashboardRealtimeServerMessage) => {
    if (message.type === "snapshot_required") {
      return true;
    }
    if (message.type === "event" && message.event.eventType === "project.structure.updated") {
      return true;
    }
    return false;
  }, []);

  const {
    data: taskRecords,
    loading,
    error,
    refetch,
  } = useRealtimeResource<TaskRecord[]>({
    initialData: EMPTY_TASK_RECORDS,
    fetchResource,
    isEqual: areTaskRecordListsEqual,
    isAlreadyLoaded: !projectId || !enabled,
    realtime: (projectId && enabled) ? {
      scopes: [`project:${projectId}`],
      shouldRefetch,
    } : undefined,
  });

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
    await refetch({ silent: true });
  }, [refetch]);

  return { tasks, loading, error, refresh };
}
