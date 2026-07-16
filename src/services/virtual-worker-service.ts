import { buildProviderSettingsOverride } from "./provider-settings-override.js";
import { randomUUID } from "crypto";
import type { CliWorkflowSettings, DashboardSettings, GitCiRunStatus, JulesSession, ProviderId, ProviderSettings, QwenModelProviderSettings, ThinkingMode, WorkerExecutionMode, Subtask } from "../contracts/app-types.js";
import type { ProviderInvocationUsageRecord, TaskDispatchRecord, WorkerTaskDispatchClaim } from "../contracts/execution-types.js";
import type { ProjectAttentionItemRecord, RepairAttentionRuntimeState } from "../contracts/project-attention-types.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { WorkerEndpointRepository } from "../repositories/worker-endpoint-repository.js";
import type { ProjectWorkerAssignmentRepository } from "../repositories/project-worker-assignment-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { buildTaskRunKey } from "./task-run-key.js";
import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS, sanitizeToken } from "./cli-workflow-utils.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "./cli-workflow-text-utils.js";
import { WorkspaceManager } from "../infrastructure/providers/cli/workspace-manager.js";
import { buildInvocationGitPolicy, InvocationWorkspacePreparer } from "../infrastructure/providers/cli/invocation-workspace-preparer.js";
import {
  WorkspaceArtifactService,
  type AppliedWorkspacePatchResult,
} from "../infrastructure/providers/cli/workspace-artifact-service.js";
import { CODE_UX_GIT_PATHSPEC_EXCLUDE, CODE_UX_REPO_DIR } from "../infrastructure/git/code-ux-gitignore.js";
import { ProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import { DockerRunner } from "../infrastructure/providers/cli/docker-runner.js";
import { PrService } from "../infrastructure/providers/cli/pr-service.js";
import { ProviderExecutionService, resolveEffectiveModel } from "./provider-execution-service.js";
import type { GuardrailEvaluation, GuardrailScope, GuardrailService } from "./guardrail-service.js";
import { runCommandStrict } from "./cli-process-runner.js";
import { buildGitHttpAuthEnvForRepoWithFallbacks, type GitHttpAuthOptions } from "./git-http-auth.js";
import { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import { ProjectWorkerAssignmentService } from "../domain/workers/project-worker-assignment-service.js";
import { WorkerTaskDispatchService } from "./worker-task-dispatch-service.js";
import { CliWorkflowService } from "./cli-workflow-service.js";
import { resolveProviderForInvocation, resolveWorkerModelForProvider } from "./provider-routing.js";
import { ProviderConcurrencyService } from "./provider-concurrency-service.js";
import { resolveEffectiveDashboardSettings } from "./settings-resolution-service.js";
import type { WorkerInboxReplyService } from "./worker-inbox-reply-service.js";
import type { InstructionService } from "../instructions/instruction-template-service.js";
import type { SprintExecutionStateService } from "./sprint-execution-state-service.js";
import type { MemoryService } from "./memory-service.js";
import type { SkillService } from "./skill-service.js";
import type { AgentPresetRepository } from "../repositories/agent-preset-repository.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { AgentMcpAccessConfig } from "../contracts/agent-preset-types.js";
import type { AgentPresetRecord } from "../contracts/agent-preset-types.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import { resolveAgentMemoryInstructions } from "./agent-memory-instructions.js";
import { buildRelevantMemoryInjectionContext } from "./memory-injection-context.js";
import { LEARNINGS_FILENAME } from "../contracts/memory-types.js";
import { DockerService } from "./docker-service.js";
import { workerClarificationAgentMcpAccess } from "./agent-mcp-access.js";
import {
  planVirtualWorkerAttentionClaim,
  projectNeedsVirtualWorker,
  peekNextWorkerAttention,
  resolveWorkerExecutionMode,
  computeReconciliationCandidates,
  hasPendingManagerClarificationForScope,
  isProjectManagerOwnedClarificationItem,
  resolveVirtualWorkerAttentionRoute,
  type VirtualWorkerAttentionRoute,
} from "../domain/workers/virtual-worker-scheduling-policy.js";
import { getFailedJobLabels, getFailedLogSnippets, selectNewestCiRun } from "../sprint/ci-status-utils.js";
import {
  VirtualWorkerCycleRegistry,
  type VirtualWorkerCycleReservation,
} from "./virtual-worker-cycle-registry.js";

const VIRTUAL_WORKER_RECONCILE_MS = 3_000;
const VIRTUAL_WORKER_SESSION_POLL_MS = 2_000;
const VIRTUAL_WORKER_PROVIDER_SLOT_WAIT_MS = 30_000;
const VIRTUAL_WORKER_CLI_PROVIDER_POOL: ProviderId[] = [
  "gemini",
  "codex",
  "claude-code",
  "qwen-code",
  "opencode",
  "antigravity",
  "mockup-cli",
];

interface TaskCiFixContinuation {
  provider: Exclude<ProviderId, "jules">;
  providerConfigId: string;
  providerSettings: ProviderSettings;
  sessionId: string;
  resumeSessionId: string;
  continueSessionId: string | null;
  continueSessionWithoutNativeId: boolean;
  taskRunId: string | null;
  previousInvocation: ProviderInvocationUsageRecord | null;
  workerAgent: AgentPresetRecord | null;
}

type VirtualWorkerCycleWork =
  | { kind: "attention"; attentionItemId: string }
  | { kind: "dispatch"; dispatchId: string; taskId: string; sprintId: string };

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCiFixFailureDetails(failedRuns: GitCiRunStatus[], fallbackLogSnippets: string[]): string {
  if (failedRuns.length === 0) {
    return fallbackLogSnippets.length > 0
      ? `No structured failed run metadata was available. Failed job logs:\n${fallbackLogSnippets.join("\n\n")}`
      : "No structured failed run metadata or failed-job logs were available in the CI status payload.";
  }

  const sections: string[] = [];
  failedRuns.forEach((run, runIndex) => {
    const runLabel = run.workflowName || run.name || `run-${run.id ?? runIndex + 1}`;
    const lines = [
      `### Failed Run ${runIndex + 1}: ${runLabel}`,
      `- Run ID: ${run.id ?? "unknown"}`,
      `- Run URL: ${run.url || "unknown"}`,
      `- Status: ${run.status}`,
      `- Conclusion: ${run.conclusion ?? "unknown"}`,
      `- Event: ${run.event ?? "unknown"}`,
      `- Head branch: ${run.headBranch ?? "unknown"}`,
      `- Updated at: ${run.updatedAt ?? "unknown"}`,
    ];

    const jobs = Array.isArray(run.failedJobs) ? run.failedJobs : [];
    if (jobs.length === 0) {
      lines.push("- Failed jobs: unavailable from CI metadata.");
    } else {
      lines.push("- Failed jobs:");
      jobs.forEach((job, jobIndex) => {
        lines.push(`  ${jobIndex + 1}. ${job.name}`);
        lines.push(`     - Job ID: ${job.id ?? "unknown"}`);
        lines.push(`     - Conclusion: ${job.conclusion ?? "unknown"}`);
        lines.push(`     - Failed steps: ${job.failedSteps.length > 0 ? job.failedSteps.join(", ") : "not reported"}`);
        lines.push(`     - Log command: ${job.logCommand ?? "not available"}`);
        lines.push("     - Failed-step error and assertion evidence:");
        lines.push("```text");
        lines.push(job.logExcerpt?.trim() || "No failed-step error evidence was available.");
        lines.push("```");
      });
    }

    sections.push(lines.join("\n"));
  });

  return sections.join("\n\n");
}

function isTerminalSessionState(state: string | undefined): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED" || state === "QUOTA" || state === "RATE_LIMITED";
}

function isProviderCancellationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /Command spawner host exited/i.test(message)
    && /(signal=SIGINT|signal=SIGTERM|signal=SIGHUP)/i.test(message);
}

function extractPullRequest(session: JulesSession): { url?: string; workerBranch?: string } | null {
  const output = (session.outputs || [])
    .map((entry) => entry.pullRequest)
    .find((entry): entry is { url?: string; workerBranch?: string } => Boolean(entry));
  return output || null;
}

function resolveTerminalDispatchState(session: JulesSession): "COMPLETED" | "FAILED" | "QUOTA" | null {
  if (session.state === "QUOTA") {
    return "QUOTA";
  }
  if (session.state === "RATE_LIMITED") {
    return "QUOTA";
  }
  if (session.state === "FAILED" || session.state === "CANCELLED") {
    return "FAILED";
  }
  if (extractPullRequest(session) || session.state === "COMPLETED") {
    return "COMPLETED";
  }
  return null;
}

export interface VirtualWorkerServiceDependencies {
  settingsRepository: SettingsRepository;
  sessionTracking: SessionTrackingRepository;
  executionRepository: ExecutionRepository;
  projectManagementRepository: ProjectManagementRepository;
  workerEndpointRepository: WorkerEndpointRepository;
  projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository;
  projectWorkerAssignmentService: ProjectWorkerAssignmentService;
  projectAttentionService: ProjectAttentionService;
  guardrailService?: GuardrailService;
  workerTaskDispatchService: WorkerTaskDispatchService;
  cliWorkflowService: CliWorkflowService;
  sprintExecutionStateService: SprintExecutionStateService;
  workerInboxReplyService: WorkerInboxReplyService;
  instructionService: InstructionService;
  approveSessionPlan: (sessionId: string) => Promise<unknown>;
  sendSessionMessage: (sessionId: string, prompt: string) => Promise<unknown>;
  providerConcurrencyService: ProviderConcurrencyService;
  memoryService?: MemoryService;
  skillService?: SkillService;
  agentPresetRepository?: AgentPresetRepository;
  getMcpConnectionInfo?: () => McpConnectionInfo | null;
  agentPresetSyncService?: Pick<AgentPresetSyncService, "getOptionalWorkerAgentForRepoPath" | "resolveTargetedCodingAgent">;
  logger?: Logger;
}

export class VirtualWorkerService {
  private readonly workspaceManager = new WorkspaceManager();
  private readonly invocationWorkspacePreparer = new InvocationWorkspacePreparer(this.workspaceManager);
  private readonly workspaceArtifactService = new WorkspaceArtifactService(this.workspaceManager);
  private readonly dockerService = new DockerService();
  private readonly prService = new PrService();

  private readonly providerRunner = new ProviderRunner(new DockerRunner());

  private readonly cycleRegistry = new VirtualWorkerCycleRegistry();

  private readonly activeCycles = new Map<string, Promise<void>>();

  private readonly scheduledProjects = new Set<string>();

  private readonly launchingProjects = new Set<string>();

  private readonly deferredProjectSchedules = new Map<string, ReturnType<typeof setTimeout>>();

  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  private reconcileInProgress = false;

  private stopped = false;

  private readonly providerExecutionService: ProviderExecutionService;

  constructor(private readonly deps: VirtualWorkerServiceDependencies) {
    this.providerExecutionService = new ProviderExecutionService({
      executionRepository: deps.executionRepository,
      providerRunner: this.providerRunner,
      providerConcurrencyService: deps.providerConcurrencyService,
      logger: deps.logger,
      sessionTracking: deps.sessionTracking,
      getMcpConnectionInfo: deps.getMcpConnectionInfo,
      skillService: deps.skillService,
      agentPresetRepository: deps.agentPresetRepository,
      getDashboardSettings: ({ projectId, sprintId }) => (
        projectId ? this.resolveDashboardSettings(projectId, sprintId) : deps.settingsRepository.getDefaultDashboardSettings()
      ),
    });
  }

  start(): void {
    if (this.reconcileTimer) {
      return;
    }
    this.stopped = false;

    this.cleanupOrphanedVirtualWorkers();
    void this.reconcile().catch((error) => {
      this.deps.logger?.error("Virtual worker reconcile failed", { error });
    });
    this.reconcileTimer = setInterval(() => {
      void this.reconcile().catch((error) => {
        this.deps.logger?.error("Virtual worker reconcile failed", { error });
      });
    }, VIRTUAL_WORKER_RECONCILE_MS);
    this.reconcileTimer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    for (const timer of this.deferredProjectSchedules.values()) {
      clearTimeout(timer);
    }
    this.deferredProjectSchedules.clear();
  }

  scheduleProject(projectId: string, reason: string, resolver?: (pId: string, sId?: string | null) => DashboardSettings): void {
    if (this.stopped || this.scheduledProjects.has(projectId) || this.launchingProjects.has(projectId) || this.deferredProjectSchedules.has(projectId)) {
      return;
    }
    if (!this.projectNeedsVirtualWorker(projectId, resolver)) {
      return;
    }

    this.scheduledProjects.add(projectId);
    queueMicrotask(() => {
      this.scheduledProjects.delete(projectId);
      if (this.stopped || !this.projectNeedsVirtualWorker(projectId, resolver)) {
        return;
      }
      this.launchingProjects.add(projectId);
      void this.launchAvailableProjectCycles(projectId, reason, resolver)
        .catch((error) => {
          this.deps.logger?.error("Virtual worker project launch failed", { projectId, reason, error });
        })
        .finally(() => {
          this.launchingProjects.delete(projectId);
          if (!this.stopped && this.projectNeedsVirtualWorker(projectId, resolver)) {
            this.scheduleProjectLater(projectId, "remaining_worker_work", resolver);
          }
        });
    });
  }

  private scheduleProjectLater(projectId: string, reason: string, resolver?: (pId: string, sId?: string | null) => DashboardSettings): void {
    if (this.stopped || this.scheduledProjects.has(projectId) || this.launchingProjects.has(projectId) || this.deferredProjectSchedules.has(projectId)) {
      return;
    }
    if (!this.projectNeedsVirtualWorker(projectId, resolver)) {
      return;
    }

    const timer = setTimeout(() => {
      this.deferredProjectSchedules.delete(projectId);
      this.scheduleProject(projectId, reason, resolver);
    }, VIRTUAL_WORKER_RECONCILE_MS);
    timer.unref?.();
    this.deferredProjectSchedules.set(projectId, timer);
  }

  async reconcile(): Promise<void> {
    if (this.stopped || this.reconcileInProgress) {
      return;
    }
    this.reconcileInProgress = true;
    try {
      this.reconcileProjects();
    } finally {
      this.reconcileInProgress = false;
    }
  }

  private reconcileProjects(): void {
    const cycleCache = new Map<string, DashboardSettings>();
    const resolver = (pId: string, sId?: string | null): DashboardSettings => {
      const key = `${pId}:${sId ?? ""}`;
      if (cycleCache.has(key)) {
        return cycleCache.get(key)!;
      }
      const settings = this.resolveDashboardSettings(pId, sId);
      cycleCache.set(key, settings);
      return settings;
    };

    const activeAttentionProjects = this.deps.projectAttentionService.listProjectIdsWithOpenWorkerAttention();
    const pendingDispatchProjects = this.deps.executionRepository.listProjectIdsWithPendingDispatches();

    const activeProjectIds = computeReconciliationCandidates(
      activeAttentionProjects,
      pendingDispatchProjects,
      this.cycleRegistry.listProjectIds(),
    );

    for (const projectId of activeProjectIds) {
      if (this.scheduledProjects.has(projectId) || this.launchingProjects.has(projectId) || this.deferredProjectSchedules.has(projectId)) {
        continue;
      }
      if (this.projectNeedsVirtualWorker(projectId, resolver, pendingDispatchProjects.includes(projectId))) {
        this.scheduleProject(projectId, "reconcile", resolver);
      }
    }
  }

  private resolveDashboardSettings(projectId: string, sprintId?: string | null): DashboardSettings {
    return resolveEffectiveDashboardSettings(this.deps.settingsRepository, projectId, sprintId).settings;
  }

