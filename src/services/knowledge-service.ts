import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import type { Logger } from "../shared/logging/logger.js";
import { KnowledgeRepository } from "../repositories/knowledge-repository.js";
import { KnowledgeIngestionService } from "./knowledge-ingestion-service.js";
import { EmbeddingService } from "./embedding-service.js";
import { cosineSimilarity, bufferToFloat32, float32ToBuffer, estimateTokens } from "./embedding-vector-utils.js";
import type {
  KnowledgeDocumentRecord,
  KnowledgeDocumentSummary,
  KnowledgeDocumentListItem,
  KnowledgeSearchResult,
  KnowledgeManifestEntry,
  KnowledgeSourceType,
} from "../contracts/knowledge-types.js";
import type { EmbeddingModelId } from "../contracts/memory-types.js";

export interface IngestDocumentRequest {
  title: string;
  sourceType: KnowledgeSourceType;
  sourceRef?: string | null;
  mimeType?: string | null;
  /** Raw text (for pasted notes / already-decoded content). */
  text?: string;
  /** Raw bytes (for uploads / repo files); decoded by the ingestion service. */
  buffer?: Buffer;
  fileName?: string;
}

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_MIN_SIMILARITY = 0.2;
export const CODE_UX_INTERNAL_DOCS_SOURCE_REF = "codeux/internaldocs";
export const CODE_UX_INTERNAL_DOCS_TITLE = "codeux/internaldocs";

interface PrecomputedKnowledgeEmbeddingFile {
  kind: "codeux.knowledge.embeddings";
  version: 1;
  sourceRef: string;
  modelId: EmbeddingModelId;
  dimension: number;
  contentHash: string;
  chunks: Array<{
    chunkIndex: number;
    content: string;
    tokenCount: number;
    heading: string | null;
    embedding: number[];
  }>;
}

/**
 * Orchestrates the agent knowledge base: ingest documents into the project library, embed their
 * chunks with the active ONNX model, search the chunks subscribed by a given agent, and build the
 * compact manifest injected into agent prompts. Mirrors `MemoryService` patterns.
 */
