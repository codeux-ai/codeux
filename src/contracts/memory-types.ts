/**
 * Types for the memory + local embedding system.
 *
 * Three memory scopes:
 * - sprint: short-term, auto-captured during sprint execution
 * - agent: per-agent learning, accumulated across sprints
 * - project: long-term curated knowledge, promoted from sprint memories
 */

export type MemoryScope = "sprint" | "agent" | "project";

export type MemoryCategory =
  | "architecture"
  | "codebase"
  | "context"
  | "preferences"
  | "patterns"
  | "decision"
  | "error"
  | "learning";

export const MEMORY_SCOPES: MemoryScope[] = ["sprint", "agent", "project"];

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  "architecture",
  "codebase",
  "context",
  "preferences",
  "patterns",
  "decision",
  "error",
  "learning",
];

export type EmbeddingModelId = "bge-small-en-v1.5" | "Qwen3-Embedding-0.6B";

export const EMBEDDING_MODEL_IDS: EmbeddingModelId[] = [
  "bge-small-en-v1.5",
  "Qwen3-Embedding-0.6B",
];

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
  embeddingBlob: Buffer | null;
  promotedFromId: string | null;
  promotionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryInput {
  scope: MemoryScope;
  sprintId?: string | null;
  agentPresetId?: string | null;
  content: string;
  category: MemoryCategory;
  strength?: number;
  source?: MemorySource;
}

export interface UpdateMemoryInput {
  content?: string;
  category?: MemoryCategory;
  strength?: number;
}

export interface MemorySearchQuery {
  projectId: string;
  query: string;
  scope?: MemoryScope;
  sprintId?: string;
  agentPresetId?: string;
  category?: MemoryCategory;
  limit?: number;
  minSimilarity?: number;
}

export interface MemorySearchResult {
  memory: MemoryRecord;
  similarity: number;
}

export interface EmbeddingRecord {
  id: string;
  embeddingBlob: Buffer;
  embeddingDimension: number;
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

export interface PromotionCandidate {
  memory: MemoryRecord;
  score: number;
  reason: string;
  crossSprintCount: number;
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
  workerLearningsInstruction: string;
}
