import { useCallback, useMemo, useRef } from "preact/hooks";
import type { CreateSprintInput, Sprint, SprintCollectionResponse } from "../v2/types.js";
import { createSprint as apiCreateSprint, fetchSprints, selectSprint as apiSelectSprint } from "../v2/lib/project-api.js";
import { toSprintViewModel } from "../v2/lib/view-models.js";
import { areSprintCollectionsEqual, resolveSelectedSprint } from "../v2/lib/sprint-scope.js";
import { useRealtimeResource } from "./use-realtime-resource.js";
import { invalidateLivePayloadCache } from "../lib/api/dashboard-api.js";

interface UseSprintsResult {
  data: Sprint[];
  selectedSprintId: string | null;
  selectedSprint: Sprint | null;
  selectSprint: (sprintId: string | null) => Promise<void>;
  createSprint: (input: CreateSprintInput) => Promise<Sprint | null>;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface SprintResourceState {
  cache: Map<string, SprintCollectionResponse>;
  inflightRequests: Map<string, Promise<SprintCollectionResponse>>;
  selectionVersions: Map<string, number>;
}

const sprintResourceState = ((globalThis as typeof globalThis & {
  __CODE_UX_SPRINT_RESOURCE_STATE__?: SprintResourceState;
}).__CODE_UX_SPRINT_RESOURCE_STATE__ ||= {
  cache: new Map<string, SprintCollectionResponse>(),
  inflightRequests: new Map<string, Promise<SprintCollectionResponse>>(),
  selectionVersions: new Map<string, number>(),
});

// Preserve compatibility with an already-created hot-reload singleton from an
// older dashboard bundle that did not yet carry selection versions.
sprintResourceState.selectionVersions ||= new Map<string, number>();

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
  const activeProjectIdRef = useRef(projectId);
  activeProjectIdRef.current = projectId;
  const cachedCollection = projectId ? sprintResourceState.cache.get(projectId) || null : null;
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
    let request = sprintResourceState.inflightRequests.get(projectId);
    if (!request) {
      request = (async () => {
        try {
          return await fetchSprints(projectId, signal);
        } finally {
          if (sprintResourceState.inflightRequests.get(projectId) === request) {
            sprintResourceState.inflightRequests.delete(projectId);
          }
        }
      })();
      sprintResourceState.inflightRequests.set(projectId, request);
    }

    let resolvedCollection;
    try {
      resolvedCollection = await request;
    } catch (err: any) {
      if (err.name === "AbortError" && (!signal || !signal.aborted)) {
        return fetchResource(signal);
      }
      throw err;
    }

    const cached = sprintResourceState.cache.get(projectId) || null;
    const nextCollection = areNullableSprintCollectionsEqual(cached, resolvedCollection)
      ? cached
      : resolvedCollection;
    if (nextCollection) {
      sprintResourceState.cache.set(projectId, nextCollection);
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
      shouldRefetch: (message) => {
        if (message.type === "snapshot_required") {
          return true;
        }
        return message.type === "event"
          && message.event.eventType === "project.structure.updated";
      },
    } : undefined,
    pollIntervalMs: projectId ? 15000 : 0,
    isAlreadyLoaded: projectCacheEntryRef.current.hadInitialCache || !projectId,
    refreshOnMount: false,
  });

  const selectSprint = useCallback(async (sprintId: string | null) => {
    if (!projectId) return;
    const selectionVersion = (sprintResourceState.selectionVersions.get(projectId) ?? 0) + 1;
    sprintResourceState.selectionVersions.set(projectId, selectionVersion);
    try {
      const nextSelectedSprintId = await apiSelectSprint(projectId, sprintId);
      if (sprintResourceState.selectionVersions.get(projectId) !== selectionVersion) {
        return;
      }

      const cached = sprintResourceState.cache.get(projectId);
      if (!cached || cached.selectedSprintId !== nextSelectedSprintId) {
        invalidateLivePayloadCache(projectId);
      }
      if (cached) {
        sprintResourceState.cache.set(projectId, {
          ...cached,
          selectedSprintId: nextSelectedSprintId,
        });
      }

      if (activeProjectIdRef.current !== projectId) {
        return;
      }
      updateDataLocally((current) => {
        if (!current || activeProjectIdRef.current !== projectId) {
          return current;
        }
        const nextCollection = { ...current, selectedSprintId: nextSelectedSprintId };
        sprintResourceState.cache.set(projectId, nextCollection);
        return nextCollection;
      });
    } catch (err) {
      console.error("Failed to select sprint", err);
    }
  }, [projectId, updateDataLocally]);

  const createSprint = useCallback(async (input: CreateSprintInput): Promise<Sprint | null> => {
    if (!projectId) return null;
    try {
      const created = await apiCreateSprint(projectId, input);
      invalidateLivePayloadCache(projectId);
      const appendCreatedSprint = (current: SprintCollectionResponse): SprintCollectionResponse => ({
        ...current,
        sprints: current.sprints.some((sprint) => sprint.id === created.id)
          ? current.sprints.map((sprint) => sprint.id === created.id ? created : sprint)
          : [...current.sprints, created],
      });
      const cached = sprintResourceState.cache.get(projectId);
      if (cached) {
        sprintResourceState.cache.set(projectId, appendCreatedSprint(cached));
      }

      if (activeProjectIdRef.current !== projectId) {
        return toSprintViewModel(created);
      }
      updateDataLocally((current) => {
        if (!current || activeProjectIdRef.current !== projectId) return current;
        const nextCollection = appendCreatedSprint(current);
        sprintResourceState.cache.set(projectId, nextCollection);
        return nextCollection;
      });
      return toSprintViewModel(created);
    } catch (err) {
      console.error("Failed to create sprint", err);
      throw err;
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

  return { data, selectedSprintId, selectedSprint, selectSprint, createSprint, loading, error, refetch: () => refetch({ silent: true }) };
}
