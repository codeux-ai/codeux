export type SkillStorageKind = "project" | "shared";
export type SkillSourceType = "manual" | "imported" | "generated";

export interface SkillStorageRecord {
  id: string;
  projectId: string;
  name: string;
  description: string;
  storageKind: SkillStorageKind;
  createdAt: string;
  updatedAt: string;
}

export interface SkillRecord {
  id: string;
  projectId: string;
  storageId: string;
  name: string;
  description: string;
  contentMarkdown: string;
  sourceType: SkillSourceType;
  sourceRef: string | null;
  contentHash: string;
  tags: string[];
  appliesTo: string[];
  version: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillEmbeddingMetadata {
  id: string;
  projectId: string;
  storageId: string;
  skillId: string;
  embeddingModel: string;
  embeddingDimension: number;
  chunkIndex: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillEmbeddingRecord extends SkillEmbeddingMetadata {
  embeddingBlob: Buffer;
}

export interface AgentSkillStorageAttachment {
  agentPresetId: string;
  storageId: string;
  projectId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillStorageInput {
  id?: string;
  name: string;
  description?: string;
  storageKind?: SkillStorageKind;
}

export interface UpdateSkillStorageInput {
  name?: string;
  description?: string;
  storageKind?: SkillStorageKind;
}

export interface CreateSkillInput {
  id?: string;
  name: string;
  description?: string;
  contentMarkdown: string;
  sourceType?: SkillSourceType;
  sourceRef?: string | null;
  tags?: string[];
  appliesTo?: string[];
  version?: string | null;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  contentMarkdown?: string;
  sourceType?: SkillSourceType;
  sourceRef?: string | null;
  tags?: string[];
  appliesTo?: string[];
  version?: string | null;
}

export interface ParsedSkillMarkdown {
  title: string;
  description: string;
  tags: string[];
  appliesTo: string[];
  version: string | null;
  bodyMarkdown: string;
}

export interface SkillSearchQuery {
  projectId: string;
  query: string;
  storageId?: string;
  agentPresetId?: string;
  limit?: number;
  minSimilarity?: number;
}

export interface SkillSearchResult {
  skill: SkillRecord;
  similarity: number;
}