export class KnowledgeService {
  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly ingestion: KnowledgeIngestionService,
    private readonly embeddingService: EmbeddingService,
    private readonly logger: Logger,
  ) {}

  // --- Library ---

  listDocuments(projectId: string): KnowledgeDocumentListItem[] {
    return this.repository.listDocuments(projectId).map((doc) => ({
      ...doc,
      subscriberAgentIds: this.repository.listAgentIdsForDocument(doc.id),
    }));
  }

  getDocument(documentId: string): KnowledgeDocumentRecord | null {
    return this.repository.getDocument(documentId);
  }

  getDocumentForProject(projectId: string, documentId: string): KnowledgeDocumentRecord | null {
    return this.repository.getDocumentForProject(projectId, documentId);
  }

  deleteDocument(documentId: string): void {
    this.repository.deleteDocument(documentId);
  }

  deleteDocumentForProject(projectId: string, documentId: string): boolean {
    return this.repository.deleteDocumentForProject(projectId, documentId);
  }

  isModelLoaded(): boolean {
    return this.embeddingService.isLoaded();
  }

  /**
   * Ingest a document into the project library and embed it asynchronously.
   * Deduplicates by content hash: an identical document already in the library is reused.
   */
  async ingestDocument(projectId: string, req: IngestDocumentRequest): Promise<KnowledgeDocumentSummary> {
    let text: string;
    let mimeType: string | null;

    if (req.buffer && req.buffer.byteLength > 0) {
      const extracted = await this.ingestion.extractText({
        fileName: req.fileName || req.sourceRef || req.title,
        mimeType: req.mimeType,
        buffer: req.buffer,
      });
      text = extracted.text;
      mimeType = extracted.mimeType;
    } else {
      text = (req.text ?? "").replace(/\r\n/g, "\n").trim();
      mimeType = req.mimeType ?? "text/plain";
      if (!text) {
        throw new Error("Document is empty — provide text or a file to ingest.");
      }
    }

    const contentHash = createHash("sha256").update(text).digest("hex");
    const existing = this.repository.findByContentHash(projectId, contentHash);
    if (existing) {
      return this.toSummary(existing);
    }

    const doc = this.repository.createDocument(
      projectId,
      {
        title: req.title,
        sourceType: req.sourceType,
        sourceRef: req.sourceRef ?? req.fileName ?? null,
        mimeType,
        contentText: text,
        byteSize: req.buffer?.byteLength,
      },
      contentHash,
      estimateTokens(text),
    );

    this.repository.updateDocumentStatus(doc.id, { summary: this.ingestion.summarize(text, doc.title) });

    // Embed asynchronously; status polling on the dashboard surfaces progress.
    this.embedDocument(doc.id).catch((error) => {
      this.logger.warn(`Failed to embed knowledge document ${doc.id}: ${error instanceof Error ? error.message : String(error)}`);
    });

    const refreshed = this.repository.getDocument(doc.id);
    return this.toSummary(refreshed ?? doc);
  }

  async ensureCodeUxInternalDocsDocument(projectId: string, projectRoot: string): Promise<KnowledgeDocumentSummary | null> {
    const docsDir = path.join(projectRoot, "docs");
    const text = await this.buildInternalDocsText(docsDir);
    if (!text.trim()) {
      return null;
    }

    const contentHash = createHash("sha256").update(text).digest("hex");
    const existingBySource = this.repository.findBySourceRef(projectId, "repo_path", CODE_UX_INTERNAL_DOCS_SOURCE_REF);
    if (existingBySource?.contentHash === contentHash) {
      return this.toSummary(existingBySource);
    }
    if (existingBySource) {
      this.repository.deleteDocument(existingBySource.id);
    }

    const existingByHash = this.repository.findByContentHash(projectId, contentHash);
    if (existingByHash) {
      return this.toSummary(existingByHash);
    }

    const doc = this.repository.createDocument(
      projectId,
      {
        title: CODE_UX_INTERNAL_DOCS_TITLE,
        sourceType: "repo_path",
        sourceRef: CODE_UX_INTERNAL_DOCS_SOURCE_REF,
        mimeType: "text/markdown",
        contentText: text,
        byteSize: Buffer.byteLength(text, "utf8"),
      },
      contentHash,
      estimateTokens(text),
    );

    this.repository.updateDocumentStatus(doc.id, { summary: this.ingestion.summarize(text, doc.title) });

    const embeddedFromBundle = await this.tryApplyPrecomputedEmbeddings(doc.id, doc.projectId, contentHash, projectRoot);
    if (!embeddedFromBundle) {
      this.embedDocument(doc.id).catch((error) => {
        this.logger.warn(`Failed to embed Code UX internal docs ${doc.id}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    const refreshed = this.repository.getDocument(doc.id);
    return this.toSummary(refreshed ?? doc);
  }

  async importDocumentsFromProject(
    targetProjectId: string,
    sourceProjectId: string,
    documentIds?: string[],
  ): Promise<{ documents: KnowledgeDocumentSummary[]; errors: Array<{ fileName: string; error: string }> }> {
    if (targetProjectId === sourceProjectId) {
      throw new Error("Choose a different source project.");
    }

    const requestedIds = Array.isArray(documentIds) && documentIds.length > 0
      ? new Set(documentIds)
      : null;
    const sourceDocs = this.repository.listDocuments(sourceProjectId);
    const selectedSourceDocs = requestedIds
      ? sourceDocs.filter((doc) => requestedIds.has(doc.id))
      : sourceDocs;

    const documents: KnowledgeDocumentSummary[] = [];
    const errors: Array<{ fileName: string; error: string }> = [];

    if (requestedIds) {
      const sourceIds = new Set(sourceDocs.map((doc) => doc.id));
      for (const documentId of requestedIds) {
        if (!sourceIds.has(documentId)) {
          errors.push({ fileName: documentId, error: "Document not found in source project" });
        }
      }
    }

    for (const sourceDoc of selectedSourceDocs) {
      const full = this.repository.getDocumentForProject(sourceProjectId, sourceDoc.id);
      if (!full) {
        continue;
      }
      try {
        const copied = await this.ingestDocument(targetProjectId, {
          title: full.title,
          sourceType: "project",
          sourceRef: `project:${sourceProjectId}/${full.sourceRef || full.title}`,
          mimeType: full.mimeType,
          text: full.contentText,
        });
        documents.push(copied);
      } catch (error) {
        errors.push({ fileName: full.title, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return { documents, errors };
  }

  /** Chunk + embed a document's text with the active model. Updates status to ready/error. */
  async embedDocument(documentId: string): Promise<void> {
    const doc = this.repository.getDocument(documentId);
    if (!doc) return;

    const modelId = this.embeddingService.getLoadedModelId();
    const dimension = this.embeddingService.getDimension();
    if (!modelId || !dimension) {
      this.repository.updateDocumentStatus(documentId, {
        status: "error",
        errorMessage: "No embedding model is loaded. Download and select one under Settings → Memory.",
      });
      return;
    }

    this.repository.updateDocumentStatus(documentId, { status: "embedding", errorMessage: null });

    try {
      const chunks = this.ingestion.chunkText(doc.contentText);
      const embedded = [] as Array<Parameters<KnowledgeRepository["replaceChunks"]>[2][number]>;
      for (const chunk of chunks) {
        const vector = await this.embeddingService.embed(chunk.content);
        embedded.push({
          ...chunk,
          embeddingModel: modelId,
          embeddingDimension: dimension,
          embeddingBlob: float32ToBuffer(vector),
        });
      }
      this.repository.replaceChunks(documentId, doc.projectId, embedded);
      this.repository.updateDocumentStatus(documentId, {
        status: "ready",
        embeddingModel: modelId,
        chunkCount: embedded.length,
        errorMessage: null,
      });
    } catch (error) {
      this.repository.updateDocumentStatus(documentId, {
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async reembedDocument(documentId: string): Promise<void> {
    await this.embedDocument(documentId);
  }

  async reembedDocumentForProject(projectId: string, documentId: string): Promise<KnowledgeDocumentRecord | null> {
    const doc = this.repository.getDocumentForProject(projectId, documentId);
    if (!doc) return null;
    await this.embedDocument(doc.id);
    return this.repository.getDocumentForProject(projectId, documentId);
  }

  // --- Search ---

  /** Semantic search over a specific set of documents (e.g. an agent's subscriptions). */
  async search(
    documentIds: string[],
    query: string,
    limit = DEFAULT_SEARCH_LIMIT,
    minSimilarity = DEFAULT_MIN_SIMILARITY,
  ): Promise<KnowledgeSearchResult[]> {
    const modelId = this.embeddingService.getLoadedModelId();
    if (!modelId || documentIds.length === 0 || !query.trim()) {
      return [];
    }

    const queryVector = await this.embeddingService.embed(query);
    const candidates = this.repository.loadChunkEmbeddingsForDocuments(documentIds, modelId);

    const scored = candidates
      .map((candidate) => ({
        candidate,
        similarity: cosineSimilarity(queryVector, bufferToFloat32(candidate.embeddingBlob, candidate.embeddingDimension)),
      }))
      .filter((entry) => entry.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    const titles = new Map<string, string>();
    for (const { candidate } of scored) {
      if (!titles.has(candidate.documentId)) {
        titles.set(candidate.documentId, this.repository.getDocument(candidate.documentId)?.title ?? "Document");
      }
    }

    return scored.map(({ candidate, similarity }) => ({
      documentId: candidate.documentId,
      documentTitle: titles.get(candidate.documentId) ?? "Document",
      chunkIndex: candidate.chunkIndex,
      heading: candidate.heading,
      content: candidate.content,
      similarity,
    }));
  }

  async searchForAgent(agentPresetId: string, query: string, limit = DEFAULT_SEARCH_LIMIT): Promise<KnowledgeSearchResult[]> {
    const documentIds = this.repository.listDocumentIdsForAgent(agentPresetId);
    return this.search(documentIds, query, limit);
  }

  // --- Manifest + subscriptions ---

  /** Compact list of an agent's ready, embedded documents for the always-on prompt manifest. */
  buildManifestForAgent(agentPresetId: string): KnowledgeManifestEntry[] {
    const entries: KnowledgeManifestEntry[] = [];
    for (const documentId of this.repository.listDocumentIdsForAgent(agentPresetId)) {
      const doc = this.repository.getDocument(documentId);
      if (doc && doc.status === "ready" && doc.chunkCount > 0) {
        entries.push({
          documentId: doc.id,
          title: doc.title,
          summary: doc.summary,
          chunkCount: doc.chunkCount,
          tokenCount: doc.tokenCount,
        });
      }
    }
    return entries;
  }

  /** Renders the agent's manifest as a markdown block, or null when the agent has no knowledge. */
  buildManifestMarkdownForAgent(agentPresetId: string): string | null {
    const entries = this.buildManifestForAgent(agentPresetId);
    if (entries.length === 0) return null;
    const lines = entries.map((entry) => {
      const summary = entry.summary ? ` — ${entry.summary}` : "";
      return `- **${entry.title}**${summary}`;
    });
    return [
      "The following documents are attached to you as a knowledge base.",
      "Call the `search_knowledge` tool with a focused query to read the exact relevant passages before answering; cite the document you used. Do not guess at their contents.",
      "",
      ...lines,
    ].join("\n");
  }

  listSubscriptions(agentPresetId: string): string[] {
    return this.repository.listDocumentIdsForAgent(agentPresetId);
  }

  setSubscriptions(agentPresetId: string, projectId: string, documentIds: string[]): string[] {
    this.repository.setSubscriptions(agentPresetId, projectId, documentIds);
    return this.repository.listDocumentIdsForAgent(agentPresetId);
  }

  private toSummary(doc: KnowledgeDocumentRecord): KnowledgeDocumentSummary {
    const { contentText: _omit, ...summary } = doc;
    return summary;
  }

  private async buildInternalDocsText(docsDir: string): Promise<string> {
    const files = await this.collectMarkdownFiles(docsDir);
    const sections: string[] = [];
    for (const filePath of files) {
      const rel = path.relative(docsDir, filePath).split(path.sep).join("/");
      const content = await fs.readFile(filePath, "utf8");
      sections.push(`# ${rel}\n\n${content.trim()}`);
    }
    return sections.join("\n\n---\n\n").trim();
  }

  private async collectMarkdownFiles(root: string): Promise<string[]> {
    const collected: string[] = [];
    const walk = async (current: string): Promise<void> => {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          collected.push(entryPath);
        }
      }
    };
    await walk(root);
    return collected.sort((left, right) => left.localeCompare(right));
  }

  private async tryApplyPrecomputedEmbeddings(
    documentId: string,
    projectId: string,
    contentHash: string,
    projectRoot: string,
  ): Promise<boolean> {
    const modelId = this.embeddingService.getLoadedModelId();
    const dimension = this.embeddingService.getDimension();
    if (!modelId || !dimension) {
      return false;
    }

    const bundle = await this.loadPrecomputedEmbeddingBundle(projectRoot, modelId);
    if (
      !bundle ||
      bundle.sourceRef !== CODE_UX_INTERNAL_DOCS_SOURCE_REF ||
      bundle.modelId !== modelId ||
      bundle.dimension !== dimension ||
      bundle.contentHash !== contentHash
    ) {
      return false;
    }

    this.repository.replaceChunks(documentId, projectId, bundle.chunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      heading: chunk.heading,
      embeddingModel: modelId,
      embeddingDimension: dimension,
      embeddingBlob: float32ToBuffer(Float32Array.from(chunk.embedding)),
    })));
    this.repository.updateDocumentStatus(documentId, {
      status: "ready",
      embeddingModel: modelId,
      chunkCount: bundle.chunks.length,
      errorMessage: null,
    });
    return true;
  }

  private async loadPrecomputedEmbeddingBundle(
    projectRoot: string,
    modelId: EmbeddingModelId,
  ): Promise<PrecomputedKnowledgeEmbeddingFile | null> {
    const filePath = path.join(projectRoot, ".code-ux", "embeddings", `codeux-internaldocs.${modelId}.json`);
    const raw = await fs.readFile(filePath, "utf8").catch(() => null);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as PrecomputedKnowledgeEmbeddingFile;
      if (parsed.kind !== "codeux.knowledge.embeddings" || parsed.version !== 1 || !Array.isArray(parsed.chunks)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}
