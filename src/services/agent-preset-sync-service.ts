import * as fs from "fs/promises";
import * as path from "path";
import type {
  AgentMcpAccessConfig,
  AgentMemoryConfig,
  AgentPresetRecord,
  AgentSourceScope,
  AgentAvatarConfig,
  BaseAgentInstructionState,
  BaseAgentRole,
  BaseAgentUpdateContext,
  BaseAgentUpdateNotice,
  PushAgentPresetsToMarkdownOptions,
} from "../contracts/agent-preset-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { AgentPresetRepository } from "../repositories/agent-preset-repository.js";
import { ValidationError } from "../repositories/repository-utils.js";
import { parseAgentMarkdown, formatAgentMarkdown } from "./agent-preset-markdown.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import { getHomeCodeUxPath, getRepoCodeUxPath } from "../shared/config/code-ux-paths.js";
import type { Logger } from "../shared/logging/logger.js";
import { ensureDefaultCodeUxAssetsInstalled, resolveBundledCodeUxDir } from "./code-ux-default-assets-service.js";
import { CODE_UX_INTERNAL_DOCS_SOURCE_REF, type KnowledgeService } from "./knowledge-service.js";
import { runCommandStrict } from "./cli-process-runner.js";
import { readLocalGitOriginUrl } from "../infrastructure/git/local-git-origin.js";
import { PrService } from "../infrastructure/providers/cli/pr-service.js";
import { hasAgentAvatarConfig, resolveAgentAvatarConfig } from "../contracts/agent-avatar-style.js";
import { defaultCodingAgentMcpAccess } from "./agent-mcp-access.js";
import type { SkillService } from "./skill-service.js";
import {
  BASE_AGENT_ROLE_DEFINITIONS,
  createBaseAgentInstructionState,
  getBaseAgentRoleDefinition,
  hashBaseAgentInstructions,
  resolveBaseAgentRole,
} from "./base-agent-update-state.js";

interface AgentPresetSyncServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  agentPresetRepository: AgentPresetRepository;
  settingsRepository: SettingsRepository;
  getGithubToken?: () => string | undefined;
  projectRoot: string;
  logger?: Logger;
  knowledgeService?: KnowledgeService;
  skillService?: Pick<SkillService, "listStorages" | "createStorage">;
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
  containerRunAsRoot?: boolean | null;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;
  memoryConfig?: AgentMemoryConfig;
}

interface BundledBaseAgentSource {
  role: BaseAgentRole;
  instructionMarkdown: string;
  revision: string;
}

const BASE_AGENT_IDS: Record<string, string> = {
  "worker": "1",
  "planning agent": "2",
  "project manager": "3",
  "iris": "3",
  "quality assurance agent": "4",
  "project setup agent": "5",
};

export const PROJECT_MANAGER_DEFAULT_SKILL_STORAGE_NAME = "Project Manager Skills";

export class AgentPresetSyncService {
  private static readonly DASHBOARD_BACKGROUND_SYNC_INTERVAL_MS = 30_000;
  private readonly projectSyncPromises = new Map<string, Promise<void>>();
  private readonly dashboardBackgroundSyncState = new Map<string, {
    lastStartedAt: number;
    promise: Promise<void> | null;
  }>();

  constructor(private readonly deps: AgentPresetSyncServiceDeps) {}

  async listAgentPresets(projectId: string): Promise<AgentPresetRecord[]> {
    await this.syncProjectAgents(projectId);
    return await this.decorateProjectAgentPresets(projectId);
  }

