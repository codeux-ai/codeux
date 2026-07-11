import { useCallback, useMemo } from "preact/hooks";
import type { DashboardRealtimeServerMessage } from "../../types.js";
import { useRealtimeResource } from "../../hooks/use-realtime-resource.js";
import type { ProjectInitializationState } from "../types.js";
import { fetchProjectInitializationState } from "../lib/project-api.js";

export function shouldRefreshProjectInitializationState(message: DashboardRealtimeServerMessage): boolean {
  return message.type === "snapshot_required"
    || (message.type === "event" && (
      message.event.eventType === "project.structure.updated"
      || message.event.eventType === "project.git.updated"
    ));
}

export function useProjectInitializationState(projectId: string | null): {
  data: ProjectInitializationState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const unavailableState = useMemo<ProjectInitializationState | null>(() => projectId ? ({
    projectId,
    initializationMode: "existing",
    repositoryState: "unavailable",
    canCreateInitialAppQuickactions: false,
  }) : null, [projectId]);

  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    if (!projectId) {
      return null;
    }
    return await fetchProjectInitializationState(projectId, signal);
  }, [projectId]);

  const { data, loading, error, refetch } = useRealtimeResource<ProjectInitializationState | null>({
    initialData: unavailableState,
    fetchResource,
    realtime: projectId ? {
      scopes: [`project:${projectId}`, `project:${projectId}:git`],
      shouldRefetch: shouldRefreshProjectInitializationState,
    } : undefined,
    isAlreadyLoaded: !projectId,
  });

  return useMemo(() => ({
    data: error ? unavailableState : data,
    loading,
    error,
    refresh: async () => {
      await refetch({ silent: true });
    },
  }), [data, error, loading, refetch, unavailableState]);
}
