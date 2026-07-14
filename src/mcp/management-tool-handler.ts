import type {
  ManageCodeUxArgs,
  ManagementResponseEnvelope,
  ManageProjectsArgs,
  ManageSprintsArgs,
  ManageTasksArgs,
  ManageQuicksprintsArgs,
  ManageSchedulerArgs,
  SchedulerArgs,
  ManageAgentsArgs,
  ManageNodeFlowsArgs,
  ManageMemoryArgs,
  AddLongTermMemoryArgs,
  ManageSkillsArgs,
  ManageSettingsArgs,
  ManagePreviewArgs,
  ManageCustomDashboardsArgs,
  ManageTelemetryArgs,
  ManageChatProvidersArgs,
  SearchKnowledgeArgs,
  SearchSkillsArgs,
  RequestClarificationArgs,
  ReplyToClarificationArgs,
  RunAttachedFlowArgs,
} from "../contracts/internal-management-types.js";
import type { KnowledgeService } from "../services/knowledge-service.js";
import { getCurrentMcpAgentId, getCurrentMcpThreadId } from "../server/mcp-agent-context.js";
import type { SprintPreviewService } from "../services/sprint-preview-service.js";
import type { CustomDashboardRepository } from "../repositories/custom-dashboard-repository.js";
import type { CustomDashboardValidationService } from "../services/custom-dashboard-validation-service.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ExecutionControlService } from "../services/execution-control-service.js";
import type { TaskRerunService } from "../services/task-rerun-service.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { ChatProviderRepository } from "../repositories/chat-provider-repository.js";
import type { AgentPresetSyncService } from "../services/agent-preset-sync-service.js";
import type { MemoryService } from "../services/memory-service.js";
import type { MemoryPromotionService } from "../services/memory-promotion-service.js";
import type { EmbeddingModelManager } from "../services/embedding-model-manager.js";
import type {
  PullWorkerTaskDispatchArgs,
  RegisterExternalWorkerEndpointArgs,
  UpdateWorkerTaskDispatchArgs,
  WorkerTaskDispatchService,
} from "../services/worker-task-dispatch-service.js";
import type { SkillService } from "../services/skill-service.js";
import type { NodeFlowService } from "../services/node-flow-service.js";
import { NodeFlowAgentSkillService } from "../services/node-flow-agent-skill-service.js";
import type { WorkerClarificationService } from "../services/worker-clarification-service.js";
import type { WorkerClarificationContinuationService } from "../services/worker-clarification-continuation-service.js";

import type { PlanningAgentService } from "../services/planning-agent-service.js";
import type { ProjectSetupService } from "../services/project-setup-service.js";
import type { SprintIssueService } from "../services/sprint-issue-service.js";
import type { QuicksprintService } from "../services/quicksprint-service.js";
import type { SchedulerService } from "../services/scheduler-service.js";
import type { Logger } from "../shared/logging/logger.js";
import type { CreateProjectInput, ProjectSummary } from "../contracts/project-management-types.js";
import { initializeProject } from "../domain/projects/project-initializer.js";
import { prepareGitProjectCreateInput } from "../services/project-git-clone-service.js";

import { PreviewActions } from "./management/preview-actions.js";
import { CustomDashboardActions } from "./management/custom-dashboard-actions.js";
import { handleTelemetryActions } from "./management/telemetry-actions.js";
import { handleProjectAction } from "./management/project-actions.js";
import { SprintActions } from "./management/sprint-actions.js";
import { TaskActions } from "./management/task-actions.js";
import { QuicksprintActions } from "./management/quicksprint-actions.js";
import { SchedulerActions } from "./management/scheduler-actions.js";
import { AgentSchedulerActions } from "./management/agent-scheduler-actions.js";
import { SettingsActions } from "./management/settings-actions.js";
import { AgentActions } from "./management/agent-actions.js";
import { NodeFlowActions, formatRunSummary } from "./management/node-flow-actions.js";
import { MemoryActions } from "./management/memory-actions.js";
import { SkillActions } from "./management/skill-actions.js";
import { ChatProviderActions } from "./management/chat-provider-actions.js";
import type { ChatProviderSecretService } from "../services/chat-provider-secret-service.js";
import type { ChatProviderVerificationService } from "../services/chat-provider-verification-service.js";
import type { ChatProviderOutboundService } from "../services/chat-provider-outbound-service.js";
import type { ChatConnectorRegistry } from "../domain/chat-connectors/registry.js";
import type { HeadlessAuthService } from "../services/headless-auth-service.js";
import type { AgentPresetRepository } from "../repositories/agent-preset-repository.js";
import { buildMcpApprovalFingerprint, formatManagementErrorEnvelope } from "./management/payload-parsers.js";
import { resolveLateBoundDependency, type LateBoundOrValue } from "../shared/late-bound-dependency.js";

