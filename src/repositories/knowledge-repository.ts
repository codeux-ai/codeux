import { randomUUID } from "crypto";
import { createLogger, type Logger } from "../shared/logging/logger.js";
import { RepositoryError, requireRecord, executeChunkedInQuery } from "./repository-utils.js";
import { DatabaseAdapter } from "./db/database-adapter.js";
import { AppDbStorage } from "./app-db-storage.js";
import type {
  KnowledgeDocumentRecord,
  KnowledgeDocumentSummary,
  KnowledgeDocumentStatus,
  KnowledgeChunkEmbeddingRecord,
  KnowledgeChunkInput,
  KnowledgeSourceType,
  CreateKnowledgeDocumentInput,
} from "../contracts/knowledge-types.js";
import type { EmbeddingModelId } from "../contracts/memory-types.js";

interface DocumentRow {
  id: string;
  project_id: string;
  title: string;
  source_type: string;
  source_ref: string | null;
  mime_type: string | null;
  byte_size: number;
  char_count: number;
  token_count: number;
  summary: string;
  content_text: string;
  content_hash: string;
  status: string;
  embedding_model: string | null;
  chunk_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface ChunkEmbeddingRow {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  heading: string | null;
  embedding_blob: Buffer;
  embedding_dimension: number;
}

interface CountRow {
  count: number;
}

export class KnowledgeRepository {
  private readonly db: DatabaseAdapter;

  constructor(
    storage: AppDbStorage,
    private readonly logger: Logger = createLogger({ bindings: { component: "KnowledgeRepository" } }),
  ) {
    this.db = storage.getDatabase();
  }

  // --- Documents ---

  createDocument(projectId: string, input: CreateKnowledgeDocumentInput, contentHash: string, tokenCount: number): KnowledgeDocumentRecord {
    try {
      requireRecord(this.db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId), "Project", projectId);
      const now = new Date().toISOString();
      const text = input.contentText;
      const row: DocumentRow = {
        id: randomUUID(),
        project_id: projectId,
        title: input.title.trim() || "Untitled document",
        source_type: input.sourceType,
        source_ref: input.sourceRef ?? null,
        mime_type: input.mimeType ?? null,
        byte_size: input.byteSize ?? Buffer.byteLength(text, "utf8"),
        char_count: text.length,
        token_count: tokenCount,
        summary: "",
        content_text: text,
        content_hash: contentHash,
        status: "pending",
        embedding_model: null,
        chunk_count: 0,
        error_message: null,
        created_at: now,
        updated_at: now,
      };

      this.db.prepare(`
        INSERT INTO knowledge_documents (
          id, project_id, title, source_type, source_ref, mime_type,
          byte_size, char_count, token_count, summary, content_text, content_hash,
          status, embedding_model, chunk_count, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id, row.project_id, row.title, row.source_type, row.source_ref, row.mime_type,
        row.byte_size, row.char_count, row.token_count, row.summary, row.content_text, row.content_hash,
        row.status, row.embedding_model, row.chunk_count, row.error_message, row.created_at, row.updated_at,
      );

      return this.mapDocument(row);
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  getDocument(documentId: string): KnowledgeDocumentRecord | null {
    const row = this.db.prepare("SELECT * FROM knowledge_documents WHERE id = ?").get(documentId) as DocumentRow | undefined;
    return row ? this.mapDocument(row) : null;
  }

  findByContentHash(projectId: string, contentHash: string): KnowledgeDocumentRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM knowledge_documents WHERE project_id = ? AND content_hash = ? LIMIT 1",
    ).get(projectId, contentHash) as DocumentRow | undefined;
    return row ? this.mapDocument(row) : null;
  }

  listDocuments(projectId: string): KnowledgeDocumentSummary[] {
    const rows = this.db.prepare(
      "SELECT * FROM knowledge_documents WHERE project_id = ? ORDER BY updated_at DESC",
    ).all(projectId) as unknown as DocumentRow[];
    return rows.map((row) => this.mapDocumentSummary(row));
  }

  updateDocumentStatus(documentId: string, update: {
    status?: KnowledgeDocumentStatus;
    summary?: string;
    embeddingModel?: EmbeddingModelId | null;
    chunkCount?: number;
    errorMessage?: string | null;
  }): void {
    const current = requireRecord(this.getDocument(documentId), "Knowledge document", documentId);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE knowledge_documents
      SET status = ?, summary = ?, embedding_model = ?, chunk_count = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(
      update.status ?? current.status,
      update.summary ?? current.summary,
      update.embeddingModel === undefined ? current.embeddingModel : update.embeddingModel,
      update.chunkCount ?? current.chunkCount,
      update.errorMessage === undefined ? current.errorMessage : update.errorMessage,
      now,
      documentId,
    );
  }

  deleteDocument(documentId: string): void {
    try {
      // chunks + subscriptions cascade via FK
      this.db.prepare("DELETE FROM knowledge_documents WHERE id = ?").run(documentId);
    } catch (error) {
      this.logger.error("Operation failed", { error, documentId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  // --- Chunks ---

  replaceChunks(
    documentId: string,
    projectId: string,
    chunks: Array<KnowledgeChunkInput & { embeddingModel: EmbeddingModelId; embeddingDimension: number; embeddingBlob: Buffer }>,
  ): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM knowledge_chunks WHERE document_id = ?").run(documentId);
      const now = new Date().toISOString();
      const stmt = this.db.prepare(`
        INSERT INTO knowledge_chunks (
          id, document_id, project_id, chunk_index, content, token_count, heading,
          embedding_model, embedding_dimension, embedding_blob, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const chunk of chunks) {
        stmt.run(
          randomUUID(), documentId, projectId, chunk.chunkIndex, chunk.content, chunk.tokenCount, chunk.heading,
          chunk.embeddingModel, chunk.embeddingDimension, chunk.embeddingBlob, now,
        );
      }
    });
  }

