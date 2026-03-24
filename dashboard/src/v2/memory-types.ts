export type MemoryScope = "sprint" | "agent" | "project";

/** High-level memory tier — maps to scopes: short_term → "sprint", long_term → "project" */
export type MemoryTier = "short_term" | "long_term";

export type MemoryCategory =
  | "architecture"
  | "codebase"
  | "context"
  | "preferences"
  | "patterns"
  | "decision"
  | "error"
  | "learning";

export type EmbeddingModelId = "bge-small-en-v1.5" | "multilingual-e5-large";

export interface MemorySource {
  type: "auto_capture" | "manual" | "promotion";
  originType?: string;
  originId?: string;
  agent?: string;
}

export interface MemoryRecord {
  id: string;
  projectId: string;
  scope: MemoryScope;
  sprintId: string | null;
  agentPresetId: string | null;
  content: string;
  category: MemoryCategory;
  strength: number;
  source: MemorySource;
  embeddingModel: EmbeddingModelId | null;
  embeddingDimension: number | null;
  embeddingBlob: null; // Not sent to frontend
  promotedFromId: string | null;
  promotionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemorySearchResult {
  memory: MemoryRecord;
  similarity: number;
}

export interface PromotionCandidate {
  memory: MemoryRecord;
  score: number;
  reason: string;
  crossSprintCount: number;
}

export interface EmbeddingModelInfo {
  id: EmbeddingModelId;
  displayName: string;
  description: string;
  dimension: number;
  sizeBytes: number;
  language: string;
  files: string[];
}

export interface EmbeddingModelStatus {
  id: EmbeddingModelId;
  downloaded: boolean;
  downloading: boolean;
  downloadProgress: number;
  localPath: string | null;
  error: string | null;
}

export interface MemorySettings {
  enabled: boolean;
  embeddingModel: EmbeddingModelId | null;
  autoCaptureSprint: boolean;
  autoCaptureAgent: boolean;
  autoPromote: boolean;
  promotionThreshold: number;
  maxSprintMemories: number;
  maxProjectMemories: number;
  mapMaxEdgesPerNode: number;
}
