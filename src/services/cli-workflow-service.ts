import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import type {
  CliWorkflowSettings,
  DashboardSettings,
  DashboardSettingsScope,
  JulesSession,
  ProviderId,
  QwenModelProviderSettings,
  Subtask,
  ThinkingMode,
} from "../contracts/app-types.js";
import type { TaskRunRecord, UpdateTaskDispatchInput, UpdateTaskRunInput } from "../contracts/execution-types.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import { runCommandStrict, type CommandResult } from "./cli-process-runner.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "./cli-workflow-text-utils.js";
import { buildProviderSettingsOverride, type ProviderSettingsOverride } from "./provider-settings-override.js";

import {
  buildProviderPrompt,
  buildWorkerBranch,
  DEFAULT_CLI_WORKFLOW_SETTINGS,
} from "./cli-workflow-utils.js";
import { buildTaskRunKey, buildTaskRunTag } from "./task-run-key.js";
import type { Logger } from "../shared/logging/logger.js";
import { workerClarificationAgentMcpAccess } from "./agent-mcp-access.js";

// New Modules
import { WorkspaceManager, IWorkspaceManager } from "../infrastructure/providers/cli/workspace-manager.js";
import { InvocationWorkspacePreparer } from "../infrastructure/providers/cli/invocation-workspace-preparer.js";
import { PrService, IPrService } from "../infrastructure/providers/cli/pr-service.js";
import { ProviderRunner, IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import { DockerRunner } from "../infrastructure/providers/cli/docker-runner.js";
import { WorkspaceArtifactService } from "../infrastructure/providers/cli/workspace-artifact-service.js";

import type { PipelineContext } from "./cli-workflow/pipeline/pipeline-context.js";
import { executePrepareStage } from "./cli-workflow/pipeline/prepare-stage.js";
import { executeProviderStage } from "./cli-workflow/pipeline/execute-provider-stage.js";
import { executeGitFinalizeStage } from "./cli-workflow/pipeline/git-finalize-stage.js";
import { executePrFinalizeStage } from "./cli-workflow/pipeline/pr-finalize-stage.js";
import { executeCleanupStage } from "./cli-workflow/pipeline/cleanup-stage.js";
import { executeMemoryCaptureStage } from "./cli-workflow/pipeline/memory-capture-stage.js";
import type { ActiveDispatchRegistry } from "./active-dispatch-registry.js";
import { SERVER_SHUTDOWN_STOP_REASON } from "./active-dispatch-registry.js";
import { isRuntimeShutdownInProgress } from "./shutdown-state.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { MemoryService } from "./memory-service.js";
import type { TaskSelfReflectionRatingRepository } from "../repositories/task-self-reflection-rating-repository.js";
import type { ProviderConcurrencyService } from "./provider-concurrency-service.js";
import { ProviderQuotaError } from "../shared/providers/provider-error-classifier.js";
import type { SprintRunLifecycleService } from "./sprint-run-lifecycle-service.js";
import type { SkillService } from "./skill-service.js";
import type { AgentPresetRepository } from "../repositories/agent-preset-repository.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { AgentPresetRecord } from "../contracts/agent-preset-types.js";
import { parseTaskExecutionOutcomeFromProviderOutput, type TaskExecutionOutcome } from "../domain/sprint/task-execution-outcome.js";
import { resolveProviderForInvocation } from "./provider-routing.js";
import { resolveEffectiveModel } from "./provider-execution-service.js";
import type { WorkerClarificationService } from "./worker-clarification-service.js";
import type { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import type { WorkerClarificationRecord } from "../contracts/worker-clarification-types.js";

interface CliWorkflowServiceDependencies {
  sessionTracking: SessionTrackingRepository;
  executionRepository?: ExecutionRepository;
  projectManagementRepository?: ProjectManagementRepository;
  activeDispatchRegistry?: ActiveDispatchRegistry;
  memoryService?: MemoryService;
  taskSelfReflectionRatingRepository?: TaskSelfReflectionRatingRepository;
  skillService?: SkillService;
  agentPresetRepository?: AgentPresetRepository;
  providerConcurrencyService?: ProviderConcurrencyService;
  sprintRunLifecycleService?: Pick<SprintRunLifecycleService, "finalizeCancellationIfIdle">;
  workerClarificationService?: WorkerClarificationService;
  projectAttentionService?: ProjectAttentionService;
  getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings;
  agentPresetSyncService: AgentPresetSyncService;
  getGithubToken: () => string | undefined;
  getMcpConnectionInfo?: () => McpConnectionInfo | null;
  logger?: Logger;
}

interface StartCliTaskInput {
  provider: Exclude<ProviderId, "jules">;
  providerSettingsOverride?: ProviderSettingsOverride;
  task: Subtask;
  taskRecordId?: string;
  repoPath: string;
  featureBranch: string;
  sprintNumber: number;
  settingsScope?: DashboardSettingsScope;
  agentPresetId?: string | null;
  dispatchId?: string;
  taskRunId?: string;
  resumeWorkspaceSessionId?: string;
  resumeWorkerBranch?: string;
  forceFreshWorkspace?: boolean;
  requireProviderSessionResume?: boolean;
}

function isNonRecoverableGitWorkflowError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return [
    "could not read username for",
    "authentication failed",
    "repository not found",
    "permission denied to",
    "could not authenticate to github",
    "gh auth login",
    "gh auth status",
    "gh token",
    "github token",
    "no git credentials",
    "remote: invalid username or token",
    "support for password authentication was removed",
  ].some((pattern) => normalized.includes(pattern));
}

function isNonRecoverableExecutionEnvironmentError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return [
    "the command 'docker' could not be found in this wsl 2 distro",
    "cannot connect to the docker daemon",
    "docker: command not found",
    "failed to create shim task",
  ].some((pattern) => normalized.includes(pattern));
}

