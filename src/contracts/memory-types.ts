/**
 * Types for the memory + local embedding system.
 *
 * Two memory tiers:
 * - Short Term (scope: "sprint"): per-sprint, per-agent — each agent has isolated memories
 *   within a sprint. Sprint 46's memories don't leak into Sprint 47.
 * - Long Term (scope: "project"): per-project, per-agent — promoted from short-term when
 *   sprints complete. Each agent accumulates its own persistent knowledge across sprints.
 *
 * Legacy scope "agent" is deprecated — use "sprint" with agentPresetId for short-term,
 * "project" with agentPresetId for long-term.
 */

/** @see MemoryTier for the two-tier model */
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

export const MEMORY_SCOPES: MemoryScope[] = ["sprint", "agent", "project"];

/** Maps a tier to its underlying scope. */
export function scopeForTier(tier: MemoryTier): MemoryScope {
  return tier === "short_term" ? "sprint" : "project";
}

/** Maps a scope to its tier (agent scope is legacy short-term). */
export function tierForScope(scope: MemoryScope): MemoryTier {
  return scope === "project" ? "long_term" : "short_term";
}

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

export type EmbeddingModelId = "bge-small-en-v1.5" | "multilingual-e5-large";

export const EMBEDDING_MODEL_IDS: EmbeddingModelId[] = [
  "bge-small-en-v1.5",
  "multilingual-e5-large",
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
  embeddingBlob: Buffer | Uint8Array;
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
  mapMaxEdgesPerNode: number;
  workerLearningsInstruction: string;
}
