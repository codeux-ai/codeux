import { createHash, randomUUID } from "crypto";
import { AppDbStorage } from "./app-db-storage.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import { EntityNotFoundError, requireRecord, ValidationError } from "./repository-utils.js";
import { normalizeStringArray } from "../services/skill-markdown-parser.js";
import type {
  AgentSkillStorageAttachment,
  CreateSkillInput,
  CreateSkillStorageInput,
  SkillEmbeddingRecord,
  SkillRecord,
  SkillSourceType,
  SkillStorageKind,
  SkillStorageRecord,
  UpdateSkillInput,
  UpdateSkillStorageInput,
} from "../contracts/skill-types.js";

interface SkillStorageRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  storage_kind: string;
  created_at: string;
  updated_at: string;
}

interface SkillRow {
  id: string;
  project_id: string;
  storage_id: string;
  name: string;
  description: string | null;
  content_markdown: string;
  source_type: string;
  source_ref: string | null;
  content_hash: string;
  tags_json: string | null;
  applies_to_json: string | null;
  version: string | null;
  created_at: string;
  updated_at: string;
}

interface SkillEmbeddingRow {
  id: string;
  project_id: string;
  storage_id: string;
  skill_id: string;
  embedding_model: string;
  embedding_dimension: number;
  chunk_index: number;
  content_hash: string;
  embedding_blob: Buffer | Uint8Array | null;
  created_at: string;
  updated_at: string;
}

interface AgentSkillStorageBindingRow {
  agent_preset_id: string;
  storage_id: string;
  project_id: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

const VALID_STORAGE_KINDS = new Set<SkillStorageKind>(["project", "shared"]);
const VALID_SOURCE_TYPES = new Set<SkillSourceType>(["manual", "imported", "generated"]);

export function computeSkillContentHash(contentMarkdown: string): string {
  return createHash("sha256").update(contentMarkdown).digest("hex");
}

function parseStringArrayJson(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? normalizeStringArray(parsed.map((entry) => String(entry))) : [];
  } catch {
    return [];
  }
}

function normalizeStorageKind(value: SkillStorageKind | undefined): SkillStorageKind {
  if (!value) {
    return "project";
  }
  if (!VALID_STORAGE_KINDS.has(value)) {
    throw new ValidationError(`Invalid skill storage kind: ${value}`);
  }
  return value;
}

function normalizeSourceType(value: SkillSourceType | undefined): SkillSourceType {
  if (!value) {
    return "manual";
  }
  if (!VALID_SOURCE_TYPES.has(value)) {
    throw new ValidationError(`Invalid skill source type: ${value}`);
  }
  return value;
}

function normalizeName(name: string, entityType: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new ValidationError(`${entityType} name is required`);
  }
  return trimmed;
}

export class SkillRepository {
  private readonly db: DatabaseAdapter;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  createStorage(projectId: string, input: CreateSkillStorageInput): SkillStorageRecord {
    this.requireProject(projectId);
    const now = new Date().toISOString();
    const id = input.id?.trim() || randomUUID();
    this.db.prepare(`
      INSERT INTO skill_storages (id, project_id, name, description, storage_kind, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      normalizeName(input.name, "Skill storage"),
      input.description?.trim() || "",
      normalizeStorageKind(input.storageKind),
      now,
      now,
    );
    return requireRecord(this.getStorage(projectId, id), "Skill storage", id);
  }

  listStorages(projectId: string): SkillStorageRecord[] {
    this.requireProject(projectId);
    const rows = this.db.prepare(`
      SELECT *
      FROM skill_storages
      WHERE project_id = ?
      ORDER BY updated_at DESC, created_at DESC, name ASC
    `).all(projectId) as unknown as SkillStorageRow[];
    return rows.map((row) => this.mapStorageRow(row));
  }

  getStorage(projectId: string, storageId: string): SkillStorageRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM skill_storages
      WHERE id = ?
        AND project_id = ?
    `).get(storageId, projectId) as SkillStorageRow | undefined;
    return row ? this.mapStorageRow(row) : null;
  }

