import type { ManagementResponseEnvelope } from "./internal-management-types.js";

export type ClusterSettingsSyncScope =
  | "runtime"
  | "defaults"
  | "mcpTools"
  | "customMcpServers"
  | "modelPricing"
  | "providerSettings";

export interface ClusterSettingsSyncRequest {
  connectionId?: string;
  bearerToken?: string;
  approval?: {
    confirmed: boolean;
  };
}

export interface ClusterSettingsSyncErrorDetails {
  name?: string;
  message: string;
  stack?: string;
}

export interface ClusterSettingsSyncResult {
  remoteUrl: string;
  connectionId: string;
  changedSettingsScope: ClusterSettingsSyncScope[];
  approvalRequired: boolean;
  approvalMessage?: string;
  applied: boolean;
  error?: ClusterSettingsSyncErrorDetails;
}

export interface ClusterToolListResult {
  tools: Array<{
    name: string;
    description?: string;
  }>;
}

export interface ClusterToolCallResult {
  isError?: boolean;
  content?: Array<{
    type: string;
    text?: string;
  }>;
  structuredContent?: unknown;
}

export interface ClusterManageSettingsCallResult {
  envelope: ManagementResponseEnvelope;
  raw: ClusterToolCallResult;
}
