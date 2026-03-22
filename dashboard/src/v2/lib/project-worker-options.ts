import type {
  ExecutionDashboardSnapshot,
  ExecutionAssignedWorkerSummary,
  VirtualWorkerProvider,
} from "../../types.js";

const LIVE_WORKER_STATUSES = new Set(["connected", "listening", "idle", "paused"]);

export const VIRTUAL_WORKER_OPTIONS: Array<{
  id: VirtualWorkerProvider;
  label: string;
  subLabel: string;
}> = [
  {
    id: "gemini",
    label: "Virtual Gemini Worker",
    subLabel: "On-demand CLI",
  },
  {
    id: "codex",
    label: "Virtual Codex Worker",
    subLabel: "On-demand CLI",
  },
  {
    id: "claude-code",
    label: "Virtual Claude Code Worker",
    subLabel: "On-demand CLI",
  },
];

export interface WorkerRoutingPreference {
  executionMode: "CONNECTED_MCP" | "VIRTUAL";
  virtualWorkerProvider: VirtualWorkerProvider;
}

export interface WorkerOption {
  id: string; // connectionId or endpointId
  label: string;
  subLabel?: string;
  status: string;
  isPrimary: boolean;
  type: 'connection' | 'endpoint' | 'virtual';
  isSelectable: boolean;
  connectionId?: string | null;
  workerEndpointId?: string | null;
  workerEndpointKey?: string | null;
  providerId?: VirtualWorkerProvider;
}

export interface ProjectWorkerOptionsResult {
  options: WorkerOption[];
  selectedOption: WorkerOption | null;
  isLoading: boolean;
  hasConnections: boolean;
}

export function getProjectWorkerOptions(
  execution: ExecutionDashboardSnapshot | null,
  routing: WorkerRoutingPreference | null,
  loading: boolean = false
): ProjectWorkerOptionsResult {
  const connections = (execution?.connections || []).filter((connection) => connection.role === "worker");
  const primaryAssignedWorker = execution?.primaryAssignedWorker || null;
  const options: WorkerOption[] = [];
  const isVirtualMode = routing?.executionMode === "VIRTUAL";
  const selectedVirtualProvider = isVirtualMode ? routing?.virtualWorkerProvider : null;

  for (const conn of connections) {
    const isPrimary = !isVirtualMode && primaryAssignedWorker?.connectionId === conn.id;
    options.push({
      id: conn.id,
      label: conn.displayName,
      subLabel: conn.model || conn.role,
      status: conn.status,
      isPrimary,
      type: 'connection',
      isSelectable: LIVE_WORKER_STATUSES.has(conn.status),
      connectionId: conn.id,
    });
  }

  if (
    primaryAssignedWorker
    && !isVirtualMode
    && !options.find((option) => option.connectionId === primaryAssignedWorker.connectionId)
  ) {
    options.unshift({
      id: primaryAssignedWorker.workerEndpointId || primaryAssignedWorker.assignmentId,
      label: primaryAssignedWorker.workerDisplayName,
      subLabel: 'Assigned (Offline)',
      status: primaryAssignedWorker.workerStatus || 'offline',
      isPrimary: true,
      type: 'endpoint',
      isSelectable: isSelectableAssignedWorker(primaryAssignedWorker),
      workerEndpointId: primaryAssignedWorker.workerEndpointId,
      workerEndpointKey: primaryAssignedWorker.workerEndpointKey,
    });
  }

  for (const virtualWorker of VIRTUAL_WORKER_OPTIONS) {
    options.push({
      id: `virtual:${virtualWorker.id}`,
      label: virtualWorker.label,
      subLabel: virtualWorker.subLabel,
      status: "available",
      isPrimary: selectedVirtualProvider === virtualWorker.id,
      type: "virtual",
      isSelectable: true,
      providerId: virtualWorker.id,
      workerEndpointKey: `virtual:${virtualWorker.id}`,
    });
  }

  const selectedOption = options.find((option) => option.isPrimary) || null;

  return {
    options,
    selectedOption,
    isLoading: loading,
    hasConnections: connections.length > 0,
  };
}

function isSelectableAssignedWorker(primaryAssignedWorker: ExecutionAssignedWorkerSummary): boolean {
  return LIVE_WORKER_STATUSES.has(primaryAssignedWorker.workerStatus || primaryAssignedWorker.status);
}