  updateStorage(projectId: string, storageId: string, input: UpdateSkillStorageInput): SkillStorageRecord {
    const current = requireRecord(this.getStorage(projectId, storageId), "Skill storage", storageId);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE skill_storages
      SET name = ?, description = ?, storage_kind = ?, updated_at = ?
      WHERE id = ?
        AND project_id = ?
    `).run(
      input.name === undefined ? current.name : normalizeName(input.name, "Skill storage"),
      input.description === undefined ? current.description : input.description.trim(),
      input.storageKind === undefined ? current.storageKind : normalizeStorageKind(input.storageKind),
      now,
      storageId,
      projectId,
    );
    return requireRecord(this.getStorage(projectId, storageId), "Skill storage", storageId);
  }

  deleteStorage(projectId: string, storageId: string): void {
    requireRecord(this.getStorage(projectId, storageId), "Skill storage", storageId);
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM agent_skill_storage_bindings WHERE project_id = ? AND storage_id = ?`).run(projectId, storageId);
      this.db.prepare(`DELETE FROM skill_embeddings WHERE project_id = ? AND storage_id = ?`).run(projectId, storageId);
      this.db.prepare(`DELETE FROM skills WHERE project_id = ? AND storage_id = ?`).run(projectId, storageId);
      this.db.prepare(`DELETE FROM skill_storages WHERE project_id = ? AND id = ?`).run(projectId, storageId);
    });
  }

  attachStorageToAgent(projectId: string, agentPresetId: string, storageId: string): AgentSkillStorageAttachment {
    this.requireAgent(projectId, agentPresetId);
    requireRecord(this.getStorage(projectId, storageId), "Skill storage", storageId);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO agent_skill_storage_bindings (
        agent_preset_id,
        storage_id,
        project_id,
        enabled,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 1, ?, ?)
      ${this.db.dialect.upsert(["agent_preset_id", "storage_id"], ["project_id", "enabled", "updated_at"])}
    `).run(agentPresetId, storageId, projectId, now, now);
    return requireRecord(this.getAttachment(projectId, agentPresetId, storageId), "Agent skill storage attachment", `${agentPresetId}:${storageId}`);
  }

  detachStorageFromAgent(projectId: string, agentPresetId: string, storageId: string): void {
    this.requireAgent(projectId, agentPresetId);
    requireRecord(this.getStorage(projectId, storageId), "Skill storage", storageId);
    this.db.prepare(`
      DELETE FROM agent_skill_storage_bindings
      WHERE project_id = ?
        AND agent_preset_id = ?
        AND storage_id = ?
    `).run(projectId, agentPresetId, storageId);
  }

  listAttachmentsForAgent(projectId: string, agentPresetId: string): AgentSkillStorageAttachment[] {
    this.requireAgent(projectId, agentPresetId);
    const rows = this.db.prepare(`
      SELECT *
      FROM agent_skill_storage_bindings
      WHERE project_id = ?
        AND agent_preset_id = ?
        AND enabled = 1
      ORDER BY created_at ASC, storage_id ASC
    `).all(projectId, agentPresetId) as unknown as AgentSkillStorageBindingRow[];
    return rows.map((row) => this.mapAttachmentRow(row));
  }

  listStoragesForAgent(projectId: string, agentPresetId: string): SkillStorageRecord[] {
    this.requireAgent(projectId, agentPresetId);
    const rows = this.db.prepare(`
      SELECT s.*
      FROM skill_storages s
      INNER JOIN agent_skill_storage_bindings b
        ON b.storage_id = s.id
       AND b.project_id = s.project_id
      WHERE b.project_id = ?
        AND b.agent_preset_id = ?
        AND b.enabled = 1
      ORDER BY b.created_at ASC, s.name ASC
    `).all(projectId, agentPresetId) as unknown as SkillStorageRow[];
    return rows.map((row) => this.mapStorageRow(row));
  }

  createSkill(projectId: string, storageId: string, input: CreateSkillInput): SkillRecord {
    requireRecord(this.getStorage(projectId, storageId), "Skill storage", storageId);
    const now = new Date().toISOString();
    const id = input.id?.trim() || randomUUID();
    const contentMarkdown = input.contentMarkdown.trim();
    this.db.prepare(`
      INSERT INTO skills (
        id,
        project_id,
        storage_id,
        name,
        description,
        content_markdown,
        source_type,
        source_ref,
        content_hash,
        tags_json,
        applies_to_json,
        version,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      storageId,
      normalizeName(input.name, "Skill"),
      input.description?.trim() || "",
      contentMarkdown,
      normalizeSourceType(input.sourceType),
      input.sourceRef?.trim() || null,
      computeSkillContentHash(contentMarkdown),
      JSON.stringify(normalizeStringArray(input.tags)),
      JSON.stringify(normalizeStringArray(input.appliesTo)),
      input.version?.trim() || null,
      now,
      now,
    );
    return requireRecord(this.getSkill(projectId, id), "Skill", id);
  }

  listSkills(projectId: string, storageId: string, limit = 200): SkillRecord[] {
    requireRecord(this.getStorage(projectId, storageId), "Skill storage", storageId);
    const rows = this.db.prepare(`
      SELECT *
      FROM skills
      WHERE project_id = ?
        AND storage_id = ?
      ORDER BY updated_at DESC, created_at DESC, name ASC
      LIMIT ?
    `).all(projectId, storageId, limit) as unknown as SkillRow[];
    return rows.map((row) => this.mapSkillRow(row));
  }

  getSkill(projectId: string, skillId: string): SkillRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM skills
      WHERE id = ?
        AND project_id = ?
    `).get(skillId, projectId) as SkillRow | undefined;
    return row ? this.mapSkillRow(row) : null;
  }

  getSkills(projectId: string, skillIds: string[]): SkillRecord[] {
    if (skillIds.length === 0) {
      return [];
    }
    const uniqueIds = [...new Set(skillIds)];
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT *
      FROM skills
      WHERE project_id = ?
        AND id IN (${placeholders})
    `).all(projectId, ...uniqueIds) as unknown as SkillRow[];
    const skillMap = new Map(rows.map((row) => [row.id, this.mapSkillRow(row)]));
    return skillIds.map((id) => skillMap.get(id)).filter((skill): skill is SkillRecord => Boolean(skill));
  }

  updateSkill(projectId: string, skillId: string, input: UpdateSkillInput): SkillRecord {
    const current = requireRecord(this.getSkill(projectId, skillId), "Skill", skillId);
    if (input.contentMarkdown !== undefined || input.name !== undefined) {
      requireRecord(this.getStorage(projectId, current.storageId), "Skill storage", current.storageId);
    }
    const now = new Date().toISOString();
    const contentMarkdown = input.contentMarkdown === undefined ? current.contentMarkdown : input.contentMarkdown.trim();
    this.db.prepare(`
      UPDATE skills
      SET name = ?,
          description = ?,
          content_markdown = ?,
          source_type = ?,
          source_ref = ?,
          content_hash = ?,
          tags_json = ?,
          applies_to_json = ?,
          version = ?,
          updated_at = ?
      WHERE id = ?
        AND project_id = ?
    `).run(
      input.name === undefined ? current.name : normalizeName(input.name, "Skill"),
      input.description === undefined ? current.description : input.description.trim(),
      contentMarkdown,
      input.sourceType === undefined ? current.sourceType : normalizeSourceType(input.sourceType),
      input.sourceRef === undefined ? current.sourceRef : input.sourceRef?.trim() || null,
      computeSkillContentHash(contentMarkdown),
      JSON.stringify(input.tags === undefined ? current.tags : normalizeStringArray(input.tags)),
      JSON.stringify(input.appliesTo === undefined ? current.appliesTo : normalizeStringArray(input.appliesTo)),
      input.version === undefined ? current.version : input.version?.trim() || null,
      now,
      skillId,
      projectId,
    );
    return requireRecord(this.getSkill(projectId, skillId), "Skill", skillId);
  }

  deleteSkill(projectId: string, skillId: string): void {
    requireRecord(this.getSkill(projectId, skillId), "Skill", skillId);
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM skill_embeddings WHERE project_id = ? AND skill_id = ?`).run(projectId, skillId);
      this.db.prepare(`DELETE FROM skills WHERE project_id = ? AND id = ?`).run(projectId, skillId);
    });
  }

  saveEmbedding(projectId: string, skillId: string, embeddingModel: string, embeddingDimension: number, embeddingBlob: Buffer, chunkIndex = 0): void {
    const skill = requireRecord(this.getSkill(projectId, skillId), "Skill", skillId);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO skill_embeddings (
        id,
        project_id,
        storage_id,
        skill_id,
        embedding_model,
        embedding_dimension,
        chunk_index,
        content_hash,
        embedding_blob,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${this.db.dialect.upsert(["skill_id", "embedding_model", "chunk_index"], [
        "project_id",
        "storage_id",
        "embedding_dimension",
        "content_hash",
        "embedding_blob",
        "updated_at",
      ])}
    `).run(
      id,
      projectId,
      skill.storageId,
      skill.id,
      embeddingModel,
      embeddingDimension,
      chunkIndex,
      skill.contentHash,
      embeddingBlob,
      now,
      now,
    );
  }

  deleteEmbeddingsForSkill(projectId: string, skillId: string): void {
    requireRecord(this.getSkill(projectId, skillId), "Skill", skillId);
    this.db.prepare(`DELETE FROM skill_embeddings WHERE project_id = ? AND skill_id = ?`).run(projectId, skillId);
  }

  loadEmbeddingsForStorages(
    projectId: string,
    storageIds: string[],
    embeddingModel: string,
    limit: number,
  ): SkillEmbeddingRecord[] {
    const normalizedStorageIds = normalizeStringArray(storageIds);
    if (normalizedStorageIds.length === 0) {
      return [];
    }
    for (const storageId of normalizedStorageIds) {
      requireRecord(this.getStorage(projectId, storageId), "Skill storage", storageId);
    }
    const placeholders = normalizedStorageIds.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT *
      FROM skill_embeddings
      WHERE project_id = ?
        AND storage_id IN (${placeholders})
        AND embedding_model = ?
        AND embedding_blob IS NOT NULL
      ORDER BY updated_at DESC, skill_id ASC, chunk_index ASC
      LIMIT ?
    `).all(projectId, ...normalizedStorageIds, embeddingModel, limit) as unknown as SkillEmbeddingRow[];

    return rows
      .filter((row) => row.embedding_blob !== null)
      .map((row) => this.mapEmbeddingRow(row as SkillEmbeddingRow & { embedding_blob: Buffer | Uint8Array }));
  }

  private getAttachment(projectId: string, agentPresetId: string, storageId: string): AgentSkillStorageAttachment | null {
    const row = this.db.prepare(`
      SELECT *
      FROM agent_skill_storage_bindings
      WHERE project_id = ?
        AND agent_preset_id = ?
        AND storage_id = ?
    `).get(projectId, agentPresetId, storageId) as AgentSkillStorageBindingRow | undefined;
    return row ? this.mapAttachmentRow(row) : null;
  }

  private requireProject(projectId: string): void {
    requireRecord(this.db.prepare(`SELECT id FROM projects WHERE id = ?`).get(projectId), "Project", projectId);
  }

  private requireAgent(projectId: string, agentPresetId: string): void {
    const row = this.db.prepare(`
      SELECT id
      FROM agent_presets
      WHERE id = ?
        AND project_id = ?
    `).get(agentPresetId, projectId);
    if (!row) {
      throw new EntityNotFoundError(`Agent preset not found: ${agentPresetId}`);
    }
  }

  private mapStorageRow(row: SkillStorageRow): SkillStorageRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description || "",
      storageKind: VALID_STORAGE_KINDS.has(row.storage_kind as SkillStorageKind) ? row.storage_kind as SkillStorageKind : "project",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapSkillRow(row: SkillRow): SkillRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      storageId: row.storage_id,
      name: row.name,
      description: row.description || "",
      contentMarkdown: row.content_markdown,
      sourceType: VALID_SOURCE_TYPES.has(row.source_type as SkillSourceType) ? row.source_type as SkillSourceType : "manual",
      sourceRef: row.source_ref,
      contentHash: row.content_hash,
      tags: parseStringArrayJson(row.tags_json),
      appliesTo: parseStringArrayJson(row.applies_to_json),
      version: row.version || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapEmbeddingRow(row: SkillEmbeddingRow & { embedding_blob: Buffer | Uint8Array }): SkillEmbeddingRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      storageId: row.storage_id,
      skillId: row.skill_id,
      embeddingModel: row.embedding_model,
      embeddingDimension: row.embedding_dimension,
      chunkIndex: row.chunk_index,
      contentHash: row.content_hash,
      embeddingBlob: row.embedding_blob instanceof Buffer
        ? row.embedding_blob
        : Buffer.from(row.embedding_blob.buffer, row.embedding_blob.byteOffset, row.embedding_blob.byteLength),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapAttachmentRow(row: AgentSkillStorageBindingRow): AgentSkillStorageAttachment {
    return {
      agentPresetId: row.agent_preset_id,
      storageId: row.storage_id,
      projectId: row.project_id,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
