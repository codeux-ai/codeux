import { randomUUID } from "crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppDbStorage } from "./app-db-storage.js";
import { requireRecord } from "./repository-utils.js";
import type {
  AgentSourceScope,
  AgentPresetRecord,
  CreateAgentPresetInput,
  UpdateAgentPresetInput,
} from "../contracts/agent-preset-types.js";

interface AgentPresetRow {
  id: string;
  project_id: string;
  name: string;
  instruction_markdown: string;
  labels_json: string | null;
  source_path: string | null;
  source_scope: string | null;
  source_updated_at: string | null;
  source_imported_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentPresetSourceMetadata {
  sourcePath: string;
  sourceScope: AgentSourceScope;
  sourceUpdatedAt: string;
  sourceImportedAt?: string | null;
}

function parseLabels(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export class AgentPresetRepository {
  private readonly db: DatabaseSync;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  listAgentPresets(projectId: string): AgentPresetRecord[] {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const rows = this.db.prepare(`
      SELECT *
      FROM agent_presets
      WHERE project_id = ?
      ORDER BY updated_at DESC, created_at DESC, name ASC
    `).all(projectId) as unknown as AgentPresetRow[];

    return rows.map((row) => this.mapRow(row));
  }

  getAgentPreset(agentPresetId: string): AgentPresetRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM agent_presets
      WHERE id = ?
    `).get(agentPresetId) as AgentPresetRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  createAgentPreset(projectId: string, input: CreateAgentPresetInput): AgentPresetRecord {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO agent_presets (
        id,
        project_id,
        name,
        instruction_markdown,
        labels_json,
        source_path,
        source_scope,
        source_updated_at,
        source_imported_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      input.name.trim(),
      input.instructionMarkdown?.trim() || "",
      JSON.stringify(this.normalizeLabels(input.labels)),
      null,
      null,
      null,
      null,
      now,
      now,
    );

    return requireRecord(this.getAgentPreset(id), "Agent preset", id);
  }

  importAgentPresetFromSource(projectId: string, input: CreateAgentPresetInput & AgentPresetSourceMetadata): AgentPresetRecord {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const now = new Date().toISOString();
    const id = randomUUID();
    const importedAt = input.sourceImportedAt ?? input.sourceUpdatedAt;

    this.db.prepare(`
      INSERT INTO agent_presets (
        id,
        project_id,
        name,
        instruction_markdown,
        labels_json,
        source_path,
        source_scope,
        source_updated_at,
        source_imported_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      input.name.trim(),
      input.instructionMarkdown?.trim() || "",
      JSON.stringify(this.normalizeLabels(input.labels)),
      input.sourcePath,
      input.sourceScope,
      input.sourceUpdatedAt,
      importedAt,
      now,
      now,
    );

    return requireRecord(this.getAgentPreset(id), "Agent preset", id);
  }

  updateAgentPreset(agentPresetId: string, input: UpdateAgentPresetInput): AgentPresetRecord {
    const current = requireRecord(this.getAgentPreset(agentPresetId), "Agent preset", agentPresetId);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE agent_presets
      SET name = ?, instruction_markdown = ?, labels_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name?.trim() || current.name,
      input.instructionMarkdown === undefined ? current.instructionMarkdown : input.instructionMarkdown.trim(),
      JSON.stringify(input.labels === undefined ? current.labels : this.normalizeLabels(input.labels)),
      now,
      agentPresetId,
    );

    return requireRecord(this.getAgentPreset(agentPresetId), "Agent preset", agentPresetId);
  }

  linkAgentPresetToSource(agentPresetId: string, input: AgentPresetSourceMetadata): AgentPresetRecord {
    requireRecord(this.getAgentPreset(agentPresetId), "Agent preset", agentPresetId);
    this.db.prepare(`
      UPDATE agent_presets
      SET source_path = ?, source_scope = ?, source_updated_at = ?
      WHERE id = ?
    `).run(
      input.sourcePath,
      input.sourceScope,
      input.sourceUpdatedAt,
      agentPresetId,
    );

    if (input.sourceImportedAt !== undefined) {
      this.db.prepare(`
        UPDATE agent_presets
        SET source_imported_at = ?
        WHERE id = ?
      `).run(input.sourceImportedAt, agentPresetId);
    }

    return requireRecord(this.getAgentPreset(agentPresetId), "Agent preset", agentPresetId);
  }

  importLinkedAgentPreset(agentPresetId: string, input: {
    name: string;
    instructionMarkdown: string;
    sourceUpdatedAt: string;
  }): AgentPresetRecord {
    const current = requireRecord(this.getAgentPreset(agentPresetId), "Agent preset", agentPresetId);
    if (!current.sourcePath || !current.sourceScope) {
      throw new Error(`Agent ${agentPresetId} is not linked to a markdown source.`);
    }
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE agent_presets
      SET name = ?, instruction_markdown = ?, source_updated_at = ?, source_imported_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name.trim(),
      input.instructionMarkdown.trim(),
      input.sourceUpdatedAt,
      input.sourceUpdatedAt,
      now,
      agentPresetId,
    );

    return requireRecord(this.getAgentPreset(agentPresetId), "Agent preset", agentPresetId);
  }

  findAgentPresetByName(projectId: string, name: string): AgentPresetRecord | null {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const row = this.db.prepare(`
      SELECT *
      FROM agent_presets
      WHERE project_id = ?
        AND lower(trim(name)) = lower(trim(?))
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `).get(projectId, name) as AgentPresetRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  deleteAgentPreset(agentPresetId: string): void {
    requireRecord(this.getAgentPreset(agentPresetId), "Agent preset", agentPresetId);
    this.db.prepare(`
      DELETE FROM agent_presets
      WHERE id = ?
    `).run(agentPresetId);
  }

  private mapRow(row: AgentPresetRow): AgentPresetRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      instructionMarkdown: row.instruction_markdown,
      labels: parseLabels(row.labels_json),
      sourcePath: row.source_path,
      sourceScope: this.parseSourceScope(row.source_scope),
      sourceUpdatedAt: row.source_updated_at,
      sourceImportedAt: row.source_imported_at,
      sourceExists: Boolean(row.source_path),
      syncStatus: row.source_path ? "synced" : "manual",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }



  private normalizeLabels(labels?: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const label of labels || []) {
      const trimmed = String(label || "").trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      normalized.push(trimmed);
    }
    return normalized;
  }

  private parseSourceScope(value: string | null): AgentSourceScope | null {
    if (value === "project" || value === "home" || value === "default") {
      return value;
    }
    return null;
  }
}
