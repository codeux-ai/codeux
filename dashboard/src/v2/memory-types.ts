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

export interface AgentMemoryConfig {
  /** Which memory tier(s) to inject. Default: "both" */
  tier: "short_term" | "long_term" | "both";
  /** Categories to include. Empty array means all categories. Default: [] */
  categories: MemoryCategory[];
  /** Global minimum strength threshold (0 = no minimum). Default: 0 */
  minStrength: number;
  /** Per-category minimum strength overrides. Keys not present fall back to minStrength. Default: {} */
  minStrengthPerCategory: Partial<Record<MemoryCategory, number>>;
  /** Max short-term memories to inject (0 = unlimited). Default: 0 */
  maxShortTerm: number;
  /** Max long-term memories to inject (0 = unlimited). Default: 0 */
  maxLongTerm: number;
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

export const DEFAULT_AGENT_MEMORY_CONFIG: AgentMemoryConfig = {
  tier: "both",
  categories: [],
  minStrength: 0,
  minStrengthPerCategory: {},
  maxShortTerm: 0,
  maxLongTerm: 0,
};

export type EmbeddingModelId = string;

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

export interface MemoryClaimEvidenceLink {
  claimId: string;
  memoryId: string;
  supportType: MemoryClaimEvidenceSupport;
  weight: number;
  createdAt: string;
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
