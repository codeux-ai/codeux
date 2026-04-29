import { useCallback, useMemo, useRef } from "preact/hooks";
import type { Sprint, SprintCollectionResponse } from "../v2/types.js";
import { fetchSprints, selectSprint as apiSelectSprint } from "../v2/lib/project-api.js";
import { toSprintViewModel } from "../v2/lib/view-models.js";
import { areSprintCollectionsEqual, resolveSelectedSprint } from "../v2/lib/sprint-scope.js";
import { useRealtimeResource } from "./use-realtime-resource.js";

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
const sprintInflightRequests = new Map<string, Promise<SprintCollectionResponse>>();

const areNullableSprintCollectionsEqual = (
  prev: SprintCollectionResponse | null,
  next: SprintCollectionResponse | null,
): boolean => {
  if (prev === next) {
    return true;
  }
  if (!prev || !next) {
    return false;
  }
  return areSprintCollectionsEqual(prev, next);
};

const stabilizeSprintCollection = (
  prev: SprintCollectionResponse | null,
  next: SprintCollectionResponse | null,
): SprintCollectionResponse | null => (
  areNullableSprintCollectionsEqual(prev, next) ? prev : next
);

export function useSprints(projectId: string | null): UseSprintsResult {
  const cachedCollection = projectId ? sprintCache.get(projectId) || null : null;
  const projectCacheEntryRef = useRef<{ projectId: string | null; hadInitialCache: boolean }>({
    projectId: null,
    hadInitialCache: false,
  });

  if (projectCacheEntryRef.current.projectId !== projectId) {
    projectCacheEntryRef.current = {
      projectId,
      hadInitialCache: !!cachedCollection,
    };
  }

  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    if (!projectId) {
      return null;
    }
    let request = sprintInflightRequests.get(projectId);
    if (!request) {
      request = fetchSprints(projectId, signal).finally(() => {
        sprintInflightRequests.delete(projectId);
      });
      sprintInflightRequests.set(projectId, request);
    }
    const resolvedCollection = await request;
    const cached = sprintCache.get(projectId) || null;
    const nextCollection = areNullableSprintCollectionsEqual(cached, resolvedCollection)
      ? cached
      : resolvedCollection;
    if (nextCollection) {
      sprintCache.set(projectId, nextCollection);
    }
    return nextCollection;
  }, [projectId]);

  const { data: collection, loading, error, refetch, updateDataLocally } = useRealtimeResource<SprintCollectionResponse | null>({
    initialData: cachedCollection,
    fetchResource,
    isEqual: areNullableSprintCollectionsEqual,
    stabilizeNext: stabilizeSprintCollection,
    realtime: projectId ? {
      scopes: [`project:${projectId}`],
      eventType: "project.structure.updated",
      updateDirectlyFromEvent: false, // Refetch to allow cache populating
    } : undefined,
    isAlreadyLoaded: projectCacheEntryRef.current.hadInitialCache || !projectId,
    refreshOnMount: false,
  });

  const selectSprint = useCallback(async (sprintId: string | null) => {
    if (!projectId) return;
    try {
      const nextSelectedSprintId = await apiSelectSprint(projectId, sprintId);
      updateDataLocally((current) => {
        if (!current) return current;
        const nextCollection = { ...current, selectedSprintId: nextSelectedSprintId };
        sprintCache.set(projectId, nextCollection);
        return nextCollection;
      });
    } catch (err) {
      console.error("Failed to select sprint", err);
    }
  }, [projectId, updateDataLocally]);

  const data = useMemo(
    () => collection ? collection.sprints.map(toSprintViewModel) : [],
    [collection],
  );
  const selectedSprintId = collection?.selectedSprintId ?? null;
  const selectedSprint = useMemo(
    () => resolveSelectedSprint(data, selectedSprintId),
    [data, selectedSprintId],
  );

  return { data, selectedSprintId, selectedSprint, selectSprint, loading, error, refetch: () => refetch({ silent: true }) };
}
