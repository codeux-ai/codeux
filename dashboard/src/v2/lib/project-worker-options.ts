import type { ExecutionDashboardSnapshot, ExecutionConnectionSummary, ExecutionAssignedWorkerSummary } from "../../types.js";

export interface WorkerOption {
  id: string; // connectionId or endpointId
  label: string;
  subLabel?: string;
  status: string;
  isPrimary: boolean;
  type: 'connection' | 'endpoint' | 'virtual';
  connectionId?: string | null;
  workerEndpointId?: string | null;
  workerEndpointKey?: string | null;
}

export interface ProjectWorkerOptionsResult {
  options: WorkerOption[];
  selectedOption: WorkerOption | null;
  isLoading: boolean;
  hasConnections: boolean;
}

export function getProjectWorkerOptions(
  execution: ExecutionDashboardSnapshot | null,
  loading: boolean = false
): ProjectWorkerOptionsResult {
  if (!execution || loading) {
    return {
      options: [],
      selectedOption: null,
      isLoading: loading,
      hasConnections: false,
    };
  }

  const { connections, primaryAssignedWorker } = execution;
  const options: WorkerOption[] = [];

  // 1. Add connections as options
  for (const conn of connections) {
    const isPrimary = primaryAssignedWorker?.connectionId === conn.id;
    options.push({
      id: conn.id,
      label: conn.displayName,
      subLabel: conn.model || conn.role,
      status: conn.status,
      isPrimary,
      type: 'connection',
      connectionId: conn.id,
    });
  }

  // 2. If primary worker is not in connections (e.g. offline/stale but still assigned), add it
  if (primaryAssignedWorker && !options.find(o => o.connectionId === primaryAssignedWorker.connectionId)) {
    options.unshift({
      id: primaryAssignedWorker.workerEndpointId || primaryAssignedWorker.assignmentId,
      label: primaryAssignedWorker.workerDisplayName,
      subLabel: 'Assigned (Offline)',
      status: primaryAssignedWorker.workerStatus || 'offline',
      isPrimary: true,
      type: 'endpoint',
      workerEndpointId: primaryAssignedWorker.workerEndpointId,
      workerEndpointKey: primaryAssignedWorker.workerEndpointKey,
    });
  }

  // Find selected option
  const selectedOption = options.find(o => o.isPrimary) || null;

  return {
    options,
    selectedOption,
    isLoading: false,
    hasConnections: connections.length > 0,
  };
}
