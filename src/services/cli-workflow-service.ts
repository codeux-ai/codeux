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
  provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
  task: Subtask;
  repoPath: string;
  featureBranch: string;
  sprintNumber: number;
  settingsScope?: DashboardSettingsScope;
  dispatchId?: string;
  taskRunId?: string;
}

export class CliWorkflowService {
  private readonly workspaceManager: IWorkspaceManager;
  private readonly prService: IPrService;
  private readonly providerRunner: IProviderRunner;

  constructor(private readonly deps: CliWorkflowServiceDependencies) {
    this.workspaceManager = new WorkspaceManager();
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
    resumeFromFailedSessionId?: string;
    resumeWorktreePath?: string;
  }): Promise<void> {
    const abortController = new AbortController();
    const workspaceSessionId = args.resumeFromFailedSessionId || args.sessionId;
    const settings = this.deps.getDashboardSettings(args.settingsScope);
    const workflowSettings = this.resolveWorkflowSettings(settings);
    
    const worktreePath = args.resumeWorktreePath || this.workspaceManager.buildWorktreePath(args.repoPath, workspaceSessionId, workflowSettings.executionMode);

    // Resolve worker agent preset for per-agent memory tagging
    const workerAgent = await this.deps.agentPresetSyncService.getOptionalWorkerAgentForRepoPath(args.repoPath).catch(() => null);

    const ctx: PipelineContext = {
      ...args,
      settings,
      workflowSettings,
      worktreePath,
      abortSignal: abortController.signal,
      initialHead: "",
      workflowSucceeded: false,
      agentPresetId: workerAgent?.id,
      workspaceManager: this.workspaceManager,
      prService: this.prService,
      providerRunner: this.providerRunner,
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

      const { hasChanges, committedChanges, pushedBranch } = await executeGitFinalizeStage(ctx);

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

      this.appendExecutionEvent(args, "cli_git_pushed", {
        provider: args.provider,
        committedChanges,
        pushedBranch: pushedBranch || args.workerBranch,
      }, `cli:git:pushed:${pushedBranch || args.workerBranch}`);
      
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
      }, `cli:pr:${prUrl || "none"}`);
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
      } else if (error instanceof ProviderQuotaError && error.category !== "UNKNOWN") {
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
      state: "COMPLETED" | "FAILED" | "QUOTA";
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
      status: input.state === "COMPLETED" ? "coding_completed" : input.state === "FAILED" ? "pending" : "in_progress",
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

  private async hasWorkerBranchCommitsAgainstFeature(worktreePath: string, featureBranch: string): Promise<boolean> {
    return this.prService.hasWorkerBranchCommitsAgainstFeature(worktreePath, featureBranch, this.runCommand.bind(this));
  }
}
