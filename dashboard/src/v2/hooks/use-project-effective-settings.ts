import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import type { EffectiveSettingsResponse } from "../../types.js";
import { fetchProjectEffectiveSettings } from "../lib/settings-api.js";
import { useRealtimeResource } from "../../hooks/use-realtime-resource.js";
import { isEqualEffectiveSettings, stabilizeEffectiveSettings } from "../lib/resource-equality.js";

const effectiveSettingsCache = new Map<string, EffectiveSettingsResponse>();
const effectiveSettingsInflightRequests = new Map<string, Promise<EffectiveSettingsResponse>>();

export const clearEffectiveSettingsCacheForTests = (): void => {
  effectiveSettingsCache.clear();
  effectiveSettingsInflightRequests.clear();
};

export function useProjectEffectiveSettings(projectId: string | null): {
  data: EffectiveSettingsResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const cachedSettings = projectId ? effectiveSettingsCache.get(projectId) || null : null;
  const projectCacheEntryRef = useRef<{ projectId: string | null; hadInitialCache: boolean }>({
    projectId: null,
    hadInitialCache: false,
  });

  if (projectCacheEntryRef.current.projectId !== projectId) {
    projectCacheEntryRef.current = {
      projectId,
      hadInitialCache: !!cachedSettings,
    };
  }

  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    if (!projectId) {
      return null;
    }
    let request = effectiveSettingsInflightRequests.get(projectId);
    if (!request) {
      request = fetchProjectEffectiveSettings(projectId, { signal }).finally(() => {
        effectiveSettingsInflightRequests.delete(projectId);
      });
      effectiveSettingsInflightRequests.set(projectId, request);
    }
    const nextSettings = await request;
    const cached = effectiveSettingsCache.get(projectId) || null;
    const stabilized = stabilizeEffectiveSettings(cached, nextSettings) || nextSettings;
    effectiveSettingsCache.set(projectId, stabilized);
    return stabilized;
  }, [projectId]);

  const { data, loading, error, refetch } = useRealtimeResource<EffectiveSettingsResponse | null>({
    initialData: cachedSettings,
    fetchResource,
    isEqual: isEqualEffectiveSettings,
    stabilizeNext: stabilizeEffectiveSettings,
    realtime: {
      scopes: projectId ? [`project:${projectId}`] : [],
      eventType: "project.structure.updated",
    },
    isAlreadyLoaded: projectCacheEntryRef.current.hadInitialCache || !projectId,
    refreshOnMount: false,
  });

  useEffect(() => {
    if (!projectId || typeof window === "undefined") {
      return;
    }

    const handleSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; projectId?: string }>).detail;
      if (detail?.scope === "project" && detail.projectId && detail.projectId !== projectId) {
        return;
      }

      if (detail?.scope === "system" || !detail?.scope) {
        effectiveSettingsCache.clear();
      } else {
        effectiveSettingsCache.delete(projectId);
      }
      effectiveSettingsInflightRequests.delete(projectId);
      void refetch({ silent: true });
    };

    window.addEventListener("codeux:settings-updated", handleSettingsUpdated);
    return () => window.removeEventListener("codeux:settings-updated", handleSettingsUpdated);
  }, [projectId, refetch]);

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