  private projectNeedsVirtualWorker(
    projectId: string,
    resolver?: (pId: string, sId?: string | null) => DashboardSettings,
    hasPendingDispatch?: boolean,
  ): boolean {
    const effectiveResolver = resolver || ((pId, sId) => this.resolveDashboardSettings(pId, sId));
    const activeItems = this.deps.projectAttentionService.listActiveProjectItems(projectId);
    const nextAttentionItem = peekNextWorkerAttention(activeItems, effectiveResolver);
    const projectHasPendingDispatch = hasPendingDispatch
      ?? this.deps.executionRepository.listProjectIdsWithPendingDispatches().includes(projectId);
    const eligibleDispatches = projectHasPendingDispatch
      ? this.listEligibleQueuedDispatches(projectId, activeItems)
      : [];
    const pendingDispatchAvailable = !nextAttentionItem && eligibleDispatches.some((dispatch) => {
      const settings = effectiveResolver(projectId, dispatch.sprintId);
      const maxCycles = Math.max(1, Math.floor(settings.workers.maxConcurrency));
      return resolveWorkerExecutionMode(settings) === "VIRTUAL"
        && this.cycleRegistry.countProject(projectId) < maxCycles
        && !this.cycleRegistry.hasAttention(projectId)
        && !this.cycleRegistry.hasDispatchConflict(projectId, dispatch.id, dispatch.taskId);
    });
    const executionMode: WorkerExecutionMode = "VIRTUAL";
    const projectCycleBlocked = nextAttentionItem
      ? this.cycleRegistry.countProject(projectId) > 0
      : !pendingDispatchAvailable;
    return projectNeedsVirtualWorker(
      projectCycleBlocked,
      nextAttentionItem,
      executionMode,
      pendingDispatchAvailable,
      this.scheduledProjects.has(projectId),
    );
  }

  private listEligibleQueuedDispatches(
    projectId: string,
    activeItems: ProjectAttentionItemRecord[],
  ): TaskDispatchRecord[] {
    return this.deps.executionRepository.listTaskDispatches({ projectId })
      .filter((dispatch) => (
        dispatch.status === "queued"
        && !hasPendingManagerClarificationForScope({
          taskId: dispatch.taskId,
          dispatchId: dispatch.id,
        }, activeItems)
      ));
  }

  private async launchAvailableProjectCycles(
    projectId: string,
    reason: string,
    resolver?: (pId: string, sId?: string | null) => DashboardSettings,
  ): Promise<void> {
    const effectiveResolver = resolver || ((pId: string, sId?: string | null) => this.resolveDashboardSettings(pId, sId));
    const activeItems = this.deps.projectAttentionService.listActiveProjectItems(projectId);
    const attentionItem = peekNextWorkerAttention(activeItems, effectiveResolver);
    if (attentionItem) {
      const reservation: VirtualWorkerCycleReservation = {
        id: `attention:${attentionItem.id}:${randomUUID()}`,
        projectId,
        kind: "attention",
        attentionItemId: attentionItem.id,
        taskId: attentionItem.taskId || undefined,
      };
      if (this.cycleRegistry.tryReserve(reservation, 1)) {
        this.startReservedCycle(reservation, { kind: "attention", attentionItemId: attentionItem.id }, reason, resolver);
      }
      return;
    }

    const providerBudgets = new Map<ProviderId, number>();
    for (const dispatch of this.listEligibleQueuedDispatches(projectId, activeItems)) {
      const settings = effectiveResolver(projectId, dispatch.sprintId);
      if (resolveWorkerExecutionMode(settings) !== "VIRTUAL") {
        continue;
      }
      const providerConfigId = settings.workers.virtualWorkerProvider;
      const providerSettings = settings.aiProvider.providers[providerConfigId];
      const provider = providerSettings?.provider || "codex";
      let providerBudget = providerBudgets.get(provider);
      if (providerBudget === undefined) {
        const capacityService = this.deps.providerConcurrencyService as ProviderConcurrencyService & {
          getAvailableCapacityCount?: (
            providerId: ProviderId,
            limit: number,
            purpose?: "task_coding",
          ) => Promise<number | null>;
        };
        if (typeof capacityService.getAvailableCapacityCount === "function") {
          const available = await capacityService.getAvailableCapacityCount(
            provider,
            providerSettings?.maxConcurrentTasks ?? 0,
            "task_coding",
          );
          providerBudget = available ?? Number.POSITIVE_INFINITY;
        } else {
          providerBudget = await capacityService.hasAvailableCapacity(
            provider,
            providerSettings?.maxConcurrentTasks ?? 0,
          ) ? Number.POSITIVE_INFINITY : 0;
        }
        providerBudgets.set(provider, providerBudget);
      }
      if (providerBudget <= 0) {
        continue;
      }
      const maxCycles = Math.max(1, Math.floor(settings.workers.maxConcurrency));
      const reservation: VirtualWorkerCycleReservation = {
        id: `dispatch:${dispatch.id}:${randomUUID()}`,
        projectId,
        kind: "dispatch",
        dispatchId: dispatch.id,
        taskId: dispatch.taskId,
        providerId: provider,
      };
      if (!this.cycleRegistry.tryReserve(reservation, maxCycles)) {
        continue;
      }
      providerBudgets.set(provider, providerBudget - 1);
      this.startReservedCycle(reservation, {
        kind: "dispatch",
        dispatchId: dispatch.id,
        taskId: dispatch.taskId,
        sprintId: dispatch.sprintId,
      }, reason, resolver);
    }
  }

  private startReservedCycle(
    reservation: VirtualWorkerCycleReservation,
    work: VirtualWorkerCycleWork,
    reason: string,
    resolver?: (pId: string, sId?: string | null) => DashboardSettings,
  ): void {
    const cycle = this.runProjectCycle(reservation.projectId, reason, resolver, work)
      .catch((error) => {
        this.deps.logger?.error("Virtual worker cycle failed", {
          projectId: reservation.projectId,
          reason,
          cycleKind: reservation.kind,
          dispatchId: reservation.dispatchId ?? null,
          attentionItemId: reservation.attentionItemId ?? null,
          error,
        });
      })
      .finally(() => {
        this.activeCycles.delete(reservation.id);
        this.cycleRegistry.release(reservation.id);
        if (!this.stopped && this.projectNeedsVirtualWorker(reservation.projectId, resolver)) {
          this.scheduleProjectLater(reservation.projectId, "remaining_worker_work", resolver);
        }
      });
    this.activeCycles.set(reservation.id, cycle);
  }

  private async runProjectCycle(
    projectId: string,
    reason: string,
    resolver?: (pId: string, sId?: string | null) => DashboardSettings,
    requestedWork?: VirtualWorkerCycleWork,
  ): Promise<void> {
    const effectiveResolver = resolver || ((pId, sId) => this.resolveDashboardSettings(pId, sId));
    const activeItems = this.deps.projectAttentionService.listActiveProjectItems(projectId);
    const nextAttentionItem = peekNextWorkerAttention(activeItems, effectiveResolver);
    const attentionItem = requestedWork?.kind === "attention"
      ? nextAttentionItem?.id === requestedWork.attentionItemId ? nextAttentionItem : null
      : requestedWork?.kind === "dispatch"
        ? null
        : nextAttentionItem;

    // Repair/worker attention is project-exclusive. New coding work waits until
    // the attention item is settled, while already-running provider work keeps
    // its durable dispatch lease and is allowed to finish normally.
    if (nextAttentionItem && requestedWork?.kind === "dispatch") {
      return;
    }

    const nextDispatch = attentionItem
      ? null
      : this.listEligibleQueuedDispatches(projectId, activeItems)
        .find((dispatch) => !requestedWork || (
          requestedWork.kind === "dispatch"
          && dispatch.id === requestedWork.dispatchId
          && dispatch.taskId === requestedWork.taskId
        )) ?? null;
    if (!attentionItem && !nextDispatch) {
      return;
    }

    const attentionRoute = attentionItem
      ? resolveVirtualWorkerAttentionRoute(attentionItem)
      : null;
    if (attentionRoute === "skip_orchestrator_handled") {
      return;
    }

    const cycleSettings = effectiveResolver(projectId, nextDispatch?.sprintId || attentionItem?.sprintId);
    let cycleProviderType: ProviderId;
    let providerLimit: number;
    if (attentionItem && attentionRoute) {
      const capacity = await this.resolveAttentionProviderCapacity(attentionItem, attentionRoute, cycleSettings);
      cycleProviderType = capacity.provider;
      providerLimit = capacity.limit;
    } else {
      const providerConfigId = cycleSettings.workers.virtualWorkerProvider;
      const providerSettings = cycleSettings.aiProvider.providers[providerConfigId];
      cycleProviderType = providerSettings?.provider || "codex";
      providerLimit = providerSettings?.maxConcurrentTasks ?? 0;
    }

    if (!(await this.deps.providerConcurrencyService.hasAvailableCapacity(cycleProviderType, providerLimit))) {
      this.deps.logger?.info("Virtual worker deferred until the routed provider has capacity", {
        projectId,
        provider: cycleProviderType,
        dispatchId: nextDispatch?.id ?? null,
        attentionItemId: attentionItem?.id ?? null,
        attentionType: attentionItem?.attentionType ?? null,
      });
      return;
    }

    // Create the virtual endpoint first so that downstream operations (like task dispatch) have a valid target ID.
    const endpoint = this.deps.workerEndpointRepository.createVirtualEndpoint({
      endpointKey: `virtual:${projectId}:${Date.now().toString(36)}:${sanitizeToken(randomUUID().slice(0, 8))}`,
      displayName: `Virtual ${this.getProviderLabel(cycleProviderType)} Worker`,
      status: "connected",
      transport: "internal",
      capabilities: {
        canSuperviseProjects: true,
        canExecuteTasks: true,
      },
    });

    this.deps.projectWorkerAssignmentService.ensureWorkerAssignment(projectId, endpoint.id);

    try {
      if (attentionItem && attentionRoute) {
        await this.handleAttentionItem(
          endpoint.id,
          attentionItem,
          reason,
          attentionRoute,
          planVirtualWorkerAttentionClaim(attentionItem, reason).claimReason,
        );
        return;
      }

      if (nextDispatch) {
        const dispatchClaim = this.deps.workerTaskDispatchService.claimNextDispatchForWorker({
          projectId,
          workerEndpointId: endpoint.id,
          executionMode: "VIRTUAL",
          dispatchId: nextDispatch.id,
          taskId: nextDispatch.taskId,
          sprintId: nextDispatch.sprintId,
        });
        if (dispatchClaim) {
          await this.handleTaskDispatch(endpoint.id, dispatchClaim);
        }
      }
    } finally {
      this.deps.projectWorkerAssignmentService.releaseWorkerAssignment(projectId, endpoint.id, "virtual_worker_cycle_complete");
      this.deps.workerEndpointRepository.deleteWorkerEndpoint(endpoint.id);
    }
  }

  private peekNextWorkerAttention(projectId: string, resolver?: (pId: string, sId?: string | null) => DashboardSettings): ProjectAttentionItemRecord | null {
    const items = this.deps.projectAttentionService.listActiveProjectItems(projectId);
    const effectiveResolver = resolver || ((pId, sId) => this.resolveDashboardSettings(pId, sId));
    return peekNextWorkerAttention(items, effectiveResolver);
  }



  private async handleTaskDispatch(workerEndpointId: string, claim: WorkerTaskDispatchClaim): Promise<void> {
    const settings = this.resolveDashboardSettings(claim.project.id, claim.sprint.id);
    const providerConfigId = settings.workers.virtualWorkerProvider;
    const providerSettings = settings.aiProvider.providers[providerConfigId];
    const provider = providerSettings.provider as Exclude<ProviderId, "jules">;
    const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(claim.dispatch.id);
    if (!taskRun) {
      throw new Error(`Task run not found for dispatch ${claim.dispatch.id}`);
    }

    const task = this.deps.projectManagementRepository.getTask(claim.dispatch.taskId);

    const session = await this.deps.cliWorkflowService.startTask({
      provider,
      providerSettingsOverride: buildProviderSettingsOverride(
        resolveWorkerModelForProvider(
          provider,
          task?.model || settings.workers.model,
          providerSettings.model,
        ),
        providerSettings
      ),
      task: {
        record_id: claim.task.id,
        project_id: claim.project.id,
        sprint_id: claim.sprint.id,
        id: claim.task.taskKey,
        title: claim.task.title,
        prompt: claim.task.promptMarkdown,
        depends_on: [...claim.task.dependsOnTaskIds],
        is_independent: true,
        status: "PENDING",
      },
      repoPath: claim.executionContext.repoPath,
      featureBranch: claim.executionContext.featureBranch,
      sprintNumber: claim.sprint.number ?? 0,
      settingsScope: {
        projectId: claim.project.id,
        sprintId: claim.sprint.id,
      },
      dispatchId: claim.dispatch.id,
      taskRunId: taskRun.id,
    });
    const pullRequest = extractPullRequest(session);

    this.deps.workerEndpointRepository.touchWorkerEndpointHeartbeat(workerEndpointId, "connected");
    this.deps.workerTaskDispatchService.updateDispatchForWorker({
      workerEndpointId,
      dispatchId: claim.dispatch.id,
      leaseToken: claim.leaseToken,
      state: "RUNNING",
      provider,
      sessionId: session.id,
      sessionName: session.name,
      workerBranch: pullRequest?.workerBranch || claim.executionContext.featureBranch,
      prUrl: pullRequest?.url,
    });

    while (true) {
      await sleep(VIRTUAL_WORKER_SESSION_POLL_MS);
      this.deps.workerEndpointRepository.touchWorkerEndpointHeartbeat(workerEndpointId, "connected");

      const currentSession = this.deps.sessionTracking.getSession(session.id) || session;
      const persistedTaskRun = this.deps.executionRepository.getTaskRunByDispatchId(claim.dispatch.id);
      const terminalState = persistedTaskRun?.state === "COMPLETED"
        ? "COMPLETED"
        : persistedTaskRun?.state === "FAILED"
          ? "FAILED"
          : persistedTaskRun?.state === "QUOTA"
            ? "QUOTA"
            : persistedTaskRun?.state === "BLOCKED"
              ? "BLOCKED"
              : resolveTerminalDispatchState(currentSession);
      const currentPullRequest = extractPullRequest(currentSession);
      const update = this.deps.workerTaskDispatchService.updateDispatchForWorker({
        workerEndpointId,
        dispatchId: claim.dispatch.id,
        leaseToken: claim.leaseToken,
        state: terminalState || "RUNNING",
        provider,
        sessionId: currentSession.id,
        sessionName: currentSession.name,
        workerBranch: currentPullRequest?.workerBranch || claim.executionContext.featureBranch,
        prUrl: currentPullRequest?.url,
        summaryMarkdown: terminalState ? this.buildDispatchSummary(claim, currentSession) : undefined,
        errorMessage: terminalState === "FAILED"
          ? `Virtual worker session ended in state ${currentSession.state || "FAILED"}`
          : undefined,
      });

      if (terminalState || update.controlAction === "cancel" || isTerminalSessionState(currentSession.state)) {
        return;
      }
    }
  }

  private buildDispatchSummary(claim: WorkerTaskDispatchClaim, session: JulesSession): string {
    const pullRequest = extractPullRequest(session);
    return [
      `Project: ${claim.project.name}`,
      `Sprint: ${claim.sprint.name}`,
      `Task: ${claim.task.taskKey} ${claim.task.title}`,
      `Worker mode: virtual`,
      `Provider: ${session.provider || "unknown"}`,
      `State: ${session.state || "UNKNOWN"}`,
      pullRequest?.workerBranch ? `Worker branch: ${pullRequest.workerBranch}` : null,
      pullRequest?.url ? `Pull request: ${pullRequest.url}` : null,
    ].filter(Boolean).join("\n");
  }

