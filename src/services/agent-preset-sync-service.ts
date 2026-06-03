import * as fs from "fs/promises";
import * as path from "path";
import type { AgentMcpAccessConfig, AgentMemoryConfig, AgentPresetRecord, AgentSourceScope, AgentAvatarConfig } from "../contracts/agent-preset-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { AgentPresetRepository } from "../repositories/agent-preset-repository.js";
import { parseAgentMarkdown, formatAgentMarkdown } from "./agent-preset-markdown.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import { getHomeCodeUxPath, getRepoCodeUxPath } from "../shared/config/code-ux-paths.js";
import type { Logger } from "../shared/logging/logger.js";
import { ensureDefaultCodeUxAssetsInstalled } from "./code-ux-default-assets-service.js";

interface AgentPresetSyncServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  agentPresetRepository: AgentPresetRepository;
  settingsRepository: SettingsRepository;
  projectRoot: string;
  logger?: Logger;
}

interface AgentSourceFile {
  name: string;
  normalizedName: string;
  sourcePath: string;
  sourceScope: AgentSourceScope;
  sourceUpdatedAt: string;
  description?: string;
  instructionMarkdown: string;
  avatarConfig?: AgentAvatarConfig;
  providerConfigId?: string | null;
  model?: string | null;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
}

const BASE_AGENT_IDS: Record<string, string> = {
  "worker": "1",
  "planning agent": "2",
  "project manager": "3",
  "quality assurance agent": "4",
  "project setup agent": "5",
};

export class AgentPresetSyncService {
  constructor(private readonly deps: AgentPresetSyncServiceDeps) {}

  async listAgentPresets(projectId: string): Promise<AgentPresetRecord[]> {
    await this.syncProjectAgents(projectId);
    return await this.decorateProjectAgentPresets(projectId);
  }

  async createAgentPreset(projectId: string, input: {
    id?: string;
    name: string;
    description?: string;
    instructionMarkdown?: string;
    labels?: string[];
    avatarConfig?: AgentAvatarConfig;
    providerConfigId?: string | null;
    model?: string | null;
    memoryTemplateOverrideEnabled?: boolean;
    memoryTemplateMarkdown?: string;
    memoryConfig?: AgentMemoryConfig;
  }): Promise<AgentPresetRecord> {
    const nextName = input.name.trim();
    this.assertAgentNameAvailable(projectId, nextName);

    if (this.shouldSaveToProjectDirectory(projectId)) {
      const project = this.requireProject(projectId);
      const source = await this.writeProjectAgentFile({
        projectBaseDir: project.baseDir,
        name: nextName,
        description: input.description?.trim() || "",
        instructionMarkdown: input.instructionMarkdown?.trim() || "",
        avatarConfig: input.avatarConfig,
        providerConfigId: input.providerConfigId,
        model: input.model,
        memoryTemplateOverrideEnabled: input.memoryTemplateOverrideEnabled,
        memoryTemplateMarkdown: input.memoryTemplateMarkdown,
        memoryConfig: input.memoryConfig,
      });
      const created = this.deps.agentPresetRepository.importAgentPresetFromSource(projectId, {
        id: input.id,
        name: nextName,
        description: source.description ?? input.description,
        instructionMarkdown: source.instructionMarkdown,
        labels: input.labels,
        sourcePath: source.sourcePath,
        sourceScope: source.sourceScope,
        sourceUpdatedAt: source.sourceUpdatedAt,
        sourceImportedAt: source.sourceUpdatedAt,
        avatarConfig: source.avatarConfig,
        providerConfigId: source.providerConfigId,
        model: source.model,
        memoryTemplateOverrideEnabled: source.memoryTemplateOverrideEnabled,
        memoryTemplateMarkdown: source.memoryTemplateMarkdown,
      });
      return await this.decorateAgentPreset(created);
    }

    const created = this.deps.agentPresetRepository.createAgentPreset(projectId, input);
    return await this.decorateAgentPreset(created);
  }

