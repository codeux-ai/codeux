import type {
  AgentPresetRecord,
  BaseAgentRole,
  BaseAgentUpdateContext,
  BaseAgentUpdateNotice,
} from "../contracts/agent-preset-types.js";
import type { ProviderId, Subtask } from "../contracts/app-types.js";
import { extractJsonFromText } from "../domain/llm/json-extraction.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import { EntityNotFoundError, ValidationError } from "../repositories/repository-utils.js";
import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS } from "./cli-workflow-utils.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import { resolveEffectiveModel } from "./provider-execution-service.js";
import { resolveProviderForInvocation } from "./provider-routing.js";
import type { StructuredAgentRequestService } from "./structured-agent-request-service.js";

const ALLOWED_BASE_AGENT_ROLES = new Set<BaseAgentRole>(["planning_agent", "project_manager"]);
const LOCAL_PROVIDER_POOL: ProviderId[] = ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"];

interface AgentBaseUpdateServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  settingsRepository: SettingsRepository;
  agentPresetSyncService: AgentPresetSyncService;
  structuredAgentRequestService: StructuredAgentRequestService;
}

interface AgentBaseUpdatePayload {
  instructionMarkdown: string;
}

export class AgentBaseUpdateService {
  constructor(private readonly deps: AgentBaseUpdateServiceDeps) {}

  async listUpdates(projectId: string): Promise<BaseAgentUpdateNotice[]> {
    this.requireProject(projectId);
    return await this.deps.agentPresetSyncService.listBaseAgentUpdateNotices(projectId);
  }

  async applyUpdate(projectId: string, role: BaseAgentRole): Promise<AgentPresetRecord> {
    this.assertAllowedRole(role);
    const project = this.requireProject(projectId);
    const context = await this.deps.agentPresetSyncService.getBaseAgentUpdateContext(projectId, role);
    if (!context?.notice) {
      throw new ValidationError(`No base-agent update is available for ${role}.`);
    }
    this.assertContextOwnership(projectId, context);

    const settings = this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings;
    const routingTask: Subtask = {
      id: `agent-base-update-${role}`,
      title: `Update ${context.selectedAgentPreset.name} base instructions`,
      prompt: context.selectedAgentPreset.instructionMarkdown,
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };
    const route = resolveProviderForInvocation(settings, {
      invocation: "planning",
      task: routingTask,
      providerPool: LOCAL_PROVIDER_POOL,
      agentProvider: {
        providerConfigId: context.selectedAgentPreset.providerConfigId,
        model: context.selectedAgentPreset.model,
      },
    });
    const providerSettings = route.providers[route.providerConfigId];
    if (!providerSettings || providerSettings.provider === "jules" || providerSettings.provider === "mockup-cli") {
      throw new ValidationError("A supported local planning provider is required to update base-agent instructions.");
    }

    const provider = providerSettings.provider;
    const model = resolveEffectiveModel({
      provider,
      model: providerSettings.model,
      providerMountAuth: providerSettings.mountAuth,
      customModel: providerSettings.customModel,
      qwenAuthMode: providerSettings.qwenAuthMode,
      qwenModelId: providerSettings.qwenModelId,
      openCodeAuthMode: providerSettings.openCodeAuthMode,
      openCodeProviderId: providerSettings.openCodeProviderId,
      openCodeModelId: providerSettings.openCodeModelId,
    });
    const prompt = this.buildUpdatePrompt(context);
    const result = await this.deps.structuredAgentRequestService.executeRequest<AgentBaseUpdatePayload>({
      projectId,
      purpose: "planning",
      type: "agent_base_update",
      provider,
      model,
      apiKey: providerSettings.apiKey,
      maxConcurrentTasks: providerSettings.maxConcurrentTasks,
      qwenAuthMode: providerSettings.qwenAuthMode,
      qwenRegion: providerSettings.qwenRegion,
      qwenBaseUrl: providerSettings.qwenBaseUrl,
      qwenEnvKey: providerSettings.qwenEnvKey,
      qwenModelId: providerSettings.qwenModelId,
      qwenProtocol: providerSettings.qwenProtocol,
      qwenAdditionalModelProviders: providerSettings.qwenAdditionalModelProviders,
      openCodeAuthMode: providerSettings.openCodeAuthMode,
      openCodeProviderId: providerSettings.openCodeProviderId,
      openCodeModelId: providerSettings.openCodeModelId,
      openCodeBaseUrl: providerSettings.openCodeBaseUrl,
      openCodeEnvKey: providerSettings.openCodeEnvKey,
      openCodePackage: providerSettings.openCodePackage,
      providerMountAuth: providerSettings.mountAuth,
      providerAuthPath: providerSettings.authPath,
      providerConfigMode: providerSettings.providerConfigMode,
      providerConfigPath: providerSettings.providerConfigPath,
      customBaseUrl: providerSettings.customBaseUrl,
      customModel: providerSettings.customModel,
      providerPrompt: buildProviderPrompt(prompt, providerSettings.thinkingMode, provider),
      repoPath: project.baseDir,
      cwd: project.baseDir,
      settings: {
        ...settings,
        cliWorkflow: {
          ...DEFAULT_CLI_WORKFLOW_SETTINGS,
          ...settings.cliWorkflow,
        },
      },
      parseFn: (bodyMarkdown) => {
        const payload = this.parseUpdatePayload(bodyMarkdown);
        this.assertPreservesSelectedInstructions(
          context.selectedAgentPreset.instructionMarkdown,
          payload.instructionMarkdown,
        );
        return payload;
      },
      buildRetryPrompt: (error) => this.buildRetryPrompt(error),
      providerLabel: this.getProviderLabel(provider),
      sessionIdPrefix: "agent-base-update",
      systemRoutingMessage: `Base-agent update routed through the planning provider path (${provider}, model: ${model}).`,
      agentMcpAccess: {
        codeUxEnabled: false,
        codeUxToolToggles: [],
        linkedServerIds: [],
      },
      mcpAgentId: null,
    });

    return await this.deps.agentPresetSyncService.applyBaseAgentInstructionUpdate(
      projectId,
      role,
      result.parsed.instructionMarkdown,
      context.selectedAgentPreset.id,
    );
  }

