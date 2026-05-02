import { useCallback, useMemo } from "preact/hooks";
import { isDeepEqual } from "../v2/lib/resource-equality.js";
import type { OverviewTelemetrySnapshot } from "../types.js";
import { fetchOverviewTelemetry } from "../lib/api/dashboard-api.js";
import { useRealtimeResource } from "./use-realtime-resource.js";

const EMPTY_TELEMETRY: OverviewTelemetrySnapshot = {
  activeProjects: [],
  attentionProjects: [],
  recentEvents: [],
  updatedAt: null,
};

export function useOverviewTelemetry(pollIntervalMs: number = 30000): {
  telemetry: OverviewTelemetrySnapshot;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const fetchResource = useCallback(async (signal?: AbortSignal) => {
    // API client doesn't explicitly support signal, but could be added later
    return fetchOverviewTelemetry();
  }, []);

  // Use deep equality, ignoring metadata timestamps that cause unnecessary re-renders
  const isEqual = useCallback((prev: OverviewTelemetrySnapshot, next: OverviewTelemetrySnapshot) => {
    const prevNoMeta = { ...prev, updatedAt: null };
    const nextNoMeta = { ...next, updatedAt: null };
    return isDeepEqual(prevNoMeta, nextNoMeta);
  }, []);

  const { data: telemetry, loading, error, refetch } = useRealtimeResource<OverviewTelemetrySnapshot>({
    initialData: EMPTY_TELEMETRY,
    fetchResource,
    isEqual,
    realtime: {
      scopes: ["overview"],
      eventType: "overview.telemetry.updated",
      updateDirectlyFromEvent: true,
    },
    pollIntervalMs,
    isAlreadyLoaded: false,
  });

  return useMemo(() => ({
    telemetry,
    loading,
    error,
    refresh: () => refetch({ silent: true }),
  }), [telemetry, loading, error, refetch]);
}
