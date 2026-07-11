import { DatabaseAdapter } from "./db/database-adapter.js";
import { AppDbStorage } from "./app-db-storage.js";
import { requireRecord } from "./repository-utils.js";
import { sanitizeAgentMcpAccess } from "../services/agent-mcp-access.js";
import { parseBaseAgentInstructionStates } from "../services/base-agent-update-state.js";
import type {
  AgentMcpAccessConfig,
  AgentMemoryConfig,
  AgentSourceScope,
  AgentPresetRecord,
  BaseAgentInstructionStates,
  CreateAgentPresetInput,
  UpdateAgentPresetInput,
} from "../contracts/agent-preset-types.js";

interface AgentPresetRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  instruction_markdown: string;
  labels_json: string | null;
  source_path: string | null;
  source_scope: string | null;
  source_updated_at: string | null;
  source_imported_at: string | null;
  avatar_config_json: string | null;
  provider_config_id: string | null;
  model: string | null;
  container_run_as_root: number | null;
  memory_template_override_enabled: number;
  memory_template_markdown: string | null;
  persistent_skill_storage_enabled: number;
  mcp_access_json: string | null;
  memory_config_json: string | null;
  base_instruction_state_json: string | null;
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

function parseAvatarConfig(value: string | null): AgentPresetRecord["avatarConfig"] {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as AgentPresetRecord["avatarConfig"];
    }
  } catch {
    // Ignore invalid JSON
  }
  return undefined;
}

function parseMcpAccess(value: string | null): AgentMcpAccessConfig | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return sanitizeAgentMcpAccess(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function parseMemoryConfig(value: string | null): AgentMemoryConfig | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as AgentMemoryConfig;
    }
  } catch {
    // Ignore invalid JSON
  }
  return undefined;
}

function serializeMemoryConfig(value: AgentMemoryConfig | undefined): string | null {
  return value ? JSON.stringify(value) : null;
}

