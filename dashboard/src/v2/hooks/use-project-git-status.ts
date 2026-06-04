import { useCallback, useMemo } from "preact/hooks";
import type { GitTrackingStatus } from "../../types.js";
import { fetchGitTrackingStatus } from "../../lib/api/dashboard-api.js";
import { useRealtimeResource } from "../../hooks/use-realtime-resource.js";

/**
 * Git/CI/PR status for the selected project, on its own dedicated channel.
 *
 * Git status is slow to assemble (REMOTE mode shells out to `gh`) and can be several MB. It is only
 * shown on the Live page, so it is intentionally kept off the shared `project.live.updated` snapshot
 * that every page parses. The server publishes it on a throttled `project.git.updated` event (only
 * when it actually changes) and exposes `/api/git-status` for the initial fetch; this hook is the
 * single consumer.
 */
export function useProjectGitStatus(projectId: string | null, enabled = true): {
  data: GitTrackingStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const active = enabled && !!projectId;

  const fetchResource = useCallback(async (_signal?: AbortSignal) => {
    if (!active) {
      return null;
    }
    return await fetchGitTrackingStatus();
  }, [active]);

  const { data, loading, error, refetch } = useRealtimeResource<GitTrackingStatus | null>({
    initialData: null,
    fetchResource,
    realtime: active && projectId ? {
      scopes: [`project:${projectId}`],
      eventType: "project.git.updated",
      updateDirectlyFromEvent: true,
    } : undefined,
    isAlreadyLoaded: !active,
  });

  const refresh = useCallback(async () => {
    await refetch({ silent: true });
  }, [refetch]);

  return useMemo(
    () => ({ data, loading, error, refresh }),
    [data, loading, error, refresh],
  );
}
