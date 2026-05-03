import { randomUUID } from "crypto";
import { createLogger, type Logger } from "../shared/logging/logger.js";
import { RepositoryError, EntityNotFoundError } from "./repository-utils.js";
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

  constructor(storage: AppDbStorage, private readonly logger: Logger = createLogger({ bindings: { component: "MemoryRepository" } })) {
    this.db = storage.getDatabase();
  }

  createMemory(projectId: string, input: CreateMemoryInput): MemoryRecord {
    try {
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
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  createMemoriesBatch(projectId: string, inputs: CreateMemoryInput[]): MemoryRecord[] {
    try {
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
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  updateMemory(id: string, input: UpdateMemoryInput): MemoryRecord {
    try {
      const existing = this.getMemory(id);
      if (!existing) {
        throw new EntityNotFoundError(`Memory not found: ${id}`);
      }

      const updates: string[] = [];
      const values: any[] = [];
      const now = new Date().toISOString();

      if (input.content !== undefined) {
        updates.push("content = ?");
        values.push(input.content.trim());
      }
      if (input.category !== undefined) {
        updates.push("category = ?");
        values.push(input.category);
      }
      if (input.strength !== undefined) {
        updates.push("strength = ?");
        values.push(input.strength);
      }

      if (updates.length > 0) {
        updates.push("updated_at = ?");
        values.push(now);

        const sql = `UPDATE memories SET ${updates.join(", ")} WHERE id = ?`;
        this.db.prepare(sql).run(...values, id);
      }

      return this.getMemory(id)!;
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, id });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  getMemory(id: string): MemoryRecord | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  listMemories(projectId: string, options: { scope?: MemoryScope; category?: MemoryCategory; sprintId?: string; limit?: number; offset?: number } = {}): MemoryRecord[] {
    const clauses = ["project_id = ?"];
    const values: any[] = [projectId];

    if (options.scope) {
      clauses.push("scope = ?");
      values.push(options.scope);
    }
    if (options.category) {
      clauses.push("category = ?");
      values.push(options.category);
    }
    if (options.sprintId) {
      clauses.push("sprint_id = ?");
      values.push(options.sprintId);
    }

    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as MemoryRow[];

    return rows.map((row) => this.mapRow(row));
  }

  searchMemories(projectId: string, query: string, options: { limit?: number; scope?: MemoryScope } = {}): MemoryRecord[] {
    const clauses = ["project_id = ?", "content LIKE ?"];
    const values: any[] = [projectId, `%${query}%`];

    if (options.scope) {
      clauses.push("scope = ?");
      values.push(options.scope);
    }

    const limit = options.limit ?? 20;

    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE ${clauses.join(" AND ")}
      ORDER BY strength DESC, created_at DESC
      LIMIT ?
    `).all(...values, limit) as MemoryRow[];

    return rows.map((row) => this.mapRow(row));
  }

  deleteMemory(id: string): boolean {
    try {
      const result = this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
      return (result.changes ?? 0) > 0;
    } catch (error) {
      this.logger.error("Operation failed", { error, id });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

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
      source: JSON.parse(row.source_json),
      embeddingModel: row.embedding_model as EmbeddingModelId | null,
      embeddingDimension: row.embedding_dimension,
      promotedFromId: row.promoted_from_id,
      promotionReason: row.promotion_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
