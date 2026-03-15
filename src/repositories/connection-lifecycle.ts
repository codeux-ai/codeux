import type { McpConnectionStatus } from "../contracts/connection-chat-types.js";
import type { WorkerEndpointStatus } from "../contracts/worker-types.js";

export const HEARTBEAT_WRITE_INTERVAL_MS = 5 * 1000;
export const STALE_CONNECTION_THRESHOLD_MS = 90 * 1000;
export const OFFLINE_CONNECTION_THRESHOLD_MS = 3 * 60 * 1000;
export const PRUNE_CONNECTION_THRESHOLD_MS = 3 * 60 * 1000;

function deriveHeartbeatHealth(lastHeartbeatAt: string | null): "healthy" | "stale" | "offline" {
  if (!lastHeartbeatAt) {
    return "healthy";
  }

  const ageMs = Date.now() - new Date(lastHeartbeatAt).getTime();
  if (!Number.isFinite(ageMs)) {
    return "healthy";
  }
  if (ageMs >= OFFLINE_CONNECTION_THRESHOLD_MS) {
    return "offline";
  }
  if (ageMs >= STALE_CONNECTION_THRESHOLD_MS) {
    return "stale";
  }
  return "healthy";
}

export function deriveConnectionHeartbeatStatus(
  storedStatus: McpConnectionStatus,
  lastHeartbeatAt: string | null,
): McpConnectionStatus {
  const health = deriveHeartbeatHealth(lastHeartbeatAt);
  if (health === "offline") {
    return "offline";
  }
  if (health === "stale") {
    return "stale";
  }
  return storedStatus;
}

export function deriveWorkerEndpointStatus(
  storedStatus: WorkerEndpointStatus,
  lastHeartbeatAt: string | null,
): WorkerEndpointStatus {
  const health = deriveHeartbeatHealth(lastHeartbeatAt);
  if (health === "offline") {
    return "offline";
  }
  if (health === "stale") {
    return "stale";
  }
  return storedStatus;
}