function parseBaseInstructionStates(value: string | null): BaseAgentInstructionStates | undefined {
  if (!value) return undefined;
  try {
    return parseBaseAgentInstructionStates(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function serializeBaseInstructionStates(value: BaseAgentInstructionStates | undefined): string | null {
  const parsed = parseBaseAgentInstructionStates(value);
  return parsed ? JSON.stringify(parsed) : null;
}

function serializeNullableBoolean(value: boolean | null | undefined): number | null {
  return typeof value === "boolean" ? (value ? 1 : 0) : null;
}

export class AgentPresetRepository {
  private readonly db: DatabaseAdapter;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  private nextId(): string {
    const row = this.db.prepare(
      `SELECT COALESCE(MAX(CAST(id AS INTEGER)), 0) AS max_id FROM agent_presets WHERE id GLOB '[0-9]*' AND CAST(id AS INTEGER) > 0`,
    ).get() as { max_id: number } | undefined;
    return String((row?.max_id ?? 0) + 1);
  }

  private resolveId(requestedId: string | undefined): string {
    if (requestedId) {
      const taken = this.db.prepare(`SELECT id FROM agent_presets WHERE id = ?`).get(requestedId);
      if (!taken) return requestedId;
    }
    return this.nextId();
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
    const id = this.resolveId(input.id);
    this.db.prepare(`
      INSERT INTO agent_presets (
        id,
        project_id,
        name,
        description,
        instruction_markdown,
        labels_json,
        source_path,
        source_scope,
        source_updated_at,
        source_imported_at,
        avatar_config_json,
        provider_config_id,
        model,
        container_run_as_root,
        memory_template_override_enabled,
        memory_template_markdown,
        persistent_skill_storage_enabled,
        memory_config_json,
        mcp_access_json,
        base_instruction_state_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      input.name.trim(),
      input.description?.trim() || "",
      input.instructionMarkdown?.trim() || "",
      JSON.stringify(this.normalizeLabels(input.labels)),
      null,
      null,
      null,
      null,
      input.avatarConfig ? JSON.stringify(input.avatarConfig) : null,
      input.providerConfigId?.trim() || null,
      input.model?.trim() || null,
      serializeNullableBoolean(input.containerRunAsRoot),
      input.memoryTemplateOverrideEnabled ? 1 : 0,
      input.memoryTemplateMarkdown || null,
      input.persistentSkillStorage?.enabled ? 1 : 0,
      serializeMemoryConfig(input.memoryConfig),
      this.serializeMcpAccess(input.mcpAccess),
      serializeBaseInstructionStates(input.baseInstructionStates),
      now,
      now,
    );
    this.replacePersistentSkillStorageBindings(id, projectId, input.persistentSkillStorageIds, now);

    return requireRecord(this.getAgentPreset(id), "Agent preset", id);
  }

  importAgentPresetFromSource(projectId: string, input: CreateAgentPresetInput & AgentPresetSourceMetadata): AgentPresetRecord {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const now = new Date().toISOString();
    const id = this.resolveId(input.id);
    const importedAt = input.sourceImportedAt ?? input.sourceUpdatedAt;

    this.db.prepare(`
      INSERT INTO agent_presets (
        id,
        project_id,
        name,
        description,
        instruction_markdown,
        labels_json,
        source_path,
        source_scope,
        source_updated_at,
        source_imported_at,
        avatar_config_json,
        provider_config_id,
        model,
        container_run_as_root,
        memory_template_override_enabled,
        memory_template_markdown,
        persistent_skill_storage_enabled,
        memory_config_json,
        mcp_access_json,
        base_instruction_state_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      input.name.trim(),
      input.description?.trim() || "",
      input.instructionMarkdown?.trim() || "",
      JSON.stringify(this.normalizeLabels(input.labels)),
      input.sourcePath,
      input.sourceScope,
      input.sourceUpdatedAt,
      importedAt,
      input.avatarConfig ? JSON.stringify(input.avatarConfig) : null,
      input.providerConfigId?.trim() || null,
      input.model?.trim() || null,
      serializeNullableBoolean(input.containerRunAsRoot),
      input.memoryTemplateOverrideEnabled ? 1 : 0,
      input.memoryTemplateMarkdown || null,
      input.persistentSkillStorage?.enabled ? 1 : 0,
      input.memoryConfig ? JSON.stringify(input.memoryConfig) : null,
      this.serializeMcpAccess(input.mcpAccess),
      serializeBaseInstructionStates(input.baseInstructionStates),
      now,
      now,
    );
    this.replacePersistentSkillStorageBindings(id, projectId, input.persistentSkillStorageIds, now);

    return requireRecord(this.getAgentPreset(id), "Agent preset", id);
  }

  updateAgentPreset(agentPresetId: string, input: UpdateAgentPresetInput): AgentPresetRecord {
    const current = requireRecord(this.getAgentPreset(agentPresetId), "Agent preset", agentPresetId);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE agent_presets
      SET name = ?, description = ?, instruction_markdown = ?, labels_json = ?, avatar_config_json = ?, provider_config_id = ?, model = ?, container_run_as_root = ?, memory_template_override_enabled = ?, memory_template_markdown = ?, persistent_skill_storage_enabled = ?, memory_config_json = ?, mcp_access_json = ?, base_instruction_state_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name?.trim() || current.name,
      input.description === undefined ? current.description : input.description.trim(),
      input.instructionMarkdown === undefined ? current.instructionMarkdown : input.instructionMarkdown.trim(),
      JSON.stringify(input.labels === undefined ? current.labels : this.normalizeLabels(input.labels)),
      input.avatarConfig === undefined
        ? (current.avatarConfig ? JSON.stringify(current.avatarConfig) : null)
        : (input.avatarConfig ? JSON.stringify(input.avatarConfig) : null),
      input.providerConfigId === undefined ? current.providerConfigId || null : input.providerConfigId?.trim() || null,
      input.model === undefined ? current.model || null : input.model?.trim() || null,
      input.containerRunAsRoot === undefined ? serializeNullableBoolean(current.containerRunAsRoot) : serializeNullableBoolean(input.containerRunAsRoot),
      input.memoryTemplateOverrideEnabled === undefined ? (current.memoryTemplateOverrideEnabled ? 1 : 0) : (input.memoryTemplateOverrideEnabled ? 1 : 0),
      input.memoryTemplateMarkdown === undefined ? (current.memoryTemplateMarkdown || null) : (input.memoryTemplateMarkdown || null),
      input.persistentSkillStorage === undefined ? (current.persistentSkillStorage?.enabled ? 1 : 0) : (input.persistentSkillStorage.enabled ? 1 : 0),
      input.memoryConfig === undefined
        ? (current.memoryConfig ? JSON.stringify(current.memoryConfig) : null)
        : (input.memoryConfig ? JSON.stringify(input.memoryConfig) : null),
      input.mcpAccess === undefined ? this.serializeMcpAccess(current.mcpAccess) : this.serializeMcpAccess(input.mcpAccess),
      input.baseInstructionStates === undefined
        ? serializeBaseInstructionStates(current.baseInstructionStates)
        : serializeBaseInstructionStates(input.baseInstructionStates),
      now,
      agentPresetId,
    );
    if (input.persistentSkillStorageIds !== undefined) {
      this.replacePersistentSkillStorageBindings(agentPresetId, current.projectId, input.persistentSkillStorageIds, now);
    }

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
    description?: string;
    instructionMarkdown: string;
    sourceUpdatedAt: string;
    avatarConfig?: AgentPresetRecord["avatarConfig"];
    providerConfigId?: string | null;
    model?: string | null;
    memoryTemplateOverrideEnabled?: boolean;
    memoryTemplateMarkdown?: string;
    memoryConfig?: AgentMemoryConfig;
    containerRunAsRoot?: boolean | null;
  }): AgentPresetRecord {
    const current = requireRecord(this.getAgentPreset(agentPresetId), "Agent preset", agentPresetId);
    if (!current.sourcePath || !current.sourceScope) {
      throw new Error(`Agent ${agentPresetId} is not linked to a markdown source.`);
    }
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE agent_presets
      SET name = ?, description = ?, instruction_markdown = ?, source_updated_at = ?, source_imported_at = ?, avatar_config_json = ?, provider_config_id = ?, model = ?, container_run_as_root = ?, memory_template_override_enabled = ?, memory_template_markdown = ?, memory_config_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name.trim(),
      input.description === undefined ? current.description : input.description.trim(),
      input.instructionMarkdown.trim(),
      input.sourceUpdatedAt,
      input.sourceUpdatedAt,
      input.avatarConfig ? JSON.stringify(input.avatarConfig) : null,
      input.providerConfigId === undefined ? current.providerConfigId || null : input.providerConfigId?.trim() || null,
      input.model === undefined ? current.model || null : input.model?.trim() || null,
      input.containerRunAsRoot === undefined ? serializeNullableBoolean(current.containerRunAsRoot) : serializeNullableBoolean(input.containerRunAsRoot),
      input.memoryTemplateOverrideEnabled ? 1 : 0,
      input.memoryTemplateMarkdown || null,
      input.memoryConfig === undefined
        ? (current.memoryConfig ? JSON.stringify(current.memoryConfig) : null)
        : (input.memoryConfig ? JSON.stringify(input.memoryConfig) : null),
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

  hasCopiedDefaultAgentPresets(projectId: string): boolean {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const row = this.db.prepare(`
      SELECT payload
      FROM app_settings
      WHERE key = ?
    `).get(this.defaultAgentCopyKey(projectId)) as { payload: string } | undefined;

    if (!row) {
      return false;
    }

    try {
      const parsed = JSON.parse(row.payload) as { copied?: boolean };
      return parsed.copied === true;
    } catch {
      return false;
    }
  }

  markDefaultAgentPresetsCopied(projectId: string): void {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO app_settings (key, payload, updated_at)
      VALUES (?, ?, ?)
      ${this.db.dialect.upsert(["key"], ["payload", "updated_at"])}
    `).run(
      this.defaultAgentCopyKey(projectId),
      JSON.stringify({ copied: true, copiedAt: now }),
      now,
    );
  }

  hasSeededInternalDocsSubscription(projectId: string): boolean {
    return this.readBooleanProjectSetting(projectId, this.internalDocsSubscriptionKey(projectId), "seeded");
  }

  markInternalDocsSubscriptionSeeded(projectId: string): void {
    this.writeBooleanProjectSetting(projectId, this.internalDocsSubscriptionKey(projectId), "seeded");
  }

  private mapRow(row: AgentPresetRow): AgentPresetRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description || "",
      instructionMarkdown: row.instruction_markdown,
      labels: parseLabels(row.labels_json),
      sourcePath: row.source_path,
      sourceScope: this.parseSourceScope(row.source_scope),
      sourceUpdatedAt: row.source_updated_at,
      sourceImportedAt: row.source_imported_at,
      sourceExists: Boolean(row.source_path),
      syncStatus: row.source_path ? "synced" : "manual",
      avatarConfig: parseAvatarConfig(row.avatar_config_json),
      providerConfigId: row.provider_config_id || null,
      model: row.model || null,
      containerRunAsRoot: row.container_run_as_root === null || row.container_run_as_root === undefined
        ? null
        : Boolean(row.container_run_as_root),
      memoryTemplateOverrideEnabled: Boolean(row.memory_template_override_enabled),
      memoryTemplateMarkdown: row.memory_template_markdown || undefined,
      memoryConfig: parseMemoryConfig(row.memory_config_json),
      mcpAccess: parseMcpAccess(row.mcp_access_json),
      persistentSkillStorageIds: this.listPersistentSkillStorageIds(row.id),
      persistentSkillStorage: { enabled: Boolean(row.persistent_skill_storage_enabled) },
      baseInstructionStates: parseBaseInstructionStates(row.base_instruction_state_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private serializeMcpAccess(mcpAccess: AgentMcpAccessConfig | undefined): string | null {
    return mcpAccess ? JSON.stringify(sanitizeAgentMcpAccess(mcpAccess)) : null;
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

  private normalizeStorageIds(storageIds?: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const storageId of storageIds || []) {
      const trimmed = String(storageId || "").trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      normalized.push(trimmed);
    }
    return normalized;
  }

  private listPersistentSkillStorageIds(agentPresetId: string): string[] {
    const rows = this.db.prepare(`
      SELECT storage_id
      FROM agent_skill_storage_bindings
      WHERE agent_preset_id = ?
        AND enabled = 1
      ORDER BY created_at ASC, storage_id ASC
    `).all(agentPresetId) as Array<{ storage_id: string }>;
    return rows.map((row) => row.storage_id);
  }

  private replacePersistentSkillStorageBindings(
    agentPresetId: string,
    projectId: string,
    storageIds: string[] | undefined,
    now: string,
  ): void {
    const normalized = this.normalizeStorageIds(storageIds);
    this.db.prepare(`
      DELETE FROM agent_skill_storage_bindings
      WHERE agent_preset_id = ?
    `).run(agentPresetId);
    for (const storageId of normalized) {
      this.db.prepare(`
        INSERT INTO agent_skill_storage_bindings (
          agent_preset_id,
          storage_id,
          project_id,
          enabled,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 1, ?, ?)
      `).run(agentPresetId, storageId, projectId, now, now);
    }
  }

  private parseSourceScope(value: string | null): AgentSourceScope | null {
    if (value === "project" || value === "home" || value === "default") {
      return value;
    }
    return null;
  }

  private defaultAgentCopyKey(projectId: string): string {
    return `default_agent_presets_copied_${projectId}`;
  }

  private internalDocsSubscriptionKey(projectId: string): string {
    return `internal_docs_subscription_seeded_${projectId}`;
  }

  private readBooleanProjectSetting(projectId: string, key: string, property: string): boolean {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const row = this.db.prepare(`
      SELECT payload
      FROM app_settings
      WHERE key = ?
    `).get(key) as { payload: string } | undefined;

    if (!row) {
      return false;
    }

    try {
      const parsed = JSON.parse(row.payload) as Record<string, unknown>;
      return parsed[property] === true;
    } catch {
      return false;
    }
  }

  private writeBooleanProjectSetting(projectId: string, key: string, property: string): void {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO app_settings (key, payload, updated_at)
      VALUES (?, ?, ?)
      ${this.db.dialect.upsert(["key"], ["payload", "updated_at"])}
    `).run(
      key,
      JSON.stringify({ [property]: true, updatedAt: now }),
      now,
    );
  }
}