  async updateAgentPreset(agentPresetId: string, input: {
    name?: string;
    description?: string;
    instructionMarkdown?: string;
    labels?: string[];
    avatarConfig?: AgentAvatarConfig;
    providerConfigId?: string | null;
    model?: string | null;
    memoryTemplateOverrideEnabled?: boolean;
    memoryTemplateMarkdown?: string;
    mcpAccess?: AgentMcpAccessConfig;
    memoryConfig?: AgentMemoryConfig;
  }): Promise<AgentPresetRecord> {
    const existing = this.deps.agentPresetRepository.getAgentPreset(agentPresetId);
    if (!existing) {
      throw new Error(`Agent not found: ${agentPresetId}`);
    }

    const nextName = input.name?.trim() || existing.name;
    const nextInstructionMarkdown = input.instructionMarkdown === undefined
      ? existing.instructionMarkdown
      : input.instructionMarkdown.trim();

    this.assertAgentNameAvailable(existing.projectId, nextName, existing.id);

    if (this.shouldSaveToProjectDirectory(existing.projectId)) {
      const project = this.requireProject(existing.projectId);
      const source = await this.writeProjectAgentFile({
        projectBaseDir: project.baseDir,
        name: nextName,
        description: input.description === undefined ? existing.description : input.description,
        instructionMarkdown: nextInstructionMarkdown,
        avatarConfig: input.avatarConfig === undefined ? existing.avatarConfig : input.avatarConfig,
        providerConfigId: input.providerConfigId === undefined ? existing.providerConfigId : input.providerConfigId,
        model: input.model === undefined ? existing.model : input.model,
        memoryTemplateOverrideEnabled: input.memoryTemplateOverrideEnabled === undefined ? existing.memoryTemplateOverrideEnabled : input.memoryTemplateOverrideEnabled,
        memoryTemplateMarkdown: input.memoryTemplateMarkdown === undefined ? existing.memoryTemplateMarkdown : input.memoryTemplateMarkdown,
        previousProjectSourcePath: existing.sourceScope === "project" ? existing.sourcePath : null,
      });

      this.deps.agentPresetRepository.updateAgentPreset(agentPresetId, input);
      const linked = this.deps.agentPresetRepository.linkAgentPresetToSource(agentPresetId, {
        sourcePath: source.sourcePath,
        sourceScope: source.sourceScope,
        sourceUpdatedAt: source.sourceUpdatedAt,
        sourceImportedAt: source.sourceUpdatedAt,
      });
      return await this.decorateAgentPreset(linked);
    }

    const updated = this.deps.agentPresetRepository.updateAgentPreset(agentPresetId, input);
    return await this.decorateAgentPreset(updated);
  }

  async deleteAgentPreset(agentPresetId: string): Promise<void> {
    const existing = this.deps.agentPresetRepository.getAgentPreset(agentPresetId);
    if (!existing) {
      throw new Error(`Agent not found: ${agentPresetId}`);
    }

    if (existing.sourceScope === "project" && existing.sourcePath) {
      await fs.rm(existing.sourcePath, { force: true }).catch(() => undefined);
    }

    this.deps.agentPresetRepository.deleteAgentPreset(agentPresetId);
  }