  async listAgentPresetsForDashboard(projectId: string): Promise<AgentPresetRecord[]> {
    const existingPresets = this.deps.agentPresetRepository.listAgentPresets(projectId);
    if (existingPresets.length === 0) {
      await this.syncProjectAgents(projectId);
      return await this.decorateProjectAgentPresets(projectId);
    }

    this.scheduleDashboardBackgroundSync(projectId);
    return this.sortAgentPresets(existingPresets);
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
    containerRunAsRoot?: boolean | null;
    memoryTemplateOverrideEnabled?: boolean;
    memoryTemplateMarkdown?: string;
    memoryConfig?: AgentMemoryConfig;
    mcpAccess?: AgentMcpAccessConfig;
  }): Promise<AgentPresetRecord> {
    const nextName = input.name.trim();
    this.assertAgentNameAvailable(projectId, nextName);
    const labels = input.labels ?? [];
    const avatarConfig = this.resolvePersistedAvatarConfig({
      projectId,
      id: input.id,
      name: nextName,
      labels,
      avatarConfig: input.avatarConfig,
    });

    if (this.shouldSaveToProjectDirectory(projectId)) {
      const project = this.requireProject(projectId);
      const source = await this.writeProjectAgentFile({
        projectBaseDir: project.baseDir,
        name: nextName,
        description: input.description?.trim() || "",
        instructionMarkdown: input.instructionMarkdown?.trim() || "",
        avatarConfig,
        providerConfigId: input.providerConfigId,
        model: input.model,
        containerRunAsRoot: input.containerRunAsRoot,
        memoryTemplateOverrideEnabled: input.memoryTemplateOverrideEnabled,
        memoryTemplateMarkdown: input.memoryTemplateMarkdown,
        memoryConfig: input.memoryConfig,
      });
      const created = this.deps.agentPresetRepository.importAgentPresetFromSource(projectId, {
        id: input.id,
        name: nextName,
        description: source.description ?? input.description,
        instructionMarkdown: source.instructionMarkdown,
        labels,
        sourcePath: source.sourcePath,
        sourceScope: source.sourceScope,
        sourceUpdatedAt: source.sourceUpdatedAt,
        sourceImportedAt: source.sourceUpdatedAt,
        avatarConfig: source.avatarConfig ?? avatarConfig,
        providerConfigId: source.providerConfigId,
        model: source.model,
        containerRunAsRoot: source.containerRunAsRoot,
        memoryTemplateOverrideEnabled: source.memoryTemplateOverrideEnabled,
        memoryTemplateMarkdown: source.memoryTemplateMarkdown,
        memoryConfig: source.memoryConfig,
        mcpAccess: input.mcpAccess,
      });
      return await this.decorateAgentPreset(created);
    }

    const created = this.deps.agentPresetRepository.createAgentPreset(projectId, {
      ...input,
      labels,
      avatarConfig,
    });
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
    containerRunAsRoot?: boolean | null;
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
        containerRunAsRoot: input.containerRunAsRoot === undefined ? existing.containerRunAsRoot : input.containerRunAsRoot,
        memoryTemplateOverrideEnabled: input.memoryTemplateOverrideEnabled === undefined ? existing.memoryTemplateOverrideEnabled : input.memoryTemplateOverrideEnabled,
        memoryTemplateMarkdown: input.memoryTemplateMarkdown === undefined ? existing.memoryTemplateMarkdown : input.memoryTemplateMarkdown,
        memoryConfig: input.memoryConfig === undefined ? existing.memoryConfig : input.memoryConfig,
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
      await fs.rm(existing.sourcePath, { force: true }).catch((error) => {
        this.deps.logger?.warn("Failed to delete agent preset source file", {
          path: existing.sourcePath,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    this.deps.agentPresetRepository.deleteAgentPreset(agentPresetId);
  }

  async syncProjectAgents(projectId: string): Promise<void> {
    const existingSync = this.projectSyncPromises.get(projectId);
    if (existingSync) {
      return await existingSync;
    }

    const syncPromise = this.syncProjectAgentsNow(projectId)
      .finally(() => {
        if (this.projectSyncPromises.get(projectId) === syncPromise) {
          this.projectSyncPromises.delete(projectId);
        }
      });
    this.projectSyncPromises.set(projectId, syncPromise);
    return await syncPromise;
  }

  private async syncProjectAgentsNow(projectId: string): Promise<void> {
    const project = this.requireProject(projectId);
    const existingPresets = this.deps.agentPresetRepository.listAgentPresets(projectId);
    const presetsById = new Map(existingPresets.map((preset) => [preset.id, preset]));
    const presetsByName = new Map(existingPresets.map((preset) => [this.normalizeName(preset.name), preset]));
    const sourceFiles = await this.readAgentSources(project.baseDir);
    const bundledBaseAgents = await this.readBundledBaseAgentSources();

    for (let source of sourceFiles) {
      let existing = existingPresets.find((preset) => preset.sourcePath === source.sourcePath)
        || presetsByName.get(source.normalizedName)
        || null;
      const baseRole = resolveBaseAgentRole(source.name);
      const bundledBaseAgent = baseRole ? bundledBaseAgents.get(baseRole) : undefined;

      if (!existing) {
        const labels = this.inferLabelsForSource(source.normalizedName);
        const stableId = BASE_AGENT_IDS[source.normalizedName];
        const avatarConfig = this.resolvePersistedAvatarConfig({
          projectId,
          id: stableId,
          name: source.name,
          labels,
          avatarConfig: source.avatarConfig,
          sourcePath: source.sourcePath,
        });
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
          avatarConfig,
          providerConfigId: source.providerConfigId,
          model: source.model,
          containerRunAsRoot: source.containerRunAsRoot,
          memoryTemplateOverrideEnabled: source.memoryTemplateOverrideEnabled,
          memoryTemplateMarkdown: source.memoryTemplateMarkdown,
          memoryConfig: source.memoryConfig,
          mcpAccess: this.defaultMcpAccessForSource(source.normalizedName),
        });
        presetsById.set(created.id, created);
        const initialized = bundledBaseAgent
          ? this.initializeBaseInstructionState(created, bundledBaseAgent, source)
          : created;
        presetsById.set(initialized.id, initialized);
        presetsByName.set(source.normalizedName, initialized);
        continue;
      }

      if (baseRole && bundledBaseAgent) {
        existing = await this.reconcileBaseAgentInstructions({
          projectBaseDir: project.baseDir,
          preset: existing,
          source,
          bundled: bundledBaseAgent,
        });
        presetsById.set(existing.id, existing);
        presetsByName.set(source.normalizedName, existing);
        if (source.sourceScope === "project") {
          source = await this.readAgentSourceFile(source.sourcePath, source.sourceScope);
        }
      }

      const labels = existing.labels.length > 0 ? existing.labels : this.inferLabelsForSource(source.normalizedName);
      const avatarConfig = this.resolvePersistedAvatarConfig({
        projectId,
        id: existing.id,
        name: source.name || existing.name,
        labels,
        avatarConfig: source.avatarConfig,
        sourcePath: source.sourcePath,
      });

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

      const preserveTrackedBaseInstructions = Boolean(existing.baseInstructionStates
        && Object.keys(existing.baseInstructionStates).length > 0);
      const contentChanged = !(baseRole && bundledBaseAgent) && !preserveTrackedBaseInstructions
        && source.instructionMarkdown.trim() !== existing.instructionMarkdown.trim();
      const preserveBundledBaseMetadata = Boolean(baseRole && bundledBaseAgent && source.sourceScope === "default");
      const descriptionChanged = !preserveBundledBaseMetadata
        && (source.description || "") !== (existing.description || "");
      const nameChanged = !preserveBundledBaseMetadata
        && source.normalizedName !== this.normalizeName(existing.name);
      const avatarChanged = !preserveBundledBaseMetadata
        && JSON.stringify(avatarConfig || {}) !== JSON.stringify(existing.avatarConfig || {});
      const providerChanged = !preserveBundledBaseMetadata
        && (source.providerConfigId || "") !== (existing.providerConfigId || "");
      const modelChanged = !preserveBundledBaseMetadata
        && (source.model || "") !== (existing.model || "");
      const containerRunAsRootChanged = !preserveBundledBaseMetadata && source.containerRunAsRoot !== undefined
        && source.containerRunAsRoot !== existing.containerRunAsRoot;
      const memoryEnabledChanged = !preserveBundledBaseMetadata
        && Boolean(source.memoryTemplateOverrideEnabled) !== Boolean(existing.memoryTemplateOverrideEnabled);
      const memoryMarkdownChanged = !preserveBundledBaseMetadata
        && (source.memoryTemplateMarkdown || "") !== (existing.memoryTemplateMarkdown || "");
      const memoryConfigChanged = !preserveBundledBaseMetadata
        && JSON.stringify(source.memoryConfig || null) !== JSON.stringify(existing.memoryConfig || null);

      if (contentChanged || descriptionChanged || nameChanged || avatarChanged || providerChanged || modelChanged || containerRunAsRootChanged || memoryEnabledChanged || memoryMarkdownChanged || memoryConfigChanged) {
        const imported = this.deps.agentPresetRepository.importLinkedAgentPreset(existing.id, {
          name: source.sourceScope === "project" ? existing.name : source.name,
          description: source.description,
          instructionMarkdown: baseRole && bundledBaseAgent || preserveTrackedBaseInstructions
            ? existing.instructionMarkdown
            : source.instructionMarkdown,
          sourceUpdatedAt: source.sourceUpdatedAt,
          avatarConfig,
          providerConfigId: source.providerConfigId,
          model: source.model,
          containerRunAsRoot: source.containerRunAsRoot,
          memoryTemplateOverrideEnabled: source.memoryTemplateOverrideEnabled,
          memoryTemplateMarkdown: source.memoryTemplateMarkdown,
          memoryConfig: source.memoryConfig,
        });
        presetsById.set(imported.id, imported);
        presetsByName.set(source.normalizedName, imported);
      }

      if (!existing.mcpAccess) {
        const defaultMcpAccess = this.defaultMcpAccessForSource(source.normalizedName);
        if (defaultMcpAccess) {
          const updated = this.deps.agentPresetRepository.updateAgentPreset(existing.id, { mcpAccess: defaultMcpAccess });
          presetsById.set(updated.id, updated);
          presetsByName.set(source.normalizedName, updated);
        }
      }
    }

    this.seedProjectManagerSkillStorage(projectId);
    await this.seedProjectManagerInternalDocs(projectId);
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
    const avatarConfig = this.resolvePersistedAvatarConfig({
      projectId: existing.projectId,
      id: existing.id,
      name: source.name || existing.name,
      labels: existing.labels,
      avatarConfig: source.avatarConfig,
      sourcePath: source.sourcePath,
    });
    const updated = this.deps.agentPresetRepository.importLinkedAgentPreset(agentPresetId, {
      name: existing.sourceScope === "project" ? existing.name : source.name,
      description: source.description,
      instructionMarkdown: source.instructionMarkdown,
      sourceUpdatedAt: source.sourceUpdatedAt,
      avatarConfig,
      providerConfigId: source.providerConfigId,
      model: source.model,
      containerRunAsRoot: source.containerRunAsRoot,
      memoryTemplateOverrideEnabled: source.memoryTemplateOverrideEnabled,
      memoryTemplateMarkdown: source.memoryTemplateMarkdown,
      memoryConfig: source.memoryConfig,
    });

    return await this.decorateAgentPreset(updated);
  }

  async syncAllAgentPresetsFromMarkdown(projectId: string): Promise<AgentPresetRecord[]> {
    return await this.pullAgentPresetsFromMarkdown(projectId);
  }

  async pullAgentPresetsFromMarkdown(projectId: string): Promise<AgentPresetRecord[]> {
    await this.syncProjectAgents(projectId);
    const presets = await this.decorateProjectAgentPresets(projectId);

    for (const preset of presets) {
      if (preset.syncStatus === "out_of_sync" && preset.sourcePath) {
        await this.importAgentPresetFromMarkdown(preset.id);
      }
    }

    return await this.decorateProjectAgentPresets(projectId);
  }

  async pushAgentPresetsToMarkdown(
    projectId: string,
    options: PushAgentPresetsToMarkdownOptions = {},
  ): Promise<AgentPresetRecord[]> {
    this.assertProjectMarkdownMirroringEnabled(projectId);
    this.requireProject(projectId);

    const requestedIds = new Set((options.agentPresetIds || [])
      .map((id) => id.trim())
      .filter(Boolean));
    const decoratedPresets = await this.decorateProjectAgentPresets(projectId);
    const candidates = decoratedPresets.filter((preset) => {
      if (requestedIds.size > 0) {
        return requestedIds.has(preset.id);
      }
      return preset.syncStatus === "manual"
        || preset.syncStatus === "missing_source"
        || preset.syncStatus === "out_of_sync"
        || preset.sourceScope === "home"
        || preset.sourceScope === "default";
    });

    const exported: AgentPresetRecord[] = [];
    for (const preset of candidates) {
      exported.push(await this.exportAgentPresetToMarkdown(preset.id));
    }

    return exported;
  }

  async exportAgentPresetToMarkdown(agentPresetId: string): Promise<AgentPresetRecord> {
    const existing = this.deps.agentPresetRepository.getAgentPreset(agentPresetId);
    if (!existing) {
      throw new Error(`Agent not found: ${agentPresetId}`);
    }
    this.assertProjectMarkdownMirroringEnabled(existing.projectId);

    const project = this.requireProject(existing.projectId);
    const source = await this.writeProjectAgentFile({
      projectId: existing.projectId,
      agentPresetId: existing.id,
      projectBaseDir: project.baseDir,
      name: existing.name,
      description: existing.description,
      instructionMarkdown: existing.instructionMarkdown,
      avatarConfig: existing.avatarConfig,
      providerConfigId: existing.providerConfigId,
      model: existing.model,
      memoryTemplateOverrideEnabled: existing.memoryTemplateOverrideEnabled,
      memoryTemplateMarkdown: existing.memoryTemplateMarkdown,
      memoryConfig: existing.memoryConfig,
      previousProjectSourcePath: existing.sourceScope === "project" ? existing.sourcePath : null,
    });

    const linked = this.deps.agentPresetRepository.linkAgentPresetToSource(agentPresetId, {
      sourcePath: source.sourcePath,
      sourceScope: source.sourceScope,
      sourceUpdatedAt: source.sourceUpdatedAt,
      sourceImportedAt: source.sourceUpdatedAt,
    });
    return await this.decorateAgentPreset(linked);
  }

  async pushAgentPresetsToRepository(projectId: string, options: {
    mode: "commit_only" | "commit_and_push" | "pull_request";
    branchName?: string;
  }): Promise<{
    committed: boolean;
    pushedBranch?: string;
    pullRequestUrl?: string;
  }> {
    const project = this.requireProject(projectId);
    const agentsDir = getRepoCodeUxPath(project.baseDir, "agents");
    const statusResult = await runCommandStrict("git", ["status", "--porcelain", "--", agentsDir], project.baseDir);
    if (!statusResult.stdout.trim()) {
      return { committed: false };
    }

    let targetBranch = options.branchName?.trim() || null;
    if (options.mode === "pull_request" && !targetBranch) {
      targetBranch = `agents/push-${Date.now()}`;
    }
    if (options.mode !== "commit_only") {
      targetBranch = await this.resolvePushTargetBranch(project.baseDir, targetBranch);
      await this.checkoutBranch(project.baseDir, targetBranch);
    }

    await runCommandStrict("git", ["add", agentsDir], project.baseDir);

    const hasStagedChanges = await runCommandStrict("git", ["diff", "--cached", "--quiet", "--", agentsDir], project.baseDir)
      .then(() => false)
      .catch(() => true);
    if (!hasStagedChanges) {
      return { committed: false };
    }

    await runCommandStrict("git", ["commit", "-m", "chore: push agent presets", "--", agentsDir], project.baseDir);

    if (options.mode === "commit_only") {
      return { committed: true };
    }

    const branchToPush = targetBranch || await this.getCurrentBranch(project.baseDir);
    const originUrl = readLocalGitOriginUrl(project.baseDir);
    if (!originUrl) {
      return { committed: true };
    }

    await runCommandStrict("git", ["push", "origin", branchToPush], project.baseDir);

    if (options.mode === "commit_and_push") {
      return { committed: true, pushedBranch: branchToPush };
    }

    const defaultBranch = this.resolveDefaultBranch(projectId);
    const effectiveSettings = this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings;
    const pullRequestUrl = await new PrService().resolveOrCreateFeaturePr({
      taskId: `agent-preset-push:${projectId}`,
      provider: "codex",
      title: "Push agent presets",
      featureBranch: defaultBranch,
      workerBranch: branchToPush,
      body: `Project: ${project.name}\n\nPush the project's .code-ux/agents markdown files into the repository.`,
    }, project.baseDir, {
      githubToken: this.deps.getGithubToken?.() || effectiveSettings.git.githubToken,
      gitlabToken: effectiveSettings.git.gitlabToken,
    });

    return {
      committed: true,
      pushedBranch: branchToPush,
      pullRequestUrl,
    };
  }

  async getPlanningAgent(projectId: string): Promise<AgentPresetRecord> {
    return await this.getRequiredAgent(projectId, "Planning agent", "planning_agent.md");
  }

  async listBaseAgentUpdateNotices(projectId: string): Promise<BaseAgentUpdateNotice[]> {
    await this.syncProjectAgents(projectId);
    const notices: BaseAgentUpdateNotice[] = [];
    for (const definition of BASE_AGENT_ROLE_DEFINITIONS) {
      const context = await this.getBaseAgentUpdateContextWithoutSync(projectId, definition.role);
      if (context?.notice) notices.push(context.notice);
    }
    return notices;
  }

  async getBaseAgentUpdateContext(
    projectId: string,
    role: BaseAgentRole,
  ): Promise<BaseAgentUpdateContext | null> {
    await this.syncProjectAgents(projectId);
    return await this.getBaseAgentUpdateContextWithoutSync(projectId, role);
  }

  async applyBaseAgentInstructionUpdate(
    projectId: string,
    role: BaseAgentRole,
    instructionMarkdown?: string,
    expectedAgentPresetId?: string,
  ): Promise<AgentPresetRecord> {
    await this.syncProjectAgents(projectId);
    const context = await this.getBaseAgentUpdateContextWithoutSync(projectId, role);
    if (!context) {
      throw new Error(`Bundled ${getBaseAgentRoleDefinition(role).name} instructions are not available.`);
    }
    if (expectedAgentPresetId && context.selectedAgentPreset.id !== expectedAgentPresetId) {
      throw new ValidationError("The selected base-agent route changed before the update could be applied.");
    }
    const nextInstructionMarkdown = instructionMarkdown?.trim() || context.bundledInstructionMarkdown;

    return await this.applyBundledInstructionsToPreset({
      preset: context.selectedAgentPreset,
      role,
      instructionMarkdown: nextInstructionMarkdown,
      revision: context.bundledRevision,
    });
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

  /**
   * Resolve the agent that should answer dashboard chat. Honors the configured dashboardReply
   * routing override, otherwise defaults to the project manager rather than the Worker.
   */
  async resolveDashboardReplyAgent(projectId: string, agentPresetId?: string | null): Promise<AgentPresetRecord> {
    await this.syncProjectAgents(projectId);

    if (agentPresetId) {
      const targeted = this.deps.agentPresetRepository.getAgentPreset(agentPresetId);
      if (targeted && targeted.projectId === projectId) {
        return await this.decorateAgentPreset(targeted);
      }
    }

    return await this.getProjectManagerAgent(projectId);
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
    return this.sortAgentPresets(decorated);
  }

  private sortAgentPresets(presets: AgentPresetRecord[]): AgentPresetRecord[] {
    return [...presets].sort((left, right) => {
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

  private scheduleDashboardBackgroundSync(projectId: string): void {
    const now = Date.now();
    const state = this.dashboardBackgroundSyncState.get(projectId);
    if (state?.promise) {
      return;
    }
    if (state && now - state.lastStartedAt < AgentPresetSyncService.DASHBOARD_BACKGROUND_SYNC_INTERVAL_MS) {
      return;
    }

    const promise = this.syncProjectAgents(projectId)
      .catch((error) => {
        this.deps.logger?.warn("Background agent preset sync failed", {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        const latest = this.dashboardBackgroundSyncState.get(projectId);
        if (latest?.promise === promise) {
          this.dashboardBackgroundSyncState.set(projectId, {
            lastStartedAt: latest.lastStartedAt,
            promise: null,
          });
        }
      });

    this.dashboardBackgroundSyncState.set(projectId, {
      lastStartedAt: now,
      promise,
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
      const avatarConfig = this.resolvePersistedAvatarConfig({
        projectId: preset.projectId,
        id: preset.id,
        name: source.name || preset.name,
        labels: preset.labels,
        avatarConfig: source.avatarConfig,
        sourcePath: source.sourcePath,
      });
      const sourceDiffersFromDb = this.normalizeName(source.name) !== this.normalizeName(preset.name)
        || (source.description || "") !== (preset.description || "")
        || source.instructionMarkdown.trim() !== preset.instructionMarkdown.trim()
        || JSON.stringify(avatarConfig || {}) !== JSON.stringify(preset.avatarConfig || {})
        || (source.providerConfigId || "") !== (preset.providerConfigId || "")
        || (source.model || "") !== (preset.model || "")
        || (source.containerRunAsRoot !== undefined && source.containerRunAsRoot !== preset.containerRunAsRoot)
        || Boolean(source.memoryTemplateOverrideEnabled) !== Boolean(preset.memoryTemplateOverrideEnabled)
        || (source.memoryTemplateMarkdown || "") !== (preset.memoryTemplateMarkdown || "")
        || JSON.stringify(source.memoryConfig || null) !== JSON.stringify(preset.memoryConfig || null);
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

  private initializeBaseInstructionState(
    preset: AgentPresetRecord,
    bundled: BundledBaseAgentSource,
    source?: AgentSourceFile,
  ): AgentPresetRecord {
    const presetMatchesBundle = hashBaseAgentInstructions(preset.instructionMarkdown) === bundled.revision;
    const sourceMatchesBundle = !source
      || hashBaseAgentInstructions(source.instructionMarkdown) === bundled.revision;
    const customized = !presetMatchesBundle || !sourceMatchesBundle;
    return this.setBaseInstructionState(preset, createBaseAgentInstructionState(
      bundled.role,
      bundled.revision,
      customized,
      customized ? null : bundled.revision,
    ));
  }

  private async reconcileBaseAgentInstructions(args: {
    projectBaseDir: string;
    preset: AgentPresetRecord;
    source: AgentSourceFile;
    bundled: BundledBaseAgentSource;
  }): Promise<AgentPresetRecord> {
    let preset = args.preset;
    let state = preset.baseInstructionStates?.[args.bundled.role];
    if (!state) {
      preset = this.initializeBaseInstructionState(preset, args.bundled, args.source);
      state = preset.baseInstructionStates?.[args.bundled.role];
    }
    if (!state) return preset;

    const presetHash = hashBaseAgentInstructions(preset.instructionMarkdown);
    const sourceHash = hashBaseAgentInstructions(args.source.instructionMarkdown);
    const sourceChangedSinceImport = args.source.sourceUpdatedAt !== preset.sourceImportedAt;
    const sourceIsCurrentBundle = args.source.sourceScope === "default"
      && sourceHash === args.bundled.revision;
    const presetIsCustomized = presetHash !== state.baselineContentHash;
    const customized = state.customized
      || presetIsCustomized
      || (sourceHash !== state.baselineContentHash && !sourceIsCurrentBundle);

    if (customized) {
      const shouldImportCustomizedSource = Boolean(preset.sourcePath && preset.sourceScope)
        && sourceChangedSinceImport
        && sourceHash !== presetHash
        && (args.source.sourceScope === "project" || !presetIsCustomized);
      if (shouldImportCustomizedSource) {
        preset = this.deps.agentPresetRepository.importLinkedAgentPreset(preset.id, {
          name: args.source.sourceScope === "project" ? preset.name : args.source.name,
          description: args.source.description,
          instructionMarkdown: args.source.instructionMarkdown,
          sourceUpdatedAt: args.source.sourceUpdatedAt,
          avatarConfig: args.source.avatarConfig ?? preset.avatarConfig,
          providerConfigId: args.source.providerConfigId,
          model: args.source.model,
          containerRunAsRoot: args.source.containerRunAsRoot,
          memoryTemplateOverrideEnabled: args.source.memoryTemplateOverrideEnabled,
          memoryTemplateMarkdown: args.source.memoryTemplateMarkdown,
          memoryConfig: args.source.memoryConfig,
        });
      }
      return this.setBaseInstructionState(preset, { ...state, customized: true });
    }

    if (args.bundled.revision === state.lastAppliedRevision) return preset;

    const selectedPresetId = this.getConfiguredBaseAgentPresetId(preset.projectId, args.bundled.role);
    if (selectedPresetId && selectedPresetId !== preset.id) return preset;

    return await this.applyBundledInstructionsToPreset({
      preset,
      role: args.bundled.role,
      instructionMarkdown: args.bundled.instructionMarkdown,
      revision: args.bundled.revision,
      projectBaseDir: args.projectBaseDir,
    });
  }

  private setBaseInstructionState(
    preset: AgentPresetRecord,
    state: BaseAgentInstructionState,
  ): AgentPresetRecord {
    return this.deps.agentPresetRepository.updateAgentPreset(preset.id, {
      baseInstructionStates: {
        ...preset.baseInstructionStates,
        [state.role]: state,
      },
    });
  }

  private async applyBundledInstructionsToPreset(args: {
    preset: AgentPresetRecord;
    role: BaseAgentRole;
    instructionMarkdown: string;
    revision: string;
    projectBaseDir?: string;
  }): Promise<AgentPresetRecord> {
    let preset = args.preset;
    const projectBaseDir = args.projectBaseDir ?? this.requireProject(preset.projectId).baseDir;
    if ((preset.sourceScope === "project" && preset.sourcePath) || this.shouldSaveToProjectDirectory(preset.projectId)) {
      const source = await this.writeProjectAgentFile({
        projectId: preset.projectId,
        agentPresetId: preset.id,
        projectBaseDir,
        name: preset.name,
        description: preset.description,
        instructionMarkdown: args.instructionMarkdown,
        avatarConfig: preset.avatarConfig,
        providerConfigId: preset.providerConfigId,
        model: preset.model,
        containerRunAsRoot: preset.containerRunAsRoot,
        memoryTemplateOverrideEnabled: preset.memoryTemplateOverrideEnabled,
        memoryTemplateMarkdown: preset.memoryTemplateMarkdown,
        memoryConfig: preset.memoryConfig,
        previousProjectSourcePath: preset.sourceScope === "project" ? preset.sourcePath : null,
      });
      preset = this.deps.agentPresetRepository.updateAgentPreset(preset.id, {
        instructionMarkdown: args.instructionMarkdown,
      });
      preset = this.deps.agentPresetRepository.linkAgentPresetToSource(preset.id, {
        sourcePath: source.sourcePath,
        sourceScope: source.sourceScope,
        sourceUpdatedAt: source.sourceUpdatedAt,
        sourceImportedAt: source.sourceUpdatedAt,
      });
    } else {
      preset = this.deps.agentPresetRepository.updateAgentPreset(preset.id, {
        instructionMarkdown: args.instructionMarkdown,
      });
    }

    return this.setBaseInstructionState(preset, createBaseAgentInstructionState(
      args.role,
      args.revision,
      false,
      args.revision,
    ));
  }

  private async getBaseAgentUpdateContextWithoutSync(
    projectId: string,
    role: BaseAgentRole,
  ): Promise<BaseAgentUpdateContext | null> {
    const bundled = (await this.readBundledBaseAgentSources()).get(role);
    if (!bundled) return null;

    const definition = getBaseAgentRoleDefinition(role);
    const baseAgentPreset = this.deps.agentPresetRepository.findAgentPresetByName(projectId, definition.name);
    if (!baseAgentPreset) return null;
    const configuredPresetId = this.getConfiguredBaseAgentPresetId(projectId, role);
    const configuredPreset = configuredPresetId
      ? this.deps.agentPresetRepository.getAgentPreset(configuredPresetId)
      : null;
    const selectedAgentPreset = configuredPreset?.projectId === projectId ? configuredPreset : baseAgentPreset;
    const state = selectedAgentPreset.baseInstructionStates?.[role];
    const selectedRevision = hashBaseAgentInstructions(selectedAgentPreset.instructionMarkdown);

    let notice: BaseAgentUpdateNotice | null = null;
    if (
      selectedAgentPreset.id !== baseAgentPreset.id
      && selectedRevision !== bundled.revision
      && state?.lastAppliedRevision !== bundled.revision
    ) {
      notice = this.createBaseAgentUpdateNotice({
        projectId,
        role,
        baseAgentPreset,
        selectedAgentPreset,
        reason: "alternate_route",
        currentRevision: state?.lastAppliedRevision ?? null,
        availableRevision: bundled.revision,
      });
    } else if (state?.customized && state.lastAppliedRevision !== bundled.revision) {
      notice = this.createBaseAgentUpdateNotice({
        projectId,
        role,
        baseAgentPreset,
        selectedAgentPreset,
        reason: "customized_instructions",
        currentRevision: state.lastAppliedRevision,
        availableRevision: bundled.revision,
      });
    }

    return {
      role,
      bundledInstructionMarkdown: bundled.instructionMarkdown,
      bundledRevision: bundled.revision,
      baseAgentPreset,
      selectedAgentPreset,
      notice,
    };
  }

  private createBaseAgentUpdateNotice(args: {
    projectId: string;
    role: BaseAgentRole;
    baseAgentPreset: AgentPresetRecord;
    selectedAgentPreset: AgentPresetRecord;
    reason: BaseAgentUpdateNotice["reason"];
    currentRevision: string | null;
    availableRevision: string;
  }): BaseAgentUpdateNotice {
    return {
      projectId: args.projectId,
      role: args.role,
      baseAgentPresetId: args.baseAgentPreset.id,
      selectedAgentPresetId: args.selectedAgentPreset.id,
      selectedAgentName: args.selectedAgentPreset.name,
      reason: args.reason,
      currentRevision: args.currentRevision,
      availableRevision: args.availableRevision,
    };
  }

  private getConfiguredBaseAgentPresetId(projectId: string, role: BaseAgentRole): string | null {
    const routing = this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings.agents.routing;
    const definition = getBaseAgentRoleDefinition(role);
    return routing[definition.routingKey].agentPresetId;
  }

  private async readAgentSources(repoPath: string): Promise<AgentSourceFile[]> {
    await ensureDefaultCodeUxAssetsInstalled({
      projectRoot: this.deps.projectRoot,
      logger: this.deps.logger,
    });

    const collected = new Map<string, AgentSourceFile>();
    const bundledCodeUxDir = process.env.NODE_ENV === "test" && process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS !== "1"
      ? null
      : await resolveBundledCodeUxDir({
        projectRoot: this.deps.projectRoot,
        requireQuicksprintTemplates: false,
      });
    const roots: Array<{ directory: string; scope: AgentSourceScope }> = [
      { directory: getRepoCodeUxPath(repoPath, "agents"), scope: "project" },
      ...(bundledCodeUxDir ? [{ directory: path.join(bundledCodeUxDir, "agents"), scope: "default" as const }] : []),
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
        if (!collected.has(source.normalizedName)) {
          collected.set(source.normalizedName, source);
        }
      }
    }

    return Array.from(collected.values());
  }

  private async readBundledBaseAgentSources(): Promise<Map<BaseAgentRole, BundledBaseAgentSource>> {
    const bundledCodeUxDir = process.env.NODE_ENV === "test" && process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS !== "1"
      ? null
      : await resolveBundledCodeUxDir({
        projectRoot: this.deps.projectRoot,
        requireQuicksprintTemplates: false,
      });
    const bundled = new Map<BaseAgentRole, BundledBaseAgentSource>();
    if (!bundledCodeUxDir) return bundled;

    for (const definition of BASE_AGENT_ROLE_DEFINITIONS) {
      const source = await this.readAgentSourceFile(
        path.join(bundledCodeUxDir, "agents", definition.fileName),
        "default",
      );
      bundled.set(definition.role, {
        role: definition.role,
        instructionMarkdown: source.instructionMarkdown,
        revision: hashBaseAgentInstructions(source.instructionMarkdown),
      });
    }
    return bundled;
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
      containerRunAsRoot: parsed.containerRunAsRoot,
      memoryTemplateOverrideEnabled: parsed.memoryTemplateOverrideEnabled,
      memoryTemplateMarkdown: parsed.memoryTemplateMarkdown,
      memoryConfig: parsed.memoryConfig,
    };
  }

  private normalizeName(value: string): string {
    return value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
  }

  private resolvePersistedAvatarConfig(input: {
    projectId: string;
    id?: string | null;
    name: string;
    labels?: readonly string[];
    avatarConfig?: AgentAvatarConfig | null;
    sourcePath?: string | null;
  }): AgentAvatarConfig {
    if (hasAgentAvatarConfig(input.avatarConfig)) {
      return { ...input.avatarConfig };
    }
    return resolveAgentAvatarConfig({
      projectId: input.projectId,
      id: input.id,
      name: input.name,
      labels: input.labels,
      seed: [input.projectId, input.id, input.name, input.sourcePath]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(":"),
    });
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
    if (normalizedName === "project manager" || normalizedName === "iris") {
      return ["manager", "chat"];
    }
    return [];
  }

  private defaultMcpAccessForSource(normalizedName: string): AgentMcpAccessConfig | undefined {
    if (normalizedName === "worker" || normalizedName === "project manager" || normalizedName === "iris") {
      return defaultCodingAgentMcpAccess();
    }
    return undefined;
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

  private async seedProjectManagerInternalDocs(projectId: string): Promise<void> {
    if (!this.deps.knowledgeService || this.deps.agentPresetRepository.hasSeededInternalDocsSubscription(projectId)) {
      return;
    }

    const projectManager = this.deps.agentPresetRepository.findAgentPresetByName(projectId, "Project manager")
      || this.deps.agentPresetRepository.findAgentPresetByName(projectId, "Iris");
    if (!projectManager) {
      return;
    }

    const doc = await this.deps.knowledgeService.ensureCodeUxInternalDocsDocument(projectId, this.deps.projectRoot);
    if (!doc || doc.sourceRef !== CODE_UX_INTERNAL_DOCS_SOURCE_REF) {
      return;
    }

    const existing = this.deps.knowledgeService.listSubscriptions(projectManager.id);
    this.deps.knowledgeService.setSubscriptions(projectManager.id, projectId, [...new Set([...existing, doc.id])]);
    this.deps.agentPresetRepository.markInternalDocsSubscriptionSeeded(projectId);
  }

  private seedProjectManagerSkillStorage(projectId: string): void {
    if (!this.deps.skillService) return;
    const projectManager = this.deps.agentPresetRepository.findAgentPresetByName(projectId, "Project manager")
      || this.deps.agentPresetRepository.findAgentPresetByName(projectId, "Iris");
    if (!projectManager || (projectManager.persistentSkillStorageIds?.length ?? 0) > 0) return;

    const storage = this.deps.skillService.listStorages(projectId)
      .find((candidate) => candidate.name.toLowerCase() === PROJECT_MANAGER_DEFAULT_SKILL_STORAGE_NAME.toLowerCase())
      ?? this.deps.skillService.createStorage(projectId, {
        name: PROJECT_MANAGER_DEFAULT_SKILL_STORAGE_NAME,
        description: "Versioned reusable skills for the dashboard Project Manager.",
        storageKind: "project",
      });
    this.deps.agentPresetRepository.updateAgentPreset(projectManager.id, {
      persistentSkillStorageIds: [storage.id],
      persistentSkillStorage: { enabled: true },
    });
  }

  private shouldSaveToProjectDirectory(projectId: string): boolean {
    return this.deps.settingsRepository.getProjectResolvedSettings(projectId).agents.saveToProjectDirectory;
  }

  private assertProjectMarkdownMirroringEnabled(projectId: string): void {
    if (!this.shouldSaveToProjectDirectory(projectId)) {
      throw new ValidationError("Project agent markdown mirroring is disabled. Enable agents.saveToProjectDirectory before pushing agent presets to project markdown.");
    }
  }

  private assertAgentNameAvailable(projectId: string, name: string, currentAgentId?: string): void {
    const existing = this.deps.agentPresetRepository.findAgentPresetByName(projectId, name);
    if (existing && existing.id !== currentAgentId) {
      throw new Error(`An agent named "${name}" already exists for this project.`);
    }
  }

  private async writeProjectAgentFile(args: {
    projectId?: string;
    agentPresetId?: string;
    projectBaseDir: string;
    name: string;
    description?: string;
    instructionMarkdown: string;
    avatarConfig?: AgentAvatarConfig;
    providerConfigId?: string | null;
    model?: string | null;
    containerRunAsRoot?: boolean | null;
    memoryTemplateOverrideEnabled?: boolean;
    memoryTemplateMarkdown?: string;
    memoryConfig?: AgentMemoryConfig;
    previousProjectSourcePath?: string | null;
  }): Promise<AgentSourceFile> {
    const directory = getRepoCodeUxPath(args.projectBaseDir, "agents");
    await fs.mkdir(directory, { recursive: true });

    const filePath = path.join(directory, `${this.toAgentFileStem(args.name)}.md`);
    this.assertPathInsideDirectory(filePath, directory);
    const fileAlreadyExists = await fs.stat(filePath)
      .then(() => true)
      .catch(() => false);
    if (fileAlreadyExists && args.projectId && args.agentPresetId) {
      this.assertProjectAgentFileWritable({
        projectId: args.projectId,
        agentPresetId: args.agentPresetId,
        filePath,
        agentName: args.name,
      });
    }
    if (!args.previousProjectSourcePath || args.previousProjectSourcePath !== filePath) {
      if (fileAlreadyExists) {
        if (!args.projectId || !args.agentPresetId) {
          throw new Error(`Project agent file already exists: ${filePath}`);
        }
      }
    }

    const fileContent = formatAgentMarkdown({
      description: args.description,
      instructionMarkdown: args.instructionMarkdown,
      avatarConfig: args.avatarConfig,
      providerConfigId: args.providerConfigId,
      model: args.model,
      containerRunAsRoot: args.containerRunAsRoot,
      memoryTemplateOverrideEnabled: args.memoryTemplateOverrideEnabled,
      memoryTemplateMarkdown: args.memoryTemplateMarkdown,
      memoryConfig: args.memoryConfig,
    });
    await fs.writeFile(filePath, fileContent, "utf8");

    if (args.previousProjectSourcePath && args.previousProjectSourcePath !== filePath) {
      await fs.rm(args.previousProjectSourcePath, { force: true }).catch((error) => {
        this.deps.logger?.warn("Failed to delete previous agent preset source file", {
          path: args.previousProjectSourcePath,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return await this.readAgentSourceFile(filePath, "project");
  }

  private assertPathInsideDirectory(filePath: string, directory: string): void {
    const resolvedFile = path.resolve(filePath);
    const resolvedDirectory = path.resolve(directory);
    const relative = path.relative(resolvedDirectory, resolvedFile);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ValidationError(`Refusing to write agent markdown outside ${resolvedDirectory}.`);
    }
  }

  private assertProjectAgentFileWritable(args: {
    projectId: string;
    agentPresetId: string;
    filePath: string;
    agentName: string;
  }): void {
    const resolvedFile = path.resolve(args.filePath);
    const targetName = this.toDisplayNameFromStem(path.basename(args.filePath, path.extname(args.filePath)));
    const normalizedTargetName = this.normalizeName(targetName);
    const conflictingPreset = this.deps.agentPresetRepository.listAgentPresets(args.projectId)
      .find((preset) => {
        if (preset.id === args.agentPresetId) {
          return false;
        }
        if (preset.sourcePath && path.resolve(preset.sourcePath) === resolvedFile) {
          return true;
        }
        return this.normalizeName(preset.name) === normalizedTargetName;
      });

    if (conflictingPreset) {
      throw new ValidationError(`Cannot export agent "${args.agentName}" to ${args.filePath} because that markdown file belongs to agent "${conflictingPreset.name}".`);
    }
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

    if (this.normalizeName(normalized) === "iris") {
      return "Project manager";
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

  private async getCurrentBranch(repoPath: string): Promise<string> {
    const result = await runCommandStrict("git", ["branch", "--show-current"], repoPath);
    const branch = result.stdout.trim();
    if (!branch) {
      throw new Error("Unable to resolve the current git branch.");
    }
    return branch;
  }

  private async resolvePushTargetBranch(repoPath: string, branchName: string | null): Promise<string> {
    if (branchName) {
      return branchName;
    }
    return await this.getCurrentBranch(repoPath);
  }

  private async checkoutBranch(repoPath: string, branchName: string): Promise<void> {
    const currentBranch = await this.getCurrentBranch(repoPath);
    if (currentBranch === branchName) {
      return;
    }
    const branchExists = await runCommandStrict("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], repoPath)
      .then(() => true)
      .catch(() => false);
    if (branchExists) {
      await runCommandStrict("git", ["switch", branchName], repoPath);
      return;
    }
    await runCommandStrict("git", ["switch", "-c", branchName], repoPath);
  }

  private resolveDefaultBranch(projectId: string): string {
    return this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings.git.defaultBranch?.trim() || "main";
  }
}
