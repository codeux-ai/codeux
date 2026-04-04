import type {
  MemoryRecord,
  MemoryScope,
  MemoryCategory,
  MemorySearchResult,
  PromotionCandidate,
  EmbeddingModelStatus,
  EmbeddingModelInfo,
} from "../memory-types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

const fetchVoid = async (path: string, init?: RequestInit): Promise<void> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage = typeof errorBody?.error === "string" ? errorBody.error : `Request failed: ${path}`;
    throw new Error(errorMessage);
  }
};

// --- Memory CRUD ---

export interface ListMemoriesParams {
  projectId: string;
  scope?: MemoryScope;
  sprintId?: string;
  agentPresetId?: string;
  limit?: number;
}

export const listMemories = async (params: ListMemoriesParams): Promise<MemoryRecord[]> => {
  const qs = new URLSearchParams();
  if (params.scope) qs.set("scope", params.scope);
  if (params.sprintId) qs.set("sprintId", params.sprintId);
  if (params.agentPresetId) qs.set("agentPresetId", params.agentPresetId);
  if (params.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return fetchJson(`/api/projects/${params.projectId}/memories${query ? `?${query}` : ""}`);
};

export interface CreateMemoryInput {
  scope: MemoryScope;
  content: string;
  category: MemoryCategory;
  sprintId?: string;
  agentPresetId?: string;
  strength?: number;
}

export const createMemory = async (projectId: string, input: CreateMemoryInput): Promise<MemoryRecord> => {
  return fetchJson(`/api/projects/${projectId}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export interface UpdateMemoryInput {
  content?: string;
  category?: MemoryCategory;
  strength?: number;
}

export const updateMemory = async (memoryId: string, input: UpdateMemoryInput): Promise<MemoryRecord> => {
  return fetchJson(`/api/memories/${memoryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const deleteMemory = async (memoryId: string): Promise<void> => {
  return fetchVoid(`/api/memories/${memoryId}`, { method: "DELETE" });
};

// --- Semantic search ---

export interface SearchMemoriesInput {
  query: string;
  scope?: MemoryScope;
  limit?: number;
  minSimilarity?: number;
}

export const searchMemories = async (projectId: string, input: SearchMemoriesInput): Promise<MemorySearchResult[]> => {
  return fetchJson(`/api/projects/${projectId}/memories/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

// --- Promotion ---

export const analyzeForPromotion = async (projectId: string, sprintId: string): Promise<PromotionCandidate[]> => {
  return fetchJson(`/api/projects/${projectId}/memories/promotion/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sprintId }),
  });
};

export const executePromotion = async (projectId: string, memoryIds: string[], reason?: string): Promise<MemoryRecord[]> => {
  return fetchJson(`/api/projects/${projectId}/memories/promotion/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memoryIds, reason }),
  });
};

// --- Embedding models ---

export type EmbeddingModelWithStatus = EmbeddingModelInfo & EmbeddingModelStatus & { active: boolean };

export const listEmbeddingModels = async (): Promise<EmbeddingModelWithStatus[]> => {
  return fetchJson("/api/embedding-models");
};

export const downloadEmbeddingModel = async (modelId: string): Promise<{ status: string; modelId: string }> => {
  return fetchJson(`/api/embedding-models/${modelId}/download`, { method: "POST" });
};

export const cancelModelDownload = async (modelId: string): Promise<{ status: string; modelId: string }> => {
  return fetchJson(`/api/embedding-models/${modelId}/cancel`, { method: "POST" });
};

export const selectEmbeddingModel = async (modelId: string): Promise<{ status: string; modelId: string }> => {
  return fetchJson(`/api/embedding-models/${modelId}/select`, { method: "POST" });
};

export const deleteEmbeddingModel = async (modelId: string): Promise<void> => {
  return fetchVoid(`/api/embedding-models/${modelId}`, { method: "DELETE" });
};

export const getModelStatus = async (modelId: string): Promise<EmbeddingModelStatus & { active: boolean }> => {
  return fetchJson(`/api/embedding-models/${modelId}/status`);
};

// --- Re-embed ---

export const startReembed = async (projectId: string): Promise<{ status: string }> => {
  return fetchJson(`/api/projects/${projectId}/memories/reembed`, { method: "POST" });
};

export interface ReembedProgress {
  active: boolean;
  completed: number;
  total: number;
  projectId?: string;
}

export const getReembedProgress = async (projectId: string): Promise<ReembedProgress> => {
  return fetchJson(`/api/projects/${projectId}/memories/reembed/progress`);
};

// --- Embedding map ---

export interface EmbeddingMapNode {
  id: string;
  x: number;
  y: number;
}

export interface EmbeddingMapEdge {
  source: string;
  target: string;
  similarity: number;
}

export interface EmbeddingMapResult {
  nodes: EmbeddingMapNode[];
  edges: EmbeddingMapEdge[];
  hasEmbeddings: boolean;
}

export const getEmbeddingMap = async (projectId: string, scope?: string, sprintId?: string, agentPresetId?: string): Promise<EmbeddingMapResult> => {
  const qs = new URLSearchParams();
  if (scope) qs.set("scope", scope);
  if (sprintId) qs.set("sprintId", sprintId);
  if (agentPresetId) qs.set("agentPresetId", agentPresetId);
  const query = qs.toString();
  return fetchJson(`/api/projects/${projectId}/memories/embedding-map${query ? `?${query}` : ""}`);
};

// --- Stats ---

export interface MemoryStats {
  sprint: number;
  agent: number;
  project: number;
  activeModel: string | null;
  staleEmbeddings: number;
}

export const getMemoryStats = async (projectId: string): Promise<MemoryStats> => {
  return fetchJson(`/api/projects/${projectId}/memories/stats`);
};
