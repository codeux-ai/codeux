import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Sprint, SprintCollectionResponse } from "../v2/types.js";
import type { DashboardRealtimeServerMessage } from "../types.js";
import { fetchSprints, selectSprint as apiSelectSprint } from "../v2/lib/project-api.js";
import { toSprintViewModel } from "../v2/lib/view-models.js";
import { subscribeToDashboardRealtime } from "../lib/realtime/dashboard-realtime-client.js";
import { shouldUseForegroundLoading } from "../v2/hooks/project-resource-utils.js";
import { areSprintCollectionsEqual, resolveSelectedSprint } from "../v2/lib/sprint-scope.js";

interface UseSprintsResult {
  data: Sprint[];
  selectedSprintId: string | null;
  selectedSprint: Sprint | null;
  selectSprint: (sprintId: string | null) => Promise<void>;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const sprintCache = new Map<string, SprintCollectionResponse>();

export function useSprints(projectId: string | null): UseSprintsResult {
  const [collection, setCollection] = useState<SprintCollectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const refreshInternal = useCallback(async (options?: { silent?: boolean; signal?: AbortSignal }): Promise<void> => {
    if (!projectId) {
      setCollection(null);
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
      const resolvedCollection = await fetchSprints(projectId, options?.signal);
      if (!options?.signal?.aborted) {
        sprintCache.set(projectId, resolvedCollection);
        setCollection((current) => {
          if (!current) return resolvedCollection;
          return areSprintCollectionsEqual(current, resolvedCollection) ? current : resolvedCollection;
        });
        hasLoadedRef.current = true;
        setError(null);
      }
    } catch (fetchError: any) {
      if (fetchError.name === "AbortError") return;
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (shouldUseForegroundState && !options?.signal?.aborted) {
        setLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      hasLoadedRef.current = false;
      void refreshInternal();
      return;
    }

    const cachedCollection = sprintCache.get(projectId);
    if (cachedCollection) {
      setCollection(cachedCollection);
      setLoading(false);
      setError(null);
      hasLoadedRef.current = true;
      void refreshInternal({ silent: true });
      return;
    }

    hasLoadedRef.current = false;
    const controller = new AbortController();
    void refreshInternal({ signal: controller.signal });
    return () => controller.abort();
  }, [projectId, refreshInternal]);

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

  const refetch = useCallback(async (): Promise<void> => {
    await refreshInternal({ silent: true });
  }, [refreshInternal]);

  const selectSprint = useCallback(async (sprintId: string | null) => {
    if (!projectId) return;
    try {
      const nextSelectedSprintId = await apiSelectSprint(projectId, sprintId);
      setCollection((current) => {
        if (!current) return current;
        const nextCollection = { ...current, selectedSprintId: nextSelectedSprintId };
        sprintCache.set(projectId, nextCollection);
        return nextCollection;
      });
    } catch (err) {
      console.error("Failed to select sprint", err);
    }
  }, [projectId]);

  const data = useMemo(
    () => collection ? collection.sprints.map(toSprintViewModel) : [],
    [collection],
  );
  const selectedSprintId = collection?.selectedSprintId ?? null;
  const selectedSprint = useMemo(
    () => resolveSelectedSprint(data, selectedSprintId),
    [data, selectedSprintId],
  );

  return { data, selectedSprintId, selectedSprint, selectSprint, loading, error, refetch };
}
