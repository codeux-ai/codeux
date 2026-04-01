import { h } from "preact";
import type { FunctionComponent } from "preact";
import { Zap, RefreshCcw, WifiOff, AlertTriangle } from "lucide-preact";
import type { TransportState } from "../../../lib/realtime/dashboard-realtime-client.js";
import { useEffect, useState } from "preact/hooks";

export interface LiveTransportBannerProps {
  transportState: TransportState;
  isRecovering: boolean;
  snapshotUpdatedAt: string | null;
  error: string | null;
}

const STALE_THRESHOLD_MS = 15000;

export const LiveTransportBanner: FunctionComponent<LiveTransportBannerProps> = ({
  transportState,
  isRecovering,
  snapshotUpdatedAt,
  error,
}) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const isStale =
    snapshotUpdatedAt && transportState === "connected" && !isRecovering
      ? now - new Date(snapshotUpdatedAt).getTime() > STALE_THRESHOLD_MS
      : false;

  if (transportState === "connected" && !isRecovering && !isStale && !error) {
    return null;
  }

  let icon = <WifiOff className="w-5 h-5 shrink-0" />;
  let title = "Disconnected";
  let message = "Lost connection to the live stream. Retrying...";
  let wrapperClass = "bg-status-red/10 border-status-red/20 text-status-red";
  let iconClass = "text-status-red";

  if (error) {
    icon = <Zap className="w-5 h-5 shrink-0" />;
    title = "Connection Error";
    message = error;
    wrapperClass = "bg-status-red/10 border-status-red/20 text-status-red";
    iconClass = "text-status-red";
  } else if (transportState === "reconnecting") {
    icon = <RefreshCcw className="w-5 h-5 shrink-0 animate-spin" />;
    title = "Reconnecting";
    message = "Attempting to restore connection...";
    wrapperClass = "bg-status-amber/10 border-status-amber/20 text-status-amber";
    iconClass = "text-status-amber";
  } else if (isRecovering || transportState === "connecting") {
    icon = <RefreshCcw className="w-5 h-5 shrink-0 animate-spin" />;
    title = "Recovering State";
    message = "Fetching latest snapshot to ensure data consistency...";
    wrapperClass = "bg-status-amber/10 border-status-amber/20 text-status-amber";
    iconClass = "text-status-amber";
  } else if (isStale) {
    icon = <AlertTriangle className="w-5 h-5 shrink-0" />;
    title = "Stale Data";
    message = "Data has not been updated recently. Network issues may be present.";
    wrapperClass = "bg-status-amber/10 border-status-amber/20 text-status-amber";
    iconClass = "text-status-amber";
  }

  return (
    <div
      className={`flex items-center gap-4 px-5 py-4 rounded-2xl border backdrop-blur-md mb-6 ${wrapperClass}`}
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
    >
      <div className={`flex items-center justify-center ${iconClass}`}>
        {icon}
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-bold tracking-tight">{title}</span>
        <span className="text-sm opacity-90">{message}</span>
      </div>
    </div>
  );
};
