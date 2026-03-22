import { randomUUID } from "crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppDbStorage } from "./app-db-storage.js";
import type {
  MemoryRecord,
  MemoryScope,
  MemoryCategory,
  MemorySource,
  CreateMemoryInput,
  UpdateMemoryInput,
  EmbeddingRecord,
  EmbeddingModelId,
  EmbeddingModelStatus,
} from "../contracts/memory-types.js";

interface MemoryRow {
  id: string;
  project_id: string;
  scope: string;
  sprint_id: string | null;
  agent_preset_id: string | null;
  content: string;
  category: string;
  strength: number;
  source_json: string;
  embedding_model: string | null;
  embedding_dimension: number | null;
  embedding_blob: Buffer | null;
  promoted_from_id: string | null;
  promotion_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface EmbeddingRow {
  id: string;
  embedding_blob: Buffer;
  embedding_dimension: number;
}

interface EmbeddingModelRow {
  id: string;
  status: string;
  download_progress: number;
  local_path: string | null;
  error_message: string | null;
  updated_at: string;
}

interface CountRow {
  count: number;
}

export class MemoryRepository {
  private readonly db: DatabaseSync;

  constructor(storage: AppDbStorage) {
    this.db = storage.getDatabase();
  }

  createMemory(projectId: string, input: CreateMemoryInput): MemoryRecord {
    this.requireProject(projectId);
    const now = new Date().toISOString();
    const id = randomUUID();
    const source: MemorySource = input.source ?? { type: "manual" };

    this.db.prepare(`
      INSERT INTO memories (
        id, project_id, scope, sprint_id, agent_preset_id,
        content, category, strength, source_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      input.scope,
      input.sprintId ?? null,
      input.agentPresetId ?? null,
      input.content.trim(),
      input.category,
      input.strength ?? 0.5,
      JSON.stringify(source),
      now,
      now,
    );

    return this.requireMemory(id);
  }

  getMemory(memoryId: string): MemoryRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM memories WHERE id = ?
    `).get(memoryId) as MemoryRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  updateMemory(memoryId: string, input: UpdateMemoryInput): MemoryRecord {
    const current = this.requireMemory(memoryId);
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE memories
      SET content = ?, category = ?, strength = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.content?.trim() ?? current.content,
      input.category ?? current.category,
      input.strength ?? current.strength,
      now,
      memoryId,
    );

    return this.requireMemory(memoryId);
  }

  deleteMemory(memoryId: string): void {
    this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(memoryId);
  }

  listByProject(projectId: string, scope?: MemoryScope, limit = 100): MemoryRecord[] {
    if (scope) {
      const rows = this.db.prepare(`
        SELECT * FROM memories
        WHERE project_id = ? AND scope = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(projectId, scope, limit) as unknown as MemoryRow[];
      return rows.map((row) => this.mapRow(row));
    }

    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE project_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(projectId, limit) as unknown as MemoryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  listBySprint(projectId: string, sprintId: string, limit = 200): MemoryRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE project_id = ? AND sprint_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(projectId, sprintId, limit) as unknown as MemoryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  listByAgent(projectId: string, agentPresetId: string, limit = 100): MemoryRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE project_id = ? AND agent_preset_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(projectId, agentPresetId, limit) as unknown as MemoryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  saveEmbedding(memoryId: string, model: EmbeddingModelId, dimension: number, blob: Buffer): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE memories
      SET embedding_model = ?, embedding_dimension = ?, embedding_blob = ?, updated_at = ?
      WHERE id = ?
    `).run(model, dimension, blob, now, memoryId);
  }

  clearEmbeddingsForModel(projectId: string, model: EmbeddingModelId): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE memories
      SET embedding_model = NULL, embedding_dimension = NULL, embedding_blob = NULL, updated_at = ?
      WHERE project_id = ? AND embedding_model = ?
    `).run(now, projectId, model);
  }

  loadEmbeddingsForScope(
    projectId: string,
    model: EmbeddingModelId,
    scope?: MemoryScope,
    sprintId?: string,
    agentPresetId?: string,
  ): EmbeddingRecord[] {
    let sql = `
      SELECT id, embedding_blob, embedding_dimension
      FROM memories
      WHERE project_id = ? AND embedding_model = ? AND embedding_blob IS NOT NULL
    `;
    const params: string[] = [projectId, model];

    if (scope) {
      sql += " AND scope = ?";
      params.push(scope);
    }
    if (sprintId) {
      sql += " AND sprint_id = ?";
      params.push(sprintId);
    }
    if (agentPresetId) {
      sql += " AND agent_preset_id = ?";
      params.push(agentPresetId);
    }

    const rows = this.db.prepare(sql).all(...params) as unknown as EmbeddingRow[];
    return rows.map((row) => ({
      id: row.id,
      embeddingBlob: row.embedding_blob,
      embeddingDimension: row.embedding_dimension,
    }));
  }

  countByScope(projectId: string, scope: MemoryScope): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM memories
      WHERE project_id = ? AND scope = ?
    `).get(projectId, scope) as CountRow | undefined;
    return row?.count ?? 0;
  }