  private buildUpdatePrompt(context: BaseAgentUpdateContext): string {
    return [
      "You are producing a compatibility-only instruction update for a Code UX base agent.",
      "Compare the previous bundled/base instructions, the current bundled instructions, and the user's selected target preset.",
      "",
      "Return exactly one raw JSON object with exactly this shape:",
      '{"instructionMarkdown":"<complete resulting markdown>"}',
      "",
      "Rules:",
      "- Preserve the user's main prompt, custom behavior, and every custom section verbatim unless a compatibility-critical conflict makes a minimal edit unavoidable.",
      "- Add only important system compatibility requirements introduced by the current bundle, such as changed MCP usage or strict JSON-schema/output rules.",
      "- Never rewrite, summarize, reorganize, or remove custom sections.",
      "- Do not copy cosmetic wording changes or unrelated bundled behavior into the target preset.",
      "- Do not change avatar, labels, routing, provider/model, memory, MCP access, persistent skills, source metadata, or any non-instruction field.",
      "- Do not inspect, create, edit, or delete workspace files. Code UX will apply the validated instructionMarkdown itself.",
      "- Output raw JSON only, with no markdown fence, commentary, or extra properties.",
      "",
      "## Previous bundled/base instructions",
      context.baseAgentPreset.instructionMarkdown,
      "",
      "## Current bundled instructions",
      context.bundledInstructionMarkdown,
      "",
      "## User-selected target preset instructions",
      context.selectedAgentPreset.instructionMarkdown,
    ].join("\n");
  }

  private buildRetryPrompt(error: Error): string {
    return [
      `The previous response was rejected: ${error.message}`,
      "Return only a raw JSON object with exactly one non-empty string property named instructionMarkdown.",
      "The complete selected preset must remain present line-for-line and in order; only insert compatibility-critical instructions.",
      "Do not include markdown fences, commentary, metadata, file operations, or any other property.",
    ].join("\n");
  }

  private parseUpdatePayload(bodyMarkdown: string): AgentBaseUpdatePayload {
    const extraction = extractJsonFromText(bodyMarkdown);
    if (!extraction.success) {
      throw new ValidationError("Base-agent update response was not raw valid JSON.");
    }
    const parsed = extraction.data;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ValidationError("Base-agent update response must be a JSON object.");
    }
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.instructionMarkdown !== "string" || !record.instructionMarkdown.trim()) {
      throw new ValidationError("Base-agent update response must contain only a non-empty instructionMarkdown string.");
    }
    return { instructionMarkdown: record.instructionMarkdown.trim() };
  }

  private assertAllowedRole(role: string): asserts role is BaseAgentRole {
    if (!ALLOWED_BASE_AGENT_ROLES.has(role as BaseAgentRole)) {
      throw new ValidationError(`Invalid baseAgentRole: ${role}.`);
    }
  }

  private assertPreservesSelectedInstructions(original: string, updated: string): void {
    const originalLines = original.replace(/\r\n?/g, "\n").trim().split("\n");
    const updatedLines = updated.replace(/\r\n?/g, "\n").trim().split("\n");
    let cursor = 0;
    for (const line of updatedLines) {
      if (line === originalLines[cursor]) cursor += 1;
    }
    if (cursor !== originalLines.length) {
      throw new ValidationError("Base-agent update response rewrote or removed selected preset instructions.");
    }
  }

  private assertContextOwnership(projectId: string, context: BaseAgentUpdateContext): void {
    if (context.baseAgentPreset.projectId !== projectId || context.selectedAgentPreset.projectId !== projectId) {
      throw new ValidationError("The selected base-agent preset does not belong to this project.");
    }
  }

  private requireProject(projectId: string): NonNullable<ReturnType<ProjectManagementRepository["getProject"]>> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new EntityNotFoundError(`Project not found: ${projectId}.`);
    }
    return project;
  }

  private getProviderLabel(provider: ProviderId): string {
    switch (provider) {
      case "gemini": return "Gemini";
      case "claude-code": return "Claude Code";
      case "qwen-code": return "Qwen Code";
      case "opencode": return "OpenCode";
      case "antigravity": return "Antigravity";
      case "codex": return "Codex";
      default: return provider;
    }
  }
}
