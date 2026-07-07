import type {
  ManageCodeUxArgs,
  ManagementResponseEnvelope,
  ManageProjectsArgs,
  ManageSprintsArgs,
  ManageTasksArgs,
  ManageQuicksprintsArgs,
  ManageSchedulerArgs,
  ManageAgentsArgs,
  ManageMemoryArgs,
  ManageSettingsArgs,
  ManagePreviewArgs,
  ManageTelemetryArgs,
  SearchKnowledgeArgs
} from "../contracts/internal-management-types.js";
import type { KnowledgeService } from "../services/knowledge-service.js";
import { getCurrentMcpAgentId } from "../server/mcp-agent-context.js";
import type { SprintPreviewService } from "../services/sprint-preview-service.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ExecutionControlService } from "../services/execution-control-service.js";
import type { TaskRerunService } from "../services/task-rerun-service.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { AgentPresetSyncService } from "../services/agent-preset-sync-service.js";
import type { MemoryService } from "../services/memory-service.js";
import type { MemoryPromotionService } from "../services/memory-promotion-service.js";
import type { EmbeddingModelManager } from "../services/embedding-model-manager.js";

import type { PlanningAgentService } from "../services/planning-agent-service.js";
import type { ProjectSetupService } from "../services/project-setup-service.js";
import type { SprintIssueService } from "../services/sprint-issue-service.js";
import type { QuicksprintService } from "../services/quicksprint-service.js";
import type { SchedulerService } from "../services/scheduler-service.js";
import type { CreateProjectInput, ProjectSummary } from "../contracts/project-management-types.js";
import { initializeProject } from "../domain/projects/project-initializer.js";
import { prepareGitProjectCreateInput } from "../services/project-git-clone-service.js";

import { PreviewActions } from "./management/preview-actions.js";
import { handleTelemetryActions } from "./management/telemetry-actions.js";
import { handleProjectAction } from "./management/project-actions.js";
import { SprintActions } from "./management/sprint-actions.js";
import { TaskActions } from "./management/task-actions.js";
import { QuicksprintActions } from "./management/quicksprint-actions.js";
import { SchedulerActions } from "./management/scheduler-actions.js";
import { SettingsActions } from "./management/settings-actions.js";
import { AgentActions } from "./management/agent-actions.js";
import { MemoryActions } from "./management/memory-actions.js";
import { buildMcpApprovalFingerprint, formatManagementErrorEnvelope } from "./management/payload-parsers.js";
import { resolveLateBoundDependency, type LateBoundOrValue } from "../shared/late-bound-dependency.js";

export interface ManagementToolHandlerDeps {
  sprintPreviewService: SprintPreviewService;
  executionRepository: ExecutionRepository;
  getDashboardSettings: () => DashboardSettings;
  projectManagementRepository: ProjectManagementRepository;
  executionControlService: ExecutionControlService;
  taskRerunService: LateBoundOrValue<TaskRerunService>;
  settingsRepository: SettingsRepository;
  agentPresetSyncService: AgentPresetSyncService;
  memoryService: MemoryService;
  memoryPromotionService: MemoryPromotionService;
  embeddingModelManager: EmbeddingModelManager;
  knowledgeService: KnowledgeService;
  planningAgentService: LateBoundOrValue<PlanningAgentService>;
  projectSetupService?: LateBoundOrValue<ProjectSetupService>;
  sprintIssueService: SprintIssueService;
  quicksprintService?: LateBoundOrValue<QuicksprintService>;
  schedulerService?: LateBoundOrValue<SchedulerService>;
}

const MANAGEMENT_APPROVAL_TTL_MS = 15 * 60 * 1000;

export class ManagementToolHandler {
  private sprintActions: SprintActions | null = null;
  private taskActions: TaskActions | null = null;
  private readonly pendingDestructiveApprovals = new Map<string, number>();
  private readonly settingsActions: SettingsActions;
  private readonly agentActions: AgentActions;
  private readonly memoryActions: MemoryActions;
  private readonly previewActions: PreviewActions;

  constructor(private readonly deps: ManagementToolHandlerDeps) {
    this.settingsActions = new SettingsActions(deps.settingsRepository);
    this.agentActions = new AgentActions(deps.agentPresetSyncService);
    this.memoryActions = new MemoryActions(deps.memoryService, deps.memoryPromotionService, deps.embeddingModelManager);
    this.previewActions = new PreviewActions(deps.sprintPreviewService);
  }