  async syncProjectAgents(projectId: string): Promise<void> {
    const project = this.requireProject(projectId);
    const existingPresets = this.deps.agentPresetRepository.listAgentPresets(projectId);
    const presetsById = new Map(existingPresets.map((preset) => [preset.id, preset]));
    const presetsByName = new Map(existingPresets.map((preset) => [this.normalizeName(preset.name), preset]));
    const defaultAgentPresetsCopied = this.deps.agentPresetRepository.hasCopiedDefaultAgentPresets(projectId);
    const sourceFiles = await this.readAgentSources(project.baseDir, { defaultAgentPresetsCopied });
    let copiedDefaultAgentPresetThisSync = false;

    for (const source of sourceFiles) {
      const existing = existingPresets.find((preset) => preset.sourcePath === source.sourcePath)
        || presetsByName.get(source.normalizedName)
        || null;

      if (!existing) {
        const labels = this.inferLabelsForSource(source.normalizedName);
        const stableId = BASE_AGENT_IDS[source.normalizedName];
        const created = this.deps.agentPresetRepository.importAgentPresetFromSource(projectId, {
          id: stableId,
          name: source.name,
          description: source.description,
          instructionMarkdown: source.instructionMarkdown,
          labels,
          sourcePath: source.sourcePath,
          sourceScope: source.sourceScope,
          sourceUpdatedAt: source.sourceUpdatedAt,
          sourceImportedAt: source.sourceUpdatedAt,
          avatarConfig: source.avatarConfig,
          providerConfigId: source.providerConfigId,
          model: source.model,
          memoryTemplateOverrideEnabled: source.memoryTemplateOverrideEnabled,
          memoryTemplateMarkdown: source.memoryTemplateMarkdown,
        });
        presetsById.set(created.id, created);
        presetsByName.set(source.normalizedName, created);
        if (this.isDefaultBaseAgentSource(source)) {
          copiedDefaultAgentPresetThisSync = true;
        }
        continue;
      }

      const metadataChanged = existing.sourcePath !== source.sourcePath
        || existing.sourceScope !== source.sourceScope
        || existing.sourceUpdatedAt !== source.sourceUpdatedAt;

      if (metadataChanged) {
        this.deps.agentPresetRepository.linkAgentPresetToSource(existing.id, {
          sourcePath: source.sourcePath,
          sourceScope: source.sourceScope,
          sourceUpdatedAt: source.sourceUpdatedAt,
          sourceImportedAt: source.sourceUpdatedAt,
        });
      }

      const contentChanged = source.instructionMarkdown.trim() !== existing.instructionMarkdown.trim();
      const descriptionChanged = (source.description || "") !== (existing.description || "");
      const nameChanged = source.normalizedName !== this.normalizeName(existing.name);
      const avatarChanged = JSON.stringify(source.avatarConfig || {}) !== JSON.stringify(existing.avatarConfig || {});
      const providerChanged = (source.providerConfigId || "") !== (existing.providerConfigId || "");
      const modelChanged = (source.model || "") !== (existing.model || "");
      const memoryEnabledChanged = Boolean(source.memoryTemplateOverrideEnabled) !== Boolean(existing.memoryTemplateOverrideEnabled);
      const memoryMarkdownChanged = (source.memoryTemplateMarkdown || "") !== (existing.memoryTemplateMarkdown || "");

      if (contentChanged || descriptionChanged || nameChanged || avatarChanged || providerChanged || modelChanged || memoryEnabledChanged || memoryMarkdownChanged) {
        const imported = this.deps.agentPresetRepository.importLinkedAgentPreset(existing.id, {
          name: source.sourceScope === "project" ? existing.name : source.name,
          description: source.description,
          instructionMarkdown: source.instructionMarkdown,
          sourceUpdatedAt: source.sourceUpdatedAt,
          avatarConfig: source.avatarConfig,
          providerConfigId: source.providerConfigId,
          model: source.model,
          memoryTemplateOverrideEnabled: source.memoryTemplateOverrideEnabled,
          memoryTemplateMarkdown: source.memoryTemplateMarkdown,
        });
        presetsById.set(imported.id, imported);
        presetsByName.set(source.normalizedName, imported);
      }
    }

    if (!defaultAgentPresetsCopied && copiedDefaultAgentPresetThisSync) {
      this.deps.agentPresetRepository.markDefaultAgentPresetsCopied(projectId);
    }
  }

  async importAgentPresetFromMarkdown(agentPresetId: string): Promise<AgentPresetRecord> {
    const existing = this.deps.agentPresetRepository.getAgentPreset(agentPresetId);
    if (!existing) {
      throw new Error(`Agent not found: ${agentPresetId}`);
    }
    if (!existing.sourcePath) {
      throw new Error(`Agent ${existing.name} is not linked to a markdown file.`);
    }

    const source = await this.readAgentSourceFile(existing.sourcePath, existing.sourceScope || "project");
    const updated = this.deps.agentPresetRepository.importLinkedAgentPreset(agentPresetId, {
      name: existing.sourceScope === "project" ? existing.name : source.name,
      description: source.description,
      instructionMarkdown: source.instructionMarkdown,
      sourceUpdatedAt: source.sourceUpdatedAt,
      avatarConfig: source.avatarConfig,
      providerConfigId: source.providerConfigId,
      model: source.model,
      memoryTemplateOverrideEnabled: source.memoryTemplateOverrideEnabled,
      memoryTemplateMarkdown: source.memoryTemplateMarkdown,
    });

    return await this.decorateAgentPreset(updated);
  }

