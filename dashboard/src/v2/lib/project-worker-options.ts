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
  const overflowAssignedWorkers = execution?.overflowAssignedWorkers || [];
  const options: WorkerOption[] = [];
  const isVirtualMode = routing?.executionMode === "VIRTUAL";
  const selectedVirtualProvider = isVirtualMode ? routing?.virtualWorkerProvider : null;
  const assignedWorkers = [primaryAssignedWorker, ...overflowAssignedWorkers].filter(Boolean) as ExecutionAssignedWorkerSummary[];
  const representedConnectionIds = new Set<string>();

  for (const assignedWorker of assignedWorkers) {
    if (assignedWorker.connectionId) {
      representedConnectionIds.add(assignedWorker.connectionId);
    }
    options.push({
      id: assignedWorker.workerEndpointId || assignedWorker.connectionId || assignedWorker.assignmentId,
      label: assignedWorker.workerDisplayName,
      subLabel: assignedWorker.assignmentRole === "primary" ? "Assigned Worker" : "Overflow Worker",
      status: assignedWorker.workerStatus || assignedWorker.status,
      isPrimary: !isVirtualMode && assignedWorker.assignmentRole === "primary",
      type: "endpoint",
      isSelectable: isSelectableAssignedWorker(assignedWorker),
      connectionId: assignedWorker.connectionId,
      workerEndpointId: assignedWorker.workerEndpointId,
      workerEndpointKey: assignedWorker.workerEndpointKey,
    });
  }

  for (const conn of connections) {
    if (representedConnectionIds.has(conn.id)) {
      continue;
    }
    options.push({
      id: conn.id,
      label: conn.displayName,
      subLabel: conn.model || conn.role,
      status: conn.status,
      isPrimary: false,
      type: "connection",
      isSelectable: LIVE_WORKER_STATUSES.has(conn.status),
      connectionId: conn.id,
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