  private resolveCycleSettings(projectId: string, resolver?: (pId: string, sId?: string | null) => DashboardSettings): DashboardSettings {
    const effectiveResolver = resolver || ((pId: string, sId?: string | null) => this.resolveDashboardSettings(pId, sId));
    const attentionItem = this.deps.projectAttentionService.listActiveProjectItems(projectId)
      .find((item) => item.ownerType === "worker");
    return effectiveResolver(projectId, attentionItem?.sprintId);
  }

  private async resolveAttentionProviderCapacity(
    item: ProjectAttentionItemRecord,
    attentionRoute: Exclude<VirtualWorkerAttentionRoute, "skip_orchestrator_handled">,
    settings: DashboardSettings,
  ): Promise<{ provider: ProviderId; limit: number }> {
    if (attentionRoute === "ci_fix") {
      const continuation = await this.resolveTaskCiFixContinuation(item, settings);
      if (continuation) {
        return {
          provider: continuation.provider,
          limit: continuation.providerSettings.maxConcurrentTasks,
        };
      }
    }

    const invocation = attentionRoute === "ci_fix"
      ? "ci_fix"
      : attentionRoute === "merge_conflict"
        ? "merge_conflict"
        : null;
    if (!invocation) {
      const providerConfigId = settings.workers.virtualWorkerProvider;
      const providerSettings = settings.aiProvider.providers[providerConfigId];
      return {
        provider: providerSettings?.provider || "codex",
        limit: providerSettings?.maxConcurrentTasks ?? 0,
      };
    }

    const agentPresetId = invocation === "ci_fix"
      ? settings.agents?.routing?.ciFix?.agentPresetId
      : settings.agents?.routing?.mergeConflict?.agentPresetId;
    const workerAgent = await this.deps.agentPresetSyncService?.resolveTargetedCodingAgent(
      item.projectId,
      agentPresetId ?? null,
    ).catch(() => null);
    const route = resolveProviderForInvocation(settings, {
      invocation,
      task: {
        id: item.taskId || item.id,
        title: item.title,
        prompt: item.summaryMarkdown,
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
      providerPool: VIRTUAL_WORKER_CLI_PROVIDER_POOL,
      agentProvider: workerAgent
        ? {
          providerConfigId: workerAgent.providerConfigId,
          model: workerAgent.model,
        }
        : null,
    });
    const providerConfigId = route.providerConfigId || route.provider;
    const routedSettings = route.providers[providerConfigId];
    return {
      provider: route.provider,
      limit: routedSettings?.maxConcurrentTasks ?? 0,
    };
  }

  private async resolveTaskCiFixContinuation(
    item: ProjectAttentionItemRecord,
    settings: DashboardSettings,
  ): Promise<TaskCiFixContinuation | null> {
    if (!item.taskId || settings.aiProvider.invocationRouting.ci_fix?.continueTaskSession === false) {
      return null;
    }

    const taskRun = this.deps.executionRepository.getLatestTaskRun(
      item.taskId,
      item.sprintRunId || undefined,
    );
    const workspaceTarget = this.deps.executionRepository.getLatestTaskWorkspaceResumeTarget(
      item.taskId,
      item.sprintRunId || undefined,
    );
    const workspaceTaskRun = workspaceTarget?.taskRunId
      ? this.deps.executionRepository.getTaskRun(workspaceTarget.taskRunId)
      : null;
    const sessionId = taskRun?.sessionId?.trim()
      || taskRun?.sessionName?.replace(/^sessions\//, "").trim()
      || workspaceTaskRun?.sessionId?.trim()
      || workspaceTaskRun?.sessionName?.replace(/^sessions\//, "").trim()
      || workspaceTarget?.sessionId?.trim()
      || "";
    if (!sessionId) {
      return null;
    }

    const codingInvocation = this.deps.executionRepository.getLatestProviderInvocationUsageBySession(
      sessionId,
      "task_coding",
    );
    const previousInvocation = this.deps.executionRepository.getLatestProviderInvocationUsageBySession(sessionId);
    const trackedSession = this.deps.sessionTracking.getSession(sessionId);
    const providerValue = codingInvocation?.provider
      || taskRun?.provider
      || workspaceTaskRun?.provider
      || workspaceTarget?.provider
      || trackedSession?.provider;
    if (!providerValue || providerValue === "jules" || !VIRTUAL_WORKER_CLI_PROVIDER_POOL.includes(providerValue as ProviderId)) {
      return null;
    }
    const provider = providerValue as Exclude<ProviderId, "jules">;

    const taskRecord = this.deps.projectManagementRepository.getTask(item.taskId);
    if (!taskRecord) {
      return null;
    }
    const workerAgent = await this.deps.agentPresetSyncService?.resolveTargetedCodingAgent(
      item.projectId,
      taskRecord.agentPresetId || settings.agents.routing.taskCoding.agentPresetId,
    ).catch(() => null) ?? null;
    const taskRoute = settings.aiProvider.invocationRouting.task_coding;
    const inheritedProviderConfigId = taskRoute.profile === "WORKER"
      ? settings.workers.virtualWorkerProvider
      : settings.aiProvider.provider;
    const providerConfigId = [
      workerAgent?.providerConfigId,
      taskRoute.provider,
      inheritedProviderConfigId,
      ...Object.keys(taskRoute.providers),
      ...Object.keys(settings.aiProvider.providers),
    ].find((candidate): candidate is string => Boolean(
      candidate && settings.aiProvider.providers[candidate]?.provider === provider,
    ));
    const baseProviderSettings = providerConfigId ? settings.aiProvider.providers[providerConfigId] : null;
    if (!baseProviderSettings) {
      return null;
    }
    const routeOverrides = taskRoute.providers[providerConfigId!];
    const agentModel = workerAgent && workerAgent.providerConfigId === providerConfigId
      ? workerAgent.model?.trim() || null
      : null;
    const configured: ProviderSettings = {
      ...baseProviderSettings,
      ...(typeof routeOverrides?.enabled === "boolean" ? { enabled: routeOverrides.enabled } : {}),
      ...(typeof routeOverrides?.model === "string" ? { model: routeOverrides.model } : {}),
      ...(typeof routeOverrides?.weight === "number" ? { weight: routeOverrides.weight } : {}),
      ...(typeof routeOverrides?.thinkingMode === "string" ? { thinkingMode: routeOverrides.thinkingMode } : {}),
      ...(agentModel ? { model: agentModel } : {}),
    };

    return {
      provider,
      providerConfigId: providerConfigId!,
      providerSettings: {
        ...configured,
        model: codingInvocation?.model?.trim() || taskRecord.model?.trim() || configured.model,
      },
      sessionId,
      resumeSessionId: workspaceTarget?.sessionId || sessionId,
      continueSessionId: previousInvocation?.nativeSessionId
        || (provider === "claude-code" || provider === "codex" ? null : sessionId),
      continueSessionWithoutNativeId: provider === "codex"
        && Boolean(previousInvocation)
        && !previousInvocation?.nativeSessionId,
      taskRunId: taskRun?.sessionId ? taskRun.id : workspaceTarget?.taskRunId || taskRun?.id || null,
      previousInvocation,
      workerAgent,
    };
  }

  private async handleAttentionItem(
    workerEndpointId: string,
    item: ProjectAttentionItemRecord,
    reason: string,
    attentionRoute: VirtualWorkerAttentionRoute = resolveVirtualWorkerAttentionRoute(item),
    claimReason: string = planVirtualWorkerAttentionClaim(item, reason).claimReason,
  ): Promise<void> {
    if (attentionRoute === "skip_orchestrator_handled" || isProjectManagerOwnedClarificationItem(item)) {
      return;
    }

    const claimed = this.deps.projectAttentionService.claimItem(item.id, workerEndpointId, claimReason);
    this.deps.workerEndpointRepository.touchWorkerEndpointHeartbeat(workerEndpointId, "connected");

    if (attentionRoute === "merge_conflict") {
      await this.resolveMergeConflictAttention(workerEndpointId, claimed);
      return;
    }

    if (attentionRoute === "ci_fix") {
      await this.resolveCiFixAttention(workerEndpointId, claimed);
      return;
    }

    if (attentionRoute === "action_required") {
      await this.resolveActionRequiredAttention(workerEndpointId, claimed);
      return;
    }

    this.escalateAttentionToHuman(workerEndpointId, claimed, [
      "Virtual worker cannot handle this worker-owned attention item automatically.",
      "",
      claimed.summaryMarkdown.trim(),
    ].join("\n"));
  }

  private async resolveActionRequiredAttention(workerEndpointId: string, item: ProjectAttentionItemRecord): Promise<void> {
    const settings = this.resolveDashboardSettings(item.projectId, item.sprintId);
    const payload = item.payload || {};
    const sessionState = typeof payload.sessionState === "string" ? payload.sessionState : null;
    // Prefer the session id captured on the attention payload, but fall back to
    // the task's latest run so that an item missing the field (older items, or
    // any code path that forgot to populate it) can still be handled instead of
    // being needlessly escalated to a human and pausing the sprint.
    let sessionId = typeof payload.sessionId === "string" && payload.sessionId.trim().length > 0
      ? payload.sessionId.trim()
      : null;
    if (!sessionId && item.taskId) {
      const latestRun = this.deps.executionRepository.getLatestTaskRun(item.taskId);
      sessionId = latestRun?.sessionId?.trim()
        || latestRun?.sessionName?.replace(/^sessions\//, "").trim()
        || null;
    }

    if (!sessionId) {
      this.escalateAttentionToHuman(workerEndpointId, item, "No session ID available for action-required attention.");
      return;
    }

    try {
      if (sessionState === "AWAITING_PLAN_APPROVAL" && settings.automationInterventions.autoApprovePlan) {
        await this.deps.approveSessionPlan(sessionId);
        this.deps.projectAttentionService.resolveItem(item.id, {
          status: "resolved",
          reason: "virtual_worker_auto_approved_plan",
          resolutionSummaryMarkdown: "Virtual worker automatically approved the session plan.",
          workerEndpointId,
        });
        return;
      }

      if (sessionState === "AWAITING_USER_FEEDBACK" && settings.automationInterventions.autoAnswerClarification) {
        const guardrailScope = { projectId: item.projectId, sprintId: item.sprintId };
        const clarificationEval = item.taskId
          ? this.deps.guardrailService?.evaluate(guardrailScope, item.taskId, "clarification_reply") ?? null
          : null;
        if (clarificationEval && !clarificationEval.allowed && clarificationEval.action !== "WARN_ONLY") {
          this.escalateAttentionToHuman(
            workerEndpointId,
            item,
            `Virtual worker reached the clarification auto-answer guardrail (${clarificationEval.count}/${clarificationEval.cap}). Escalating to human.`,
          );
          return;
        }

        const task = this.deps.projectManagementRepository.getTask(item.taskId || "");
        const sprint = this.deps.projectManagementRepository.getSprint(item.sprintId || "");
        if (!task || !sprint) {
          throw new Error("Missing task or sprint context for clarification reply.");
        }

        const subtasks = await this.deps.sprintExecutionStateService.loadSubtasks(item.projectId, item.sprintId || "");

        const reply = await this.deps.workerInboxReplyService.generateClarificationReply({
          projectId: item.projectId,
          sprintGoal: sprint.goal || "",
          subtasks,
          task: task as unknown as Subtask,
        });

        await this.deps.sendSessionMessage(sessionId, reply);
        if (item.taskId) {
          this.deps.guardrailService?.record(guardrailScope, item.taskId, "clarification_reply");
        }

        this.deps.projectAttentionService.resolveItem(item.id, {
          status: "resolved",
          reason: "virtual_worker_auto_answered_clarification",
          resolutionSummaryMarkdown: [
            "Virtual worker automatically answered clarification request.",
            "",
            "Reply:",
            reply,
          ].join("\n"),
          workerEndpointId,
        });
        return;
      }

      this.escalateAttentionToHuman(workerEndpointId, item, `Virtual worker cannot handle action-required state: ${sessionState || "unknown"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.escalateAttentionToHuman(workerEndpointId, item, `Virtual worker failed to handle action-required attention: ${message}`);
    }
  }

  private readRepairRuntime(
    item: ProjectAttentionItemRecord,
    purpose: RepairAttentionRuntimeState["purpose"],
  ): RepairAttentionRuntimeState | null {
    const value = this.asRecord(item.payload?.repairRuntime);
    if (
      value?.purpose !== purpose
      || typeof value.sessionId !== "string"
      || typeof value.workspaceSessionId !== "string"
      || typeof value.provider !== "string"
      || typeof value.providerConfigId !== "string"
      || typeof value.model !== "string"
    ) {
      return null;
    }
    return {
      purpose,
      sessionId: value.sessionId,
      workspaceSessionId: value.workspaceSessionId,
      provider: value.provider,
      providerConfigId: value.providerConfigId,
      model: value.model,
      nativeSessionId: typeof value.nativeSessionId === "string" ? value.nativeSessionId : null,
      activeAttemptId: typeof value.activeAttemptId === "string" ? value.activeAttemptId : null,
      attemptRecorded: value.attemptRecorded === true,
      phase: value.phase === "workspace_ready" || value.phase === "provider_running" || value.phase === "interrupted"
        ? value.phase
        : "claimed",
      workspaceBaselineHead: typeof value.workspaceBaselineHead === "string" ? value.workspaceBaselineHead : null,
      workspaceRepairHead: typeof value.workspaceRepairHead === "string" ? value.workspaceRepairHead : null,
      publicationPhase: value.publicationPhase === "workspace_finalized"
        || value.publicationPhase === "host_publishing"
        || value.publicationPhase === "host_published"
        ? value.publicationPhase
        : "pending",
      publishedHeadSha: typeof value.publishedHeadSha === "string" ? value.publishedHeadSha : null,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    };
  }

  private checkpointRepairRuntime(
    item: ProjectAttentionItemRecord,
    runtime: Omit<RepairAttentionRuntimeState, "updatedAt">,
  ): RepairAttentionRuntimeState {
    const checkpoint: RepairAttentionRuntimeState = {
      ...runtime,
      updatedAt: new Date().toISOString(),
    };
    const updated = this.deps.projectAttentionService.patchItemPayload(item.id, {
      repairRuntime: checkpoint,
    });
    item.payload = updated.payload;
    return checkpoint;
  }

  private latestRepairInvocation(runtime: RepairAttentionRuntimeState): ProviderInvocationUsageRecord | null {
    return this.deps.executionRepository.getLatestProviderInvocationUsageBySession(runtime.sessionId);
  }

  private buildRepairPublicationCommitMessage(summary: string, workspaceRepairHead: string | null): string {
    return workspaceRepairHead
      ? `${summary}\n\nCode-UX-Repair-Head: ${workspaceRepairHead}`
      : summary;
  }

  private async findPublishedRepairCommit(args: {
    repoPath: string;
    workerBranch: string;
    workspaceRepairHead: string | null;
    githubMode: "REMOTE" | "LOCAL";
    gitAuth: GitHttpAuthOptions;
  }): Promise<string | null> {
    if (!args.workspaceRepairHead) {
      return null;
    }
    const marker = `Code-UX-Repair-Head: ${args.workspaceRepairHead}`;
    let commitSha: string;
    try {
      commitSha = (await runCommandStrict(
        "git",
        [
          "log",
          "-1",
          "--format=%H",
          "--fixed-strings",
          `--grep=${marker}`,
          `refs/heads/${args.workerBranch}`,
        ],
        args.repoPath,
      )).stdout.trim();
    } catch {
      return null;
    }
    if (!commitSha) {
      return null;
    }
    await this.ensureRepairBranchPublished(args);
    return commitSha;
  }

  private async findTreeEquivalentPublishedRepair(args: {
    repoPath: string;
    worktreePath: string;
    workerBranch: string;
    workspaceBaselineHead: string | null;
    workspaceRepairHead: string | null;
    expectedCommitSubject: string;
    requiredParentRefs: string[];
    githubMode: "REMOTE" | "LOCAL";
    gitAuth: GitHttpAuthOptions;
  }): Promise<string | null> {
    if (!args.workspaceBaselineHead || !args.workspaceRepairHead) {
      return null;
    }
    let workspaceRepairTree: string;
    let workspaceBaselineTree: string;
    let hostCandidates: Array<{ head: string; tree: string; subject: string }>;
    try {
      workspaceRepairTree = await this.workspaceArtifactService.resolveWorkspaceTree(args.worktreePath);
      workspaceBaselineTree = (await this.runWorkspaceCommand(
        args.worktreePath,
        "git",
        ["rev-parse", `${args.workspaceBaselineHead}^{tree}`],
      )).stdout.trim();
      const hostLog = (await runCommandStrict(
        "git",
        [
          "log",
          "--format=%H%x09%T%x09%s",
          "--fixed-strings",
          `--grep=${args.expectedCommitSubject}`,
          `refs/heads/${args.workerBranch}`,
        ],
        args.repoPath,
      )).stdout;
      hostCandidates = hostLog.split("\n").map((line) => {
        const [head = "", tree = "", subject = ""] = line.split("\t");
        return { head: head.trim(), tree: tree.trim(), subject: subject.trim() };
      });
    } catch {
      return null;
    }
    if (
      !workspaceRepairTree
      || !workspaceBaselineTree
      || (workspaceRepairTree === workspaceBaselineTree
        && (args.requiredParentRefs.length === 0 || args.workspaceRepairHead === args.workspaceBaselineHead))
    ) {
      return null;
    }
    for (const candidate of hostCandidates) {
      if (
        !candidate.head
        || candidate.head === args.workspaceBaselineHead
        || candidate.tree !== workspaceRepairTree
        || candidate.subject !== args.expectedCommitSubject
      ) {
        continue;
      }
      try {
        await runCommandStrict(
          "git",
          ["merge-base", "--is-ancestor", args.workspaceBaselineHead, candidate.head],
          args.repoPath,
        );
      } catch {
        continue;
      }
      let hasRequiredParents = true;
      for (const parentRef of args.requiredParentRefs) {
        try {
          await runCommandStrict(
            "git",
            ["merge-base", "--is-ancestor", parentRef, candidate.head],
            args.repoPath,
          );
        } catch {
          hasRequiredParents = false;
          break;
        }
      }
      if (hasRequiredParents) {
        await this.ensureRepairBranchPublished(args);
        return candidate.head;
      }
    }
    return null;
  }

  private async ensureRepairBranchPublished(args: {
    repoPath: string;
    workerBranch: string;
    githubMode: "REMOTE" | "LOCAL";
    gitAuth: GitHttpAuthOptions;
  }): Promise<void> {
    if (args.githubMode === "LOCAL") {
      return;
    }
    const pushEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(args.repoPath, args.gitAuth);
    await runCommandStrict(
      "git",
      ["push", "-u", "origin", `refs/heads/${args.workerBranch}:refs/heads/${args.workerBranch}`],
      args.repoPath,
      pushEnv ?? process.env,
    );
  }

  private async resolveMergeConflictAttention(workerEndpointId: string, item: ProjectAttentionItemRecord): Promise<void> {
    const settings = this.resolveDashboardSettings(item.projectId, item.sprintId);
    const guardrailScope = { projectId: item.projectId, sprintId: item.sprintId };
    const savedRuntime = this.readRepairRuntime(item, "merge_conflict");
    const workerAgent = await this.deps.agentPresetSyncService?.resolveTargetedCodingAgent(
      item.projectId,
      settings.agents?.routing?.mergeConflict?.agentPresetId ?? null,
    ).catch(() => null);
    const route = resolveProviderForInvocation(settings, {
      invocation: "merge_conflict",
      task: {
        id: item.taskId || item.id,
        title: item.title,
        prompt: item.summaryMarkdown,
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
      providerPool: VIRTUAL_WORKER_CLI_PROVIDER_POOL,
      agentProvider: workerAgent
        ? {
          providerConfigId: workerAgent.providerConfigId,
          model: workerAgent.model,
        }
        : null,
    });
    const savedProviderSettings = savedRuntime
      && savedRuntime.provider !== "jules"
      && settings.aiProvider.providers[savedRuntime.providerConfigId]?.provider === savedRuntime.provider
      ? route.providers[savedRuntime.providerConfigId] || settings.aiProvider.providers[savedRuntime.providerConfigId]
      : null;
    const provider = (savedProviderSettings ? savedRuntime!.provider : route.provider) as Exclude<ProviderId, "jules">;
    const providerConfigId = savedProviderSettings
      ? savedRuntime!.providerConfigId
      : route.providerConfigId || route.provider;
    const resolvedProviderSettings = savedProviderSettings || route.providers[providerConfigId];
    const providerSettings: ProviderSettings = {
      ...resolvedProviderSettings,
      model: savedRuntime?.model || resolvedProviderSettings.model,
    };
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...settings.cliWorkflow,
    };
    const payload = item.payload || {};
    const repoPath = this.readRequiredString(payload.repoPath, "repoPath");
    const conflictingBranches = this.asRecord(payload.conflictingBranches);
    const sourceBranchRaw = conflictingBranches?.source ?? payload.workerBranch;
    if (typeof sourceBranchRaw !== "string" || !sourceBranchRaw.trim()) {
      this.escalateAttentionToHuman(
        workerEndpointId,
        item,
        [
          "Virtual worker cannot resolve merge conflict: source branch is not recorded in the attention payload.",
          "This can happen when the Jules session did not return a workerBranch and gitStatus was unavailable when the conflict was detected.",
          "Please resolve the conflict manually or re-trigger the sprint cycle once the GitHub API is reachable.",
          "",
          item.summaryMarkdown.trim(),
        ].join("\n"),
      );
      return;
    }
    const sourceBranch = sourceBranchRaw.trim();
    const targetBranch = this.readRequiredString(conflictingBranches?.target ?? payload.featureBranch, "targetBranch");
    // LOCAL git mode has no `origin` remote: the seeded merge workspace only carries the
    // target branch as a local ref (`refs/heads/…`), never `refs/remotes/origin/…`. Merging
    // (or verifying) against `origin/<target>` therefore fails with "not something we can
    // merge". Reference the local branch directly in that mode. (Matches the parentRefs
    // selection below.)
    const targetRef = settings.git.githubMode === "LOCAL" ? targetBranch : `origin/${targetBranch}`;
    const gitAuth: GitHttpAuthOptions = {
      githubToken: settings.git.githubToken,
      gitlabToken: settings.git.gitlabToken,
    };

    // A previous cycle may already have merged the source branch into the target branch while
    // GitHub/local mergeability state lagged. Only skip provider work when the source branch is
    // already contained in the target branch. The reverse relationship (target contained in
    // source) only means the worker branch has been updated with target changes; it may still
    // contain unmerged task commits and must remain in the merge gate.
    if (await this.isMergeConflictAlreadyResolved({
      repoPath,
      sourceBranch,
      targetBranch,
      targetRef,
      gitAuth,
      githubMode: settings.git.githubMode,
    })) {
      // No provider runs here (the remote is already merged), so this must not consume
      // the retry budget — otherwise GitHub mergeability lag could falsely trip the cap.
      this.deps.projectAttentionService.resolveItem(item.id, {
        status: "resolved",
        reason: "virtual_worker_merge_conflict_already_resolved",
        resolutionSummaryMarkdown: [
          item.summaryMarkdown.trim(),
          "",
          `The merge conflict was already resolved: \`${sourceBranch}\` is contained in \`${targetBranch}\`. Waiting for mergeability state to refresh.`,
        ].join("\n"),
        workerEndpointId,
        payloadPatch: {
          handledBy: "virtual_worker",
          provider,
          sourceBranch,
          targetBranch,
          alreadyResolved: true,
        },
      });
      this.clearResolvedMergeConflictTaskMarker(item);
      return;
    }

    const isRestartContinuation = Boolean(savedRuntime?.activeAttemptId && savedRuntime.attemptRecorded);
    const mergeConflictEval = this.evaluateMergeConflictGuardrail(settings, guardrailScope, item);
    if (!isRestartContinuation && mergeConflictEval && !mergeConflictEval.allowed && mergeConflictEval.action !== "WARN_ONLY") {
      this.escalateAttentionToHuman(
        workerEndpointId,
        item,
        `Virtual worker reached the merge-conflict resolution guardrail (${mergeConflictEval.count}/${mergeConflictEval.cap > 0 ? mergeConflictEval.cap : "∞"}). Escalating to human.`,
      );
      return;
    }

    // Count every real resolution attempt up-front — before spinning up the provider — so
    // failures, crashes, and quota-exhausted runs all consume the retry budget. Recording
    // only on success (the previous behavior) meant a conflict that never resolved retried
    // indefinitely until the provider API limit was hit instead of escalating after `cap`.
    const sessionId = savedRuntime?.sessionId
      || `virtual-merge-${provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    let repairRuntime = this.checkpointRepairRuntime(item, {
      purpose: "merge_conflict",
      sessionId,
      workspaceSessionId: savedRuntime?.workspaceSessionId || sessionId,
      provider,
      providerConfigId,
      model: savedRuntime?.model || providerSettings.model,
      nativeSessionId: savedRuntime?.nativeSessionId || null,
      activeAttemptId: savedRuntime?.activeAttemptId || randomUUID(),
      // Persist the marker before recording. A process exit in this tiny window can
      // under-count once, but can never charge the same interrupted attempt twice.
      attemptRecorded: true,
      phase: "claimed",
      workspaceBaselineHead: savedRuntime?.workspaceBaselineHead || null,
      workspaceRepairHead: savedRuntime?.workspaceRepairHead || null,
      publicationPhase: savedRuntime?.publicationPhase || "pending",
      publishedHeadSha: savedRuntime?.publishedHeadSha || null,
    });
    if (!isRestartContinuation) {
      this.recordMergeConflictAttempt(guardrailScope, item);
    }

    let worktreePath = this.workspaceManager.buildWorktreePath(repoPath, sessionId, workflowSettings.executionMode);
    const title = item.title;
    let succeeded = false;
    let initialHead = "";
    const memoryContext = workerAgent?.id
      ? await this.buildMemoryContext(item.projectId, item.sprintId || null, workerAgent.id, item.summaryMarkdown)
      : undefined;
    const memoryInstructions = settings.memory?.enabled && settings.memory.autoCaptureSprint
      ? resolveAgentMemoryInstructions(workerAgent || {}, settings.memory?.workerLearningsInstruction)
      : "";

    const trackedSession = this.deps.sessionTracking.getSession(sessionId);
    if (trackedSession) {
      this.deps.sessionTracking.updateSession(sessionId, { state: "RUNNING" });
    } else {
      this.deps.sessionTracking.createSession({
        id: sessionId,
        provider,
        taskId: buildTaskRunKey(repoPath, 0, `attention-${item.id}`),
        title,
        prompt: item.summaryMarkdown,
        state: "RUNNING",
        featureBranch: sourceBranch,
        workerBranch: sourceBranch,
        repoPath,
      });
    }
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: `Virtual worker claimed merge conflict between ${sourceBranch} and ${targetBranch}.`,
    });

    let cleanedUp = false;
    let preserveWorkspace = false;
    try {
      const effectiveWorkflowSettings = await this.resolveVirtualWorkerWorkflowSettings({
        workflowSettings,
        sessionId,
        repoPath,
        purpose: "merge_conflict",
      });
      const prepared = await this.invocationWorkspacePreparer.prepareWorktree({
        repoPath,
        worktreePath: this.workspaceManager.buildWorktreePath(repoPath, repairRuntime.workspaceSessionId, effectiveWorkflowSettings.executionMode),
        workerBranch: sourceBranch,
        featureBranch: targetBranch,
        resumeSessionId: repairRuntime.workspaceSessionId,
        gitAuth,
        gitPolicy: buildInvocationGitPolicy({
          githubMode: settings.git.githubMode,
          defaultBranch: settings.git.defaultBranch,
          githubToken: settings.git.githubToken,
          gitlabToken: settings.git.gitlabToken,
        }),
      });
      const finalWorktreePath = prepared.worktreePath;
      worktreePath = finalWorktreePath;
      repairRuntime = this.checkpointRepairRuntime(item, {
        ...repairRuntime,
        phase: "workspace_ready",
      });
      const currentWorkspaceHead = (await this.runWorkspaceCommand(finalWorktreePath, "git", ["rev-parse", "HEAD"])).stdout.trim();
      if (!repairRuntime.workspaceBaselineHead) {
        repairRuntime = this.checkpointRepairRuntime(item, {
          ...repairRuntime,
          workspaceBaselineHead: currentWorkspaceHead,
        });
      }
      initialHead = repairRuntime.workspaceBaselineHead || currentWorkspaceHead;
      let workspaceFinalized = repairRuntime.publicationPhase !== "pending";
      if (!workspaceFinalized && prepared.resumed === true && currentWorkspaceHead !== initialHead) {
        workspaceFinalized = await this.isWorkspaceMergeFinalized(finalWorktreePath, targetRef);
        if (workspaceFinalized) {
          repairRuntime = this.checkpointRepairRuntime(item, {
            ...repairRuntime,
            workspaceRepairHead: currentWorkspaceHead,
            publicationPhase: "workspace_finalized",
          });
        }
      }
      if (!workspaceFinalized) {
        const resumedMerge = prepared.resumed === true && await this.workspaceHasMergeInProgress(finalWorktreePath);
        const hasConflicts = resumedMerge
          ? (await this.listUnresolvedFiles(finalWorktreePath)).length > 0
          : await this.runMergeIntoSource(finalWorktreePath, targetRef, sessionId);
        if (hasConflicts) {
          const workspaceGuidance = await this.workspaceManager.buildWorkspaceGuidance(item.summaryMarkdown, finalWorktreePath);
          const providerPrompt = buildProviderPrompt(
            this.buildMergeConflictPrompt(
              item,
              sourceBranch,
              targetBranch,
              workspaceGuidance,
              workerAgent?.instructionMarkdown,
              memoryContext,
              memoryInstructions,
            ),
            providerSettings.thinkingMode,
            provider,
          );
          const previousInvocation = this.latestRepairInvocation(repairRuntime);
          repairRuntime = this.checkpointRepairRuntime(item, {
            ...repairRuntime,
            nativeSessionId: previousInvocation?.nativeSessionId || repairRuntime.nativeSessionId,
            phase: "provider_running",
          });
          const nativeSessionId = await this.runProviderWithRetry({
            provider,
            providerPrompt,
            workflowSettings: effectiveWorkflowSettings,
            repoPath,
            worktreePath: finalWorktreePath,
            sessionId,
            attentionItem: item,
            purpose: "merge_conflict",
            model: providerSettings.model,
            thinkingMode: providerSettings.thinkingMode,
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
            continueSessionId: repairRuntime.nativeSessionId,
            continueSessionWithoutNativeId: provider === "codex"
              && !repairRuntime.nativeSessionId
              && Boolean(savedRuntime),
            openCodeBaselineRawUsageJson: provider === "opencode"
              ? previousInvocation?.rawUsageJson ?? null
              : null,
            githubToken: settings.git.githubToken,
            agentMcpAccess: workerAgent ? workerClarificationAgentMcpAccess(workerAgent.mcpAccess) : null,
            mcpAgentId: workerAgent?.id ?? null,
          });
          if (nativeSessionId) {
            repairRuntime = this.checkpointRepairRuntime(item, {
              ...repairRuntime,
              nativeSessionId,
              phase: "provider_running",
            });
          }
        }
        await this.ensureMergeConflictResolved(finalWorktreePath);
        await this.ensureMergeConflictPreservesPromptLiterals(finalWorktreePath, item);
        await this.finalizeMergeCommit(finalWorktreePath, sourceBranch, targetBranch);
        await this.ensureTargetMergedIntoSource(finalWorktreePath, targetRef);
        if (settings.memory?.enabled && settings.memory.autoCaptureSprint) {
          await this.captureMemoriesFromWorkspace(
            item.projectId,
            item.sprintId || undefined,
            workerAgent?.id || null,
            finalWorktreePath,
            item.id,
          );
        }
        const workspaceRepairHead = (await this.runWorkspaceCommand(finalWorktreePath, "git", ["rev-parse", "HEAD"])).stdout.trim();
        repairRuntime = this.checkpointRepairRuntime(item, {
          ...repairRuntime,
          workspaceRepairHead,
          publicationPhase: "workspace_finalized",
        });
      }
      const repairCommitSubject = `fix(merge): resolve ${targetBranch} into ${sourceBranch}`;
      let recoveredPublishedHead = repairRuntime.publicationPhase === "host_publishing"
        && repairRuntime.workspaceRepairHead !== repairRuntime.workspaceBaselineHead
        ? await this.findPublishedRepairCommit({
          repoPath,
          workerBranch: sourceBranch,
          workspaceRepairHead: repairRuntime.workspaceRepairHead,
          githubMode: settings.git.githubMode,
          gitAuth,
        })
        : null;
      if (!recoveredPublishedHead && repairRuntime.publicationPhase === "host_publishing") {
        recoveredPublishedHead = await this.findTreeEquivalentPublishedRepair({
          repoPath,
          worktreePath: finalWorktreePath,
          workerBranch: sourceBranch,
          workspaceBaselineHead: repairRuntime.workspaceBaselineHead,
          workspaceRepairHead: repairRuntime.workspaceRepairHead,
          expectedCommitSubject: repairCommitSubject,
          requiredParentRefs: settings.git.githubMode === "LOCAL" ? [targetBranch] : [`origin/${targetBranch}`],
          githubMode: settings.git.githubMode,
          gitAuth,
        });
      }
      const alreadyPublished = Boolean(recoveredPublishedHead)
        || (repairRuntime.publicationPhase === "host_published" && Boolean(repairRuntime.publishedHeadSha));
      let applyResult: AppliedWorkspacePatchResult = {
        hasChanges: alreadyPublished,
        commitSha: recoveredPublishedHead || repairRuntime.publishedHeadSha || undefined,
      };
      if (!alreadyPublished) {
        const patchText = await this.workspaceArtifactService.exportBinaryPatch(
          finalWorktreePath,
          repairRuntime.workspaceBaselineHead || initialHead,
        );
        repairRuntime = this.checkpointRepairRuntime(item, {
          ...repairRuntime,
          publicationPhase: "host_publishing",
        });
        applyResult = await this.workspaceArtifactService.applyPatchToBranch({
          repoPath,
          baseRef: repairRuntime.workspaceBaselineHead || initialHead,
          workerBranch: sourceBranch,
          patchText,
          commitMessage: this.buildRepairPublicationCommitMessage(
            repairCommitSubject,
            repairRuntime.workspaceRepairHead,
          ),
          parentRefs: settings.git.githubMode === "LOCAL" ? [targetBranch] : [`origin/${targetBranch}`],
          // A conflict resolved by keeping the source side leaves the tree unchanged but
          // still needs a merge commit recording the target as a parent, otherwise the PR
          // keeps reporting the conflict and the resolution loops forever.
          forceMergeCommit: true,
          gitAuth,
          gitIdentity: effectiveWorkflowSettings.containerMountGitConfig
            ? undefined
            : {
              name: effectiveWorkflowSettings.containerGitUserName,
              email: effectiveWorkflowSettings.containerGitUserEmail,
            },
          githubMode: settings.git.githubMode,
        });
      }
      let hasUnpushed = alreadyPublished || applyResult.hasChanges;
      let hasAhead = alreadyPublished || applyResult.hasChanges;
      if (!applyResult.hasChanges) {
        hasUnpushed = await this.prService.hasUnpushedCommits(repoPath, sourceBranch, targetBranch);
        hasAhead = await this.prService.hasWorkerBranchCommitsAgainstFeature(repoPath, sourceBranch, targetBranch);
        if (hasUnpushed && settings.git.githubMode !== "LOCAL") {
          const pushEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(repoPath, gitAuth);
          await runCommandStrict(
            "git",
            ["push", "-u", "origin", `refs/heads/${sourceBranch}:refs/heads/${sourceBranch}`],
            repoPath,
            pushEnv ?? process.env,
          );
        }
      }
      if (!applyResult.hasChanges && !hasUnpushed && !hasAhead) {
        throw new Error(
          `Merge-conflict worker completed without recording merge evidence on ${sourceBranch}. ` +
          "The attention item was kept open so the conflict is not falsely marked resolved.",
        );
      }
      const headSha = applyResult.commitSha
        || ((hasUnpushed || hasAhead)
          ? (await runCommandStrict("git", ["rev-parse", `refs/heads/${sourceBranch}`], repoPath)).stdout.trim()
          : initialHead);
      repairRuntime = this.checkpointRepairRuntime(item, {
        ...repairRuntime,
        publicationPhase: "host_published",
        publishedHeadSha: headSha,
      });
      this.deps.sessionTracking.updateSession(sessionId, { state: "COMPLETED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: hasUnpushed || applyResult.hasChanges
          ? `Pushed resolved merge conflict to ${sourceBranch} at ${headSha}.`
          : `Resolved merge-conflict run completed on ${sourceBranch} at ${headSha}.`,
      });
      this.deps.projectAttentionService.resolveItem(item.id, {
        status: "resolved",
        reason: "virtual_worker_merge_conflict_resolved",
        resolutionSummaryMarkdown: [
          item.summaryMarkdown.trim(),
          "",
          `Virtual ${this.getProviderLabel(provider)} worker resolved the merge conflict and pushed the updated source branch.`,
          `Source branch: ${sourceBranch}`,
          `Target branch: ${targetBranch}`,
          `Head SHA: ${headSha}`,
        ].join("\n"),
        workerEndpointId,
        payloadPatch: {
          handledBy: "virtual_worker",
          provider,
          sourceBranch,
          targetBranch,
          headSha,
        },
      });
      this.clearResolvedMergeConflictTaskMarker(item);
      succeeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isProviderCancellationError(error)) {
        preserveWorkspace = true;
        const previousInvocation = this.latestRepairInvocation(repairRuntime);
        repairRuntime = this.checkpointRepairRuntime(item, {
          ...repairRuntime,
          nativeSessionId: previousInvocation?.nativeSessionId || repairRuntime.nativeSessionId,
          phase: "interrupted",
        });
        this.deps.sessionTracking.updateSession(sessionId, { state: "CANCELLED" });
        this.deps.sessionTracking.appendActivity(sessionId, {
          originator: "system",
          description: `Virtual worker merge-conflict run cancelled before completion: ${message}`,
        });
        this.deps.logger?.info("Virtual worker merge-conflict run cancelled", {
          projectId: item.projectId,
          sprintId: item.sprintId,
          taskId: item.taskId,
          attentionItemId: item.id,
          sessionId,
          provider,
          error,
        });
        this.deps.projectAttentionService.requeueItem(item.id, {
          repairRuntime,
          lastVirtualWorkerError: message,
          lastVirtualWorkerInterruptedAt: new Date().toISOString(),
          lastVirtualWorkerProvider: provider,
          lastVirtualWorkerSessionId: sessionId,
        });
        return;
      }
      this.deps.sessionTracking.updateSession(sessionId, { state: "FAILED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Virtual worker failed to resolve merge conflict: ${message}`,
      });
      const retryEval = this.evaluateMergeConflictGuardrail(settings, guardrailScope, item);
      if (!retryEval || retryEval.allowed || retryEval.action === "WARN_ONLY") {
        preserveWorkspace = true;
        const now = new Date().toISOString();
        this.deps.projectAttentionService.requeueItem(item.id, {
          repairRuntime: {
            ...repairRuntime,
            nativeSessionId: this.latestRepairInvocation(repairRuntime)?.nativeSessionId || repairRuntime.nativeSessionId,
            activeAttemptId: null,
            attemptRecorded: false,
            phase: "interrupted",
            updatedAt: now,
          },
          lastVirtualWorkerError: message,
          lastVirtualWorkerFailedAt: now,
          lastVirtualWorkerProvider: provider,
          lastVirtualWorkerSessionId: sessionId,
          mergeConflictRetryCount: retryEval?.count ?? null,
          mergeConflictRetryCap: retryEval?.cap ?? null,
        });
        this.deps.logger?.warn("Virtual worker merge-conflict attempt failed; leaving attention retryable", {
          projectId: item.projectId,
          sprintId: item.sprintId,
          taskId: item.taskId,
          attentionItemId: item.id,
          sessionId,
          provider,
          retryCount: retryEval?.count,
          retryCap: retryEval?.cap,
          error,
        });
        return;
      }
      this.escalateAttentionToHuman(workerEndpointId, item, [
        `Virtual ${this.getProviderLabel(provider)} worker failed to resolve the merge conflict automatically.`,
        "",
        `Attempts: ${retryEval.count}/${retryEval.cap > 0 ? retryEval.cap : "∞"}`,
        "",
        `Error: ${message}`,
        "",
        item.summaryMarkdown.trim(),
      ].join("\n"));
    } finally {
      const shouldCleanup = succeeded
        ? workflowSettings.cleanupWorktreeOnSuccess
        : !preserveWorkspace;
      if (shouldCleanup) {
        await this.workspaceManager.removeWorktree(repoPath, worktreePath).catch(() => undefined);
        cleanedUp = true;
      }
      if (!cleanedUp) {
        this.deps.sessionTracking.appendActivity(sessionId, {
          originator: "system",
          description: `Preserved merge-resolution worktree at ${worktreePath}.`,
        });
      }
    }
  }

  private evaluateMergeConflictGuardrail(
    settings: DashboardSettings,
    scope: GuardrailScope,
    item: ProjectAttentionItemRecord,
  ): GuardrailEvaluation | null {
    if (item.taskId) {
      return this.deps.guardrailService?.evaluate(scope, item.taskId, "merge_conflict") ?? null;
    }

    const jobConfig = settings.guardrails?.jobs?.merge_conflict;
    if (!settings.guardrails?.enabled || !jobConfig) {
      return { allowed: true, count: 0, cap: 0, action: jobConfig?.onLimit ?? "WARN_ONLY" };
    }

    const count = this.readNonNegativeInteger(item.payload?.mergeConflictResolutionAttempts);
    const cap = jobConfig.cap;
    if (cap <= 0) {
      return { allowed: true, count, cap, action: jobConfig.onLimit };
    }

    return {
      allowed: count < cap,
      count,
      cap,
      action: jobConfig.onLimit,
      reason: count < cap ? undefined : `Reached max merge_conflict invocations for this sprint-level attention item (${count}/${cap}).`,
    };
  }

  private recordMergeConflictAttempt(scope: GuardrailScope, item: ProjectAttentionItemRecord): void {
    if (item.taskId) {
      this.deps.guardrailService?.record(scope, item.taskId, "merge_conflict");
      return;
    }

    const nextCount = this.readNonNegativeInteger(item.payload?.mergeConflictResolutionAttempts) + 1;
    const updated = this.deps.projectAttentionService.patchItemPayload(item.id, {
      mergeConflictResolutionAttempts: nextCount,
      mergeConflictGuardrailSubject: `attention:${item.id}`,
    });
    item.payload = updated.payload;
  }

  private async resolveCiFixAttention(workerEndpointId: string, item: ProjectAttentionItemRecord): Promise<void> {
    const settings = this.resolveDashboardSettings(item.projectId, item.sprintId);
    const savedRuntime = this.readRepairRuntime(item, "ci_fix");
    const taskContinuation = await this.resolveTaskCiFixContinuation(item, settings);
    const workerAgent = taskContinuation?.workerAgent
      || await this.deps.agentPresetSyncService?.resolveTargetedCodingAgent(
        item.projectId,
        settings.agents?.routing?.ciFix?.agentPresetId ?? null,
      ).catch(() => null)
      || null;
    const ciFixRoute = taskContinuation ? null : resolveProviderForInvocation(settings, {
      invocation: "ci_fix",
      task: {
        id: item.taskId || item.id,
        title: item.title,
        prompt: item.summaryMarkdown,
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
      providerPool: VIRTUAL_WORKER_CLI_PROVIDER_POOL,
      agentProvider: workerAgent
        ? {
          providerConfigId: workerAgent.providerConfigId,
          model: workerAgent.model,
        }
        : null,
    });
    const savedProviderSettings = savedRuntime
      && savedRuntime.provider !== "jules"
      && settings.aiProvider.providers[savedRuntime.providerConfigId]?.provider === savedRuntime.provider
      ? settings.aiProvider.providers[savedRuntime.providerConfigId]
      : null;
    const provider = (savedProviderSettings
      ? savedRuntime!.provider
      : taskContinuation?.provider || ciFixRoute!.provider) as Exclude<ProviderId, "jules">;
    const providerConfigId = savedProviderSettings
      ? savedRuntime!.providerConfigId
      : taskContinuation?.providerConfigId || ciFixRoute?.providerConfigId || ciFixRoute?.provider || provider;
    const resolvedProviderSettings = savedProviderSettings || taskContinuation?.providerSettings || ciFixRoute!.providers[providerConfigId];
    const providerSettings: ProviderSettings = {
      ...resolvedProviderSettings,
      model: savedRuntime?.model || resolvedProviderSettings.model,
    };
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...settings.cliWorkflow,
    };
    const payload = item.payload || {};
    const repoPath = this.readRequiredString(payload.repoPath, "repoPath");
    const branchName = this.readRequiredString(
      payload.workerBranch ?? payload.branchName,
      "branchName",
    );
    const compareBaseBranch = typeof payload.featureBranch === "string" && payload.featureBranch.trim().length > 0
      ? payload.featureBranch.trim()
      : (settings.git.defaultBranch || "main");

    const guardrailScope = { projectId: item.projectId, sprintId: item.sprintId };
    // Task-level CI fixes key the guardrail by task id. Sprint-level fixes (e.g. the
    // final feature→default merge gate) have no task, so key by a stable synthetic id
    // derived from the attention item — otherwise an unfixable failure would retry
    // forever and the sprint would wait indefinitely instead of escalating.
    const guardrailKey = item.taskId
      || `main-merge-ci-fix:${item.sprintRunId ?? item.id}`;
    const ciFixEval = this.deps.guardrailService?.evaluate(guardrailScope, guardrailKey, "ci_fix") ?? null;
    const retryCount = ciFixEval?.count ?? 0;
    const maxRetries = ciFixEval?.cap ?? 0;
    const capLabel = maxRetries > 0 ? String(maxRetries) : "∞";

    const isRestartContinuation = Boolean(savedRuntime?.activeAttemptId && savedRuntime.attemptRecorded);
    if (!isRestartContinuation && ciFixEval && !ciFixEval.allowed && ciFixEval.action !== "WARN_ONLY") {
      this.escalateAttentionToHuman(workerEndpointId, item, `Virtual worker reached the CI autofix guardrail (${retryCount}/${capLabel}). Escalating to human.`);
      return;
    }

    // Record the attempt up-front so failed/crashed CI-fix runs also consume the retry
    // budget — recording only on success let an unfixable failure retry until the
    // provider API limit instead of escalating after `cap` attempts.
    const sessionId = savedRuntime?.sessionId || taskContinuation?.sessionId
      || `virtual-cifix-${provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const resumeTarget = taskContinuation
      ? { sessionId: taskContinuation.resumeSessionId }
      : this.deps.sessionTracking.findLatestCliSessionForBranch({
        repoPath,
        workerBranch: branchName,
        providers: [provider],
      });
    const workspaceOwnerSessionId = savedRuntime?.workspaceSessionId || resumeTarget?.sessionId || sessionId;
    let repairRuntime = this.checkpointRepairRuntime(item, {
      purpose: "ci_fix",
      sessionId,
      workspaceSessionId: workspaceOwnerSessionId,
      provider,
      providerConfigId,
      model: savedRuntime?.model || providerSettings.model,
      nativeSessionId: savedRuntime?.nativeSessionId || taskContinuation?.continueSessionId || null,
      activeAttemptId: savedRuntime?.activeAttemptId || randomUUID(),
      attemptRecorded: true,
      phase: "claimed",
      workspaceBaselineHead: savedRuntime?.workspaceBaselineHead || null,
      workspaceRepairHead: savedRuntime?.workspaceRepairHead || null,
      publicationPhase: savedRuntime?.publicationPhase || "pending",
      publishedHeadSha: savedRuntime?.publishedHeadSha || null,
    });
    if (!isRestartContinuation) {
      this.deps.guardrailService?.record(guardrailScope, guardrailKey, "ci_fix");
    }
    let worktreePath = this.workspaceManager.buildWorkspaceRef(repoPath, workspaceOwnerSessionId, workflowSettings.executionMode);
    const title = item.title;
    let succeeded = false;
    let initialHead = "";
    const memoryContext = workerAgent?.id
      ? await this.buildMemoryContext(item.projectId, item.sprintId || null, workerAgent.id, item.summaryMarkdown)
      : undefined;
    const memoryInstructions = settings.memory?.enabled && settings.memory.autoCaptureSprint
      ? resolveAgentMemoryInstructions(workerAgent || {}, settings.memory?.workerLearningsInstruction)
      : "";

    if (this.deps.sessionTracking.getSession(sessionId)) {
      this.deps.sessionTracking.updateSession(sessionId, { state: "RUNNING" });
    } else {
      this.deps.sessionTracking.createSession({
        id: sessionId,
        provider,
        taskId: buildTaskRunKey(repoPath, 0, `attention-${item.id}`),
        title,
        prompt: item.summaryMarkdown,
        state: "RUNNING",
        featureBranch: branchName,
        workerBranch: branchName,
        repoPath,
      });
    }
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: `${taskContinuation ? "Continued the task coding session for" : "Virtual worker claimed"} CI fix on branch ${branchName} (Attempt ${retryCount + 1}/${capLabel}).`,
    });

    let cleanedUp = false;
    let preserveWorkspace = false;
    const gitAuth: GitHttpAuthOptions = {
      githubToken: settings.git.githubToken,
      gitlabToken: settings.git.gitlabToken,
    };
    try {
      const effectiveWorkflowSettings = await this.resolveVirtualWorkerWorkflowSettings({
        workflowSettings,
        sessionId,
        repoPath,
        purpose: "ci_fix",
      });
      const prepared = await this.invocationWorkspacePreparer.prepareWorktree({
        repoPath,
        worktreePath: this.workspaceManager.buildWorkspaceRef(repoPath, workspaceOwnerSessionId, effectiveWorkflowSettings.executionMode),
        workerBranch: branchName,
        featureBranch: branchName,
        resumeSessionId: repairRuntime.workspaceSessionId,
        gitAuth,
        gitPolicy: buildInvocationGitPolicy({
          githubMode: settings.git.githubMode,
          defaultBranch: settings.git.defaultBranch,
          githubToken: settings.git.githubToken,
          gitlabToken: settings.git.gitlabToken,
        }),
      });
      const finalWorktreePath = prepared.worktreePath;
      worktreePath = finalWorktreePath;
      repairRuntime = this.checkpointRepairRuntime(item, {
        ...repairRuntime,
        phase: "workspace_ready",
      });
      const currentWorkspaceHead = (await this.runWorkspaceCommand(finalWorktreePath, "git", ["rev-parse", "HEAD"])).stdout.trim();
      if (!repairRuntime.workspaceBaselineHead) {
        repairRuntime = this.checkpointRepairRuntime(item, {
          ...repairRuntime,
          workspaceBaselineHead: currentWorkspaceHead,
        });
      }
      initialHead = repairRuntime.workspaceBaselineHead || currentWorkspaceHead;

      if (repairRuntime.publicationPhase === "pending") {
        const workspaceGuidance = await this.workspaceManager.buildWorkspaceGuidance(item.summaryMarkdown, finalWorktreePath);
        const providerPrompt = buildProviderPrompt(
          this.buildCiFixPrompt(
            item,
            branchName,
            workspaceGuidance,
            workerAgent?.instructionMarkdown,
            memoryContext,
            memoryInstructions,
          ),
          providerSettings.thinkingMode,
          provider,
        );
        const previousInvocation = this.latestRepairInvocation(repairRuntime)
          || taskContinuation?.previousInvocation
          || null;
        repairRuntime = this.checkpointRepairRuntime(item, {
          ...repairRuntime,
          nativeSessionId: previousInvocation?.nativeSessionId || repairRuntime.nativeSessionId,
          phase: "provider_running",
        });
        const nativeSessionId = await this.runProviderWithRetry({
          provider,
          providerPrompt,
          workflowSettings: effectiveWorkflowSettings,
          repoPath,
          worktreePath: finalWorktreePath,
          sessionId,
          attentionItem: item,
          purpose: "ci_fix",
          model: providerSettings.model,
          thinkingMode: providerSettings.thinkingMode,
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
          taskRunId: taskContinuation?.taskRunId || undefined,
          continueSessionId: repairRuntime.nativeSessionId,
          continueSessionWithoutNativeId: provider === "codex"
            && !repairRuntime.nativeSessionId
            && Boolean(savedRuntime || taskContinuation?.continueSessionWithoutNativeId),
          openCodeBaselineRawUsageJson: provider === "opencode"
            ? previousInvocation?.rawUsageJson ?? null
            : null,
          githubToken: settings.git.githubToken,
          agentMcpAccess: workerAgent ? workerClarificationAgentMcpAccess(workerAgent.mcpAccess) : null,
          mcpAgentId: workerAgent?.id ?? null,
        });
        if (nativeSessionId) {
          repairRuntime = this.checkpointRepairRuntime(item, {
            ...repairRuntime,
            nativeSessionId,
            phase: "provider_running",
          });
        }

        if (settings.memory?.enabled && settings.memory.autoCaptureSprint) {
          await this.captureMemoriesFromWorkspace(
            item.projectId,
            item.sprintId || undefined,
            workerAgent?.id || null,
            finalWorktreePath,
            item.id,
          );
        }
        const workspaceRepairHead = (await this.runWorkspaceCommand(finalWorktreePath, "git", ["rev-parse", "HEAD"])).stdout.trim();
        repairRuntime = this.checkpointRepairRuntime(item, {
          ...repairRuntime,
          workspaceRepairHead,
          publicationPhase: "workspace_finalized",
        });
      }

      const repairCommitSubject = `fix(ci): resolve failing checks on ${branchName}`;
      let recoveredPublishedHead = repairRuntime.publicationPhase === "host_publishing"
        && repairRuntime.workspaceRepairHead !== repairRuntime.workspaceBaselineHead
        ? await this.findPublishedRepairCommit({
          repoPath,
          workerBranch: branchName,
          workspaceRepairHead: repairRuntime.workspaceRepairHead,
          githubMode: settings.git.githubMode,
          gitAuth,
        })
        : null;
      if (!recoveredPublishedHead && repairRuntime.publicationPhase === "host_publishing") {
        recoveredPublishedHead = await this.findTreeEquivalentPublishedRepair({
          repoPath,
          worktreePath: finalWorktreePath,
          workerBranch: branchName,
          workspaceBaselineHead: repairRuntime.workspaceBaselineHead,
          workspaceRepairHead: repairRuntime.workspaceRepairHead,
          expectedCommitSubject: repairCommitSubject,
          requiredParentRefs: [],
          githubMode: settings.git.githubMode,
          gitAuth,
        });
      }
      const alreadyPublished = Boolean(recoveredPublishedHead)
        || (repairRuntime.publicationPhase === "host_published" && Boolean(repairRuntime.publishedHeadSha));
      let applyResult: AppliedWorkspacePatchResult = {
        hasChanges: alreadyPublished,
        commitSha: recoveredPublishedHead || repairRuntime.publishedHeadSha || undefined,
      };
      if (!alreadyPublished) {
        const patchText = await this.workspaceArtifactService.exportBinaryPatch(
          finalWorktreePath,
          repairRuntime.workspaceBaselineHead || initialHead,
        );
        repairRuntime = this.checkpointRepairRuntime(item, {
          ...repairRuntime,
          publicationPhase: "host_publishing",
        });
        applyResult = await this.workspaceArtifactService.applyPatchToBranch({
          repoPath,
          baseRef: repairRuntime.workspaceBaselineHead || initialHead,
          workerBranch: branchName,
          patchText,
          commitMessage: this.buildRepairPublicationCommitMessage(
            repairCommitSubject,
            repairRuntime.workspaceRepairHead,
          ),
          gitAuth,
          gitIdentity: effectiveWorkflowSettings.containerMountGitConfig
            ? undefined
            : {
              name: effectiveWorkflowSettings.containerGitUserName,
              email: effectiveWorkflowSettings.containerGitUserEmail,
            },
          githubMode: settings.git.githubMode,
        });
      }
      let hasUnpushed = alreadyPublished || applyResult.hasChanges;
      let hasAhead = alreadyPublished || applyResult.hasChanges;
      if (!applyResult.hasChanges) {
        hasUnpushed = await this.prService.hasUnpushedCommits(repoPath, branchName, compareBaseBranch);
        hasAhead = await this.prService.hasWorkerBranchCommitsAgainstFeature(repoPath, branchName, compareBaseBranch);
        if (hasUnpushed && settings.git.githubMode !== "LOCAL") {
          const pushEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(repoPath, gitAuth);
          await runCommandStrict(
            "git",
            ["push", "-u", "origin", `refs/heads/${branchName}:refs/heads/${branchName}`],
            repoPath,
            pushEnv ?? process.env,
          );
        }
      }
      if (!applyResult.hasChanges && !hasUnpushed) {
        throw new Error(
          "CI fix completed without producing a patch or unpublished branch commits; refusing to mark the fix as pushed.",
        );
      }
      const headSha = applyResult.commitSha
        || ((hasUnpushed || hasAhead)
          ? (await runCommandStrict("git", ["rev-parse", `refs/heads/${branchName}`], repoPath)).stdout.trim()
          : initialHead);
      repairRuntime = this.checkpointRepairRuntime(item, {
        ...repairRuntime,
        publicationPhase: "host_published",
        publishedHeadSha: headSha,
      });
      this.deps.sessionTracking.updateSession(sessionId, { state: "COMPLETED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: hasUnpushed || applyResult.hasChanges
          ? `Pushed CI fix to ${branchName} at ${headSha}.`
          : `CI fix run completed on ${branchName} at ${headSha}.`,
      });

      this.deps.projectAttentionService.resolveItem(item.id, {
        status: "resolved",
        reason: "virtual_worker_ci_fix_resolved",
        resolutionSummaryMarkdown: [
          item.summaryMarkdown.trim(),
          "",
          `Virtual ${this.getProviderLabel(provider)} worker fixed CI issues and pushed the updated branch.`,
          `Branch: ${branchName}`,
          `Head SHA: ${headSha}`,
          `Attempt: ${retryCount + 1}/${capLabel}`,
        ].join("\n"),
        workerEndpointId,
        payloadPatch: {
          handledBy: "virtual_worker",
          provider,
          branchName,
          headSha,
          attempt: retryCount + 1,
        },
      });
      succeeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isProviderCancellationError(error)) {
        preserveWorkspace = true;
        const previousInvocation = this.latestRepairInvocation(repairRuntime);
        repairRuntime = this.checkpointRepairRuntime(item, {
          ...repairRuntime,
          nativeSessionId: previousInvocation?.nativeSessionId || repairRuntime.nativeSessionId,
          phase: "interrupted",
        });
        this.deps.sessionTracking.updateSession(sessionId, { state: "CANCELLED" });
        this.deps.sessionTracking.appendActivity(sessionId, {
          originator: "system",
          description: `Virtual worker CI-fix run cancelled before completion: ${message}`,
        });
        this.deps.projectAttentionService.requeueItem(item.id, {
          repairRuntime,
          lastVirtualWorkerError: message,
          lastVirtualWorkerInterruptedAt: new Date().toISOString(),
          lastVirtualWorkerProvider: provider,
          lastVirtualWorkerSessionId: sessionId,
        });
        return;
      }
      this.deps.sessionTracking.updateSession(sessionId, { state: "FAILED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Virtual worker failed to fix CI issues: ${message}`,
      });
      const retryEval = this.deps.guardrailService?.evaluate(guardrailScope, guardrailKey, "ci_fix") ?? null;
      if (retryEval && (retryEval.allowed || retryEval.action === "WARN_ONLY")) {
        preserveWorkspace = true;
        const now = new Date().toISOString();
        this.deps.projectAttentionService.requeueItem(item.id, {
          repairRuntime: {
            ...repairRuntime,
            nativeSessionId: this.latestRepairInvocation(repairRuntime)?.nativeSessionId || repairRuntime.nativeSessionId,
            activeAttemptId: null,
            attemptRecorded: false,
            phase: "interrupted",
            updatedAt: now,
          },
          lastVirtualWorkerError: message,
          lastVirtualWorkerFailedAt: now,
          lastVirtualWorkerProvider: provider,
          lastVirtualWorkerSessionId: sessionId,
          ciFixRetryCount: retryEval.count,
          ciFixRetryCap: retryEval.cap,
        });
        this.deps.logger?.warn("Virtual worker CI-fix attempt failed; leaving attention retryable", {
          projectId: item.projectId,
          sprintId: item.sprintId,
          taskId: item.taskId,
          attentionItemId: item.id,
          sessionId,
          provider,
          retryCount: retryEval.count,
          retryCap: retryEval.cap,
          error,
        });
        return;
      }
      this.escalateAttentionToHuman(workerEndpointId, item, [
        `Virtual ${this.getProviderLabel(provider)} worker failed to fix CI issues automatically.`,
        "",
        `Attempts: ${retryEval?.count ?? retryCount + 1}/${(retryEval?.cap ?? maxRetries) > 0 ? retryEval?.cap ?? maxRetries : "∞"}`,
        "",
        `Error: ${message}`,
        "",
        item.summaryMarkdown.trim(),
      ].join("\n"));
    } finally {
      const shouldCleanup = taskContinuation || preserveWorkspace
        ? false
        : succeeded
          ? workflowSettings.cleanupWorktreeOnSuccess
          : true;
      if (shouldCleanup) {
        await this.workspaceManager.removeWorktree(repoPath, worktreePath).catch(() => undefined);
        cleanedUp = true;
      }
      if (!cleanedUp) {
        this.deps.sessionTracking.appendActivity(sessionId, {
          originator: "system",
          description: `Preserved CI-fix worktree at ${worktreePath}.`,
        });
      }
    }
  }

  private clearResolvedMergeConflictTaskMarker(item: ProjectAttentionItemRecord): void {
    if (!item.taskId) {
      return;
    }
    const task = this.deps.projectManagementRepository.getTask(item.taskId);
    if (task?.mergeIndicator !== "MERGE_CONFLICT") {
      return;
    }
    this.deps.projectManagementRepository.updateTask(item.taskId, {
      mergeIndicator: null,
      isMerged: false,
    });
  }

  private async isMergeConflictAlreadyResolved(args: {
    repoPath: string;
    sourceBranch: string;
    targetBranch: string;
    targetRef: string;
    gitAuth: GitHttpAuthOptions;
    githubMode: string;
  }): Promise<boolean> {
    if (args.githubMode !== "LOCAL") {
      return this.isMergeConflictResolvedOnRemote(
        args.repoPath,
        args.sourceBranch,
        args.targetBranch,
        args.gitAuth,
      );
    }
    try {
      await runCommandStrict(
        "git",
        ["merge-base", "--is-ancestor", args.sourceBranch, args.targetRef],
        args.repoPath,
      );
      return true;
    } catch {
      return false;
    }
  }

  private async resolveVirtualWorkerWorkflowSettings(args: {
    workflowSettings: CliWorkflowSettings;
    sessionId: string;
    repoPath: string;
    purpose: "ci_fix" | "merge_conflict";
  }): Promise<CliWorkflowSettings> {
    if (args.workflowSettings.executionMode !== "DOCKER") {
      return args.workflowSettings;
    }

    const dockerAvailable = await this.dockerService.isAvailable();
    if (dockerAvailable) {
      return args.workflowSettings;
    }

    if (args.purpose === "merge_conflict") {
      throw new Error(
        "Docker is unavailable, and merge-conflict resolution requires isolated container execution. Fix Docker availability and retry.",
      );
    }

    this.deps.sessionTracking.appendActivity(args.sessionId, {
      originator: "system",
      description: "Docker is unavailable. Falling back to HOST execution mode for virtual worker CI autofix.",
    });
    return {
      ...args.workflowSettings,
      executionMode: "HOST",
    };
  }

  private buildCiFixPrompt(
    item: ProjectAttentionItemRecord,
    branchName: string,
    workspaceGuidance: string,
    workerInstruction?: string,
    memoryContext?: string,
    memoryInstructions?: string,
  ): string {
    const payload = item.payload || {};
    const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks as string[] : [];
    const persistedFailedRuns = Array.isArray(payload.failedRuns) ? payload.failedRuns as GitCiRunStatus[] : [];
    const failedRuns = selectNewestCiRun(persistedFailedRuns);
    const failedJobLabels = failedRuns.length > 0
      ? getFailedJobLabels(failedRuns)
      : Array.isArray(payload.failedJobLabels) ? payload.failedJobLabels as string[] : [];
    const failedLogSnippets = failedRuns.length > 0
      ? getFailedLogSnippets(failedRuns)
      : Array.isArray(payload.failedLogSnippets) ? payload.failedLogSnippets as string[] : [];
    const prUrl = typeof payload.prUrl === "string" ? payload.prUrl : "";
    const prNumber = typeof payload.prNumber === "number" ? payload.prNumber : 0;
    const taskKey = typeof payload.taskKey === "string" ? payload.taskKey : item.taskId || "unknown task";
    const taskTitle = typeof payload.taskTitle === "string" ? payload.taskTitle : item.title;
    const taskPrompt = typeof payload.taskPrompt === "string" ? payload.taskPrompt.trim() : "";
    const featureBranch = typeof payload.featureBranch === "string" ? payload.featureBranch : "";
    const defaultBranch = typeof payload.defaultBranch === "string" ? payload.defaultBranch : "";
    const previousAttemptError = typeof payload.lastVirtualWorkerError === "string"
      ? payload.lastVirtualWorkerError.trim()
      : "";
    const failureDetails = formatCiFixFailureDetails(failedRuns, failedLogSnippets);

    return [
      "# CI Fix Job",
      "",
      "You are not starting or reimplementing the original task. The original task work already exists on this branch and has an open PR. Your job is to repair the failing CI checks with the smallest necessary changes, commit those fixes, and leave the same branch pushable.",
      "",
      "## CI Failure Target",
      `- PR: ${prNumber > 0 ? `#${prNumber}` : "unknown"}${prUrl ? ` (${prUrl})` : ""}`,
      `- Worker branch to fix: \`${branchName}\``,
      featureBranch ? `- PR base / sprint feature branch: \`${featureBranch}\`` : null,
      defaultBranch ? `- Repository default branch: \`${defaultBranch}\`` : null,
      `- Original task: ${taskKey}${taskTitle ? ` - ${taskTitle}` : ""}`,
      `- Failed checks: ${failedChecks.length > 0 ? failedChecks.join(", ") : "unknown"}`,
      `- Failed jobs: ${failedJobLabels.length > 0 ? failedJobLabels.join(", ") : "unknown"}`,
      "",
      "## Required Outcome",
      "- Investigate the CI failures using the details below as the primary source of truth.",
      "- Fix only the root cause of the failing CI checks.",
      "- Commit the necessary changes on the current worker branch.",
      "- Do not open a new pull request, do not rewrite history, and do not restart the original task from scratch.",
      "- If the provided CI metadata is insufficient, then use the included `gh run view ... --log-failed` commands to fetch missing logs.",
      "",
      "## Failed CI Details",
      failureDetails,
      "",
      previousAttemptError
        ? `## Previous CI Fix Attempt\nThe prior repair invocation failed. Continue from its session/workspace when available and correct this exact failure:\n\n${previousAttemptError}`
        : null,
      "",
      workerInstruction?.trim() ? `## General Coding Agent Instructions\n\n${workerInstruction.trim()}` : null,
      prUrl ? `PR URL: ${prUrl}` : null,
      "",
      memoryContext?.trim() || null,
      "",
      taskPrompt ? "## Original Task Context (Reference Only)\nThe implementation below is already present on the worker branch. Use it only to understand the intended behavior while fixing CI; do not redo the whole task.\n\n" + taskPrompt : null,
      "",
      "## LEARNINGS CAPTURE (Required)",
      memoryInstructions?.trim()
        || `Before you finish, write key durable learnings and pitfalls from this CI fix to \`${LEARNINGS_FILENAME}\`.`,
      "",
      "## Original Attention Summary",
      item.summaryMarkdown.trim(),
      "",
      workspaceGuidance,
    ].filter(Boolean).join("\n");
  }

  private async workspaceHasMergeInProgress(worktreePath: string): Promise<boolean> {
    try {
      const result = await this.runWorkspaceCommand(worktreePath, "git", ["rev-parse", "--verify", "MERGE_HEAD"]);
      return result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async runMergeIntoSource(worktreePath: string, targetRef: string, sessionId: string): Promise<boolean> {
    try {
      await this.runWorkspaceCommand(worktreePath, "git", ["merge", "--no-ff", "--no-commit", targetRef]);
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Prepared merge of ${targetRef} into the source branch without conflicts.`,
      });
      return false;
    } catch (error) {
      const rawUnresolved = await this.listRawUnresolvedFiles(worktreePath);
      const ignoredCodeUxConflicts = rawUnresolved.filter((entry) => this.isCodeUxRepoPath(entry));
      if (ignoredCodeUxConflicts.length > 0) {
        await this.resolveCodeUxMergeConflictsToTarget(worktreePath);
        this.deps.sessionTracking.appendActivity(sessionId, {
          originator: "system",
          description: `Ignored Code UX runtime merge conflicts in: ${ignoredCodeUxConflicts.join(", ")}`,
        });
      }
      const unresolved = rawUnresolved.filter((entry) => !this.isCodeUxRepoPath(entry));
      if (unresolved.length === 0) {
        return false;
      }
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Merge produced conflicts in: ${unresolved.join(", ")}`,
      });
      return true;
    }
  }

  private async runProviderWithRetry(args: {
    provider: Exclude<ProviderId, "jules">;
    providerPrompt: string;
    workflowSettings: DashboardSettings["cliWorkflow"];
    repoPath: string;
    worktreePath: string;
    sessionId: string;
    attentionItem: ProjectAttentionItemRecord;
    purpose: "ci_fix" | "merge_conflict";
    model: string;
    thinkingMode?: ThinkingMode;
    apiKey: string;
    maxConcurrentTasks?: number;
    qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
    qwenRegion?: "china" | "international";
    qwenBaseUrl?: string;
    qwenEnvKey?: string;
    qwenModelId?: string;
    qwenProtocol?: "openai" | "anthropic" | "gemini";
    qwenAdditionalModelProviders?: QwenModelProviderSettings[];
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
    providerConfigMode?: import("../contracts/app-types.js").ProviderConfigMode;
    providerConfigPath?: string;
    customBaseUrl?: string;
    customModel?: string;
    taskRunId?: string;
    continueSessionId?: string | null;
    continueSessionWithoutNativeId?: boolean;
    openCodeBaselineRawUsageJson?: Record<string, unknown> | null;
    githubToken: string;
    agentMcpAccess?: AgentMcpAccessConfig | null;
    mcpAgentId?: string | null;
  }): Promise<string | null> {
    const effectiveModel = resolveEffectiveModel({
      provider: args.provider,
      model: args.model,
      providerMountAuth: args.providerMountAuth,
      customModel: args.customModel,
      qwenAuthMode: args.qwenAuthMode,
      qwenModelId: args.qwenModelId,
      openCodeAuthMode: args.openCodeAuthMode,
      openCodeProviderId: args.openCodeProviderId,
      openCodeModelId: args.openCodeModelId,
    });

    const result = await this.providerExecutionService.executeProvider({
      projectId: args.attentionItem.projectId,
      sprintId: args.attentionItem.sprintId,
      taskId: args.attentionItem.taskId,
      taskRunId: args.taskRunId,
      sprintRunId: args.attentionItem.sprintRunId,
      dispatchId: args.attentionItem.dispatchId,
      attentionItemId: args.attentionItem.id,
      purpose: args.purpose,
      type: args.purpose,
      provider: args.provider,
      prompt: args.providerPrompt,
      cwd: args.worktreePath,
      model: effectiveModel,
      thinkingMode: args.thinkingMode,
      apiKey: args.apiKey,
      maxConcurrentTasks: args.maxConcurrentTasks,
      qwenAuthMode: args.qwenAuthMode,
      qwenRegion: args.qwenRegion,
      qwenBaseUrl: args.qwenBaseUrl,
      qwenEnvKey: args.qwenEnvKey,
      qwenModelId: args.qwenModelId,
      qwenProtocol: args.qwenProtocol,
      qwenAdditionalModelProviders: args.qwenAdditionalModelProviders,
        openCodeAuthMode: args.openCodeAuthMode,
        openCodeProviderId: args.openCodeProviderId,
        openCodeModelId: args.openCodeModelId,
        openCodeBaseUrl: args.openCodeBaseUrl,
        openCodeEnvKey: args.openCodeEnvKey,
        openCodePackage: args.openCodePackage,
      providerMountAuth: args.providerMountAuth,
      providerAuthPath: args.providerAuthPath,
      providerConfigMode: args.providerConfigMode,
      providerConfigPath: args.providerConfigPath,
      customBaseUrl: args.customBaseUrl,
      customModel: args.customModel,
      sessionId: args.sessionId,
      continueSessionId: args.continueSessionId,
      continueSessionWithoutNativeId: args.continueSessionWithoutNativeId,
      openCodeBaselineRawUsageJson: args.openCodeBaselineRawUsageJson,
      workflowSettings: args.workflowSettings,
      repoPath: args.repoPath,
      githubToken: args.githubToken,
      agentMcpAccess: args.agentMcpAccess,
      mcpAgentId: args.mcpAgentId,
      concurrencyWaitTimeoutMs: VIRTUAL_WORKER_PROVIDER_SLOT_WAIT_MS,
    });

    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || "Provider failed without output.");
    }
    return result.nativeSessionId || null;
  }

  private async isMergeConflictResolvedOnRemote(
    repoPath: string,
    sourceBranch: string,
    targetBranch: string,
    gitAuth: GitHttpAuthOptions,
  ): Promise<boolean> {
    try {
      const env = await buildGitHttpAuthEnvForRepoWithFallbacks(repoPath, gitAuth);
      await runCommandStrict("git", ["fetch", "origin", sourceBranch, targetBranch], repoPath, env ?? process.env);
      await runCommandStrict(
        "git",
        ["merge-base", "--is-ancestor", `origin/${sourceBranch}`, `origin/${targetBranch}`],
        repoPath,
      );
      return true;
    } catch {
      return false;
    }
  }

  private async ensureMergeConflictResolved(worktreePath: string): Promise<void> {
    const unresolved = await this.listUnresolvedFiles(worktreePath);
    if (unresolved.length === 0) {
      return;
    }
    // The agent almost always edits the working-tree files to resolve the conflict but
    // leaves them unstaged, so the index still records unmerged stage entries and
    // `git diff --diff-filter=U` keeps listing them. That is NOT an unresolved conflict —
    // only files that still contain conflict markers are. (Every provider — Qwen, Codex,
    // Antigravity — hits this: they remove the markers, run tests, then hand back without
    // staging, expecting the orchestrator to finalize the index.) Stage the agent's edits
    // first so resolved unmerged entries collapse, then verify no markers survived.
    await this.runWorkspaceCommand(worktreePath, "git", ["add", "-A", "--", ".", CODE_UX_GIT_PATHSPEC_EXCLUDE]);
    const stillConflicted = await this.listFilesWithConflictMarkers(worktreePath, unresolved);
    if (stillConflicted.length > 0) {
      throw new Error(`Unresolved merge conflicts remain: ${stillConflicted.join(", ")}`);
    }
  }

  private async ensureMergeConflictPreservesPromptLiterals(
    worktreePath: string,
    item: ProjectAttentionItemRecord,
  ): Promise<void> {
    const requiredLiterals = this.extractRequiredMergeTimestampLiterals(item);
    if (requiredLiterals.length === 0) {
      return;
    }

    const malformedVariants = new Map<string, string>();
    for (const literal of requiredLiterals) {
      for (const variant of this.buildMalformedTimestampLiteralVariants(literal)) {
        malformedVariants.set(variant, literal);
      }
    }
    if (malformedVariants.size === 0) {
      return;
    }

    const matches: string[] = [];
    try {
      const grepArgs = [
        "grep",
        "--cached",
        "-n",
        "-F",
        ...Array.from(malformedVariants.keys()).flatMap((variant) => ["-e", variant]),
        "--",
        ".",
      ];
      const result = await this.runWorkspaceCommand(worktreePath, "git", grepArgs);
      matches.push(...result.stdout.split("\n").map((line) => line.trim()).filter(Boolean));
    } catch {
      // `git grep` exits non-zero when there are no matches.
    }

    try {
      const result = await this.runWorkspaceCommand(worktreePath, "git", [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
      ]);
      for (const filePath of result.stdout.split("\n").map((line) => line.trim()).filter(Boolean)) {
        for (const variant of malformedVariants.keys()) {
          if (filePath.includes(variant)) {
            matches.push(filePath);
            break;
          }
        }
      }
    } catch {
      // Path-level validation is best-effort; content validation above is the primary guard.
    }

    if (matches.length === 0) {
      return;
    }

    const sample = matches.slice(0, 8).join("; ");
    throw new Error(
      `Merge conflict resolution mutated required prompt timestamp literals. Found malformed marker variants in: ${sample}`,
    );
  }

  private extractRequiredMergeTimestampLiterals(item: ProjectAttentionItemRecord): string[] {
    const payload = item.payload || {};
    const texts = [
      item.summaryMarkdown,
      this.extractCurrentTaskPrompt(payload),
      ...this.extractMergeConflictTaskPrompts(
        Array.isArray(payload.mergedTaskPrompts)
          ? payload.mergedTaskPrompts
          : Array.isArray(payload.featureBranchTaskContexts)
            ? payload.featureBranchTaskContexts
            : [],
      ),
    ];
    const literals = new Set<string>();
    const markerPattern = /\b\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\b/g;
    for (const text of texts) {
      if (!text) {
        continue;
      }
      for (const match of text.matchAll(markerPattern)) {
        literals.add(match[0]);
      }
    }
    return Array.from(literals);
  }

  private buildMalformedTimestampLiteralVariants(literal: string): string[] {
    const match = literal.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
    if (!match) {
      return [];
    }
    const [, date, hour, minute, second, millis] = match;
    return [
      `${date}T${hour}:${minute}-${second}-${millis}Z`,
      `${date}T${hour}:${minute}:${second}-${millis}Z`,
      `${date}T${hour}:${minute}-${second}Z`,
      `${date}T${hour}:${minute}:${second}Z`,
    ];
  }

  private isCodeUxRepoPath(entry: string): boolean {
    const normalized = entry.replace(/\\/g, "/").replace(/^"+|"+$/g, "");
    return normalized === CODE_UX_REPO_DIR || normalized.startsWith(`${CODE_UX_REPO_DIR}/`);
  }

  private async resolveCodeUxMergeConflictsToTarget(worktreePath: string): Promise<void> {
    try {
      await this.runWorkspaceCommand(worktreePath, "git", ["checkout", "--theirs", "--", CODE_UX_REPO_DIR]);
    } catch {
      await this.runWorkspaceCommand(worktreePath, "git", ["rm", "-r", "--ignore-unmatch", "--", CODE_UX_REPO_DIR])
        .catch(() => undefined);
    }
    await this.runWorkspaceCommand(worktreePath, "git", ["add", "-A", "--", CODE_UX_REPO_DIR]);
  }

  private async listUnresolvedFiles(worktreePath: string): Promise<string[]> {
    return (await this.listRawUnresolvedFiles(worktreePath)).filter((entry) => !this.isCodeUxRepoPath(entry));
  }

  private async listRawUnresolvedFiles(worktreePath: string): Promise<string[]> {
    try {
      const result = await this.runWorkspaceCommand(worktreePath, "git", ["diff", "--name-only", "--diff-filter=U"]);
      return result.stdout.split("\n").map((entry) => entry.trim()).filter(Boolean);
    } catch (error) {
      this.deps.logger?.warn("Failed to list unresolved merge files via git diff; falling back to git status.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const status = await this.runWorkspaceCommand(worktreePath, "git", ["status", "--porcelain", "-z"]);
    return status.stdout
      .split("\0")
      .map((entry) => {
        const code = entry.slice(0, 2);
        if (!/U|AA|DD/.test(code)) {
          return null;
        }
        return entry.slice(3).trim();
      })
      .filter((entry): entry is string => Boolean(entry));
  }

  private async listFilesWithConflictMarkers(worktreePath: string, files: string[]): Promise<string[]> {
    if (files.length === 0) {
      return [];
    }
    try {
      // Search the staged content for surviving conflict markers. Requiring the start
      // (`<<<<<<<`) or end (`>>>>>>>`) markers — rather than the `=======` separator,
      // which appears legitimately in markdown/RST — avoids false positives.
      const result = await this.runWorkspaceCommand(worktreePath, "git", [
        "grep",
        "--cached",
        "-l",
        "-E",
        "^(<{7}|>{7})( |$)",
        "--",
        ...files,
      ]);
      return result.stdout.split("\n").map((entry) => entry.trim()).filter(Boolean);
    } catch {
      // `git grep` exits non-zero when it finds no matches, which is exactly the
      // success case here: the agent removed every conflict marker.
      return [];
    }
  }

  private async finalizeMergeCommit(worktreePath: string, sourceBranch: string, targetBranch: string): Promise<void> {
    const mergeHead = await this.hasMergeHead(worktreePath);
    const status = (await this.runWorkspaceCommand(worktreePath, "git", ["status", "--porcelain", "--", ".", CODE_UX_GIT_PATHSPEC_EXCLUDE])).stdout.trim();
    if (!mergeHead && status.length === 0) {
      return;
    }

    await this.runWorkspaceCommand(worktreePath, "git", ["add", "-A", "--", ".", CODE_UX_GIT_PATHSPEC_EXCLUDE]);
    try {
      await this.runWorkspaceCommand(
        worktreePath,
        "git",
        ["commit", "-m", `Resolve merge conflict: ${targetBranch} into ${sourceBranch}`],
      );
    } catch (error) {
      const nextStatus = (await this.runWorkspaceCommand(worktreePath, "git", ["status", "--porcelain", "--", ".", CODE_UX_GIT_PATHSPEC_EXCLUDE])).stdout.trim();
      if (nextStatus.length > 0 || await this.hasMergeHead(worktreePath)) {
        throw error;
      }
    }
  }

  private async ensureTargetMergedIntoSource(worktreePath: string, targetRef: string): Promise<void> {
    try {
      await this.runWorkspaceCommand(worktreePath, "git", ["merge-base", "--is-ancestor", targetRef, "HEAD"]);
    } catch {
      throw new Error(`Merge verification failed: ${targetRef} is not contained in the resolved source branch.`);
    }
  }

  private async isWorkspaceMergeFinalized(worktreePath: string, targetRef: string): Promise<boolean> {
    if (await this.workspaceHasMergeInProgress(worktreePath)) {
      return false;
    }
    try {
      await this.ensureTargetMergedIntoSource(worktreePath, targetRef);
      return true;
    } catch {
      return false;
    }
  }

  private async hasMergeHead(worktreePath: string): Promise<boolean> {
    try {
      await this.runWorkspaceCommand(worktreePath, "git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  private buildMergeConflictPrompt(
    item: ProjectAttentionItemRecord,
    sourceBranch: string,
    targetBranch: string,
    workspaceGuidance: string,
    workerInstruction?: string,
    memoryContext?: string,
    memoryInstructions?: string,
  ): string {
    const payload = item.payload || {};
    const mergedTaskPrompts = this.extractMergeConflictTaskPrompts(
      Array.isArray(payload.mergedTaskPrompts)
        ? payload.mergedTaskPrompts
        : Array.isArray(payload.featureBranchTaskContexts)
          ? payload.featureBranchTaskContexts
          : [],
    );
    const currentTaskPrompt = this.extractCurrentTaskPrompt(payload);
    const previousFailure = this.formatPreviousMergeConflictFailure(payload);

    return [
      "Resolve the active Git merge conflict already present in this worktree.",
      workerInstruction?.trim() ? `## Agent Instructions\n\n${workerInstruction.trim()}` : null,
      `Source branch: ${sourceBranch}`,
      `Target branch: ${targetBranch}`,
      "",
      memoryContext?.trim() || null,
      "",
      "Requirements:",
      "- Preserve the intended work from both branches.",
      "- Preserve exact literal identifiers, branch names, file paths, directory names, timestamps, marker strings, and task keys from the task prompts and conflict content.",
      "- Do not normalize, reformat, or reinterpret timestamp-like strings, separators, hyphens, underscores, colons, or casing when copying required identifiers.",
      "- When resolving text files, copy required existing lines verbatim unless the task prompt explicitly asks you to change that line.",
      "- If the source branch contains a malformed variant of a required prompt literal, repair it to the exact literal from the task prompt before committing.",
      "- If two branches contain similarly named paths or markers, keep each branch's exact literals and combine the intended content without inventing replacement names.",
      "- Resolve only the conflict and any directly related fallout.",
      "- Leave the branch in a clean, committed, pushable state.",
      "- Do not open a new pull request or rewrite history.",
      previousFailure,
      "",
      currentTaskPrompt ? "Current task prompt:" : null,
      currentTaskPrompt || null,
      mergedTaskPrompts.length > 0 ? "\nMerged task prompts already present on the target branch:" : null,
      mergedTaskPrompts.length > 0 ? mergedTaskPrompts.join("\n\n") : null,
      "",
      "## LEARNINGS CAPTURE (Required)",
      memoryInstructions?.trim()
        || `Before you finish, write key durable learnings and pitfalls from this merge-conflict resolution to \`${LEARNINGS_FILENAME}\`.`,
      "",
      "Original attention summary:",
      item.summaryMarkdown.trim(),
      "",
      workspaceGuidance,
    ].filter(Boolean).join("\n");
  }

  private formatPreviousMergeConflictFailure(payload: Record<string, unknown>): string | null {
    const error = typeof payload.lastVirtualWorkerError === "string" ? payload.lastVirtualWorkerError.trim() : "";
    if (!error) {
      return null;
    }
    const provider = typeof payload.lastVirtualWorkerProvider === "string" ? payload.lastVirtualWorkerProvider.trim() : "";
    const sessionId = typeof payload.lastVirtualWorkerSessionId === "string" ? payload.lastVirtualWorkerSessionId.trim() : "";
    const failedAt = typeof payload.lastVirtualWorkerFailedAt === "string" ? payload.lastVirtualWorkerFailedAt.trim() : "";

    return [
      "",
      "Previous automatic merge-conflict attempt failed. Correct this exact issue on this retry:",
      provider ? `Provider: ${provider}` : null,
      sessionId ? `Session: ${sessionId}` : null,
      failedAt ? `Failed at: ${failedAt}` : null,
      `Error: ${error}`,
    ].filter(Boolean).join("\n");
  }

  private extractCurrentTaskPrompt(payload: Record<string, unknown>): string {
    if (typeof payload.currentTaskPrompt === "string" && payload.currentTaskPrompt.trim()) {
      return payload.currentTaskPrompt.trim();
    }

    const currentTask = this.asRecord(payload.currentTask);
    if (typeof currentTask?.taskPrompt === "string" && currentTask.taskPrompt.trim()) {
      return currentTask.taskPrompt.trim();
    }

    if (typeof payload.taskPrompt === "string" && payload.taskPrompt.trim()) {
      return payload.taskPrompt.trim();
    }

    return "";
  }

  private extractMergeConflictTaskPrompts(entries: unknown[]): string[] {
    return entries
      .map((entry) => this.asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => {
        const taskKey = typeof entry.taskKey === "string" ? entry.taskKey : "task";
        const title = typeof entry.taskTitle === "string"
          ? entry.taskTitle
          : typeof entry.title === "string"
            ? entry.title
            : taskKey;
        const prompt = typeof entry.taskPrompt === "string"
          ? entry.taskPrompt
          : typeof entry.prompt === "string"
            ? entry.prompt
            : "";
        return `${taskKey} ${title}\n\n${prompt}`.trim();
      })
      .filter(Boolean);
  }

  private escalateAttentionToHuman(workerEndpointId: string, item: ProjectAttentionItemRecord, summaryMarkdown: string): void {
    this.deps.projectAttentionService.openItem({
      projectId: item.projectId,
      sprintId: item.sprintId,
      taskId: item.taskId,
      sprintRunId: item.sprintRunId,
      dispatchId: item.dispatchId,
      attentionType: "human_escalation_required",
      severity: item.severity,
      ownerType: "human",
      title: `Virtual worker escalation: ${item.title}`,
      summaryMarkdown,
      payload: {
        ...(item.payload || {}),
        sourceAttentionItemId: item.id,
        sourceAttentionType: item.attentionType,
        escalatedBy: "virtual_worker",
      },
    });
    this.deps.projectAttentionService.resolveItem(item.id, {
      status: "resolved",
      reason: "virtual_worker_escalated",
      resolutionSummaryMarkdown: summaryMarkdown,
      workerEndpointId,
      payloadPatch: {
        workerOutcome: "needs_human_escalation",
      },
    });
  }

  private cleanupOrphanedVirtualWorkers(): void {
    const orphaned = this.deps.workerEndpointRepository.listWorkerEndpoints()
      .filter((endpoint) => endpoint.endpointType === "virtual_cli");

    if (orphaned.length === 0) {
      return;
    }

    const orphanedIds = orphaned.map((e) => e.id);
    const activeAssignments = this.deps.projectWorkerAssignmentRepository.listActiveAssignmentsForWorkers(orphanedIds);

    const assignmentsByEndpointId = new Map<string, typeof activeAssignments>();
    for (const assignment of activeAssignments) {
      if (assignment.workerEndpointId) {
        let group = assignmentsByEndpointId.get(assignment.workerEndpointId);
        if (!group) {
          group = [];
          assignmentsByEndpointId.set(assignment.workerEndpointId, group);
        }
        group.push(assignment);
      }
    }

    for (const endpoint of orphaned) {
      const assignments = assignmentsByEndpointId.get(endpoint.id) || [];
      for (const assignment of assignments) {
        this.deps.projectWorkerAssignmentService.releaseWorkerAssignment(assignment.projectId, endpoint.id, "virtual_worker_startup_prune");
      }
      this.deps.workerEndpointRepository.deleteWorkerEndpoint(endpoint.id);
    }
  }

  private getProviderLabel(provider: ProviderId): string {
    switch (provider) {
      case "claude-code":
        return "Claude Code";
      case "qwen-code":
        return "Qwen Code";
      case "opencode":
        return "OpenCode";
      case "gemini":
        return "Gemini";
      case "codex":
      default:
        return "Codex";
    }
  }

  private readRequiredString(value: unknown, label: string): string {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      throw new Error(`Missing ${label} in virtual worker attention payload.`);
    }
    return normalized;
  }

  private readNonNegativeInteger(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    }
    return 0;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private async buildMemoryContext(projectId: string, sprintId: string | null, agentPresetId: string, query: string): Promise<string | undefined> {
    const memoryService = this.deps.memoryService;
    if (!memoryService) {
      return undefined;
    }

    try {
      return (await buildRelevantMemoryInjectionContext(memoryService, {
        projectId,
        sprintId,
        agentPresetId,
        query,
        tokenBudget: 1_800,
      })).markdown;
    } catch {
      return undefined;
    }
  }

  private async captureMemoriesFromWorkspace(
    projectId: string,
    sprintId: string | undefined,
    agentPresetId: string | null,
    worktreePath: string,
    originId: string,
  ): Promise<number> {
    if (!this.deps.memoryService) {
      return 0;
    }
    if (worktreePath.startsWith("docker-volume://")) {
      const raw = await this.workspaceManager.readWorkspaceFile(worktreePath, LEARNINGS_FILENAME);
      if (!raw) {
        return 0;
      }
      return await this.deps.memoryService.captureMemoriesFromContent(
        projectId,
        sprintId,
        agentPresetId,
        raw,
        originId,
      );
    }
    return await this.deps.memoryService.captureMemoriesFromWorktree(
      projectId,
      sprintId,
      agentPresetId,
      worktreePath,
      originId,
    );
  }

  private async runWorkspaceCommand(worktreePath: string, command: string, args: string[]) {
    if (worktreePath.startsWith("docker-volume://")) {
      return this.workspaceManager.runWorkspaceCommand(worktreePath, command, args);
    }
    return runCommandStrict(command, args, worktreePath);
  }
}
