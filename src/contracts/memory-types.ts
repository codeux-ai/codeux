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

/**
 * Target tier for a bulk memory clear ("danger zone" reset):
 * - short_term → sprint + legacy agent scoped memories
 * - long_term  → project-scoped memories plus all memory claims + evidence
 * - all        → every memory, claim, and evidence row (the full memory database)
 */
export type MemoryClearTier = "short_term" | "long_term" | "all";

export const MEMORY_CLEAR_TIERS: MemoryClearTier[] = ["short_term", "long_term", "all"];

export function isMemoryClearTier(value: unknown): value is MemoryClearTier {
  return typeof value === "string" && (MEMORY_CLEAR_TIERS as string[]).includes(value);
}

/** Row counts removed by a bulk memory clear. */
export interface MemoryClearResult {
  memories: number;
  claims: number;
  evidence: number;
}

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

export const LEARNINGS_FILENAME = ".task-learnings.md";

export interface ParsedMemoryEntry {
  category: MemoryCategory;
  content: string;
}

export const EMBEDDING_MODEL_IDS = [
  "bge-small-en-v1.5",
  "bge-base-en-v1.5",
  "bge-large-en-v1.5",
  "all-minilm-l6-v2",
  "all-mpnet-base-v2",
  "multilingual-e5-large",
] as const;

export type InAppEmbeddingModelId = typeof EMBEDDING_MODEL_IDS[number];
export type EmbeddingModelId = InAppEmbeddingModelId | (string & {});

export function isInAppEmbeddingModelId(value: string): value is InAppEmbeddingModelId {
  return (EMBEDDING_MODEL_IDS as readonly string[]).includes(value);
}

export type EmbeddingProviderMode = "in_app" | "external_api";
export type MemoryRemediationMode = "off" | "deterministic" | "ai";

export interface ExternalEmbeddingSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number | null;
}

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

export type MemoryClaimStatus = "active" | "superseded" | "deprecated";
export type MemoryClaimSourceType = "promotion" | "manual" | "remediation";
export type MemoryClaimEvidenceSupport = "supports" | "contradicts" | "supersedes";

export interface MemoryClaimRecord {
  id: string;
  projectId: string;
  claim: string;
  fingerprint: string;
  category: MemoryCategory;
  confidence: number;
  durability: number;
  status: MemoryClaimStatus;
  tags: string[];
  appliesToPaths: string[];
  sourceType: MemoryClaimSourceType;
  sourceMemoryId: string | null;
  supersedesClaimId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryClaimInput {
  claim: string;
  category: MemoryCategory;
  confidence: number;
  durability: number;
  tags?: string[];
  appliesToPaths?: string[];
  sourceType?: MemoryClaimSourceType;
  sourceMemoryId?: string | null;
  supersedesClaimId?: string | null;
}

export interface UpdateMemoryClaimInput {
  claim?: string;
  category?: MemoryCategory;
  confidence?: number;
  durability?: number;
  status?: MemoryClaimStatus;
  tags?: string[];
  appliesToPaths?: string[];
  supersedesClaimId?: string | null;
}

export interface MemoryClaimEvidenceLink {
  claimId: string;
  memoryId: string;
  supportType: MemoryClaimEvidenceSupport;
  weight: number;
  createdAt: string;
}

export interface AddMemoryClaimEvidenceInput {
  claimId: string;
  memoryId: string;
  supportType?: MemoryClaimEvidenceSupport;
  weight?: number;
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

export interface MemoryClaimSearchResult {
  claim: MemoryClaimRecord;
  similarity: number;
  evidenceCount: number;
  supportingMemory: MemoryRecord;
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

export type MemoryPromotionRiskFlag =
  | "ci_failure"
  | "test_fixture"
  | "file_specific"
  | "task_local"
  | "implementation_trivia"
  | "speculative";

export interface PromotionCandidate {
  memory: MemoryRecord;
  clusterId: string;
  claim: string;
  evidenceMemoryIds: string[];
  riskFlags: MemoryPromotionRiskFlag[];
  score: number;
  reason: string;
  crossSprintCount: number;
}

export interface MemorySettings {
  enabled: boolean;
  embeddingProvider: EmbeddingProviderMode;
  embeddingModel: EmbeddingModelId | null;
  externalEmbedding: ExternalEmbeddingSettings;
  autoCaptureSprint: boolean;
  autoCaptureAgent: boolean;
  autoPromote: boolean;
  promotionThreshold: number;
  remediationMode: MemoryRemediationMode;
  remediationMaxPromotions: number;
  maxSprintMemories: number;
  maxProjectMemories: number;
  mapMaxEdgesPerNode: number;
  workerLearningsInstruction: string;
}
