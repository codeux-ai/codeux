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
    
    let worktreePath = args.resumeWorktreePath || this.workspaceManager.buildWorktreePath(args.repoPath, workspaceSessionId, workflowSettings.executionMode);
    let workflowSucceeded = false;

    try {
      const providerSettings = settings.aiProvider.providers[args.provider];
      let workerGuide = "";
      try { workerGuide = await this.deps.getGuideContent("worker.md", args.repoPath); } catch { /* optional */ }

      const promptBody = workerGuide
        ? `## SYSTEM INSTRUCTIONS & ENGINEERING STANDARDS\n\n${workerGuide}\n\n---\n\n## SUBTASK TO EXECUTE\n\n${args.task.prompt}`
        : args.task.prompt;

      const { worktreePath: finalPath, resumed } = await this.workspaceManager.prepareWorktree(
        args.repoPath, worktreePath, args.workerBranch, args.featureBranch, args.resumeFromFailedSessionId
      );
      worktreePath = finalPath;

      const workspaceGuidance = await this.workspaceManager.buildWorkspaceGuidance(args.task.prompt, worktreePath);
      const providerPrompt = buildProviderPrompt(`${promptBody}\n\n${workspaceGuidance}`, providerSettings.thinkingMode);
      
      const initialHead = (await this.runCommand("git", ["rev-parse", "HEAD"], worktreePath)).stdout.trim();
      
      if (resumed) {
        this.deps.sessionTracking.appendActivity(args.sessionId, { originator: "system", description: `Resumed failed workspace from ${args.resumeFromFailedSessionId}.` });
        try {
          await this.runCommand("git", ["merge", "--ff-only", `origin/${args.featureBranch}`], worktreePath);
          this.deps.sessionTracking.appendActivity(args.sessionId, { originator: "system", description: `Synced resumed workspace with latest origin/${args.featureBranch}.` });
        } catch {
          this.deps.sessionTracking.appendActivity(args.sessionId, { originator: "system", description: `Resumed workspace could not fast-forward; continuing on existing state.` });
        }
      }

      this.deps.sessionTracking.appendActivity(args.sessionId, { originator: "system", description: `Running ${args.provider} prompt on ${args.workerBranch}.` });

      const runProvider = (p: string) => this.providerRunner.runProvider({
        provider: args.provider, prompt: p, cwd: worktreePath, model: providerSettings.model,
        apiKey: providerSettings.apiKey, sessionId: args.sessionId, workflowSettings,
        repoPath: args.repoPath, githubToken: this.deps.getGithubToken(),
        onActivity: (desc, originator) => this.deps.sessionTracking.appendActivity(args.sessionId, { description: desc, originator: originator as any || "system" })
      });

      let providerResult = await runProvider(providerPrompt);
      if (!providerResult.ok && workflowSettings.retryOnReadFileNotFound && isReadFileNotFoundToolError(providerResult)) {
        this.deps.sessionTracking.appendActivity(args.sessionId, { originator: "system", description: "Retrying with file-discovery guidance." });
        providerResult = await runProvider(buildReadFileRetryPrompt(providerPrompt));
      }

      if (!providerResult.ok) throw new Error(providerResult.stderr || providerResult.stdout || `${args.provider} failed`);

      // Ensure we are on the right branch
      const currentBranch = (await this.runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], worktreePath)).stdout.trim();
      if (currentBranch !== args.workerBranch) await this.runCommand("git", ["checkout", args.workerBranch], worktreePath);

      const finalHead = (await this.runCommand("git", ["rev-parse", "HEAD"], worktreePath)).stdout.trim();
      const hasWorkingTreeChanges = (await this.runCommand("git", ["status", "--porcelain"], worktreePath)).stdout.trim().length > 0;
      const hasCommittedChanges = finalHead !== initialHead;
      const hasUnpushed = await this.prService.hasUnpushedCommits(worktreePath, args.workerBranch, args.featureBranch);
      const hasAhead = await this.prService.hasWorkerBranchCommitsAgainstFeature(worktreePath, args.featureBranch);

      if (!hasWorkingTreeChanges && !hasCommittedChanges && !hasUnpushed && !hasAhead) {
        this.deps.sessionTracking.appendActivity(args.sessionId, { originator: "system", description: `No file changes produced.` });
        this.deps.sessionTracking.updateSession(args.sessionId, { state: "COMPLETED" });
        workflowSucceeded = true;
        return;
      }

      if (hasWorkingTreeChanges) {
        await this.runCommand("git", ["add", "-A"], worktreePath);
        await this.runCommand("git", ["commit", "-m", `feat(task ${args.task.id}): implement via ${args.provider}`], worktreePath);
      }
      
      await this.runCommand("git", ["push", "-u", "origin", args.workerBranch], worktreePath);

      let prUrl: string | undefined;
      if (settings.git.autoCreatePr) {
        prUrl = await this.prService.resolveOrCreateFeaturePr({
          taskId: args.task.id, provider: args.provider, title: args.title,
          featureBranch: args.featureBranch, workerBranch: args.workerBranch
        }, worktreePath, this.deps.getGithubToken());
      }

      this.deps.sessionTracking.updateSession(args.sessionId, { state: "COMPLETED", prUrl });
      this.deps.sessionTracking.appendActivity(args.sessionId, { originator: "system", description: prUrl ? `Workflow completed. PR: ${prUrl}` : "Workflow completed." });
      workflowSucceeded = true;
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
      const shouldCleanup = workflowSucceeded ? workflowSettings.cleanupWorktreeOnSuccess : workflowSettings.cleanupWorktreeOnFailure;
      if (shouldCleanup) {
        await this.workspaceManager.removeWorktree(args.repoPath, worktreePath);
      } else {
        this.deps.sessionTracking.appendActivity(args.sessionId, { originator: "system", description: `Preserving worktree: ${worktreePath}` });
      }
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
