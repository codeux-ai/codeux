import { randomUUID } from "crypto";
import { createLogger, type Logger } from "../shared/logging/logger.js";
import { RepositoryError } from "./repository-utils.js";
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
  MemoryClaimEvidenceLink,
  MemoryClaimRecord,
  MemoryClaimStatus,
  MemoryClaimSourceType,
  MemoryClaimEvidenceSupport,
  CreateMemoryClaimInput,
  UpdateMemoryClaimInput,
  AddMemoryClaimEvidenceInput,
  MemoryClearTier,
  MemoryClearResult,
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

interface MemoryClaimRow {
  id: string;
  project_id: string;
  claim: string;
  fingerprint: string;
  category: string;
  confidence: number;
  durability: number;
  status: string;
  tags_json: string;
  applies_to_paths_json: string;
  source_type: string;
  source_memory_id: string | null;
  supersedes_claim_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MemoryClaimEvidenceRow {
  claim_id: string;
  memory_id: string;
  support_type: string;
  weight: number;
  created_at: string;
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

  createMemoriesBatch(projectId: string, items: import("../contracts/memory-types.js").CreateMemoryInput[]): import("../contracts/memory-types.js").MemoryRecord[] {
    if (items.length === 0) return [];

    return this.db.transaction(() => {
      return items.map((item) => this.createMemory(projectId, item));
    });
  }

  createMemories(projectId: string, inputs: CreateMemoryInput[]): MemoryRecord[] {
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
    try {
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
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, memoryId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  deleteMemory(memoryId: string): void {
    try {
      this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(memoryId);
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, memoryId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
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

  /**
   * Bulk-clear memory data by tier, optionally scoped to a single project.
   * Omitting `projectId` clears system-wide (across every project).
   *
   * - short_term: sprint + legacy agent scoped memories only (claims are long-term).
   * - long_term:  project-scoped memories + every memory claim and its evidence.
   * - all:        every memory, claim, and evidence row (the full memory database).
   */
  clearMemories(tier: MemoryClearTier, projectId?: string): MemoryClearResult {
    try {
      const projectClause = projectId ? " AND project_id = ?" : "";
      const projectParam = projectId ? [projectId] : [];
      // Evidence references claims by project; scope evidence to the project's claims.
      const evidenceSql = projectId
        ? "DELETE FROM memory_claim_evidence WHERE claim_id IN (SELECT id FROM memory_claims WHERE project_id = ?)"
        : "DELETE FROM memory_claim_evidence";

      return this.db.transaction(() => {
        let memories = 0;
        let claims = 0;
        let evidence = 0;

        if (tier === "short_term") {
          memories = this.db
            .prepare(`DELETE FROM memories WHERE scope IN ('sprint', 'agent')${projectClause}`)
            .run(...projectParam).changes;
        } else if (tier === "long_term") {
          evidence = this.db.prepare(evidenceSql).run(...projectParam).changes;
          claims = this.db.prepare(`DELETE FROM memory_claims WHERE 1 = 1${projectClause}`).run(...projectParam).changes;
          memories = this.db
            .prepare(`DELETE FROM memories WHERE scope = 'project'${projectClause}`)
            .run(...projectParam).changes;
        } else {
          evidence = this.db.prepare(evidenceSql).run(...projectParam).changes;
          claims = this.db.prepare(`DELETE FROM memory_claims WHERE 1 = 1${projectClause}`).run(...projectParam).changes;
          memories = this.db.prepare(`DELETE FROM memories WHERE 1 = 1${projectClause}`).run(...projectParam).changes;
        }

        return { memories, claims, evidence };
      });
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, projectId, tier });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
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

  createPromotedClaimMemory(
    projectId: string,
    sourceMemory: MemoryRecord,
    claim: string,
    claimId: string,
    reason: string,
    strength: number,
  ): MemoryRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    const source: MemorySource = { type: "promotion", originType: "memory_claim", originId: claimId };

    const row: MemoryRow = {
      id,
      project_id: projectId,
      scope: "project",
      sprint_id: null,
      agent_preset_id: sourceMemory.agentPresetId,
      content: claim.trim(),
      category: sourceMemory.category,
      strength: clamp01(strength),
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

  createMemoryClaim(projectId: string, input: CreateMemoryClaimInput): MemoryClaimRecord {
    try {
      requireRecord(this.db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId), "Project", projectId);
      const now = new Date().toISOString();
      const id = randomUUID();
      const claim = input.claim.trim();
      if (!claim) {
        throw new RepositoryError("Memory claim content is required");
      }
      const row: MemoryClaimRow = {
        id,
        project_id: projectId,
        claim,
        fingerprint: normalizeClaimFingerprint(claim),
        category: input.category,
        confidence: clamp01(input.confidence),
        durability: clamp01(input.durability),
        status: "active",
        tags_json: JSON.stringify(normalizeStringArray(input.tags || [])),
        applies_to_paths_json: JSON.stringify(normalizeStringArray(input.appliesToPaths || [])),
        source_type: input.sourceType || "promotion",
        source_memory_id: input.sourceMemoryId || null,
        supersedes_claim_id: input.supersedesClaimId || null,
        created_at: now,
        updated_at: now,
      };

      this.db.prepare(`
        INSERT INTO memory_claims (
          id, project_id, claim, fingerprint, category, confidence, durability, status,
          tags_json, applies_to_paths_json, source_type, source_memory_id, supersedes_claim_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id,
        row.project_id,
        row.claim,
        row.fingerprint,
        row.category,
        row.confidence,
        row.durability,
        row.status,
        row.tags_json,
        row.applies_to_paths_json,
        row.source_type,
        row.source_memory_id,
        row.supersedes_claim_id,
        row.created_at,
        row.updated_at,
      );

      return this.mapClaimRow(row);
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  getMemoryClaim(claimId: string): MemoryClaimRecord | null {
    const row = this.db.prepare("SELECT * FROM memory_claims WHERE id = ?").get(claimId) as MemoryClaimRow | undefined;
    return row ? this.mapClaimRow(row) : null;
  }

  findActiveMemoryClaimByFingerprint(projectId: string, claim: string): MemoryClaimRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM memory_claims
      WHERE project_id = ? AND fingerprint = ? AND status = 'active'
      LIMIT 1
    `).get(projectId, normalizeClaimFingerprint(claim)) as MemoryClaimRow | undefined;
    return row ? this.mapClaimRow(row) : null;
  }

  listMemoryClaims(
    projectId: string,
    options: { status?: MemoryClaimStatus; category?: MemoryCategory; limit?: number } = {},
  ): MemoryClaimRecord[] {
    let sql = "SELECT * FROM memory_claims WHERE project_id = ?";
    const params: Array<string | number> = [projectId];

    if (options.status) {
      sql += " AND status = ?";
      params.push(options.status);
    }
    if (options.category) {
      sql += " AND category = ?";
      params.push(options.category);
    }

    sql += " ORDER BY updated_at DESC LIMIT ?";
    params.push(options.limit ?? 200);

    const rows = this.db.prepare(sql).all(...params) as unknown as MemoryClaimRow[];
    return rows.map((row) => this.mapClaimRow(row));
  }

  updateMemoryClaim(claimId: string, input: UpdateMemoryClaimInput): MemoryClaimRecord {
    try {
      const current = requireRecord(this.getMemoryClaim(claimId), "Memory claim", claimId);
      const now = new Date().toISOString();
      const claim = input.claim?.trim() ?? current.claim;
      if (!claim) {
        throw new RepositoryError("Memory claim content is required");
      }
      const tags = input.tags ? normalizeStringArray(input.tags) : current.tags;
      const appliesToPaths = input.appliesToPaths ? normalizeStringArray(input.appliesToPaths) : current.appliesToPaths;

      this.db.prepare(`
        UPDATE memory_claims
        SET claim = ?, fingerprint = ?, category = ?, confidence = ?, durability = ?,
            status = ?, tags_json = ?, applies_to_paths_json = ?, supersedes_claim_id = ?, updated_at = ?
        WHERE id = ?
      `).run(
        claim,
        normalizeClaimFingerprint(claim),
        input.category ?? current.category,
        input.confidence === undefined ? current.confidence : clamp01(input.confidence),
        input.durability === undefined ? current.durability : clamp01(input.durability),
        input.status ?? current.status,
        JSON.stringify(tags),
        JSON.stringify(appliesToPaths),
        input.supersedesClaimId === undefined ? current.supersedesClaimId : input.supersedesClaimId,
        now,
        claimId,
      );

      return requireRecord(this.getMemoryClaim(claimId), "Memory claim", claimId);
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.logger.error("Operation failed", { error, claimId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  addMemoryClaimEvidence(input: AddMemoryClaimEvidenceInput): MemoryClaimEvidenceLink {
    const now = new Date().toISOString();
    const row: MemoryClaimEvidenceRow = {
      claim_id: input.claimId,
      memory_id: input.memoryId,
      support_type: input.supportType || "supports",
      weight: clamp01(input.weight ?? 1),
      created_at: now,
    };

    this.db.prepare(`
      INSERT INTO memory_claim_evidence (claim_id, memory_id, support_type, weight, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(claim_id, memory_id) DO UPDATE SET
        support_type = excluded.support_type,
        weight = excluded.weight
    `).run(row.claim_id, row.memory_id, row.support_type, row.weight, row.created_at);

    return this.mapEvidenceRow(row);
  }

  listMemoryClaimEvidence(claimId: string): MemoryClaimEvidenceLink[] {
    const rows = this.db.prepare(`
      SELECT * FROM memory_claim_evidence
      WHERE claim_id = ?
      ORDER BY weight DESC, created_at ASC
    `).all(claimId) as unknown as MemoryClaimEvidenceRow[];
    return rows.map((row) => this.mapEvidenceRow(row));
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

  private mapClaimRow(row: MemoryClaimRow): MemoryClaimRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      claim: row.claim,
      fingerprint: row.fingerprint,
      category: row.category as MemoryCategory,
      confidence: row.confidence,
      durability: row.durability,
      status: row.status as MemoryClaimStatus,
      tags: parseStringArray(row.tags_json),
      appliesToPaths: parseStringArray(row.applies_to_paths_json),
      sourceType: row.source_type as MemoryClaimSourceType,
      sourceMemoryId: row.source_memory_id,
      supersedesClaimId: row.supersedes_claim_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapEvidenceRow(row: MemoryClaimEvidenceRow): MemoryClaimEvidenceLink {
    return {
      claimId: row.claim_id,
      memoryId: row.memory_id,
      supportType: row.support_type as MemoryClaimEvidenceSupport,
      weight: row.weight,
      createdAt: row.created_at,
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeStringArray(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeStringArray(parsed.filter((value): value is string => typeof value === "string"));
    }
  } catch {
    // ignore malformed stored metadata
  }
  return [];
}

function normalizeClaimFingerprint(claim: string): string {
  return claim
    .trim()
    .toLowerCase()
    .replace(/[`"'.,;:!?()[\]{}]/g, "")
    .replace(/\s+/g, " ");
}