  async syncAllAgentPresetsFromMarkdown(projectId: string): Promise<AgentPresetRecord[]> {
    await this.syncProjectAgents(projectId);
    const presets = await this.decorateProjectAgentPresets(projectId);

    for (const preset of presets) {
      if (preset.syncStatus === "out_of_sync" && preset.sourcePath) {
        await this.importAgentPresetFromMarkdown(preset.id);
      }
    }

    return await this.decorateProjectAgentPresets(projectId);
  }

  async getPlanningAgent(projectId: string): Promise<AgentPresetRecord> {
    return await this.getRequiredAgent(projectId, "Planning agent", "planning_agent.md");
  }

  async resolveTargetedPlanningAgent(projectId: string, planningAgentPresetId?: string): Promise<AgentPresetRecord> {
    await this.syncProjectAgents(projectId);

    if (planningAgentPresetId) {
      const targeted = this.deps.agentPresetRepository.getAgentPreset(planningAgentPresetId);
      if (targeted && targeted.projectId === projectId) {
        return await this.decorateAgentPreset(targeted);
      }
    }

    return await this.getPlanningAgent(projectId);
  }

  async getWorkerAgent(projectId: string): Promise<AgentPresetRecord> {
    return await this.getRequiredAgent(projectId, "Worker", "worker.md");
  }

  async getProjectManagerAgent(projectId: string): Promise<AgentPresetRecord> {
    return await this.getRequiredAgent(projectId, "Project manager", "project_manager.md");
  }

  async getQualityAssuranceAgent(projectId: string): Promise<AgentPresetRecord> {
    return await this.getRequiredAgent(projectId, "Quality assurance agent", "quality_assurance_agent.md");
  }

  async resolveTargetedQualityAssuranceAgent(projectId: string, agentPresetId?: string | null): Promise<AgentPresetRecord> {
    await this.syncProjectAgents(projectId);

    if (agentPresetId) {
      const targeted = this.deps.agentPresetRepository.getAgentPreset(agentPresetId);
      if (targeted && targeted.projectId === projectId) {
        return await this.decorateAgentPreset(targeted);
      }
    }

    return await this.getQualityAssuranceAgent(projectId);
  }

  async resolveTargetedCodingAgent(projectId: string, agentPresetId?: string | null): Promise<AgentPresetRecord> {
    await this.syncProjectAgents(projectId);

    if (agentPresetId) {
      const targeted = this.deps.agentPresetRepository.getAgentPreset(agentPresetId);
      if (targeted && targeted.projectId === projectId) {
        return await this.decorateAgentPreset(targeted);
      }
    }

    return await this.getWorkerAgent(projectId);
  }

  async getOptionalWorkerAgentForRepoPath(repoPath: string): Promise<AgentPresetRecord | null> {
    return await this.getOptionalAgentForRepoPath(repoPath, "Worker");
  }