  loadChunkEmbeddingsForDocuments(
    documentIds: string[],
    model: EmbeddingModelId,
  ): KnowledgeChunkEmbeddingRecord[] {
    if (documentIds.length === 0) return [];
    const rows = executeChunkedInQuery<ChunkEmbeddingRow>(
      (sql) => this.db.prepare(sql),
      {
        sqlPrefix: "SELECT id, document_id, chunk_index, content, heading, embedding_blob, embedding_dimension FROM knowledge_chunks WHERE embedding_blob IS NOT NULL AND embedding_model = ? AND document_id",
        bindParamsBefore: [model],
        items: documentIds,
      },
    );
    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      heading: row.heading,
      embeddingBlob: row.embedding_blob,
      embeddingDimension: row.embedding_dimension,
    }));
  }

  countChunks(documentId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM knowledge_chunks WHERE document_id = ?").get(documentId) as CountRow | undefined;
    return row?.count ?? 0;
  }

  // --- Subscriptions ---

  listDocumentIdsForAgent(agentPresetId: string): string[] {
    const rows = this.db.prepare(
      "SELECT document_id FROM agent_knowledge_subscriptions WHERE agent_preset_id = ?",
    ).all(agentPresetId) as unknown as Array<{ document_id: string }>;
    return rows.map((row) => row.document_id);
  }

  listAgentIdsForDocument(documentId: string): string[] {
    const rows = this.db.prepare(
      "SELECT agent_preset_id FROM agent_knowledge_subscriptions WHERE document_id = ?",
    ).all(documentId) as unknown as Array<{ agent_preset_id: string }>;
    return rows.map((row) => row.agent_preset_id);
  }

  /** Replace an agent's full subscription set with the given document ids (validated to the project). */
  setSubscriptions(agentPresetId: string, projectId: string, documentIds: string[]): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM agent_knowledge_subscriptions WHERE agent_preset_id = ?").run(agentPresetId);
      const now = new Date().toISOString();
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO agent_knowledge_subscriptions (agent_preset_id, document_id, project_id, created_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const documentId of [...new Set(documentIds)]) {
        const doc = this.db.prepare("SELECT id FROM knowledge_documents WHERE id = ? AND project_id = ?").get(documentId, projectId);
        if (doc) {
          stmt.run(agentPresetId, documentId, projectId, now);
        }
      }
    });
  }

  // --- Mapping ---

  private mapDocument(row: DocumentRow): KnowledgeDocumentRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      sourceType: row.source_type as KnowledgeSourceType,
      sourceRef: row.source_ref,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      charCount: row.char_count,
      tokenCount: row.token_count,
      summary: row.summary,
      contentText: row.content_text,
      contentHash: row.content_hash,
      status: row.status as KnowledgeDocumentStatus,
      embeddingModel: row.embedding_model as EmbeddingModelId | null,
      chunkCount: row.chunk_count,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapDocumentSummary(row: DocumentRow): KnowledgeDocumentSummary {
    const { contentText: _omit, ...summary } = this.mapDocument(row);
    return summary;
  }
}