export interface ManagementToolHandlerDeps {
  sprintPreviewService: SprintPreviewService;
  customDashboardRepository: CustomDashboardRepository;
  customDashboardValidationService: CustomDashboardValidationService;
  executionRepository: ExecutionRepository;
  getDashboardSettings: () => DashboardSettings;
  projectManagementRepository: ProjectManagementRepository;
  executionControlService: ExecutionControlService;
  taskRerunService: LateBoundOrValue<TaskRerunService>;
  settingsRepository: SettingsRepository;
  chatProviderRepository: ChatProviderRepository;
  chatProviderSecretService?: ChatProviderSecretService;
  chatProviderVerificationService?: ChatProviderVerificationService;
  chatProviderOutboundService?: ChatProviderOutboundService;
  chatConnectorRegistry?: ChatConnectorRegistry;
  headlessAuthService?: HeadlessAuthService;
  agentPresetRepository?: AgentPresetRepository;
  agentPresetSyncService: AgentPresetSyncService;
  memoryService: MemoryService;
  memoryPromotionService: MemoryPromotionService;
  embeddingModelManager: EmbeddingModelManager;
  skillService: SkillService;
  nodeFlowService: NodeFlowService;
  knowledgeService: KnowledgeService;
  planningAgentService: LateBoundOrValue<PlanningAgentService>;
  projectSetupService?: LateBoundOrValue<ProjectSetupService>;
  sprintIssueService: SprintIssueService;
  quicksprintService?: LateBoundOrValue<QuicksprintService>;
  schedulerService?: LateBoundOrValue<SchedulerService>;
  logger?: Logger;
  workerTaskDispatchService?: WorkerTaskDispatchService;
  workerClarificationService?: WorkerClarificationService;
  workerClarificationContinuationService?: WorkerClarificationContinuationService;
}

const MANAGEMENT_APPROVAL_TTL_MS = 15 * 60 * 1000;

export class ManagementToolHandler {
  private sprintActions: SprintActions | null = null;
  private taskActions: TaskActions | null = null;
  private agentSchedulerActions: AgentSchedulerActions | null = null;
  private readonly pendingDestructiveApprovals = new Map<string, number>();
  private readonly settingsActions: SettingsActions;
  private readonly agentActions: AgentActions;
  private readonly nodeFlowActions: NodeFlowActions;
  private readonly nodeFlowAgentSkillService: NodeFlowAgentSkillService;
  private readonly memoryActions: MemoryActions;
  private readonly skillActions: SkillActions;
  private readonly previewActions: PreviewActions;
  private readonly customDashboardActions: CustomDashboardActions;
  private readonly chatProviderActions: ChatProviderActions;

  constructor(private readonly deps: ManagementToolHandlerDeps) {
    this.settingsActions = new SettingsActions(deps.settingsRepository);
    this.agentActions = new AgentActions(deps.agentPresetSyncService);
    this.nodeFlowActions = new NodeFlowActions(deps.nodeFlowService);
    this.nodeFlowAgentSkillService = new NodeFlowAgentSkillService(deps.nodeFlowService);
    this.memoryActions = new MemoryActions(deps.memoryService, deps.memoryPromotionService, deps.embeddingModelManager);
    this.skillActions = new SkillActions(deps.skillService);
    this.previewActions = new PreviewActions(deps.sprintPreviewService);
    this.customDashboardActions = new CustomDashboardActions(
      deps.customDashboardRepository,
      deps.customDashboardValidationService,
    );
    this.chatProviderActions = new ChatProviderActions(deps.chatProviderRepository, deps.chatProviderSecretService, {
      chatProviderVerificationService: deps.chatProviderVerificationService,
      chatProviderOutboundService: deps.chatProviderOutboundService,
      connectorRegistry: deps.chatConnectorRegistry,
      authorizeProject: (projectId) => {
        const agentId = getCurrentMcpAgentId();
        if (!agentId || agentId === "project-manager-mcp-client") return true;
        return deps.agentPresetRepository?.getAgentPreset(agentId)?.projectId === projectId;
      },
      allowCredentialMutation: () => !deps.headlessAuthService
        || deps.headlessAuthService.configuration.mode === "local"
        || deps.headlessAuthService.configuration.remoteCredentialManagement,
    });
  }

