import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { EffectiveSettingsResponse } from "../../types.js";
import { fetchProjectEffectiveSettings } from "../lib/settings-api.js";

export function useProjectEffectiveSettings(projectId: string | null): {
  data: EffectiveSettingsResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<EffectiveSettingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasLoadedRef = useRef(false);

  const refreshInternal = useCallback(async (options?: { silent?: boolean }): Promise<void> => {
    if (!projectId) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setData(null);
      setError(null);
      setLoading(false);
      hasLoadedRef.current = false;
      return;
    }

    const isForeground = !options?.silent && !hasLoadedRef.current;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    if (isForeground) {
      setData(null);
      setLoading(true);
    }

    try {
      const response = await fetchProjectEffectiveSettings(projectId, {
        signal: abortController.signal,
      });
      if (abortControllerRef.current === abortController) {
        setData(response);
        hasLoadedRef.current = true;
        setError(null);
      }
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        return;
      }
      if (abortControllerRef.current === abortController) {
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        setLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    hasLoadedRef.current = false;
    void refreshInternal();
  }, [refreshInternal]);

  const refresh = useCallback(() => refreshInternal({ silent: true }), [refreshInternal]);

  return useMemo(
    () => ({
      data,
      loading,
      error,
      refresh,
    }),
    [data, loading, error, refresh]
  );
}
