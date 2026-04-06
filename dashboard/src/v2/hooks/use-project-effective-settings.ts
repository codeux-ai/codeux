import { useCallback, useMemo } from "preact/hooks";
import type { EffectiveSettingsResponse } from "../../types.js";
import { fetchProjectEffectiveSettings } from "../lib/settings-api.js";
import { useRealtimeResource } from "../../hooks/use-realtime-resource.js";
import { isEqualEffectiveSettings, stabilizeEffectiveSettings } from "../lib/resource-equality.js";

export function useProjectEffectiveSettings(projectId: string | null): {
  data: EffectiveSettingsResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    if (!projectId) {
      return null;
    }
    return await fetchProjectEffectiveSettings(projectId, { signal });
  }, [projectId]);

  const { data, loading, error, refetch } = useRealtimeResource<EffectiveSettingsResponse | null>({
    initialData: null,
    fetchResource,
    isEqual: isEqualEffectiveSettings,
    stabilizeNext: stabilizeEffectiveSettings,
    realtime: {
      scopes: projectId ? [`project:${projectId}`] : [],
      eventType: "project.structure.updated",
    },
  });

  return useMemo(
    () => ({
      data,
      loading,
      error,
      refresh: async () => {
        await refetch({ silent: true });
      },
    }),
    [data, loading, error, refetch]
  );
}