  private getSprintActions(): SprintActions {
    if (!this.sprintActions) {
      this.sprintActions = new SprintActions({
        ...this.deps,
        planningAgentService: resolveLateBoundDependency(this.deps.planningAgentService),
      });
    }
    return this.sprintActions;
  }

  private getTaskActions(): TaskActions {
    if (!this.taskActions) {
      this.taskActions = new TaskActions(
        this.deps.projectManagementRepository,
        this.deps.executionControlService,
        this.deps.executionRepository,
        resolveLateBoundDependency(this.deps.taskRerunService)
      );
    }
    return this.taskActions;
  }

  private getQuicksprintActions(): QuicksprintActions {
    if (!this.deps.quicksprintService) {
      throw new Error("Quicksprint service is not enabled.");
    }
    return new QuicksprintActions(resolveLateBoundDependency(this.deps.quicksprintService));
  }

  private getSchedulerActions(): SchedulerActions {
    if (!this.deps.schedulerService) {
      throw new Error("Scheduler service is not enabled.");
    }
    return new SchedulerActions(resolveLateBoundDependency(this.deps.schedulerService));
  }

  private resolveGithubToken(): string | undefined {
    try {
      const settings = this.deps.getDashboardSettings();
      const gitToken = settings.git?.githubToken?.trim();
      if (gitToken) {
        return gitToken;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private resolveGitlabToken(): string | undefined {
    try {
      const settings = this.deps.getDashboardSettings();
      const gitToken = settings.git?.gitlabToken?.trim();
      if (gitToken) {
        return gitToken;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async createProject(input: CreateProjectInput): Promise<ProjectSummary> {
    return initializeProject(input, {
      createProject: async (projectInput) => this.deps.projectManagementRepository.createProject(
        await prepareGitProjectCreateInput(projectInput, {
          githubToken: this.resolveGithubToken(),
          gitlabToken: this.resolveGitlabToken(),
        }),
      ),
      getGithubToken: () => this.resolveGithubToken() ?? "",
      getGitlabToken: () => this.resolveGitlabToken() ?? "",
    });
  }

  private formatError(domain: string, action: string, error: unknown): { content: Array<{ type: string; text: string }>; isError: true } {
    const envelope = formatManagementErrorEnvelope(domain, action, error);
    return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }], isError: true };
  }

  private isStatefulApprovalGatedMutation(args: ManageCodeUxArgs): boolean {
    if (args.domain === "settings") {
      return false;
    }
    return args.action === "delete"
      || args.action.startsWith("delete_")
      || args.action.startsWith("reset_")
      || args.action.startsWith("replace_")
      || args.action === "remove_session"
      || args.action === "deprecate_claim";
  }

  private cleanupDestructiveApprovals(now = Date.now()): void {
    for (const [fingerprint, createdAt] of this.pendingDestructiveApprovals.entries()) {
      if (now - createdAt > MANAGEMENT_APPROVAL_TTL_MS) {
        this.pendingDestructiveApprovals.delete(fingerprint);
      }
    }
  }

  private async requireStatefulApproval(
    args: ManageCodeUxArgs,
    executeUnconfirmed: () => Promise<ManagementResponseEnvelope> | ManagementResponseEnvelope,
  ): Promise<ManagementResponseEnvelope | null> {
    if (!this.isStatefulApprovalGatedMutation(args)) {
      return null;
    }

    const now = Date.now();
    this.cleanupDestructiveApprovals(now);

    if (args.approval?.confirmed !== true) {
      return null;
    }

    const fingerprint = buildMcpApprovalFingerprint(args);
    const pendingCreatedAt = this.pendingDestructiveApprovals.get(fingerprint);
    if (pendingCreatedAt !== undefined && now - pendingCreatedAt <= MANAGEMENT_APPROVAL_TTL_MS) {
      this.pendingDestructiveApprovals.delete(fingerprint);
      return null;
    }

    const approvalEnvelope = await executeUnconfirmed();
    if (approvalEnvelope.approvalRequired) {
      this.pendingDestructiveApprovals.set(fingerprint, now);
    }
    return approvalEnvelope;
  }

  private recordStatefulApprovalRequirement(args: ManageCodeUxArgs, envelope: ManagementResponseEnvelope): ManagementResponseEnvelope {
    if (this.isStatefulApprovalGatedMutation(args) && envelope.approvalRequired) {
      this.cleanupDestructiveApprovals();
      this.pendingDestructiveApprovals.set(buildMcpApprovalFingerprint(args), Date.now());
    }
    return envelope;
  }

  private async dispatchManageCodeUx(args: ManageCodeUxArgs): Promise<ManagementResponseEnvelope> {
    if (args.domain === "projects") {
      return handleProjectAction(
        args.action,
        args.payload,
        this.deps.projectManagementRepository,
        args.domain,
        args.approval,
        this.deps.projectSetupService ? resolveLateBoundDependency(this.deps.projectSetupService) : undefined,
        (input) => this.createProject(input)
      );
    } else if (args.domain === "sprints") {
      return this.getSprintActions().handleSprintAction(args);
    } else if (args.domain === "tasks") {
      return this.getTaskActions().handleTaskAction(args);
    } else if (args.domain === "quicksprints") {
      return this.getQuicksprintActions().handleQuicksprintAction(args);
    } else if (args.domain === "scheduler") {
      return this.getSchedulerActions().handleSchedulerAction(args);
    } else if (args.domain === "settings") {
      return this.settingsActions.handleSettingsAction(args);
    } else if (args.domain === "agents") {
      return this.agentActions.handleAgentAction(args);
    } else if (args.domain === "memory") {
      return this.memoryActions.handleMemoryAction(args);
    } else if (args.domain === "preview") {
      const currentHost = null; // serverHost is not available on DashboardSettings, we'll fall back to localhost in preview-origin
      return this.previewActions.handlePreviewAction(args, currentHost);
    } else if (args.domain === "telemetry") {
      return handleTelemetryActions(args, this.deps.executionRepository);
    }

    const isDestructive = args.action.startsWith("delete_") || args.action.startsWith("reset_") || args.action.startsWith("replace_");

    if (isDestructive && args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `The action '${args.action}' is destructive and requires explicit approval. Please review the changes and call this tool again with approval.confirmed set to true.`,
      };
    }
    return {
      result: {
        status: "success",
        domain: args.domain,
        action: args.action,
        message: `Domain ${args.domain} is not implemented yet.`,
      },
    };
  }

  async handleManageCodeUx(args: ManageCodeUxArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const approvalGate = await this.requireStatefulApproval(args, () => this.dispatchManageCodeUx({ ...args, approval: { confirmed: false } }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(args, await this.dispatchManageCodeUx(args));
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError(args.domain, args.action, error);
    }
  }

  async handleManageProjects(args: ManageProjectsArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const managementArgs = { domain: "projects", action: args.action, payload: args as unknown as Record<string, unknown>, approval: args.approval };
      const dispatch = (approval = args.approval) => handleProjectAction(
          args.action,
          args as unknown as Record<string, unknown>,
          this.deps.projectManagementRepository,
          "projects",
          approval,
          this.deps.projectSetupService ? resolveLateBoundDependency(this.deps.projectSetupService) : undefined,
          (input) => this.createProject(input)
        );
      const approvalGate = await this.requireStatefulApproval(managementArgs, () => dispatch({ confirmed: false }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(managementArgs, await dispatch());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("projects", args.action, error);
    }
  }

  async handleManageSprints(args: ManageSprintsArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const managementArgs = { domain: "sprints", action: args.action, payload: args as unknown as Record<string, unknown>, approval: args.approval };
      const dispatch = (approval = args.approval) => this.getSprintActions().handleSprintAction({ ...managementArgs, approval });
      const approvalGate = await this.requireStatefulApproval(managementArgs, () => dispatch({ confirmed: false }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(managementArgs, await dispatch());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("sprints", args.action, error);
    }
  }

  async handleManageTasks(args: ManageTasksArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const managementArgs = { domain: "tasks", action: args.action, payload: args as unknown as Record<string, unknown>, approval: args.approval };
      const dispatch = (approval = args.approval) => this.getTaskActions().handleTaskAction({ ...managementArgs, approval });
      const approvalGate = await this.requireStatefulApproval(managementArgs, () => dispatch({ confirmed: false }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(managementArgs, await dispatch());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("tasks", args.action, error);
    }
  }

  async handleManageQuicksprints(args: ManageQuicksprintsArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const managementArgs = { domain: "quicksprints", action: args.action, payload: args as unknown as Record<string, unknown>, approval: args.approval };
      const dispatch = (approval = args.approval) => this.getQuicksprintActions().handleQuicksprintAction({ ...managementArgs, approval });
      const approvalGate = await this.requireStatefulApproval(managementArgs, () => dispatch({ confirmed: false }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(managementArgs, await dispatch());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("quicksprints", args.action, error);
    }
  }

  async handleManageScheduler(args: ManageSchedulerArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const managementArgs = { domain: "scheduler", action: args.action, payload: args as unknown as Record<string, unknown>, approval: args.approval };
      const dispatch = (approval = args.approval) => this.getSchedulerActions().handleSchedulerAction({ ...managementArgs, approval });
      const approvalGate = await this.requireStatefulApproval(managementArgs, () => dispatch({ confirmed: false }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(managementArgs, await dispatch());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("scheduler", args.action, error);
    }
  }

  async handleManageAgents(args: ManageAgentsArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const managementArgs = { domain: "agents", action: args.action, payload: args as unknown as Record<string, unknown>, approval: args.approval };
      const dispatch = (approval = args.approval) => this.agentActions.handleAgentAction({ ...managementArgs, approval });
      const approvalGate = await this.requireStatefulApproval(managementArgs, () => dispatch({ confirmed: false }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(managementArgs, await dispatch());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("agents", args.action, error);
    }
  }

  async handleManageMemory(args: ManageMemoryArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const managementArgs = { domain: "memory", action: args.action, payload: args as unknown as Record<string, unknown>, approval: args.approval };
      const dispatch = (approval = args.approval) => this.memoryActions.handleMemoryAction({ ...managementArgs, approval });
      const approvalGate = await this.requireStatefulApproval(managementArgs, () => dispatch({ confirmed: false }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(managementArgs, await dispatch());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("memory", args.action, error);
    }
  }

  async handleManageSettings(args: ManageSettingsArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const rawArgs = args as unknown as Record<string, unknown>;
      const nestedPayload = rawArgs.payload && typeof rawArgs.payload === "object" && !Array.isArray(rawArgs.payload)
        ? rawArgs.payload as Record<string, unknown>
        : null;
      const payload = nestedPayload ? { ...nestedPayload, action: args.action } : rawArgs;
      const envelope = await this.settingsActions.handleSettingsAction({ domain: "settings", action: args.action, payload, approval: args.approval });
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("settings", args.action, error);
    }
  }

  async handleManagePreview(args: ManagePreviewArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const currentHost = null; // fallback to localhost
      const managementArgs = { domain: "preview", action: args.action, payload: args as unknown as Record<string, unknown>, approval: args.approval };
      const dispatch = (approval = args.approval) => this.previewActions.handlePreviewAction({ ...managementArgs, approval }, currentHost);
      const approvalGate = await this.requireStatefulApproval(managementArgs, () => dispatch({ confirmed: false }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(managementArgs, await dispatch());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("preview", args.action, error);
    }
  }

  async handleManageTelemetry(args: ManageTelemetryArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const envelope = await handleTelemetryActions({ domain: "telemetry", action: args.action, payload: args as unknown as Record<string, unknown> }, this.deps.executionRepository);
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("telemetry", args.action, error);
    }
  }

  async handleSearchKnowledge(args: SearchKnowledgeArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const agentId = getCurrentMcpAgentId();
      if (!agentId) {
        return { content: [{ type: "text", text: "No knowledge base is attached to this session." }] };
      }
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return { content: [{ type: "text", text: "Provide a non-empty query to search your knowledge base." }] };
      }
      const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(Math.floor(args.limit), 20) : 5;
      const results = await this.deps.knowledgeService.searchForAgent(agentId, query, limit);

      if (results.length === 0) {
        return { content: [{ type: "text", text: `No relevant passages found in your knowledge base for: "${query}".` }] };
      }

      const formatted = results
        .map((result, index) => {
          const location = result.heading ? `${result.documentTitle} › ${result.heading}` : result.documentTitle;
          const score = `${Math.round(result.similarity * 100)}% match`;
          return `### [${index + 1}] ${location} (${score})\n${result.content.trim()}`;
        })
        .join("\n\n");

      const header = `Found ${results.length} relevant passage${results.length === 1 ? "" : "s"} for "${query}". Cite the document title when you use this.`;
      return { content: [{ type: "text", text: `${header}\n\n${formatted}` }] };
    } catch (error) {
      return this.formatError("knowledge", "search", error);
    }
  }
}
