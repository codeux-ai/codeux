import { useCallback, useEffect, useState } from "preact/hooks";
import type { Sprint } from "../types.js";
import type { DashboardRealtimeServerMessage } from "../../types.js";
import { fetchSprints } from "../lib/project-api.js";
import { toSprintViewModel } from "../lib/view-models.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";

interface UseProjectSprintsResult {
  sprints: Sprint[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useProjectSprints(projectId: string | null): UseProjectSprintsResult {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setSprints([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchSprints(projectId);
      setSprints(data.map(toSprintViewModel));
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    return subscribeToDashboardRealtime([`project:${projectId}`], (message: DashboardRealtimeServerMessage) => {
      if (message.type === "snapshot_required") {
        void refresh();
        return;
      }

      if (message.type === "event" && message.event.eventType === "project.structure.updated") {
        void refresh();
      }
    });
  }, [projectId, refresh]);

  return { sprints, loading, error, refresh };
}
