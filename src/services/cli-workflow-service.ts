import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import type { CliWorkflowSettings, DashboardSettings, JulesSession, ProviderId, Subtask } from "../contracts/app-types.js";
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

interface CliWorkflowServiceDependencies {
  sessionTracking: SessionTrackingRepository;
  getDashboardSettings: () => DashboardSettings;
  getGuideContent: (guideName: string, repoPath?: string) => Promise<string>;
  getGithubToken: () => string | undefined;
  logger?: Logger;
}

interface StartCliTaskInput {
  provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
  task: Subtask;
  repoPath: string;
  featureBranch: string;
  sprintNumber: number;
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
    const settings = this.deps.getDashboardSettings();
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
      workerBranch,
      title,
      resumeFromFailedSessionId: resumeTarget?.sessionId,
      resumeWorktreePath,
    });

    return session;
  }

  private async runTaskWorkflow(args: StartCliTaskInput & {
    sessionId: string;
    workerBranch: string;
    title: string;
    resumeFromFailedSessionId?: string;
    resumeWorktreePath?: string;
  }): Promise<void> {
    const workspaceSessionId = args.resumeFromFailedSessionId || args.sessionId;
    const settings = this.deps.getDashboardSettings();
    const workflowSettings = this.resolveWorkflowSettings(settings);
    
    const worktreePath = args.resumeWorktreePath || this.workspaceManager.buildWorktreePath(args.repoPath, workspaceSessionId, workflowSettings.executionMode);

    const ctx: PipelineContext = {
      ...args,
      settings,
      workflowSettings,
      worktreePath,
      initialHead: "",
      workflowSucceeded: false,
      workspaceManager: this.workspaceManager,
      prService: this.prService,
      providerRunner: this.providerRunner,
      deps: this.deps,
      runCommand: this.runCommand.bind(this)
    };

    try {
      const { providerPrompt } = await executePrepareStage(ctx, args.resumeFromFailedSessionId);
      
      await executeProviderStage(ctx, providerPrompt);
      
      const { hasChanges } = await executeGitFinalizeStage(ctx);

      if (!hasChanges) {
        return;
      }
      
      await executePrFinalizeStage(ctx);

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.sessionTracking.updateSession(args.sessionId, { state: "FAILED" });
      this.deps.sessionTracking.appendActivity(args.sessionId, {
        originator: "system",
        description: `Workflow failed: ${message}`,
      });
      this.deps.logger?.error("CLI workflow failed", {
        sessionId: args.sessionId,
        provider: args.provider,
        message,
      });
    } finally {
      await executeCleanupStage(ctx);
    }
  }

  private resolveWorkflowSettings(settings: DashboardSettings): CliWorkflowSettings {
    const merged: CliWorkflowSettings = { ...DEFAULT_CLI_WORKFLOW_SETTINGS, ...(settings.cliWorkflow || {}) };
    merged.containerImage = merged.containerImage.trim() || DEFAULT_CLI_WORKFLOW_SETTINGS.containerImage;
    return merged;
  }

  private async runCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
    return await runCommandStrict(command, args, cwd, env);
  }

  // Restored for tests
  private async hasUnpushedWorkerBranchCommits(worktreePath: string, workerBranch: string, featureBranch: string): Promise<boolean> {
    return this.prService.hasUnpushedCommits(worktreePath, workerBranch, featureBranch, this.runCommand.bind(this));
  }

  private async hasWorkerBranchCommitsAgainstFeature(worktreePath: string, featureBranch: string): Promise<boolean> {
    return this.prService.hasWorkerBranchCommitsAgainstFeature(worktreePath, featureBranch, this.runCommand.bind(this));
  }
}
