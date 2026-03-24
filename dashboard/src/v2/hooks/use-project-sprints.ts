import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Sprint, SprintCollectionResponse } from "../types.js";
import type { DashboardRealtimeServerMessage } from "../../types.js";
import { fetchSprints, selectSprint as apiSelectSprint } from "../lib/project-api.js";
import { toSprintViewModel } from "../lib/view-models.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";
import { shouldUseForegroundLoading } from "./project-resource-utils.js";
import { areSprintCollectionsEqual, resolveSelectedSprint } from "../lib/sprint-scope.js";

interface UseProjectSprintsResult {
  sprints: Sprint[];
  selectedSprintId: string | null;
  selectedSprint: Sprint | null;
  selectSprint: (sprintId: string | null) => Promise<void>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const sprintCache = new Map<string, SprintCollectionResponse>();

export function useProjectSprints(projectId: string | null): UseProjectSprintsResult {
  const [collection, setCollection] = useState<SprintCollectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const refreshInternal = useCallback(async (options?: { silent?: boolean }): Promise<void> => {
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
      const resolvedCollection = await fetchSprints(projectId);
      sprintCache.set(projectId, resolvedCollection);
      setCollection((current) => {
        if (!current) return resolvedCollection;
        return areSprintCollectionsEqual(current, resolvedCollection) ? current : resolvedCollection;
      });
      hasLoadedRef.current = true;
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (shouldUseForegroundState) {
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
    void refreshInternal();
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

  const refresh = useCallback(async (): Promise<void> => {
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

  const sprints = collection ? collection.sprints.map(toSprintViewModel) : [];
  const selectedSprintId = collection?.selectedSprintId ?? null;
  const selectedSprint = resolveSelectedSprint(sprints, selectedSprintId);

  return { sprints, selectedSprintId, selectedSprint, selectSprint, loading, error, refresh };
}