  deleteSprintMemories(projectId: string, sprintId: string): void {
    this.db.prepare(`
      DELETE FROM memories
      WHERE project_id = ? AND sprint_id = ? AND scope = 'sprint'
    `).run(projectId, sprintId);
  }

  createPromotedMemory(
    projectId: string,
    sourceMemory: MemoryRecord,
    reason: string,
  ): MemoryRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    const source: MemorySource = { type: "promotion", originType: "memory", originId: sourceMemory.id };

    this.db.prepare(`
      INSERT INTO memories (
        id, project_id, scope, sprint_id, agent_preset_id,
        content, category, strength, source_json,
        promoted_from_id, promotion_reason,
        created_at, updated_at
      ) VALUES (?, ?, 'project', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      sourceMemory.agentPresetId,
      sourceMemory.content,
      sourceMemory.category,
      Math.min(1, sourceMemory.strength + 0.1),
      JSON.stringify(source),
      sourceMemory.id,
      reason,
      now,
      now,
    );

    return this.requireMemory(id);
  }

  // --- Embedding model status ---

  getModelStatus(modelId: EmbeddingModelId): EmbeddingModelStatus | null {
    const row = this.db.prepare(`
      SELECT * FROM embedding_models WHERE id = ?
    `).get(modelId) as EmbeddingModelRow | undefined;

    return row ? this.mapModelRow(row) : null;
  }

  upsertModelStatus(
    modelId: EmbeddingModelId,
    update: Partial<Pick<EmbeddingModelStatus, "downloaded" | "downloading" | "downloadProgress" | "localPath" | "error">>,
  ): void {
    const now = new Date().toISOString();
    const existing = this.getModelStatus(modelId);

    if (!existing) {
      this.db.prepare(`
        INSERT INTO embedding_models (id, status, download_progress, local_path, error_message, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        modelId,
        update.downloaded ? "downloaded" : update.downloading ? "downloading" : "not_downloaded",
        update.downloadProgress ?? 0,
        update.localPath ?? null,
        update.error ?? null,
        now,
      );
      return;
    }

    const status = update.downloaded ? "downloaded"
      : update.downloading ? "downloading"
      : update.downloaded === false ? "not_downloaded"
      : (existing.downloaded ? "downloaded" : existing.downloading ? "downloading" : "not_downloaded");

    this.db.prepare(`
      UPDATE embedding_models
      SET status = ?, download_progress = ?, local_path = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(
      status,
      update.downloadProgress ?? existing.downloadProgress,
      update.localPath ?? existing.localPath,
      update.error ?? existing.error,
      now,
      modelId,
    );
  }

  listModelStatuses(): EmbeddingModelStatus[] {
    const rows = this.db.prepare(`
      SELECT * FROM embedding_models ORDER BY id ASC
    `).all() as unknown as EmbeddingModelRow[];
    return rows.map((row) => this.mapModelRow(row));
  }

  // --- Private helpers ---

  private mapRow(row: MemoryRow): MemoryRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      scope: row.scope as MemoryScope,
      sprintId: row.sprint_id,
      agentPresetId: row.agent_preset_id,
      content: row.content,
      category: row.category as MemoryCategory,
      strength: row.strength,
      source: this.parseSource(row.source_json),
      embeddingModel: row.embedding_model as EmbeddingModelId | null,
      embeddingDimension: row.embedding_dimension,
      embeddingBlob: row.embedding_blob,
      promotedFromId: row.promoted_from_id,
      promotionReason: row.promotion_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapModelRow(row: EmbeddingModelRow): EmbeddingModelStatus {
    return {
      id: row.id as EmbeddingModelId,
      downloaded: row.status === "downloaded",
      downloading: row.status === "downloading",
      downloadProgress: row.download_progress,
      localPath: row.local_path,
      error: row.error_message,
    };
  }

  private parseSource(json: string): MemorySource {
    try {
      const parsed = JSON.parse(json) as MemorySource;
      if (parsed && typeof parsed.type === "string") {
        return parsed;
      }
    } catch { /* ignore */ }
    return { type: "manual" };
  }

  private requireMemory(memoryId: string): MemoryRecord {
    const record = this.getMemory(memoryId);
    if (!record) {
      throw new Error(`Memory not found: ${memoryId}`);
    }
    return record;
  }

  private requireProject(projectId: string): void {
    const row = this.db.prepare(`
      SELECT id FROM projects WHERE id = ?
    `).get(projectId) as { id: string } | undefined;

    if (!row) {
      throw new Error(`Project not found: ${projectId}`);
    }
  }
}
