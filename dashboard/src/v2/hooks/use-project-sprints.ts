import { useCallback, useEffect, useState } from "preact/hooks";
import type { Sprint } from "../types.js";
import type { DashboardRealtimeServerMessage } from "../../types.js";
import { fetchSprints } from "../lib/project-api.js";
import { toSprintViewModel } from "../lib/view-models.js";
import { areSprintListsEqual } from "./project-resource-utils.js";
import { ProjectResourceStore } from "./project-resource-store.js";

interface UseProjectSprintsResult {
  sprints: Sprint[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const projectSprintsStore = new ProjectResourceStore<Sprint[]>({
  resourceType: "sprints",
  fetcher: async (projectId: string) => {
    const data = await fetchSprints(projectId);
    return data.map(toSprintViewModel);
  },
  isEqual: areSprintListsEqual,
  emptyData: [],
  getRealtimeScopes: (projectId: string) => [`project:${projectId}`],
  shouldRefreshOnRealtimeEvent: (message: DashboardRealtimeServerMessage) => {
    if (message.type === "snapshot_required") {
      return true;
    }
    if (message.type === "event" && message.event.eventType === "project.structure.updated") {
      return true;
    }
    return false;
  },
});

export function useProjectSprints(projectId: string | null): UseProjectSprintsResult {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return projectSprintsStore.subscribe(projectId, "", null, (data, errorStr, isLoading) => {
      setSprints(data);
      setError(errorStr);
      setLoading(isLoading);
    });
  }, [projectId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (projectId) {
      await projectSprintsStore.fetch(projectId, "", null, { silent: true });
    }
  }, [projectId]);

  return { sprints, loading, error, refresh };
}
