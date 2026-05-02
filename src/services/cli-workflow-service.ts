import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import type {
  CliWorkflowSettings,
  DashboardSettings,
  DashboardSettingsScope,
  JulesSession,
  ProviderId,
  Subtask,
  ThinkingMode,
} from "../contracts/app-types.js";
import type { UpdateTaskDispatchInput, UpdateTaskRunInput } from "../contracts/execution-types.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import { runCommandStrict, type CommandResult } from "./cli-process-runner.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "./cli-workflow-text-utils.js";
import {
  buildProviderPrompt,
  buildWorkerBranch,
  DEFAULT_CLI_WORKFLOW_SETTINGS,
} from "./cli-workflow-utils.js";
import { buildTaskRunKey, buildTaskRunTag } from "./task-run-key.js";
import type { Logger } from "../shared/logging/logger.js";

// New Modules
import { WorkspaceManager, IWorkspaceManager } from "../infrastructure/providers/cli/workspace-manager.js";
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
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { MemoryService } from "./memory-service.js";
import { ProviderQuotaError } from "../shared/providers/provider-error-classifier.js";

interface CliWorkflowServiceDependencies {
  sessionTracking: SessionTrackingRepository;
  executionRepository?: ExecutionRepository;
  projectManagementRepository?: ProjectManagementRepository;
  activeDispatchRegistry?: ActiveDispatchRegistry;
  memoryService?: MemoryService;
  getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings;
  agentPresetSyncService: AgentPresetSyncService;
  getGithubToken: () => string | undefined;
  logger?: Logger;
}

interface StartCliTaskInput {
  provider: Exclude<ProviderId, "jules">;
  providerSettingsOverride?: {
    model: string;
    thinkingMode: ThinkingMode;
    apiKey: string;
    qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
    qwenRegion?: "china" | "international";
    qwenBaseUrl?: string;
    qwenEnvKey?: string;
    qwenProtocol?: "openai" | "anthropic" | "gemini";
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
  };
  task: Subtask;
  repoPath: string;
  featureBranch: string;
  sprintNumber: number;
  settingsScope?: DashboardSettingsScope;
  dispatchId?: string;
  taskRunId?: string;
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
  private readonly workspaceArtifactService: WorkspaceArtifactService;
  private readonly prService: IPrService;
  private readonly providerRunner: IProviderRunner;

  constructor(private readonly deps: CliWorkflowServiceDependencies) {
    this.workspaceManager = new WorkspaceManager();
    this.workspaceArtifactService = new WorkspaceArtifactService(this.workspaceManager);
    this.prService = new PrService();
    this.providerRunner = new ProviderRunner(new DockerRunner());
  }

