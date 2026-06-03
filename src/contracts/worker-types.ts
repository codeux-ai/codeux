export type WorkerEndpointType = "mcp_connection" | "virtual_cli" | "hosted_api" | "ollama";

// AI model types for virtual worker providers
export type GeminiModel =
  | "auto"
  | "pro"
  | "flash"
  | "flash-lite"
  | "gemini-3-pro-preview"
  | "gemini-3-flash-preview"
  | "gemini-3.1-pro-preview"
  | "gemini-3.1-pro-preview-customtools"
  | "gemini-3.1-flash-lite-preview"
  | "gemini-2.5-pro"
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite"
  | "gemini-3.1-flash-lite"
  | "gemma-4-31b-it"
  | "gemma-4-26b-a4b-it"
  | "gemini-2.5-flash-base"
  | "gemini-3-flash-base";

export type ClaudeModel =
  | "default"
  | "sonnet"
  | "opus"
  | "haiku"
  | "sonnet[1m]"
  | "opus[1m]"
  | "opusplan"
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5-20251001";

export type CodexModel =
  | "gpt-5.5"
  | "gpt-5.4"
  | "gpt-5.4-mini"
  | "gpt-5.3-codex"
  | "gpt-5.3-codex-spark"
  | "gpt-5.2-codex"
  | "gpt-5.2"
  | "gpt-5.1-codex-max"
  | "gpt-5.1"
  | "gpt-5.1-codex"
  | "gpt-5-codex"
  | "gpt-5-codex-mini"
  | "gpt-5";

export type AntigravityModel =
  | "default"
  | "gemini-3.5-flash"
  | "gemini-3.1-pro-high"
  | "gemini-3.1-pro-low"
  | "gemini-3-flash"
  | "claude-sonnet-4.6-thinking"
  | "claude-opus-4.6-thinking"
  | "gpt-oss-120b";

export type VirtualWorkerModel = GeminiModel | ClaudeModel | CodexModel | AntigravityModel;

export interface WorkerRuntimeSettings {
  model: string;
}
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
