import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Source, Sprint, Task, TaskRecord } from "../types.js";
import type { DashboardRealtimeServerMessage } from "../../types.js";
import { fetchTasks } from "../lib/project-api.js";
import { toTaskViewModel } from "../lib/view-models.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { areTaskRecordListsEqual, shouldUseForegroundLoading, shouldClearTasksOnScopeChange } from "./project-resource-utils.js";

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
  const resolvedScopeRef = useRef({ projectId, sprintId });

  const refreshInternal = useCallback(async (options?: { silent?: boolean; signal?: AbortSignal }): Promise<void> => {
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
      const nextTaskRecords = await fetchTasks(projectId, sprintId || undefined, options?.signal);
      if (options?.signal?.aborted) return;
      setTaskRecords((current) => (areTaskRecordListsEqual(current, nextTaskRecords) ? current : nextTaskRecords));
      resolvedScopeRef.current = { projectId, sprintId };
      hasLoadedRef.current = true;
      setError(null);
    } catch (fetchError: any) {
      if (fetchError.name === "AbortError") return;
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (shouldUseForegroundState && !options?.signal?.aborted) {
        setLoading(false);
      }
    }
  }, [enabled, projectId, sprintId]);

  useEffect(() => {
    const currentScope = resolvedScopeRef.current;
    const nextScope = { projectId, sprintId };

    if (shouldClearTasksOnScopeChange(currentScope, nextScope)) {
      setTaskRecords([]);
      hasLoadedRef.current = false;
    }
    resolvedScopeRef.current = nextScope;

    const controller = new AbortController();
    void refreshInternal({ signal: controller.signal });
    return () => controller.abort();
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
