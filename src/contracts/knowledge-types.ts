/**
 * Types for the agent knowledge-base system.
 *
 * A project owns a shared **document library**. Each document is extracted to plain text once,
 * split into chunks, and each chunk is embedded with the active local ONNX model (the same stack
 * the memory system uses). Agents **subscribe** to the documents they should be grounded in.
 *
 * Retrieval is hybrid:
 * - a tiny always-injected manifest (subscribed doc titles + 1-line summaries), and
 * - an on-demand `search_knowledge` MCP tool that returns only the top-K relevant chunks.
 */

import type { EmbeddingModelId } from "./memory-types.js";

export type KnowledgeSourceType = "upload" | "repo_path" | "paste";

export type KnowledgeDocumentStatus = "pending" | "embedding" | "ready" | "error";

export interface KnowledgeDocumentRecord {
  id: string;
  projectId: string;
  title: string;
  sourceType: KnowledgeSourceType;
  /** Original filename or repo-relative path; null for free-form pasted notes. */
  sourceRef: string | null;
  mimeType: string | null;
  byteSize: number;
  charCount: number;
  tokenCount: number;
  /** One-line heuristic summary used in the agent manifest. */
  summary: string;
  /** Extracted plain text — retained so the document can be re-chunked / re-embedded. */
  contentText: string;
  /** Stable hash of the extracted text, used to dedupe identical documents. */
  contentHash: string;
  status: KnowledgeDocumentStatus;
  embeddingModel: EmbeddingModelId | null;
  chunkCount: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Library document without the heavy `contentText` field — used for list responses. */
export type KnowledgeDocumentSummary = Omit<KnowledgeDocumentRecord, "contentText">;

/** Library document plus the ids of the agents subscribed to it. */
export type KnowledgeDocumentListItem = KnowledgeDocumentSummary & {
  subscriberAgentIds: string[];
};

export interface KnowledgeChunkRecord {
  id: string;
  documentId: string;
  projectId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  /** Nearest preceding markdown heading, when one was found. */
  heading: string | null;
  embeddingModel: EmbeddingModelId | null;
  embeddingDimension: number | null;
  embeddingBlob: Buffer | null;
  createdAt: string;
}

export interface KnowledgeChunkEmbeddingRecord {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  heading: string | null;
  embeddingBlob: Buffer | Uint8Array;
  embeddingDimension: number;
}

export interface CreateKnowledgeDocumentInput {
  title: string;
  sourceType: KnowledgeSourceType;
  sourceRef?: string | null;
  mimeType?: string | null;
  /** Raw extracted/typed text. For uploads this is produced by the ingestion service. */
  contentText: string;
  byteSize?: number;
}

/** A single chunk produced by the ingestion splitter, before embedding. */
export interface KnowledgeChunkInput {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  heading: string | null;
}

export interface KnowledgeSearchQuery {
  projectId: string;
  /** Restrict candidate chunks to these document ids (e.g. an agent's subscriptions). */
  documentIds: string[];
  query: string;
  limit?: number;
  minSimilarity?: number;
}

export interface KnowledgeSearchResult {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  heading: string | null;
  content: string;
  similarity: number;
}

export interface KnowledgeManifestEntry {
  documentId: string;
  title: string;
  summary: string;
  chunkCount: number;
  tokenCount: number;
}