  async startTask(input: StartCliTaskInput): Promise<JulesSession> {
    const settings = this.deps.getDashboardSettings(input.settingsScope);
    const workflowSettings = this.resolveWorkflowSettings(settings);

    const sessionId = `cli-${input.provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const taskRunKey = buildTaskRunKey(input.repoPath, input.sprintNumber, input.task.id);
    
    const resumeTarget = workflowSettings.resumeFailedTaskInSameWorkspace
      ? this.deps.sessionTracking.findLatestFailedCliSessionForTask({
        provider: input.provider,
        taskId: taskRunKey,
        featureBranch: input.featureBranch,
        repoPath: input.repoPath,
      })
      : null;

    const workerBranch = resumeTarget?.workerBranch || buildWorkerBranch(input.featureBranch, input.task.id, input.provider);
    const resumeWorktreePath = resumeTarget
      ? await this.workspaceManager.resolveResumeWorktreePath(input.repoPath, resumeTarget.sessionId, workflowSettings.executionMode)
      : undefined;
    
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
          ? `Retry configured to resume failed workspace from ${resumeTarget.sessionId} at ${resumeWorktreePath}.`
          : `Retry configured to resume failed workspace from ${resumeTarget.sessionId}.`,
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

    // Resolve worker agent preset for per-agent memory tagging
    const workerAgent = await this.deps.agentPresetSyncService.getOptionalWorkerAgentForRepoPath(args.repoPath).catch(() => null);

    const ctx: PipelineContext = {
      ...args,
      settings,
      workflowSettings,
      worktreePath,
      workspaceSessionId,
      abortSignal: abortController.signal,
      initialHead: "",
      workflowSucceeded: false,
      preserveSuccessfulWorktree,
      agentPresetId: workerAgent?.id,
      memoryTemplateOverrideEnabled: workerAgent?.memoryTemplateOverrideEnabled,
      memoryTemplateMarkdown: workerAgent?.memoryTemplateMarkdown,
      workspaceManager: this.workspaceManager,
      workspaceArtifactService: this.workspaceArtifactService,
      prService: this.prService,
      providerRunner: this.providerRunner,
      providerSettingsOverride: args.providerSettingsOverride,
      deps: {
        ...this.deps,
        getWorkerInstruction: async (repoPath: string) => (
          (await this.deps.agentPresetSyncService.getOptionalWorkerAgentForRepoPath(repoPath))
            ?.instructionMarkdown
            ?.trim() || ""
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

    try {
      this.appendExecutionEvent(args, "cli_prepare_started", {
        provider: args.provider,
        workerBranch: args.workerBranch,
        featureBranch: args.featureBranch,
      }, "cli:prepare:started");
      const { providerPrompt } = await executePrepareStage(ctx, args.resumeFromFailedSessionId);
      this.appendExecutionEvent(args, "cli_prepare_completed", {
        provider: args.provider,
        worktreePath: ctx.worktreePath,
        resumedFromFailedSessionId: args.resumeFromFailedSessionId || null,
      }, `cli:prepare:completed:${ctx.worktreePath}`);
      
      this.appendExecutionEvent(args, "cli_provider_started", {
        provider: args.provider,
        worktreePath: ctx.worktreePath,
      }, `cli:provider:started:${ctx.worktreePath}`);
      await executeProviderStage(ctx, providerPrompt);
      this.appendExecutionEvent(args, "cli_provider_completed", {
        provider: args.provider,
        worktreePath: ctx.worktreePath,
      }, `cli:provider:completed:${ctx.worktreePath}`);

      const { memoriesCaptured } = await executeMemoryCaptureStage(ctx);
      if (memoriesCaptured > 0) {
        this.appendExecutionEvent(args, "cli_memory_captured", {
          provider: args.provider,
          memoriesCaptured,
        }, `cli:memory:captured:${args.sessionId}`);
      }

      const { hasChanges, committedChanges, pushedBranch, stats } = await executeGitFinalizeStage(ctx);

      if (!hasChanges) {
        const finishedAt = new Date().toISOString();
        this.appendExecutionEvent(args, "cli_git_no_changes", {
          provider: args.provider,
          worktreePath: ctx.worktreePath,
        }, `cli:git:no-changes:${ctx.worktreePath}`);
        this.updateExecutionState(args, {
          state: "COMPLETED",
          finishedAt,
          dispatchStatus: "completed",
        });
        this.appendExecutionEvent(args, "cli_workflow_completed", {
          provider: args.provider,
          outcome: "no_changes",
        }, "cli:workflow:completed:no-changes");
        return;
      }

      const eventKey = `cli:git:pushed:${pushedBranch || args.workerBranch}`;
      this.appendExecutionEvent(args, "cli_git_pushed", {
        provider: args.provider,
        committedChanges,
        pushedBranch: pushedBranch || args.workerBranch,
        ...(stats || {}),
        sourceEventKey: eventKey,
      }, eventKey);
      
      const { prUrl } = await executePrFinalizeStage(ctx);
      const finishedAt = new Date().toISOString();
      this.updateExecutionState(args, {
        state: "COMPLETED",
        finishedAt,
        prUrl,
        workerBranch: args.workerBranch,
        dispatchStatus: "completed",
      });
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

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finishedAt = new Date().toISOString();
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
        });
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
        });
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
        });
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
        });
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
        });
        this.appendExecutionEvent(args, "cli_workflow_blocked", {
          provider: args.provider,
          category: isNonRecoverableGitWorkflowError(message) ? "git_configuration" : "execution_environment",
          errorMessage: message,
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
        });
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
    } finally {
      try {
        const cleanupResult = await executeCleanupStage(ctx);
        this.appendExecutionEvent(args, cleanupResult.cleanedUp ? "cli_worktree_cleaned" : "cli_worktree_preserved", {
          provider: args.provider,
          worktreePath: ctx.worktreePath,
        }, `cli:cleanup:${cleanupResult.cleanedUp ? "cleaned" : "preserved"}:${ctx.worktreePath}`);
      } finally {
        unregisterDispatch?.();
        const taskRun = this.resolveTaskRun(args);
        if (taskRun?.sprintRunId) {
          this.deps.executionRepository?.finalizeSprintRunCancellationIfIdle(taskRun.sprintRunId);
        }
      }
    }
  }

  private resolveWorkflowSettings(settings: DashboardSettings): CliWorkflowSettings {
    const merged: CliWorkflowSettings = { ...DEFAULT_CLI_WORKFLOW_SETTINGS, ...(settings.cliWorkflow || {}) };
    merged.containerImage = merged.containerImage.trim() || DEFAULT_CLI_WORKFLOW_SETTINGS.containerImage;
    return merged;
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
      workerBranch?: string;
      dispatchStatus: NonNullable<UpdateTaskDispatchInput["status"]>;
      errorMessage?: string;
    },
  ): void {
    const taskRun = this.resolveTaskRun(args);
    if (!taskRun || !this.deps.executionRepository) {
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
        : input.state === "QUOTA"
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
}