  private getSprintActions(): SprintActions {
    if (!this.sprintActions) {
      this.sprintActions = new SprintActions({
        ...this.deps,
        planningAgentService: resolveLateBoundDependency(this.deps.planningAgentService),
        schedulerService: this.deps.schedulerService
          ? resolveLateBoundDependency(this.deps.schedulerService)
          : undefined,
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

  private getAgentSchedulerActions(): AgentSchedulerActions {
    if (!this.agentSchedulerActions) {
      if (!this.deps.schedulerService) {
        throw new Error("Scheduler service is not enabled.");
      }
      this.agentSchedulerActions = new AgentSchedulerActions(resolveLateBoundDependency(this.deps.schedulerService));
    }
    return this.agentSchedulerActions;
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
      || args.action === "archive"
      || args.action === "publish"
      || args.action === "rollback"
      || args.action === "retry_delivery"
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
    } else if (args.domain === "node_flows") {
      return this.nodeFlowActions.handleNodeFlowAction(args);
    } else if (args.domain === "memory") {
      return this.memoryActions.handleMemoryAction(args);
    } else if (args.domain === "skills") {
      return this.skillActions.handleSkillAction(args);
    } else if (args.domain === "preview") {
      const currentHost = null; // serverHost is not available on DashboardSettings, we'll fall back to localhost in preview-origin
      return this.previewActions.handlePreviewAction(args, currentHost);
    } else if (args.domain === "custom_dashboards") {
      return this.customDashboardActions.handleCustomDashboardAction(args);
    } else if (args.domain === "chat_providers") {
      return this.chatProviderActions.handleChatProviderAction(args);
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

  async handleScheduler(args: SchedulerArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const envelope = this.getAgentSchedulerActions().handleSchedulerAction(args, getCurrentMcpAgentId());
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

  async handleManageNodeFlows(args: ManageNodeFlowsArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const managementArgs = { domain: "node_flows", action: args.action, payload: args as unknown as Record<string, unknown>, approval: args.approval };
      const dispatch = (approval = args.approval) => this.nodeFlowActions.handleNodeFlowAction({ ...managementArgs, approval });
      const approvalGate = await this.requireStatefulApproval(managementArgs, () => dispatch({ confirmed: false }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(managementArgs, await dispatch());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("node_flows", args.action, error);
    }
  }

  async handleRunAttachedFlow(args: RunAttachedFlowArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const agentPresetId = getCurrentMcpAgentId();
      if (!agentPresetId) throw new Error("An authenticated agent is required to run an attached flow.");
      const result = await this.nodeFlowAgentSkillService.runAttachedFlow({
        projectId: args.projectId,
        flowId: args.flowId,
        agentPresetId,
        conversationId: getCurrentMcpThreadId(),
        parameters: args.input,
      });
      return { content: [{ type: "text", text: JSON.stringify({ result: formatRunSummary(result) }, null, 2) }] };
    } catch (error) {
      return this.formatError("node_flows", "run_attached_flow", error);
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

  async handleAddLongTermMemory(args: AddLongTermMemoryArgs): Promise<{ content: Array<{ type: string; text: string }>; isError?: true }> {
    try {
      const envelope = await this.memoryActions.addLongTermMemory(args);
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("memory", "add_long_term_memory", error);
    }
  }

  async handleManageSkills(args: ManageSkillsArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const managementArgs = { domain: "skills", action: args.action, payload: args as unknown as Record<string, unknown>, approval: args.approval };
      const dispatch = (approval = args.approval) => this.skillActions.handleSkillAction({ ...managementArgs, approval });
      const approvalGate = await this.requireStatefulApproval(managementArgs, () => dispatch({ confirmed: false }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(managementArgs, await dispatch());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("skills", args.action, error);
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

  async handleManageCustomDashboards(args: ManageCustomDashboardsArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const managementArgs = { domain: "custom_dashboards", action: args.action, payload: args as unknown as Record<string, unknown>, approval: args.approval };
      const dispatch = (approval = args.approval) => this.customDashboardActions.handleCustomDashboardAction({ ...managementArgs, approval });
      const approvalGate = await this.requireStatefulApproval(managementArgs, () => dispatch({ confirmed: false }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(managementArgs, await dispatch());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("custom_dashboards", args.action, error);
    }
  }

  async handleManageChatProviders(args: ManageChatProvidersArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const managementArgs = { domain: "chat_providers", action: args.action, payload: args as unknown as Record<string, unknown>, approval: args.approval };
      const dispatch = (approval = args.approval) => this.chatProviderActions.handleChatProviderAction({ ...managementArgs, approval });
      const approvalGate = await this.requireStatefulApproval(managementArgs, () => dispatch({ confirmed: false }));
      const envelope = approvalGate ?? this.recordStatefulApprovalRequirement(managementArgs, await dispatch());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("chat_providers", args.action, error);
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

  async handleRequestClarification(args: RequestClarificationArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      if (!this.deps.workerClarificationService) {
        throw new Error("Worker clarification service is not enabled.");
      }
      const requesterAgentId = getCurrentMcpAgentId();
      if (!requesterAgentId) {
        throw new Error("An authenticated worker agent is required to request clarification.");
      }
      const clarification = this.deps.workerClarificationService.create({
        ...args,
        requesterAgentId,
      });
      return { content: [{ type: "text", text: JSON.stringify({ clarification }, null, 2) }] };
    } catch (error) {
      return this.formatError("clarifications", "request", error);
    }
  }

  async handleReplyToClarification(args: ReplyToClarificationArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const repliedByAgentId = getCurrentMcpAgentId() ?? "project-manager-mcp-client";
      if (!this.deps.workerClarificationContinuationService) {
        throw new Error("Worker clarification continuation service is not enabled.");
      }
      const result = await this.deps.workerClarificationContinuationService.continueReply({
        projectId: args.projectId,
        clarificationId: args.clarificationId,
        answerMarkdown: args.answerMarkdown,
        repliedByAgentId,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return this.formatError("clarifications", "reply", error);
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

  async handleRegisterWorkerEndpoint(args: RegisterExternalWorkerEndpointArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      if (!this.deps.workerTaskDispatchService) {
        throw new Error("Worker dispatch service is not enabled.");
      }
      const endpoint = this.deps.workerTaskDispatchService.registerExternalWorkerEndpoint(args);
      return { content: [{ type: "text", text: JSON.stringify({ endpoint }, null, 2) }] };
    } catch (error) {
      return this.formatError("workers", "register_worker_endpoint", error);
    }
  }

  async handlePullTaskDispatch(args: PullWorkerTaskDispatchArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      if (!this.deps.workerTaskDispatchService) {
        throw new Error("Worker dispatch service is not enabled.");
      }
      const claim = this.deps.workerTaskDispatchService.pullNextDispatch(args);
      return { content: [{ type: "text", text: JSON.stringify(claim, null, 2) }] };
    } catch (error) {
      return this.formatError("workers", "pull_task_dispatch", error);
    }
  }

  async handleUpdateTaskDispatch(args: UpdateWorkerTaskDispatchArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      if (!this.deps.workerTaskDispatchService) {
        throw new Error("Worker dispatch service is not enabled.");
      }
      const result = this.deps.workerTaskDispatchService.updateDispatch(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return this.formatError("workers", "update_task_dispatch", error);
    }
  }

  async handleSearchSkills(args: SearchSkillsArgs): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      const envelope = await this.skillActions.handleSearchSkills(args, getCurrentMcpAgentId());
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    } catch (error) {
      return this.formatError("skills", "search", error);
    }
  }
}
