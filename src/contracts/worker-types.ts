export type WorkerEndpointType = "mcp_connection" | "hosted_api" | "ollama";
export type WorkerEndpointStatus = "configured" | "connected" | "idle" | "paused" | "stale" | "offline";
export type ProjectWorkerAssignmentRole = "primary" | "overflow";
export type ProjectWorkerAssignmentStatus = "active" | "released";

export interface WorkerEndpointCapabilities {
  canSuperviseProjects: boolean;
  canExecuteTasks: boolean;
}

export interface WorkerEndpointRecord {
  id: string;
  endpointKey: string;
  endpointType: WorkerEndpointType;
  displayName: string;
  status: WorkerEndpointStatus;
  connectionId: string | null;
  connectionKey: string | null;
  transport: string | null;
  capabilities: WorkerEndpointCapabilities;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWorkerAssignmentRecord {
  id: string;
  projectId: string;
  workerEndpointId: string | null;
  workerEndpointKey: string;
  workerEndpointType: WorkerEndpointType;
  workerDisplayName: string;
  connectionId: string | null;
  connectionKey: string | null;
  transport: string | null;
  assignmentRole: ProjectWorkerAssignmentRole;
  status: ProjectWorkerAssignmentStatus;
  assignedAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
  lastAffinityAt: string;
  workerStatus: WorkerEndpointStatus | null;
  capabilities: WorkerEndpointCapabilities;
  createdAt: string;
  updatedAt: string;
}
