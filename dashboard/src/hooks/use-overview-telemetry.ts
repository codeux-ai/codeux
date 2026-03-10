import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { OverviewTelemetrySnapshot, DashboardRealtimeServerMessage } from "../types.js";
import { fetchOverviewTelemetry } from "../lib/api/dashboard-api.js";
import { subscribeToDashboardRealtime } from "../lib/realtime/dashboard-realtime-client.js";

const EMPTY_TELEMETRY: OverviewTelemetrySnapshot = {
  activeProjects: [],
  recentEvents: [],
  updatedAt: null,
};

export function useOverviewTelemetry(pollIntervalMs: number = 30000): {
  telemetry: OverviewTelemetrySnapshot;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [telemetry, setTelemetry] = useState<OverviewTelemetrySnapshot>(EMPTY_TELEMETRY);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setTelemetry(await fetchOverviewTelemetry());
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return subscribeToDashboardRealtime(["overview"], (message: DashboardRealtimeServerMessage) => {
      if (message.type === "event" && message.event.eventType === "overview.telemetry.updated") {
        setTelemetry(message.event.payload as OverviewTelemetrySnapshot);
        setError(null);
        return;
      }

      if (message.type === "snapshot_required") {
        void refresh();
      }
    });
  }, [refresh]);

  useEffect(() => {
    if (pollIntervalMs <= 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [pollIntervalMs, refresh]);

  return useMemo(() => ({ telemetry, error, refresh }), [error, refresh, telemetry]);
}
