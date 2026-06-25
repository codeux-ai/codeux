import type {
  ExecutionDashboardSnapshot,
  ExecutionAssignedWorkerSummary,
  SystemSettings,
} from "../../types.js";
import {
  getProviderDisplayMetadata,
  getVirtualProviderDisplayMetadata,
} from "./settings-view-models.js";
import {
  DEFAULT_PROVIDER_CONFIG_NAMES,
  VIRTUAL_WORKER_PROVIDERS,
} from "../../../../src/repositories/settings-defaults.js";

const LIVE_WORKER_STATUSES = new Set(["connected", "listening", "idle", "paused"]);

export const VIRTUAL_WORKER_OPTIONS: Array<{
  id: string;
  label: string;
  subLabel: string;
}> = [
  ...VIRTUAL_WORKER_PROVIDERS.map((id) => ({
    id,
    label: DEFAULT_PROVIDER_CONFIG_NAMES[id],
    subLabel: "On-demand CLI",
  })),
];

export interface WorkerRoutingPreference {
  executionMode: "VIRTUAL";
  virtualWorkerProvider: string;
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
  providerId?: string;
  providerConfigId?: string;
  iconProviderId?: string;
  effectiveModel?: string;
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
  loading: boolean = false,
  systemSettings: SystemSettings | null = null,
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

  const virtualWorkers = systemSettings
    ? getVirtualProviderDisplayMetadata(systemSettings)
    : VIRTUAL_WORKER_OPTIONS.map((worker) => getProviderDisplayMetadata(null, worker.id))
        .filter((metadata): metadata is NonNullable<typeof metadata> => Boolean(metadata));

  for (const virtualWorker of virtualWorkers) {
    options.push({
      id: `virtual:${virtualWorker.providerConfigId}`,
      label: virtualWorker.displayLabel,
      subLabel: "On-demand CLI",
      status: "available",
      isPrimary: selectedVirtualProvider === virtualWorker.providerConfigId || selectedVirtualProvider === virtualWorker.provider,
      type: "virtual",
      isSelectable: true,
      providerId: virtualWorker.provider,
      providerConfigId: virtualWorker.providerConfigId,
      iconProviderId: virtualWorker.iconProviderId,
      effectiveModel: virtualWorker.effectiveModel,
      workerEndpointKey: `virtual:${virtualWorker.providerConfigId}`,
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