  private async decorateProjectAgentPresets(projectId: string): Promise<AgentPresetRecord[]> {
    const presets = this.deps.agentPresetRepository.listAgentPresets(projectId);
    const decorated: AgentPresetRecord[] = [];
    for (const preset of presets) {
      decorated.push(await this.decorateAgentPreset(preset));
    }
    return decorated.sort((left, right) => {
      if (left.syncStatus !== right.syncStatus) {
        const rank = (status: AgentPresetRecord["syncStatus"]): number => {
          switch (status) {
            case "out_of_sync":
              return 0;
            case "missing_source":
              return 1;
            case "synced":
              return 2;
            default:
              return 3;
          }
        };
        return rank(left.syncStatus) - rank(right.syncStatus);
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }

  private async decorateAgentPreset(preset: AgentPresetRecord): Promise<AgentPresetRecord> {
    if (!preset.sourcePath) {
      return {
        ...preset,
        sourceExists: false,
        syncStatus: "manual",
      };
    }

    try {
      const source = await this.readAgentSourceFile(preset.sourcePath, preset.sourceScope || "project");
      const sourceDiffersFromDb = this.normalizeName(source.name) !== this.normalizeName(preset.name)
        || (source.description || "") !== (preset.description || "")
        || source.instructionMarkdown.trim() !== preset.instructionMarkdown.trim()
        || JSON.stringify(source.avatarConfig || {}) !== JSON.stringify(preset.avatarConfig || {})
        || (source.providerConfigId || "") !== (preset.providerConfigId || "")
        || (source.model || "") !== (preset.model || "")
        || Boolean(source.memoryTemplateOverrideEnabled) !== Boolean(preset.memoryTemplateOverrideEnabled)
        || (source.memoryTemplateMarkdown || "") !== (preset.memoryTemplateMarkdown || "");
      return {
        ...preset,
        sourceScope: source.sourceScope,
        sourceUpdatedAt: source.sourceUpdatedAt,
        sourceExists: true,
        syncStatus: sourceDiffersFromDb
          ? "out_of_sync"
          : "synced",
      };
    } catch {
      return {
        ...preset,
        sourceExists: false,
        syncStatus: "missing_source",
      };
    }
  }

  private async readAgentSources(repoPath: string, options: { defaultAgentPresetsCopied: boolean }): Promise<AgentSourceFile[]> {
    await ensureDefaultCodeUxAssetsInstalled({
      projectRoot: this.deps.projectRoot,
      logger: this.deps.logger,
      skipDefaultAgentFiles: options.defaultAgentPresetsCopied,
    });

    const collected = new Map<string, AgentSourceFile>();
    const roots: Array<{ directory: string; scope: AgentSourceScope }> = [
      { directory: getRepoCodeUxPath(repoPath, "agents"), scope: "project" },
      { directory: getRepoCodeUxPath(this.deps.projectRoot, "agents"), scope: "default" },
      { directory: getHomeCodeUxPath("agents"), scope: "home" },
    ];

    for (const root of roots) {
      const entries = await fs.readdir(root.directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
          continue;
        }
        const sourcePath = path.join(root.directory, entry.name);
        const source = await this.readAgentSourceFile(sourcePath, root.scope);
        if (options.defaultAgentPresetsCopied && this.isDefaultBaseAgentSource(source)) {
          continue;
        }
        if (!collected.has(source.normalizedName)) {
          collected.set(source.normalizedName, source);
        }
      }
    }

    return Array.from(collected.values());
  }

  private isDefaultBaseAgentSource(source: AgentSourceFile): boolean {
    return (source.sourceScope === "default" || source.sourceScope === "home")
      && Object.prototype.hasOwnProperty.call(BASE_AGENT_IDS, source.normalizedName);
  }

  private async readAgentSourceFile(sourcePath: string, sourceScope: AgentSourceScope): Promise<AgentSourceFile> {
    const stats = await fs.stat(sourcePath);
    const rawMarkdown = await fs.readFile(sourcePath, "utf8");
    const parsed = parseAgentMarkdown(rawMarkdown);
    const rawName = path.basename(sourcePath, path.extname(sourcePath)).trim();
    const name = this.toDisplayNameFromStem(rawName);

    return {
      name,
      normalizedName: this.normalizeName(name),
      sourcePath,
      sourceScope,
      sourceUpdatedAt: stats.mtime.toISOString(),
      description: parsed.description,
      instructionMarkdown: parsed.instructionMarkdown,
      avatarConfig: parsed.avatarConfig,
      providerConfigId: parsed.providerConfigId,
      model: parsed.model,
      memoryTemplateOverrideEnabled: parsed.memoryTemplateOverrideEnabled,
      memoryTemplateMarkdown: parsed.memoryTemplateMarkdown,
    };
  }

  private normalizeName(value: string): string {
    return value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
  }

  private inferLabelsForSource(normalizedName: string): string[] {
    if (normalizedName === "planning agent") {
      return ["planning"];
    }
    if (normalizedName === "worker") {
      return ["worker"];
    }
    if (normalizedName === "quality assurance agent") {
      return ["qa", "review"];
    }
    if (normalizedName === "project setup agent") {
      return ["planning", "setup"];
    }
    return [];
  }

  private async getRequiredAgent(projectId: string, name: string, suggestedFileName: string): Promise<AgentPresetRecord> {
    await this.syncProjectAgents(projectId);
    const agent = this.deps.agentPresetRepository.findAgentPresetByName(projectId, name);
    if (!agent) {
      throw new Error(`${name} not found. Add \`${suggestedFileName}\` under \`.code-ux/agents\` or create it in Agents.`);
    }
    return await this.decorateAgentPreset(agent);
  }

  private async getOptionalAgentForRepoPath(repoPath: string, name: string): Promise<AgentPresetRecord | null> {
    const project = this.deps.projectManagementRepository.findProjectByBaseDir(repoPath);
    if (!project) {
      return null;
    }

    await this.syncProjectAgents(project.id);
    const agent = this.deps.agentPresetRepository.findAgentPresetByName(project.id, name);
    return agent ? await this.decorateAgentPreset(agent) : null;
  }

  private shouldSaveToProjectDirectory(projectId: string): boolean {
    return this.deps.settingsRepository.getProjectResolvedSettings(projectId).agents.saveToProjectDirectory;
  }

  private assertAgentNameAvailable(projectId: string, name: string, currentAgentId?: string): void {
    const existing = this.deps.agentPresetRepository.findAgentPresetByName(projectId, name);
    if (existing && existing.id !== currentAgentId) {
      throw new Error(`An agent named "${name}" already exists for this project.`);
    }
  }

  private async writeProjectAgentFile(args: {
    projectBaseDir: string;
    name: string;
    description?: string;
    instructionMarkdown: string;
    avatarConfig?: AgentAvatarConfig;
    providerConfigId?: string | null;
    model?: string | null;
    memoryTemplateOverrideEnabled?: boolean;
    memoryTemplateMarkdown?: string;
    memoryConfig?: AgentMemoryConfig;
    previousProjectSourcePath?: string | null;
  }): Promise<AgentSourceFile> {
    const directory = getRepoCodeUxPath(args.projectBaseDir, "agents");
    await fs.mkdir(directory, { recursive: true });

    const filePath = path.join(directory, `${this.toAgentFileStem(args.name)}.md`);
    if (!args.previousProjectSourcePath || args.previousProjectSourcePath !== filePath) {
      const fileAlreadyExists = await fs.stat(filePath)
        .then(() => true)
        .catch(() => false);
      if (fileAlreadyExists) {
        throw new Error(`Project agent file already exists: ${filePath}`);
      }
    }

    const fileContent = formatAgentMarkdown({
      description: args.description,
      instructionMarkdown: args.instructionMarkdown,
      avatarConfig: args.avatarConfig,
      providerConfigId: args.providerConfigId,
      model: args.model,
      memoryTemplateOverrideEnabled: args.memoryTemplateOverrideEnabled,
      memoryTemplateMarkdown: args.memoryTemplateMarkdown,
    });
    await fs.writeFile(filePath, fileContent, "utf8");

    if (args.previousProjectSourcePath && args.previousProjectSourcePath !== filePath) {
      await fs.rm(args.previousProjectSourcePath, { force: true }).catch(() => undefined);
    }

    return await this.readAgentSourceFile(filePath, "project");
  }

  private toAgentFileStem(name: string): string {
    const normalized = name.trim().replace(/\.md$/i, "").replace(/\s+/g, " ");
    const sanitized = normalized
      .toLowerCase()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_")
      .trim();
    return sanitized || "unnamed_agent";
  }

  private toDisplayNameFromStem(stem: string): string {
    const normalized = stem
      .trim()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (this.normalizeName(normalized) === "planning agent") {
      return "Planning agent";
    }

    if (this.normalizeName(normalized) === "worker") {
      return "Worker";
    }

    if (this.normalizeName(normalized) === "project manager") {
      return "Project manager";
    }

    if (this.normalizeName(normalized) === "quality assurance agent") {
      return "Quality assurance agent";
    }

    if (this.normalizeName(normalized) === "project setup agent") {
      return "Project Setup Agent";
    }

    return normalized.length > 0 ? normalized : "Unnamed agent";
  }

  private requireProject(projectId: string): NonNullable<ReturnType<ProjectManagementRepository["getProject"]>> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }
}
