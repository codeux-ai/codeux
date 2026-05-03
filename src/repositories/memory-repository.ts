import { randomUUID } from "crypto";
import { DatabaseAdapter } from "./db/database-adapter.js";
import { AppDbStorage } from "./app-db-storage.js";
import { requireRecord, executeChunkedInQuery } from "./repository-utils.js";
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
  private readonly db: DatabaseAdapter;

  constructor(storage: AppDbStorage) {
    this.db = storage.getDatabase();
  }

  createMemory(projectId: string, input: CreateMemoryInput): MemoryRecord {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const now = new Date().toISOString();
    const id = randomUUID();
    const source: MemorySource = input.source ?? { type: "manual" };

    const row: MemoryRow = {
      id,
      project_id: projectId,
      scope: input.scope,
      sprint_id: input.sprintId ?? null,
      agent_preset_id: input.agentPresetId ?? null,
      content: input.content.trim(),
      category: input.category,
      strength: input.strength ?? 0.5,
      source_json: JSON.stringify(source),
      embedding_model: null,
      embedding_dimension: null,
      embedding_blob: null,
      promoted_from_id: null,
      promotion_reason: null,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO memories (
        id, project_id, scope, sprint_id, agent_preset_id,
        content, category, strength, source_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.project_id,
      row.scope,
      row.sprint_id,
      row.agent_preset_id,
      row.content,
      row.category,
      row.strength,
      row.source_json,
      row.created_at,
      row.updated_at,
    );

    return this.mapRow(row);
  }

  createMemories(projectId: string, inputs: CreateMemoryInput[]): MemoryRecord[] {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);

    if (inputs.length === 0) return [];

    const now = new Date().toISOString();

    return this.db.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO memories (
          id, project_id, scope, sprint_id, agent_preset_id,
          content, category, strength, source_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const createdRecords: MemoryRecord[] = [];

      for (const input of inputs) {
        const id = randomUUID();
        const source: MemorySource = input.source ?? { type: "manual" };

        const row: MemoryRow = {
          id,
          project_id: projectId,
          scope: input.scope,
          sprint_id: input.sprintId ?? null,
          agent_preset_id: input.agentPresetId ?? null,
          content: input.content.trim(),
          category: input.category,
          strength: input.strength ?? 0.5,
          source_json: JSON.stringify(source),
          embedding_model: null,
          embedding_dimension: null,
          embedding_blob: null,
          promoted_from_id: null,
          promotion_reason: null,
          created_at: now,
          updated_at: now,
        };

        stmt.run(
          row.id,
          row.project_id,
          row.scope,
          row.sprint_id,
          row.agent_preset_id,
          row.content,
          row.category,
          row.strength,
          row.source_json,
          row.created_at,
          row.updated_at,
        );

        createdRecords.push(this.mapRow(row));
      }

      return createdRecords;
    });
  }


  getMemory(memoryId: string): MemoryRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM memories WHERE id = ?
    `).get(memoryId) as MemoryRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  getMemories(memoryIds: string[]): MemoryRecord[] {
    const rows = executeChunkedInQuery<MemoryRow>(
      (sql) => this.db.prepare(sql),
      { sqlPrefix: "SELECT * FROM memories WHERE id", items: memoryIds }
    );

    const map = new Map<string, MemoryRecord>();
    for (const row of rows) {
      map.set(row.id, this.mapRow(row));
    }

    const results: MemoryRecord[] = [];
    for (const id of memoryIds) {
      const mem = map.get(id);
      if (mem) {
        results.push(mem);
      }
    }
    return results;
  }

  updateMemory(memoryId: string, input: UpdateMemoryInput): MemoryRecord {
    const current = requireRecord(this.getMemory(memoryId), "Memory", memoryId);
    const now = new Date().toISOString();

    const updatedContent = input.content?.trim() ?? current.content;
    const updatedCategory = input.category ?? current.category;
    const updatedStrength = input.strength ?? current.strength;

    this.db.prepare(`
      UPDATE memories
      SET content = ?, category = ?, strength = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updatedContent,
      updatedCategory,
      updatedStrength,
      now,
      memoryId,
    );

    return {
      ...current,
      content: updatedContent,
      category: updatedCategory,
      strength: updatedStrength,
      updatedAt: now,
    };
  }

  deleteMemory(memoryId: string): void {
    this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(memoryId);
  }

  private listMemories(
    filters: { projectId: string; sprintId?: string; agentPresetId?: string; scope?: string },
    limit: number,
    orderBy: "updated_at DESC" | "created_at DESC"
  ): MemoryRecord[] {
    let sql = "SELECT * FROM memories WHERE project_id = ?";
    const params: any[] = [filters.projectId];

    if (filters.scope) {
      sql += " AND scope = ?";
      params.push(filters.scope);
    }
    if (filters.sprintId) {
      sql += " AND sprint_id = ?";
      params.push(filters.sprintId);
    }
    if (filters.agentPresetId) {
      sql += " AND agent_preset_id = ?";
      params.push(filters.agentPresetId);
    }

    sql += ` ORDER BY ${orderBy} LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as unknown as MemoryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  listByProject(projectId: string, scope?: MemoryScope, limit = 100): MemoryRecord[] {
    return this.listMemories({ projectId, scope }, limit, "updated_at DESC");
  }

  listBySprint(projectId: string, sprintId: string, limit = 200): MemoryRecord[] {
    return this.listMemories({ projectId, sprintId }, limit, "created_at DESC");
  }

  listByAgent(projectId: string, agentPresetId: string, limit = 100): MemoryRecord[] {
    return this.listMemories({ projectId, agentPresetId }, limit, "created_at DESC");
  }

  /** Short-term memories for a specific agent within a specific sprint. */
  listBySprintAndAgent(projectId: string, sprintId: string, agentPresetId: string, limit = 200): MemoryRecord[] {
    return this.listMemories({ projectId, sprintId, agentPresetId }, limit, "created_at DESC");
  }

  /** Long-term (project-scope) memories for a specific agent. */
  listLongTermByAgent(projectId: string, agentPresetId: string, limit = 200): MemoryRecord[] {
    return this.listMemories({ projectId, agentPresetId, scope: 'project' }, limit, "created_at DESC");
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
    limit?: number,
  ): EmbeddingRecord[] {
    let sql = `
      SELECT id, embedding_blob, embedding_dimension
      FROM memories
      WHERE project_id = ? AND embedding_model = ? AND embedding_blob IS NOT NULL
    `;
    const params: any[] = [projectId, model];

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

    if (limit !== undefined) {
      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);
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

  countStaleEmbeddings(projectId: string, currentModel: EmbeddingModelId): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM memories
      WHERE project_id = ? AND (embedding_model IS NULL OR embedding_model != ?)
    `).get(projectId, currentModel) as CountRow | undefined;
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

    const row: MemoryRow = {
      id,
      project_id: projectId,
      scope: 'project',
      sprint_id: null,
      agent_preset_id: sourceMemory.agentPresetId,
      content: sourceMemory.content,
      category: sourceMemory.category,
      strength: Math.min(1, sourceMemory.strength + 0.1),
      source_json: JSON.stringify(source),
      embedding_model: null,
      embedding_dimension: null,
      embedding_blob: null,
      promoted_from_id: sourceMemory.id,
      promotion_reason: reason,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO memories (
        id, project_id, scope, sprint_id, agent_preset_id,
        content, category, strength, source_json,
        promoted_from_id, promotion_reason,
        created_at, updated_at
      ) VALUES (?, ?, 'project', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.project_id,
      row.agent_preset_id,
      row.content,
      row.category,
      row.strength,
      row.source_json,
      row.promoted_from_id,
      row.promotion_reason,
      row.created_at,
      row.updated_at,
    );

    return this.mapRow(row);
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


}
