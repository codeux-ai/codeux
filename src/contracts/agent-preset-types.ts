export type AgentSourceScope = "project" | "home" | "default";
export type AgentSyncStatus = "manual" | "synced" | "out_of_sync" | "missing_source";

export interface AgentAvatarConfig {
  body?: string;
  hair?: string;
  face?: string;
  shirt?: string;
  bottom?: string;
  /** Robot avatar fields */
  chassis?: string;
  eyes?: string;
  antenna?: string;
  wings?: string;
  accent?: string;
}

export interface AgentPresetRecord {
  id: string;
  projectId: string;
  name: string;
  instructionMarkdown: string;
  labels: string[];
  sourcePath: string | null;
  sourceScope: AgentSourceScope | null;
  sourceUpdatedAt: string | null;
  sourceImportedAt: string | null;
  sourceExists: boolean;
  syncStatus: AgentSyncStatus;
  avatarConfig?: AgentAvatarConfig;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentPresetInput {
  name: string;
  instructionMarkdown?: string;
  labels?: string[];
  avatarConfig?: AgentAvatarConfig;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
}

export interface UpdateAgentPresetInput {
  name?: string;
  instructionMarkdown?: string;
  labels?: string[];
  avatarConfig?: AgentAvatarConfig;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
}