export class CliWorkflowService {
  private readonly workspaceManager: IWorkspaceManager;
  private readonly invocationWorkspacePreparer: InvocationWorkspacePreparer;
  private readonly workspaceArtifactService: WorkspaceArtifactService;
  private readonly prService: IPrService;
  private readonly providerRunner: IProviderRunner;

  constructor(private readonly deps: CliWorkflowServiceDependencies) {
    this.workspaceManager = new WorkspaceManager();
    this.invocationWorkspacePreparer = new InvocationWorkspacePreparer(this.workspaceManager);
    this.workspaceArtifactService = new WorkspaceArtifactService(this.workspaceManager);
    this.prService = new PrService();
    this.providerRunner = new ProviderRunner(new DockerRunner());
  }

  async startTask(input: StartCliTaskInput): Promise<JulesSession> {
    const settings = this.deps.getDashboardSettings(input.settingsScope);
    const workflowSettings = this.resolveWorkflowSettings(settings);

    const sessionId = `cli-${input.provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const taskRunKey = buildTaskRunKey(input.repoPath, input.sprintNumber, input.task.id);
    const taskRecordId = input.taskRecordId || input.task.record_id || input.task.id;
    
    const explicitResumeTarget = !input.forceFreshWorkspace && input.resumeWorkspaceSessionId && input.resumeWorkerBranch
      ? {
        sessionId: input.resumeWorkspaceSessionId,
        workerBranch: input.resumeWorkerBranch,
        worktreePath: null as string | null,
      }
      : null;
    const taskRun = input.taskRunId && this.deps.executionRepository
      ? this.deps.executionRepository.getTaskRun(input.taskRunId)
      : null;
    const workspaceResumeTarget = !input.forceFreshWorkspace && workflowSettings.resumeFailedTaskInSameWorkspace && this.deps.executionRepository
      ? this.deps.executionRepository.getLatestTaskWorkspaceResumeTarget(taskRecordId, taskRun?.sprintRunId || undefined)
      : null;
    const executionResumeTarget = workspaceResumeTarget
      && workspaceResumeTarget.workerBranch
      && (!workspaceResumeTarget.provider || workspaceResumeTarget.provider === input.provider)
      ? {
        sessionId: workspaceResumeTarget.sessionId,
        workerBranch: workspaceResumeTarget.workerBranch,
        worktreePath: workspaceResumeTarget.worktreePath,
      }
      : null;
    const sessionTracking = this.deps.sessionTracking as SessionTrackingRepository & {
      findLatestResumableCliSessionForTask?: SessionTrackingRepository["findLatestFailedCliSessionForTask"];
    };
    const failedResumeTarget = !input.forceFreshWorkspace && workflowSettings.resumeFailedTaskInSameWorkspace
      ? (sessionTracking.findLatestResumableCliSessionForTask || sessionTracking.findLatestFailedCliSessionForTask).call(sessionTracking, {
        provider: input.provider,
        taskId: taskRunKey,
        featureBranch: input.featureBranch,
        repoPath: input.repoPath,
      })
      : null;
    const resumeTarget = explicitResumeTarget || executionResumeTarget || (failedResumeTarget
      ? { ...failedResumeTarget, worktreePath: null as string | null }
      : null);

    const workerBranch = resumeTarget?.workerBranch || buildWorkerBranch(input.featureBranch, input.task.id, input.provider);
    const resumeWorktreePath = resumeTarget?.worktreePath || (resumeTarget
      ? await this.workspaceManager.resolveResumeWorktreePath(input.repoPath, resumeTarget.sessionId, workflowSettings.executionMode)
      : undefined);
    
    const title = `Sprint ${input.sprintNumber}: ${buildTaskRunTag(input.repoPath, input.sprintNumber, input.task.id)} [${input.task.id}] ${input.task.title}`;

    const session = this.deps.sessionTracking.createSession({
      id: sessionId,
      provider: input.provider,
      taskId: taskRunKey,
      title,
      prompt: input.task.prompt,
      state: "RUNNING",
      featureBranch: input.featureBranch,
      workerBranch,
      repoPath: input.repoPath,
    });

    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: `Started ${input.provider} background workflow on branch ${workerBranch}.`,
    });

    if (resumeTarget) {
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: resumeWorktreePath
          ? `Retry configured to resume workspace from ${resumeTarget.sessionId} at ${resumeWorktreePath}.`
          : `Retry configured to resume workspace from ${resumeTarget.sessionId}.`,
      });
    }

    void this.runTaskWorkflow({
      ...input,
      sessionId,
      taskRunId: input.taskRunId,
      workerBranch,
      title,
      providerSettingsOverride: input.providerSettingsOverride,
      resumeFromFailedSessionId: resumeTarget?.sessionId,
      resumeWorktreePath,
    });

    return session;
  }

  private async runTaskWorkflow(args: StartCliTaskInput & {
    sessionId: string;
    dispatchId?: string;
    taskRunId?: string;
    workerBranch: string;
    title: string;
    providerSettingsOverride?: StartCliTaskInput["providerSettingsOverride"];
    resumeFromFailedSessionId?: string;
    resumeWorktreePath?: string;
  }): Promise<void> {
    const abortController = new AbortController();
    const workspaceSessionId = args.resumeFromFailedSessionId || args.sessionId;
    const settings = this.deps.getDashboardSettings(args.settingsScope);
    const workflowSettings = this.resolveWorkflowSettings(settings);
    
    const worktreePath = args.resumeWorktreePath || this.workspaceManager.buildWorktreePath(args.repoPath, workspaceSessionId, workflowSettings.executionMode);
    const qaSettings = settings.agents?.qualityAssurance;
    const preserveSuccessfulWorktree = qaSettings?.enabled === true
      && (qaSettings.taskCompletion.enabled || qaSettings.completedTaskWithoutPr.enabled);
    const preserveSuccessfulWorktreeForActiveSprint = this.shouldPreserveSuccessfulWorkspaceForActiveSprint({
      taskRunId: args.taskRunId,
      sessionId: args.sessionId,
    });

    // Resolve worker agent preset for per-agent memory tagging
    const manualAgentPresetId = settings.agents?.routing?.taskCoding?.mode === "MANUAL"
      ? settings.agents.routing.taskCoding.agentPresetId
      : null;
    const workerAgent = args.settingsScope?.projectId
      ? await this.deps.agentPresetSyncService.resolveTargetedCodingAgent(
        args.settingsScope.projectId,
        args.agentPresetId || manualAgentPresetId,
      ).catch((err) => {
        this.deps.logger?.warn("Failed to resolve targeted coding agent template", { repoPath: args.repoPath, error: err instanceof Error ? err.message : String(err) });
        return null;
      })
      : await this.deps.agentPresetSyncService.getOptionalWorkerAgentForRepoPath(args.repoPath).catch((err) => {
        this.deps.logger?.warn("Failed to resolve optional worker agent template", { repoPath: args.repoPath, error: err instanceof Error ? err.message : String(err) });
        return null;
      });
    const effectiveWorkflowSettings = this.applyAgentWorkflowSettings(workflowSettings, workerAgent);
    const taskRun = args.taskRunId && this.deps.executionRepository
      ? this.deps.executionRepository.getTaskRun(args.taskRunId)
      : null;
    const canPersistExecutionInvocation = Boolean(
      taskRun
      && this.deps.executionRepository
      && typeof this.deps.executionRepository.createExecutionInvocation === "function",
    );
    const invocationModel = canPersistExecutionInvocation
      ? (() => {
        const resolvedProvider = resolveProviderForInvocation(settings, {
          invocation: "task_coding",
          task: args.task,
        });
        const resolvedProviderSettings = resolvedProvider.providers[args.provider];
        const providerSettings = args.providerSettingsOverride
          || buildProviderSettingsOverride(resolvedProviderSettings.model, resolvedProviderSettings);
        return resolveEffectiveModel({
          provider: args.provider,
          model: providerSettings.model,
          providerMountAuth: providerSettings.providerMountAuth,
          customModel: providerSettings.customModel,
          qwenAuthMode: providerSettings.qwenAuthMode,
          qwenModelId: providerSettings.qwenModelId,
          openCodeAuthMode: providerSettings.openCodeAuthMode,
          openCodeProviderId: providerSettings.openCodeProviderId,
          openCodeModelId: providerSettings.openCodeModelId,
        });
      })()
      : null;

    const ctx: PipelineContext = {
      ...args,
      settings,
      workflowSettings: effectiveWorkflowSettings,
      worktreePath,
      workspaceSessionId,
      allowExistingWorkerBranch: Boolean(args.resumeFromFailedSessionId),
      requireProviderSessionResume: args.requireProviderSessionResume,
      abortSignal: abortController.signal,
      initialHead: "",
      workflowSucceeded: false,
      preserveSuccessfulWorktree,
      preserveSuccessfulWorktreeForActiveSprint,
      preserveWorkspaceForClarification: false,
      agentPresetId: workerAgent?.id,
      agentMemoryConfig: workerAgent?.memoryConfig,
      agentMcpAccess: workerAgent ? workerClarificationAgentMcpAccess(workerAgent.mcpAccess) : undefined,
      taskClarificationContext: {
        projectId: taskRun?.projectId || args.settingsScope?.projectId,
        sprintId: taskRun?.sprintId || args.settingsScope?.sprintId,
        taskId: taskRun?.taskId || args.taskRecordId || args.task.record_id || args.task.id,
        sprintRunId: taskRun?.sprintRunId,
        dispatchId: taskRun?.dispatchId || args.dispatchId,
        taskRunId: taskRun?.id || args.taskRunId,
        sessionId: args.sessionId,
      },
      memoryTemplateOverrideEnabled: workerAgent?.memoryTemplateOverrideEnabled,
      memoryTemplateMarkdown: workerAgent?.memoryTemplateMarkdown,
      workspaceManager: this.workspaceManager,
      invocationWorkspacePreparer: this.invocationWorkspacePreparer,
      workspaceArtifactService: this.workspaceArtifactService,
      prService: this.prService,
      providerRunner: this.providerRunner,
      providerSettingsOverride: args.providerSettingsOverride,
      deps: {
        ...this.deps,
        getWorkerInstruction: async (repoPath: string) => (
          workerAgent?.instructionMarkdown?.trim()
          || (await this.deps.agentPresetSyncService.getOptionalWorkerAgentForRepoPath(repoPath).catch((err) => {
            this.deps.logger?.warn("Failed to resolve optional worker agent template", { repoPath, error: err instanceof Error ? err.message : String(err) });
            return null;
          }))
            ?.instructionMarkdown?.trim()
          || ""
        ),
      },
      runCommand: (command, commandArgs, cwd, env = process.env) =>
        this.runCommand(command, commandArgs, cwd, env, abortController.signal),
    };
    const unregisterDispatch = args.dispatchId
      ? this.deps.activeDispatchRegistry?.register({
        dispatchId: args.dispatchId,
        taskRunId: args.taskRunId,
        sessionId: args.sessionId,
        executorType: "docker_cli",
        requestStop: async (reason: string) => {
          if (!abortController.signal.aborted) {
            this.deps.sessionTracking.appendActivity(args.sessionId, {
              originator: "system",
              description: `Dashboard requested workflow cancellation: ${reason}`,
            });
            abortController.abort(reason);
          }
          return { accepted: true };
        },
      })
      : undefined;
    let releaseWorkspaceHelperReservation = (): void => undefined;

    let preserveWorkspaceForShutdown = false;
    try {
      releaseWorkspaceHelperReservation = this.workspaceManager.reserveWorkspaceHelper(
        ctx.worktreePath,
      );
      if (taskRun && invocationModel && this.deps.executionRepository) {
        const invocation = this.deps.executionRepository.createExecutionInvocation({
          projectId: taskRun.projectId,
          sprintId: taskRun.sprintId,
          taskId: taskRun.taskId,
          sprintRunId: taskRun.sprintRunId,
          dispatchId: taskRun.dispatchId || args.dispatchId || null,
          taskRunId: taskRun.id,
          type: "cli_task_coding",
          status: "running",
          provider: args.provider,
          model: invocationModel,
          invocationSource: "internal",
          agentPresetId: workerAgent?.id,
        });
        ctx.executionInvocationId = invocation.id;
        this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
          role: "system",
          contentMarkdown: `Preparing the task workspace and ${args.provider} configuration.`,
          metadata: {
            kind: "preparation_started",
            provider: args.provider,
            model: invocationModel,
          },
        });
      }

      this.appendExecutionEvent(args, "cli_workspace_bound", {
        provider: args.provider,
        repoPath: args.repoPath,
        worktreePath: ctx.worktreePath,
        workspaceSessionId: ctx.workspaceSessionId,
        executionMode: ctx.workflowSettings.executionMode,
      }, `cli:workspace:bound:${ctx.workspaceSessionId}:${ctx.worktreePath}`);
      this.appendExecutionEvent(args, "cli_prepare_started", {
        provider: args.provider,
        workerBranch: args.workerBranch,
        featureBranch: args.featureBranch,
      }, "cli:prepare:started");
      const { providerPrompt, resumed } = await executePrepareStage(ctx, args.resumeFromFailedSessionId);
      this.appendExecutionEvent(args, "cli_prepare_completed", {
        provider: args.provider,
        worktreePath: ctx.worktreePath,
        resumedFromFailedSessionId: args.resumeFromFailedSessionId || null,
      }, `cli:prepare:completed:${ctx.worktreePath}`);

      const recoveredProviderInvocation = resumed
        ? this.resolveProviderCompletionRecovery(ctx)
        : null;
      let providerOutcome: TaskExecutionOutcome = { kind: "unknown", blocker: null };
      if (recoveredProviderInvocation) {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: "Recovered completed provider work after restart; continuing with Git finalization without invoking the coding agent again.",
        });
        this.appendExecutionEvent(args, "cli_provider_completion_recovered", {
          provider: args.provider,
          worktreePath: ctx.worktreePath,
          recoveredProviderInvocationId: recoveredProviderInvocation.id,
          recoveredTaskRunId: recoveredProviderInvocation.taskRunId,
        }, `cli:provider:completion-recovered:${recoveredProviderInvocation.id}`);
      } else {
        this.appendExecutionEvent(args, "cli_provider_started", {
          provider: args.provider,
          worktreePath: ctx.worktreePath,
        }, `cli:provider:started:${ctx.worktreePath}`);
        const providerResult = await executeProviderStage(ctx, providerPrompt);
        providerOutcome = parseTaskExecutionOutcomeFromProviderOutput({
          conversation: providerResult.usageTelemetry.conversation,
          text: providerResult.text,
          stdout: providerResult.stdout,
          stderr: providerResult.stderr,
        });
        this.appendExecutionEvent(args, "cli_provider_completed", {
          provider: args.provider,
          worktreePath: ctx.worktreePath,
        }, `cli:provider:completed:${ctx.worktreePath}`);

        this.appendExecutionEvent(args, "cli_memory_capture_started", {
          provider: args.provider,
        }, `cli:memory:capture:started:${args.sessionId}`);
        const { memoriesCaptured } = await executeMemoryCaptureStage(ctx);
        this.appendExecutionEvent(args, "cli_memory_capture_completed", {
          provider: args.provider,
          memoriesCaptured,
        }, `cli:memory:capture:completed:${args.sessionId}`);
        if (memoriesCaptured > 0) {
          this.appendExecutionEvent(args, "cli_memory_captured", {
            provider: args.provider,
            memoriesCaptured,
          }, `cli:memory:captured:${args.sessionId}`);
        }
      }

      const currentTaskRun = this.resolveTaskRun(args);
      const pendingClarification = currentTaskRun
        ? this.deps.workerClarificationService?.findPendingForTaskRun(
            currentTaskRun.projectId,
            currentTaskRun.id,
          )
        : null;
      if (pendingClarification) {
        this.parkWorkflowForClarification(
          ctx,
          args,
          pendingClarification,
          "worker_clarification_requested",
          "Coding agent requested project-manager clarification before continuing.",
        );
        return;
      }

      this.appendExecutionEvent(args, "cli_git_finalize_started", {
        provider: args.provider,
        worktreePath: ctx.worktreePath,
      }, `cli:git:finalize:started:${ctx.worktreePath}`);
      const { hasChanges, committedChanges, pushedBranch, stats } = await executeGitFinalizeStage(ctx);

      if (!hasChanges) {
        const finishedAt = new Date().toISOString();
        if (providerOutcome.kind !== "completed") {
          const blocker = providerOutcome.kind === "blocked"
            ? providerOutcome.blocker
            : "Coding agent produced no repository changes and did not confirm a completed outcome.";
          const category = providerOutcome.kind === "blocked"
            ? "agent_reported_blocker"
            : "agent_outcome_missing";
          const taskRun = this.resolveTaskRun(args);
          const existingClarification = taskRun
            ? this.deps.workerClarificationService?.findPendingForTaskRun(taskRun.projectId, taskRun.id)
            : null;
          const clarification = existingClarification ?? (
            taskRun && this.deps.workerClarificationService
              ? this.deps.workerClarificationService.create({
                projectId: taskRun.projectId,
                sprintId: taskRun.sprintId,
                sprintRunId: taskRun.sprintRunId,
                taskId: taskRun.taskId,
                dispatchId: taskRun.dispatchId,
                taskRunId: taskRun.id,
                sessionId: taskRun.sessionId || args.sessionId,
                executionInvocationId: ctx.executionInvocationId,
                requesterAgentId: ctx.agentPresetId || "coding-agent",
                deduplicationKey: `coding-outcome:${ctx.executionInvocationId || taskRun.id}`,
                questionMarkdown: [
                  "The coding agent ended its turn without repository changes and reported that it could not continue.",
                  "",
                  `Reported blocker: ${blocker}`,
                  "",
                  "Decide how the task should proceed. Give the coding agent concrete instructions so it can continue in the preserved provider session and workspace. If no file change is actually required, tell it to confirm that explicitly so the normal no-change QA path can verify the task.",
                ].join("\n"),
              })
              : null
          );
          if (!clarification) {
            throw new Error("Coding turn requires clarification, but no durable clarification service is available.");
          }
          this.parkWorkflowForClarification(ctx, args, clarification, category, blocker, finishedAt);
          return;
        }
        this.appendExecutionEvent(args, "cli_git_no_changes", {
          provider: args.provider,
          worktreePath: ctx.worktreePath,
        }, `cli:git:no-changes:${ctx.worktreePath}`);
        this.updateExecutionState(args, {
          state: "COMPLETED",
          finishedAt,
          dispatchStatus: "completed",
          // The task produced nothing to merge — do not record a phantom worker
          // branch, otherwise the orchestrator treats it as merge evidence and
          // falsely advances/merges the task.
          workerBranch: null,
        }, ctx.executionInvocationId);
        this.appendExecutionEvent(args, "cli_workflow_completed", {
          provider: args.provider,
          outcome: "no_changes",
        }, "cli:workflow:completed:no-changes");
        this.finalizeExecutionInvocation(ctx.executionInvocationId, "completed", finishedAt);
        return;
      }

      const eventKey = `cli:git:pushed:${pushedBranch || args.workerBranch}`;
      this.appendExecutionEvent(args, "cli_git_pushed", {
        provider: args.provider,
        committedChanges,
        pushedBranch: pushedBranch || args.workerBranch,
        // In LOCAL mode the worker branch is committed locally and never pushed to a
        // remote — surface that so the activity feed doesn't claim a phantom origin push.
        pushedToRemote: ctx.settings.git?.githubMode !== "LOCAL",
        ...(stats || {}),
        sourceEventKey: eventKey,
      }, eventKey);

      const finishedAt = new Date().toISOString();
      this.updateExecutionState(args, {
        state: "COMPLETED",
        finishedAt,
        workerBranch: args.workerBranch,
        dispatchStatus: "completed",
      }, ctx.executionInvocationId);

      const { prUrl } = await executePrFinalizeStage(ctx, { completionTimestamp: finishedAt });
      this.updateExecutionState(args, {
        state: "COMPLETED",
        finishedAt,
        prUrl,
        workerBranch: args.workerBranch,
        dispatchStatus: "completed",
      }, ctx.executionInvocationId);
      this.appendExecutionEvent(args, "cli_pr_finalized", {
        provider: args.provider,
        prUrl: prUrl || null,
        workerBranch: args.workerBranch,
      }, `cli:pr-finalized:${args.workerBranch}`);
      this.appendExecutionEvent(args, "cli_workflow_completed", {
        provider: args.provider,
        outcome: "pushed",
        prUrl: prUrl || null,
      }, `cli:workflow:completed:${prUrl || "none"}`);
      this.finalizeExecutionInvocation(ctx.executionInvocationId, "completed", finishedAt);

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finishedAt = new Date().toISOString();
      const wasShutdownAbort = isRuntimeShutdownInProgress()
        || (abortController.signal.aborted && abortController.signal.reason === SERVER_SHUTDOWN_STOP_REASON);
      if (wasShutdownAbort) {
        preserveWorkspaceForShutdown = true;
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: "Workflow interrupted by Code UX shutdown. Startup recovery will reconcile the preserved workspace.",
        });
        this.appendExecutionEvent(args, "cli_workflow_shutdown_interrupted", {
          provider: args.provider,
          sessionId: args.sessionId,
          workspaceSessionId: ctx.workspaceSessionId,
        }, `cli:shutdown-interrupted:${args.sessionId}`);
        this.deps.logger?.info("CLI workflow interrupted by Code UX shutdown", {
          sessionId: args.sessionId,
          dispatchId: args.dispatchId ?? null,
          taskRunId: args.taskRunId ?? null,
        });
        return;
      }
      if (abortController.signal.aborted || message.toLowerCase().includes("aborted")) {
        this.deps.sessionTracking.updateSession(args.sessionId, { state: "CANCELLED" });
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: "Workflow cancelled by dashboard control.",
        });
        this.updateExecutionState(args, {
          state: "FAILED",
          finishedAt,
          dispatchStatus: "cancelled",
          errorMessage: "Workflow cancelled by dashboard control.",
        }, ctx.executionInvocationId);
        this.appendExecutionEvent(args, "cli_workflow_cancel_requested", {
          provider: args.provider,
          sessionId: args.sessionId,
        }, `cli:cancel-requested:${args.sessionId}`);
        this.appendExecutionEvent(args, "cli_workflow_cancelled", {
          provider: args.provider,
          reason: abortController.signal.reason || "dashboard_cancel",
        }, `cli:cancelled:${args.sessionId}`);
      } else if (error instanceof ProviderQuotaError && error.category === "RATE_LIMITED") {
        this.deps.sessionTracking.updateSession(args.sessionId, { state: "RATE_LIMITED" });
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: `Provider rate limit: ${message}`,
        });
        this.updateExecutionState(args, {
          state: workflowSettings.retryOnRateLimit ? "QUOTA" : "FAILED",
          finishedAt,
          dispatchStatus: workflowSettings.retryOnRateLimit ? "quota" : "failed",
          errorMessage: message,
        }, ctx.executionInvocationId);
        this.appendExecutionEvent(args, "cli_workflow_rate_limited", {
          provider: args.provider,
          errorMessage: message,
          category: error.category,
          retryAfterIso: error.retryAfterIso,
        });
        this.deps.logger?.warn("CLI workflow hit provider rate limit", {
          sessionId: args.sessionId,
          provider: args.provider,
          category: error.category,
          retryAfterIso: error.retryAfterIso,
          message,
        });
      } else if (error instanceof ProviderQuotaError && error.category === "QUOTA_EXHAUSTED") {
        this.deps.sessionTracking.updateSession(args.sessionId, { state: "QUOTA" });
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: `Provider quota: ${message}`,
        });
        this.updateExecutionState(args, {
          state: "QUOTA",
          finishedAt,
          dispatchStatus: "quota",
          errorMessage: message,
        }, ctx.executionInvocationId);
        this.appendExecutionEvent(args, "cli_workflow_quota", {
          provider: args.provider,
          errorMessage: message,
          category: error.category,
          retryAfterIso: error.retryAfterIso,
        });
        this.deps.logger?.warn("CLI workflow hit provider quota", {
          sessionId: args.sessionId,
          provider: args.provider,
          category: error.category,
          retryAfterIso: error.retryAfterIso,
          message,
        });
      } else if (error instanceof ProviderQuotaError && (error.category === "AUTH_FAILURE" || error.category === "PROVIDER_NOT_FOUND")) {
        this.deps.sessionTracking.updateSession(args.sessionId, { state: "FAILED" });
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: `Provider error: ${message}`,
        });
        this.updateExecutionState(args, {
          state: "FAILED",
          finishedAt,
          dispatchStatus: "failed",
          errorMessage: message,
        }, ctx.executionInvocationId);
        this.appendExecutionEvent(args, "cli_workflow_failed", {
          provider: args.provider,
          errorMessage: message,
          category: error.category,
        });
        this.deps.logger?.error("CLI workflow failed due to provider error", {
          sessionId: args.sessionId,
          provider: args.provider,
          category: error.category,
          message,
        });
      } else if (isNonRecoverableGitWorkflowError(message) || isNonRecoverableExecutionEnvironmentError(message)) {
        const taskRun = this.resolveTaskRun(args);
        const category = isNonRecoverableGitWorkflowError(message)
          ? "git_configuration"
          : "execution_environment";
        const attention = taskRun && this.deps.projectAttentionService
          ? this.deps.projectAttentionService.openItem({
            projectId: taskRun.projectId,
            sprintId: taskRun.sprintId,
            sprintRunId: taskRun.sprintRunId,
            taskId: taskRun.taskId,
            dispatchId: taskRun.dispatchId,
            attentionType: "manual_attention",
            severity: "critical",
            ownerType: "human",
            title: "Coding runtime configuration requires attention",
            summaryMarkdown: message,
            deduplicationKey: `cli-runtime:${taskRun.id}:${category}`,
            refreshOnDuplicate: false,
            payload: {
              category,
              taskRunId: taskRun.id,
              executionInvocationId: ctx.executionInvocationId ?? null,
              provider: args.provider,
              errorMessage: message,
            },
          })
          : null;
        this.deps.sessionTracking.updateSession(args.sessionId, { state: "FAILED" });
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: `Workflow blocked by unrecoverable execution environment error: ${message}`,
        });
        this.updateExecutionState(args, {
          state: "BLOCKED",
          finishedAt,
          dispatchStatus: "blocked",
          errorMessage: message,
        }, ctx.executionInvocationId);
        this.appendExecutionEvent(args, "cli_workflow_blocked", {
          provider: args.provider,
          category,
          errorMessage: message,
          attentionItemId: attention?.id ?? null,
        });
        this.deps.logger?.error("CLI workflow blocked by unrecoverable execution environment error", {
          sessionId: args.sessionId,
          provider: args.provider,
          message,
        });
      } else {
        this.deps.sessionTracking.updateSession(args.sessionId, { state: "FAILED" });
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: `Workflow failed: ${message}`,
        });
        this.updateExecutionState(args, {
          state: "FAILED",
          finishedAt,
          dispatchStatus: "failed",
          errorMessage: message,
        }, ctx.executionInvocationId);
        this.appendExecutionEvent(args, "cli_workflow_failed", {
          provider: args.provider,
          errorMessage: message,
        });
        this.deps.logger?.error("CLI workflow failed", {
          sessionId: args.sessionId,
          provider: args.provider,
          message,
        });
      }
      const invocationStatus = abortController.signal.aborted ? "cancelled" : "failed";
      this.finalizeExecutionInvocation(
        ctx.executionInvocationId,
        invocationStatus,
        finishedAt,
        invocationStatus === "cancelled" ? "Workflow cancelled by dashboard control." : message,
      );
    } finally {
      try {
        const cleanupResult = preserveWorkspaceForShutdown
          ? { cleanedUp: false }
          : await executeCleanupStage(ctx);
        if (preserveWorkspaceForShutdown) {
          this.deps.sessionTracking.appendActivity(args.sessionId, {
            originator: "system",
            description: `Preserving worktree for shutdown recovery: ${ctx.worktreePath}`,
          });
        }
        this.appendExecutionEvent(args, cleanupResult.cleanedUp ? "cli_worktree_cleaned" : "cli_worktree_preserved", {
          provider: args.provider,
          worktreePath: ctx.worktreePath,
        }, `cli:cleanup:${cleanupResult.cleanedUp ? "cleaned" : "preserved"}:${ctx.worktreePath}`);
      } finally {
        releaseWorkspaceHelperReservation();
        unregisterDispatch?.();
        const taskRun = this.resolveTaskRun(args);
        if (taskRun?.sprintRunId) {
          if (!this.deps.sprintRunLifecycleService) {
            throw new Error("Sprint run lifecycle service is required to finalize sprint cancellation.");
          }
          this.deps.sprintRunLifecycleService.finalizeCancellationIfIdle(taskRun.sprintRunId);
        }
      }
    }
  }

  private resolveWorkflowSettings(settings: DashboardSettings): CliWorkflowSettings {
    const merged: CliWorkflowSettings = { ...DEFAULT_CLI_WORKFLOW_SETTINGS, ...(settings.cliWorkflow || {}) };
    merged.containerImageMode = merged.containerImageMode === "custom" ? "custom" : "managed";
    merged.containerImage = merged.containerImage.trim() || DEFAULT_CLI_WORKFLOW_SETTINGS.containerImage;
    return merged;
  }

  /**
   * A runtime can stop after the provider has durably completed but before the
   * workflow commits and records the task as code-complete. Startup recovery
   * marks that precise crash window on the old task run. When its preserved
   * workspace is resumed, continue at Git finalization instead of paying for
   * and applying a second coding invocation.
   */
  private resolveProviderCompletionRecovery(ctx: PipelineContext) {
    const repository = this.deps.executionRepository;
    if (!repository || ctx.workspaceSessionId === ctx.sessionId || !ctx.taskRunId) {
      return null;
    }

    const currentTaskRun = repository.getTaskRun(ctx.taskRunId);
    if (!currentTaskRun) {
      return null;
    }

    // A retry session can keep resuming the original workspace session while
    // the provider-completed crash belongs to a newer task run/session. Search
    // by durable task identity, then require the newest completed provider to
    // carry the precise startup-recovery marker for this same workspace.
    const [providerInvocation] = repository
      .listProviderInvocationsForTask(currentTaskRun.projectId, currentTaskRun.taskId)
      .filter((invocation) => (
        invocation.purpose === "task_coding"
        && invocation.status === "completed"
        && invocation.taskRunId
        && invocation.taskRunId !== currentTaskRun.id
      ))
      .sort((left, right) => Date.parse(right.finishedAt || right.updatedAt) - Date.parse(left.finishedAt || left.updatedAt));
    if (!providerInvocation?.taskRunId) {
      return null;
    }

    const events = repository.listTaskRunEvents(providerInvocation.taskRunId, 200, {
      eventTypes: ["task_dispatch_reconciled", "cli_workspace_bound", "cli_workflow_completed"],
      skipValidation: true,
    });
    const recoveredCompletedProvider = events.some((event) => (
      event.eventType === "task_dispatch_reconciled"
      && (
        event.payload?.reason === "terminal_provider_active_dispatch_mismatch"
        || event.payload?.reason === "shutdown_interrupted_after_provider_completion"
      )
      && event.payload?.providerStatus === "completed"
    ));
    const sameWorkspace = events.some((event) => (
      event.eventType === "cli_workspace_bound"
      && (
        event.payload?.worktreePath === ctx.worktreePath
        || event.payload?.workspaceSessionId === ctx.workspaceSessionId
      )
    ));
    const workflowAlreadyCompleted = events.some((event) => event.eventType === "cli_workflow_completed");

    return recoveredCompletedProvider && sameWorkspace && !workflowAlreadyCompleted
      ? providerInvocation
      : null;
  }

  private applyAgentWorkflowSettings(
    workflowSettings: CliWorkflowSettings,
    workerAgent: Pick<AgentPresetRecord, "containerRunAsRoot"> | null,
  ): CliWorkflowSettings {
    if (typeof workerAgent?.containerRunAsRoot !== "boolean") {
      return { ...workflowSettings };
    }
    return {
      ...workflowSettings,
      containerRunAsRoot: workerAgent.containerRunAsRoot,
    };
  }

  private async runCommand(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv = process.env,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    if (cwd.startsWith("docker-volume://")) {
      return await this.workspaceManager.runWorkspaceCommand(cwd, command, args, { env, signal });
    }
    return await runCommandStrict(command, args, cwd, env, { signal });
  }

  private appendExecutionEvent(
    args: { taskRunId?: string; sessionId: string },
    eventType: string,
    payload: Record<string, unknown>,
    sourceEventKey?: string,
  ): void {
    const taskRun = this.resolveTaskRun(args);
    if (!taskRun) {
      return;
    }

    this.deps.executionRepository?.appendTaskRunEvent(taskRun.id, eventType, "system", payload, {
      sourceEventKey,
    });
  }

  private updateExecutionState(
    args: { taskRunId?: string; sessionId: string; workerBranch: string },
    input: {
      state: "COMPLETED" | "FAILED" | "QUOTA" | "BLOCKED";
      finishedAt: string;
      prUrl?: string;
      /** `null` explicitly clears the worker branch (e.g. no-changes runs). */
      workerBranch?: string | null;
      dispatchStatus: NonNullable<UpdateTaskDispatchInput["status"]>;
      errorMessage?: string;
    },
    executionInvocationId?: string,
  ): void {
    const taskRun = this.resolveTaskRun(args);
    if (!taskRun || !this.deps.executionRepository) {
      return;
    }

    // Cancellation is persisted before the active provider/workflow has
    // necessarily observed its abort signal. Ignore a late pipeline update so
    // the cancelled task and dispatch cannot drift back to another state.
    if (
      executionInvocationId
      && this.deps.executionRepository.getExecutionInvocation(executionInvocationId)?.status === "cancelled"
    ) {
      return;
    }

    if (this.isSprintRunCancelled(taskRun.sprintRunId)) {
      this.markTaskRunCancelledBySprintStop(taskRun, input.finishedAt, input.errorMessage ?? "Sprint run was cancelled.");
      return;
    }

    const taskRunUpdate: UpdateTaskRunInput = {
      state: input.state,
      finishedAt: input.finishedAt,
      durationMs: taskRun.startedAt
        ? Math.max(0, new Date(input.finishedAt).getTime() - new Date(taskRun.startedAt).getTime())
        : null,
      prUrl: input.prUrl === undefined ? taskRun.prUrl : input.prUrl,
      workerBranch: input.workerBranch === undefined ? taskRun.workerBranch || args.workerBranch : input.workerBranch,
    };
    this.deps.executionRepository.updateTaskRun(taskRun.id, taskRunUpdate);
    this.deps.projectManagementRepository?.updateTask(taskRun.taskId, {
      status: input.state === "COMPLETED"
        ? "coding_completed"
        : input.state === "QUOTA" || input.state === "BLOCKED"
          ? "in_progress"
          : "pending",
    });

    if (taskRun.dispatchId) {
      this.deps.executionRepository.updateTaskDispatch(taskRun.dispatchId, {
        status: input.dispatchStatus,
        finishedAt: input.finishedAt,
        lastHeartbeatAt: input.finishedAt,
        errorMessage: input.errorMessage ?? null,
      });
    }
  }

  private parkWorkflowForClarification(
    ctx: PipelineContext,
    args: {
      taskRunId?: string;
      sessionId: string;
      workerBranch: string;
      provider: string;
    },
    clarification: WorkerClarificationRecord,
    category: "worker_clarification_requested" | "agent_reported_blocker" | "agent_outcome_missing",
    message: string,
    finishedAt = new Date().toISOString(),
  ): void {
    // A provider can ask after making partial edits. Stop before Git finalization
    // and pin the workspace so neither cleanup nor a phantom no-change
    // projection can discard the exact continuation state.
    ctx.preserveWorkspaceForClarification = true;
    this.deps.sessionTracking.updateSession(args.sessionId, { state: "BLOCKED" });
    this.deps.sessionTracking.appendActivity(args.sessionId, {
      originator: "system",
      description: `Coding workflow requires clarification: ${message}`,
    });
    this.updateExecutionState(args, {
      state: "BLOCKED",
      finishedAt,
      dispatchStatus: "blocked",
      errorMessage: message,
      workerBranch: args.workerBranch,
    }, ctx.executionInvocationId);
    this.appendExecutionEvent(args, "cli_workflow_blocked", {
      provider: args.provider,
      category,
      errorMessage: message,
      clarificationId: clarification.id,
      attentionItemId: clarification.id,
    }, `cli:workflow:blocked:clarification:${clarification.id}`);
    this.finalizeExecutionInvocation(
      ctx.executionInvocationId,
      "completed",
      finishedAt,
      `Coding turn ended while clarification ${clarification.id} awaits a project-manager decision.`,
    );
  }

  private finalizeExecutionInvocation(
    invocationId: string | undefined,
    status: "completed" | "failed" | "cancelled",
    finishedAt: string,
    errorMessage?: string,
  ): void {
    if (!invocationId || !this.deps.executionRepository) {
      return;
    }
    const invocation = this.deps.executionRepository.getExecutionInvocation(invocationId);
    if (!invocation || (invocation.status !== "running" && invocation.status !== "paused")) {
      return;
    }
    this.deps.executionRepository.updateExecutionInvocation(invocationId, {
      status,
      finishedAt,
      errorMessage: status === "completed" ? null : errorMessage ?? null,
      lastErrorCategory: status === "failed" ? invocation.lastErrorCategory ?? "UNKNOWN" : null,
      lastErrorMessage: status === "completed" ? null : errorMessage ?? null,
      lastRetryAfterIso: null,
    });
    this.deps.executionRepository.appendExecutionInvocationMessage(invocationId, {
      role: "system",
      contentMarkdown: status === "completed"
        ? errorMessage || "CLI workflow completed successfully."
        : status === "cancelled"
          ? `CLI workflow cancelled${errorMessage ? `: ${errorMessage}` : "."}`
          : `CLI workflow failed${errorMessage ? `: ${errorMessage}` : "."}`,
      metadata: {
        kind: "cli_workflow_finalized",
        status,
      },
      createdAt: finishedAt,
    });
  }

  private isSprintRunCancelled(sprintRunId?: string | null): boolean {
    if (!sprintRunId || !this.deps.executionRepository) {
      return false;
    }
    const sprintRun = this.deps.executionRepository.getSprintRun(sprintRunId);
    return sprintRun?.status === "cancelled" || sprintRun?.status === "cancel_requested";
  }

  private markTaskRunCancelledBySprintStop(taskRun: TaskRunRecord, finishedAt: string, message: string): void {
    if (!this.deps.executionRepository) {
      return;
    }

    this.deps.executionRepository.updateTaskRun(taskRun.id, {
      connectionId: null,
      state: "BLOCKED",
      finishedAt,
      durationMs: taskRun.startedAt
        ? Math.max(0, new Date(finishedAt).getTime() - new Date(taskRun.startedAt).getTime())
        : null,
    });
    this.deps.projectManagementRepository?.updateTask(taskRun.taskId, {
      status: "pending",
    });

    if (taskRun.dispatchId) {
      this.deps.executionRepository.releaseLease("task_dispatch", taskRun.dispatchId);
      this.deps.executionRepository.updateTaskDispatch(taskRun.dispatchId, {
        connectionId: null,
        status: "cancelled",
        finishedAt,
        lastHeartbeatAt: finishedAt,
        errorMessage: message,
      });
    }
  }

  private resolveTaskRun(args: { taskRunId?: string; sessionId: string }) {
    if (args.taskRunId) {
      return this.deps.executionRepository?.getTaskRun(args.taskRunId) || null;
    }
    return this.deps.executionRepository?.getLatestTaskRunBySessionId(args.sessionId) || null;
  }

  // Restored for tests
  private async hasUnpushedWorkerBranchCommits(worktreePath: string, workerBranch: string, featureBranch: string): Promise<boolean> {
    return this.prService.hasUnpushedCommits(worktreePath, workerBranch, featureBranch, this.runCommand.bind(this));
  }

  private async hasWorkerBranchCommitsAgainstFeature(worktreePath: string, featureBranch: string, workerBranch: string): Promise<boolean> {
    return this.prService.hasWorkerBranchCommitsAgainstFeature(worktreePath, workerBranch, featureBranch, this.runCommand.bind(this));
  }

  private shouldPreserveSuccessfulWorkspaceForActiveSprint(args: {
    taskRunId?: string;
    sessionId: string;
  }): boolean {
    const taskRun = this.resolveTaskRun(args);
    if (!taskRun?.sprintRunId || !this.deps.executionRepository) {
      return false;
    }
    const sprintRun = this.deps.executionRepository.getSprintRun(taskRun.sprintRunId);
    if (!sprintRun) {
      return false;
    }
    return sprintRun.status !== "completed" && sprintRun.status !== "failed" && sprintRun.status !== "cancelled";
  }
}
