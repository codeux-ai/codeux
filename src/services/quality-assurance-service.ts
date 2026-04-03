import * as fs from "fs/promises";
import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS } from "./cli-workflow-utils.js";
import { extractJsonLikeBlock } from "./planning-json-extractor.js";
import { WorkspaceManager } from "../infrastructure/providers/cli/workspace-manager.js";
import { PrService } from "../infrastructure/providers/cli/pr-service.js";
import type { IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import type { DashboardSettings, DashboardSettingsScope, ProviderId, Subtask } from "../contracts/app-types.js";
import type { TaskRunRecord } from "../contracts/execution-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import { QaReviewRepository, type QaReviewTriggerType } from "../repositories/qa-review-repository.js";
import type { TaskService } from "./task-service.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { Logger } from "../shared/logging/logger.js";
import { runCommandStrict } from "./cli-process-runner.js";

type CliQaProvider = Extract<ProviderId, "gemini" | "codex" | "claude-code">;

interface QaReviewResultPayload {
  verdict?: unknown;
  summary?: unknown;
  findings?: unknown;
  fixInstructions?: unknown;
  targetTaskKey?: unknown;
  shouldHavePr?: unknown;
}

interface NormalizedQaReviewResult {
  verdict: "pass" | "changes_requested";
  summary: string;
  findings: string[];
  fixInstructions: string | null;
  targetTaskKey: string | null;
  shouldHavePr: boolean | null;
  raw: Record<string, unknown>;
}

export interface TaskQaReviewOutcome {
  reviewed: boolean;
  reopenedTask: boolean;
  reportText: string;
}

export interface SprintQaReviewOutcome {
  reviewed: boolean;
  blockedCompletion: boolean;
  reportText: string;
}

interface QualityAssuranceServiceDependencies {
  projectManagementRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  sessionTracking: SessionTrackingRepository;
  qaReviewRepository: QaReviewRepository;
  taskService: TaskService;
  agentPresetSyncService: AgentPresetSyncService;
  providerRunner: IProviderRunner;
  getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings;
  getGithubToken: () => string | undefined;
  sendSessionMessage: (sessionId: string, prompt: string) => Promise<unknown>;
  logger?: Logger;
}

export class QualityAssuranceService {
  private readonly workspaceManager = new WorkspaceManager();

  private readonly prService = new PrService();

  constructor(private readonly deps: QualityAssuranceServiceDependencies) {}

  async reviewCompletedTask(args: {
    projectId: string;
    sprintId: string;
    sprintRunId?: string;
    repoPath: string;
    task: Subtask;
    subtasks: Subtask[];
  }): Promise<TaskQaReviewOutcome> {
    const taskId = args.task.record_id?.trim();
    if (!taskId) {
      return { reviewed: false, reopenedTask: false, reportText: "" };
    }

    const scope = {
      projectId: args.projectId,
      sprintId: args.sprintId,
    };
    const settings = this.deps.getDashboardSettings(scope);
    const qaSettings = settings.agents.qualityAssurance;
    if (!qaSettings.enabled) {
      return { reviewed: false, reopenedTask: false, reportText: "" };
    }

    const triggerType = !args.task.pr_url && qaSettings.completedTaskWithoutPr.enabled
      ? "completed_task_without_pr"
      : qaSettings.taskCompletion.enabled
        ? "task_completion"
        : null;
    if (!triggerType) {
      return { reviewed: false, reopenedTask: false, reportText: "" };
    }

    const existingRuns = this.deps.qaReviewRepository.countTaskRuns(taskId);
    if (existingRuns >= qaSettings.maxTaskReviewRuns) {
      await this.cleanupCliWorkspaceIfNeeded(args.task, args.repoPath, scope);
      return { reviewed: false, reopenedTask: false, reportText: "" };
    }

    const taskRun = this.resolveTaskRunForSubtask(args.task, args.sprintRunId);
    const project = this.deps.projectManagementRepository.getProject(args.projectId);
    const sprint = this.deps.projectManagementRepository.getSprint(args.sprintId);
    if (!project || !sprint) {
      return { reviewed: false, reopenedTask: false, reportText: "" };
    }

    const agentPresetId = triggerType === "completed_task_without_pr"
      ? qaSettings.completedTaskWithoutPr.agentPresetId
      : qaSettings.taskCompletion.agentPresetId;
    const agent = await this.deps.agentPresetSyncService.resolveTargetedQualityAssuranceAgent(args.projectId, agentPresetId);

    const run = this.deps.qaReviewRepository.createRun({
      projectId: args.projectId,
      sprintId: args.sprintId,
      sprintRunId: args.sprintRunId || null,
      taskId,
      taskRunId: taskRun?.id || null,
      triggerType,
      runIndex: existingRuns + 1,
      agentPresetId: agent.id,
      agentName: agent.name,
      targetTaskKey: args.task.id,
      targetSessionId: args.task.session_id || null,
      targetProvider: args.task.provider || null,
      payload: {
        taskKey: args.task.id,
        runIndex: existingRuns + 1,
      },
    });

    try {
      const review = await this.runReview({
        triggerType,
        scope,
        projectName: project.name,
        sprintGoal: sprint.goal || "",
        repoPath: args.repoPath,
        agentInstructions: agent.instructionMarkdown,
        subtasks: args.subtasks,
        currentTask: args.task,
        taskRun,
        sprintRunId: args.sprintRunId || null,
      });

      if (review.verdict === "pass" || (triggerType === "completed_task_without_pr" && review.shouldHavePr === false)) {
        this.deps.qaReviewRepository.updateRun(run.id, {
          status: "completed",
          outcome: "pass",
          summaryMarkdown: review.summary,
          payload: review.raw,
          finishedAt: new Date().toISOString(),
        });
        this.appendTaskEvent(taskRun, "qa_review_passed", {
          triggerType,
          summary: review.summary,
          findings: review.findings,
          qaReviewRunId: run.id,
        });
        await this.cleanupCliWorkspaceIfNeeded(args.task, args.repoPath, scope);
        return {
          reviewed: true,
          reopenedTask: false,
          reportText: renderQaPassReport(args.task.id, review.summary),
        };
      }

      const fixInstructions = review.fixInstructions
        || (triggerType === "completed_task_without_pr" && review.shouldHavePr
          ? "A feature PR is still required for this task. Ensure the branch contains the intended changes, push any missing commits, and create or update the feature PR so Sprint OS can track the work correctly."
          : null);

      const continued = fixInstructions
        ? await this.requestFixesForTask({
          task: args.task,
          taskRun,
          repoPath: args.repoPath,
          featureBranch: sprint.featureBranch?.trim() || settings.git.defaultBranch,
          scope,
          prompt: fixInstructions,
        })
        : { applied: false, mode: "none" as const };

      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "completed",
        outcome: "changes_requested",
        summaryMarkdown: review.summary,
        fixInstructions,
        payload: {
          ...review.raw,
          continued: continued.applied,
          continuationMode: continued.mode,
        },
        finishedAt: new Date().toISOString(),
      });

      if (continued.applied) {
        this.deps.projectManagementRepository.updateTask(taskId, {
          status: "in_progress",
        });
        args.task.status = "RUNNING";
      }

      this.appendTaskEvent(taskRun, "qa_review_changes_requested", {
        triggerType,
        summary: review.summary,
        findings: review.findings,
        fixInstructions,
        qaReviewRunId: run.id,
        continued: continued.applied,
        continuationMode: continued.mode,
      });

      return {
        reviewed: true,
        reopenedTask: continued.applied,
        reportText: renderQaChangesRequestedReport(args.task.id, review.summary, continued.applied),
      };
    } catch (error) {
      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "failed",
        summaryMarkdown: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      });
      this.appendTaskEvent(taskRun, "qa_review_failed", {
        triggerType,
        error: error instanceof Error ? error.message : String(error),
        qaReviewRunId: run.id,
      });
      this.deps.logger?.warn("Task QA review failed", {
        projectId: args.projectId,
        sprintId: args.sprintId,
        taskId,
        triggerType,
        error: error instanceof Error ? error.message : String(error),
      });
      return { reviewed: false, reopenedTask: false, reportText: "" };
    }
  }

  async reviewSprintCompletion(args: {
    projectId: string;
    sprintId: string;
    sprintRunId: string;
    repoPath: string;
    subtasks: Subtask[];
  }): Promise<SprintQaReviewOutcome> {
    const scope = {
      projectId: args.projectId,
      sprintId: args.sprintId,
    };
    const settings = this.deps.getDashboardSettings(scope);
    const qaSettings = settings.agents.qualityAssurance;
    if (!qaSettings.enabled || !qaSettings.sprintCompletion.enabled) {
      return { reviewed: false, blockedCompletion: false, reportText: "" };
    }
    if (this.deps.qaReviewRepository.hasSprintReviewRun(args.sprintId)) {
      return { reviewed: false, blockedCompletion: false, reportText: "" };
    }

    const project = this.deps.projectManagementRepository.getProject(args.projectId);
    const sprint = this.deps.projectManagementRepository.getSprint(args.sprintId);
    if (!project || !sprint) {
      return { reviewed: false, blockedCompletion: false, reportText: "" };
    }

    const agent = await this.deps.agentPresetSyncService.resolveTargetedQualityAssuranceAgent(
      args.projectId,
      qaSettings.sprintCompletion.agentPresetId,
    );
    const run = this.deps.qaReviewRepository.createRun({
      projectId: args.projectId,
      sprintId: args.sprintId,
      sprintRunId: args.sprintRunId,
      triggerType: "sprint_completion",
      runIndex: 1,
      agentPresetId: agent.id,
      agentName: agent.name,
      payload: {
        sprintRunId: args.sprintRunId,
      },
    });

    try {
      const review = await this.runReview({
        triggerType: "sprint_completion",
        scope,
        projectName: project.name,
        sprintGoal: sprint.goal || "",
        repoPath: args.repoPath,
        agentInstructions: agent.instructionMarkdown,
        subtasks: args.subtasks,
        currentTask: null,
        taskRun: null,
        sprintRunId: args.sprintRunId,
      });

      if (review.verdict === "pass") {
        this.deps.qaReviewRepository.updateRun(run.id, {
          status: "completed",
          outcome: "pass",
          summaryMarkdown: review.summary,
          payload: review.raw,
          finishedAt: new Date().toISOString(),
        });
        return {
          reviewed: true,
          blockedCompletion: false,
          reportText: renderSprintQaPassReport(review.summary),
        };
      }

      const targetTask = review.targetTaskKey
        ? args.subtasks.find((task) => task.id === review.targetTaskKey)
        : null;
      const targetTaskRun = targetTask ? this.resolveTaskRunForSubtask(targetTask, args.sprintRunId) : null;
      const fixInstructions = review.fixInstructions;
      const continued = targetTask && fixInstructions
        ? await this.requestFixesForTask({
          task: targetTask,
          taskRun: targetTaskRun,
          repoPath: args.repoPath,
          featureBranch: sprint.featureBranch?.trim() || settings.git.defaultBranch,
          scope,
          prompt: fixInstructions,
        })
        : { applied: false, mode: "none" as const };

      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "completed",
        outcome: "changes_requested",
        targetTaskKey: targetTask?.id || review.targetTaskKey,
        targetSessionId: targetTask?.session_id || null,
        targetProvider: targetTask?.provider || null,
        summaryMarkdown: review.summary,
        fixInstructions,
        payload: {
          ...review.raw,
          continued: continued.applied,
          continuationMode: continued.mode,
        },
        finishedAt: new Date().toISOString(),
      });

      if (continued.applied && targetTask?.record_id) {
        this.deps.projectManagementRepository.updateTask(targetTask.record_id, {
          status: "in_progress",
        });
        targetTask.status = "RUNNING";
      }

      return {
        reviewed: true,
        blockedCompletion: continued.applied,
        reportText: renderSprintQaChangesRequestedReport(review.summary, targetTask?.id || review.targetTaskKey, continued.applied),
      };
    } catch (error) {
      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "failed",
        summaryMarkdown: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      });
      this.deps.logger?.warn("Sprint QA review failed", {
        projectId: args.projectId,
        sprintId: args.sprintId,
        sprintRunId: args.sprintRunId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { reviewed: false, blockedCompletion: false, reportText: "" };
    }
  }

  private async runReview(args: {
    triggerType: QaReviewTriggerType;
    scope: DashboardSettingsScope;
    projectName: string;
    sprintGoal: string;
    repoPath: string;
    agentInstructions: string;
    subtasks: Subtask[];
    currentTask: Subtask | null;
    taskRun: TaskRunRecord | null;
    sprintRunId: string | null;
  }): Promise<NormalizedQaReviewResult> {
    const pseudoTask: Subtask = args.currentTask || {
      id: "SPRINT",
      title: "Sprint completion review",
      prompt: args.sprintGoal,
      depends_on: [],
      is_independent: true,
      status: "COMPLETED",
    };
    const route = this.deps.taskService.resolveInvocationProvider("qa_review", pseudoTask, {
      scope: args.scope,
      cliOnly: true,
    });
    const provider = route.provider as CliQaProvider;

    const prompt = this.buildReviewPrompt(args);
    const providerPrompt = buildProviderPrompt(prompt, route.providers[provider].thinkingMode);
    const invocation = this.deps.executionRepository.createExecutionInvocation({
      projectId: args.scope.projectId!,
      sprintId: args.scope.sprintId || null,
      taskId: args.taskRun?.taskId || null,
      sprintRunId: args.sprintRunId,
      taskRunId: args.taskRun?.id || null,
      type: "qa_review",
      provider,
      model: route.providers[provider].model,
      startedAt: new Date().toISOString(),
    });

    this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
      role: "system",
      contentMarkdown: args.agentInstructions.trim(),
    });
    this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
      role: "user",
      contentMarkdown: prompt,
    });

    const usage = this.deps.executionRepository.createProviderInvocationUsage({
      projectId: args.scope.projectId!,
      sprintId: args.scope.sprintId || null,
      taskId: args.taskRun?.taskId || null,
      sprintRunId: args.sprintRunId,
      taskRunId: args.taskRun?.id || null,
      sessionId: invocation.id,
      provider,
      purpose: "qa_review",
      model: route.providers[provider].model,
      startedAt: invocation.startedAt,
      promptChars: prompt.length,
    });

    try {
      const result = await this.deps.providerRunner.runProviderForText({
        provider,
        prompt: providerPrompt,
        cwd: args.repoPath,
        model: route.providers[provider].model,
        apiKey: route.providers[provider].apiKey,
        sessionId: invocation.id,
        workflowSettings: {
          ...DEFAULT_CLI_WORKFLOW_SETTINGS,
          ...this.deps.getDashboardSettings(args.scope).cliWorkflow,
        },
        repoPath: args.repoPath,
        githubToken: this.deps.getGithubToken(),
        onActivity: () => undefined,
      });

      this.deps.executionRepository.updateProviderInvocationUsage(usage.id, {
        status: result.ok ? "completed" : "failed",
        model: route.providers[provider].model,
        nativeSessionId: result.nativeSessionId,
        finishedAt: new Date().toISOString(),
        transcriptChars: result.usageTelemetry.transcriptText.length,
        inputTokens: result.usageTelemetry.inputTokens,
        cachedInputTokens: result.usageTelemetry.cachedInputTokens,
        outputTokens: result.usageTelemetry.outputTokens,
        reasoningOutputTokens: result.usageTelemetry.reasoningOutputTokens,
        totalTokens: result.usageTelemetry.totalTokens,
        usageSource: result.usageTelemetry.usageSource,
        rawUsageJson: result.usageTelemetry.rawUsageJson,
      });

      if (!result.ok) {
        throw new Error(result.stderr || result.stdout || "QA provider failed without output.");
      }

      const text = result.text.trim();
      this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
        role: "assistant",
        contentMarkdown: text,
      });
      this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
        status: "completed",
        providerInvocationId: usage.id,
        finishedAt: new Date().toISOString(),
      });
      return normalizeQaReviewResult(text);
    } catch (error) {
      this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
        status: "failed",
        providerInvocationId: usage.id,
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  private buildReviewPrompt(args: {
    triggerType: QaReviewTriggerType;
    projectName: string;
    sprintGoal: string;
    agentInstructions: string;
    subtasks: Subtask[];
    currentTask: Subtask | null;
  }): string {
    const currentTaskSection = args.currentTask
      ? [
        "## CURRENT TASK",
        `Task key: ${args.currentTask.id}`,
        `Title: ${args.currentTask.title}`,
        `Status: ${args.currentTask.status || "unknown"}`,
        `Provider: ${args.currentTask.provider || "unknown"}`,
        `Worker branch: ${args.currentTask.worker_branch || "none"}`,
        `PR URL: ${args.currentTask.pr_url || "none"}`,
        "",
        "Prompt:",
        args.currentTask.prompt,
        "",
        "Recent activity excerpts:",
        this.renderActivityExcerpt(args.currentTask),
      ]
      : [
        "## CURRENT TASK",
        "No single task is preselected. If fixes are required, choose the best target task from the sprint task list and return its task key in `targetTaskKey`.",
      ];

    return [
      "## QUALITY ASSURANCE AGENT INSTRUCTIONS",
      args.agentInstructions.trim(),
      "",
      "## REVIEW MODE",
      `Trigger: ${args.triggerType}`,
      triggerReviewModeDescription(args.triggerType),
      "",
      "## PROJECT CONTEXT",
      `Project: ${args.projectName}`,
      `Sprint goal: ${args.sprintGoal || "No sprint goal provided."}`,
      "",
      "## SPRINT TASKS",
      args.subtasks.map((task) => (
        `- [${task.status || "unknown"}] ${task.id}: ${task.title} | provider=${task.provider || "unknown"} | branch=${task.worker_branch || "none"} | pr=${task.pr_url || "none"}`
      )).join("\n"),
      "",
      ...currentTaskSection,
      "",
      "## REQUIRED OUTPUT",
      "Return JSON only.",
      "Use this exact shape:",
      "{",
      '  "verdict": "pass" | "changes_requested",',
      '  "summary": "short markdown summary",',
      '  "findings": ["finding 1", "finding 2"],',
      '  "fixInstructions": "direct instructions for the coding session" | null,',
      '  "targetTaskKey": "T01" | null,',
      '  "shouldHavePr": true | false | null',
      "}",
      "",
      "Rules:",
      "- `summary` must be concise and factual.",
      "- If `verdict` is `changes_requested`, `fixInstructions` must tell the coding session exactly what to fix next.",
      "- For sprint completion reviews, set `targetTaskKey` to the best task to continue when changes are required.",
      "- For `completed_task_without_pr`, set `shouldHavePr` explicitly.",
      "- Do not include prose outside the JSON object.",
    ].join("\n");
  }

  private renderActivityExcerpt(task: Subtask): string {
    const activities = Array.isArray(task.activities) ? task.activities.slice(-8) : [];
    if (activities.length === 0) {
      return "- No recent activity captured.";
    }

    return activities.map((entry) => {
      const message = entry.agentMessaged?.agentMessage
        || entry.userMessaged?.userMessage
        || entry.progressUpdated?.description
        || entry.description
        || "No summary";
      return `- ${message}`;
    }).join("\n");
  }

  private resolveTaskRunForSubtask(task: Subtask, sprintRunId?: string): TaskRunRecord | null {
    const taskId = task.record_id?.trim();
    if (!taskId) {
      return null;
    }
    if (task.session_id) {
      const bySession = this.deps.executionRepository.getLatestTaskRunBySessionId(task.session_id);
      if (bySession) {
        return bySession;
      }
    }
    return this.deps.executionRepository.getLatestTaskRun(taskId, sprintRunId);
  }

  private appendTaskEvent(taskRun: TaskRunRecord | null, eventType: string, payload: Record<string, unknown>): void {
    if (!taskRun) {
      return;
    }
    this.deps.executionRepository.appendTaskRunEvent(taskRun.id, eventType, "system", payload);
  }

  private async requestFixesForTask(args: {
    task: Subtask;
    taskRun: TaskRunRecord | null;
    repoPath: string;
    featureBranch: string;
    scope: DashboardSettingsScope;
    prompt: string;
  }): Promise<{ applied: boolean; mode: "jules" | "cli" | "none" }> {
    const provider = args.task.provider;
    const sessionId = args.task.session_id?.trim();
    if (!provider || !sessionId) {
      return { applied: false, mode: "none" };
    }

    const followUpPrompt = [
      "Quality assurance review found follow-up work before this task can be considered done.",
      "",
      args.prompt.trim(),
    ].join("\n");

    if (provider === "jules") {
      await this.deps.sendSessionMessage(sessionId, followUpPrompt);
      return { applied: true, mode: "jules" };
    }

    await this.continueCliTaskSession({
      provider,
      sessionId,
      task: args.task,
      taskRun: args.taskRun,
      repoPath: args.repoPath,
      featureBranch: args.featureBranch,
      scope: args.scope,
      followUpPrompt,
    });
    return { applied: true, mode: "cli" };
  }

  private async continueCliTaskSession(args: {
    provider: CliQaProvider;
    sessionId: string;
    task: Subtask;
    taskRun: TaskRunRecord | null;
    repoPath: string;
    featureBranch: string;
    scope: DashboardSettingsScope;
    followUpPrompt: string;
  }): Promise<void> {
    const settings = this.deps.getDashboardSettings(args.scope);
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...settings.cliWorkflow,
    };
    const workerBranch = args.task.worker_branch?.trim() || args.taskRun?.workerBranch?.trim();
    if (!workerBranch) {
      throw new Error(`Cannot continue CLI QA fixes for ${args.task.id}: worker branch is missing.`);
    }

    const worktreePath = await this.workspaceManager.resolveResumeWorktreePath(args.repoPath, args.sessionId, workflowSettings.executionMode)
      || this.workspaceManager.buildWorktreePath(args.repoPath, args.sessionId, workflowSettings.executionMode);
    const existed = await this.workspacePathExists(worktreePath);
    if (!existed) {
      await this.workspaceManager.prepareWorktree(args.repoPath, worktreePath, workerBranch, args.featureBranch);
    }

    const workerInstructions = (await this.deps.agentPresetSyncService.getOptionalWorkerAgentForRepoPath(args.repoPath))
      ?.instructionMarkdown
      ?.trim() || "";
    const promptBody = [
      workerInstructions
        ? `## SYSTEM INSTRUCTIONS & ENGINEERING STANDARDS\n\n${workerInstructions}`
        : "",
      "## ORIGINAL SUBTASK",
      args.task.prompt,
      "",
      "## QA FOLLOW-UP",
      args.followUpPrompt,
    ].filter(Boolean).join("\n\n");
    const workspaceGuidance = await this.workspaceManager.buildWorkspaceGuidance(args.followUpPrompt, worktreePath);
    const providerPrompt = buildProviderPrompt(`${promptBody}\n\n${workspaceGuidance}`, settings.aiProvider.providers[args.provider].thinkingMode);
    const previousInvocation = this.deps.executionRepository.getLatestProviderInvocationUsageBySession(args.sessionId, "task_coding");
    const initialHead = (await runCommandStrict("git", ["rev-parse", "HEAD"], worktreePath)).stdout.trim();
    const invocation = this.deps.executionRepository.createExecutionInvocation({
      projectId: args.scope.projectId!,
      sprintId: args.scope.sprintId || null,
      taskId: args.taskRun?.taskId || null,
      taskRunId: args.taskRun?.id || null,
      sprintRunId: args.taskRun?.sprintRunId || null,
      dispatchId: args.taskRun?.dispatchId || null,
      type: "cli_task_followup",
      provider: args.provider,
      model: settings.aiProvider.providers[args.provider].model,
      startedAt: new Date().toISOString(),
    });
    this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
      role: "user",
      contentMarkdown: promptBody,
    });

    const usage = this.deps.executionRepository.createProviderInvocationUsage({
      projectId: args.scope.projectId!,
      sprintId: args.scope.sprintId || null,
      taskId: args.taskRun?.taskId || null,
      sprintRunId: args.taskRun?.sprintRunId || null,
      dispatchId: args.taskRun?.dispatchId || null,
      taskRunId: args.taskRun?.id || null,
      sessionId: args.sessionId,
      provider: args.provider,
      purpose: "task_coding",
      model: settings.aiProvider.providers[args.provider].model,
      startedAt: invocation.startedAt,
      promptChars: promptBody.length,
    });

    this.deps.sessionTracking.updateSession(args.sessionId, { state: "RUNNING" });
    this.deps.sessionTracking.appendActivity(args.sessionId, {
      originator: "system",
      description: "Quality assurance requested a follow-up implementation pass.",
    });

    const result = await this.deps.providerRunner.runProvider({
      provider: args.provider,
      prompt: providerPrompt,
      cwd: worktreePath,
      model: settings.aiProvider.providers[args.provider].model,
      apiKey: settings.aiProvider.providers[args.provider].apiKey,
      sessionId: args.sessionId,
      workflowSettings,
      repoPath: args.repoPath,
      githubToken: this.deps.getGithubToken(),
      continueSessionId: previousInvocation?.nativeSessionId || (args.provider === "claude-code" ? null : args.sessionId),
      onActivity: (description, originator) => {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: originator || "system",
          description,
        });
      },
    });

    this.deps.executionRepository.updateProviderInvocationUsage(usage.id, {
      status: result.ok ? "completed" : "failed",
      model: settings.aiProvider.providers[args.provider].model,
      nativeSessionId: result.nativeSessionId,
      finishedAt: new Date().toISOString(),
      transcriptChars: result.usageTelemetry.transcriptText.length,
      inputTokens: result.usageTelemetry.inputTokens,
      cachedInputTokens: result.usageTelemetry.cachedInputTokens,
      outputTokens: result.usageTelemetry.outputTokens,
      reasoningOutputTokens: result.usageTelemetry.reasoningOutputTokens,
      totalTokens: result.usageTelemetry.totalTokens,
      usageSource: result.usageTelemetry.usageSource,
      rawUsageJson: result.usageTelemetry.rawUsageJson,
    });

    if (!result.ok) {
      this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
        status: "failed",
        providerInvocationId: usage.id,
        finishedAt: new Date().toISOString(),
        errorMessage: result.stderr || result.stdout || "CLI QA follow-up failed.",
      });
      this.deps.projectManagementRepository.updateTask(args.task.record_id!, {
        status: "pending",
      });
      this.deps.sessionTracking.updateSession(args.sessionId, { state: "FAILED" });
      throw new Error(result.stderr || result.stdout || "CLI QA follow-up failed.");
    }

    this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
      role: "assistant",
      contentMarkdown: result.usageTelemetry.transcriptText,
    });
    this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
      status: "completed",
      providerInvocationId: usage.id,
      finishedAt: new Date().toISOString(),
    });

    const currentBranch = (await runCommandStrict("git", ["rev-parse", "--abbrev-ref", "HEAD"], worktreePath)).stdout.trim();
    if (currentBranch !== workerBranch) {
      await runCommandStrict("git", ["checkout", workerBranch], worktreePath);
    }
    const finalHead = (await runCommandStrict("git", ["rev-parse", "HEAD"], worktreePath)).stdout.trim();
    const hasWorkingTreeChanges = (await runCommandStrict("git", ["status", "--porcelain"], worktreePath)).stdout.trim().length > 0;
    const hasCommittedChanges = finalHead !== initialHead;
    const hasUnpushed = await this.prService.hasUnpushedCommits(worktreePath, workerBranch, args.featureBranch);
    const hasAhead = await this.prService.hasWorkerBranchCommitsAgainstFeature(worktreePath, args.featureBranch);

    let prUrl = args.task.pr_url || args.taskRun?.prUrl || null;
    if (hasWorkingTreeChanges || hasCommittedChanges || hasUnpushed || hasAhead) {
      if (hasWorkingTreeChanges) {
        await runCommandStrict("git", ["add", "-A"], worktreePath);
        await runCommandStrict("git", ["commit", "-m", `fix(task ${args.task.id}): address qa review via ${args.provider}`], worktreePath);
      }
      await runCommandStrict("git", ["push", "-u", "origin", workerBranch], worktreePath);
      if (settings.git.autoCreatePr) {
        const sprint = args.task.sprint_id ? this.deps.projectManagementRepository.getSprint(args.task.sprint_id) : null;
        prUrl = (await this.prService.resolveOrCreateFeaturePr(
          {
            taskId: args.task.id,
            provider: args.provider,
            title: args.task.title,
            featureBranch: args.featureBranch,
            workerBranch,
            taskDescription: args.task.prompt,
            sprintDescription: sprint?.goal,
          },
          worktreePath,
          this.deps.getGithubToken(),
        )) ?? null;
      }
    }

    this.deps.sessionTracking.updateSession(args.sessionId, {
      state: "COMPLETED",
      prUrl: prUrl || undefined,
    });
    this.deps.projectManagementRepository.updateTask(args.task.record_id!, {
      status: "coding_completed",
    });
  }

  private async cleanupCliWorkspaceIfNeeded(task: Subtask, repoPath: string, scope: DashboardSettingsScope): Promise<void> {
    if (task.provider !== "gemini" && task.provider !== "codex" && task.provider !== "claude-code") {
      return;
    }
    const sessionId = task.session_id?.trim();
    if (!sessionId) {
      return;
    }
    const settings = this.deps.getDashboardSettings(scope);
    if (!settings.cliWorkflow.cleanupWorktreeOnSuccess) {
      return;
    }

    const worktreePath = await this.workspaceManager.resolveResumeWorktreePath(
      repoPath,
      sessionId,
      settings.cliWorkflow.executionMode,
    ).catch(() => undefined);
    if (!worktreePath) {
      return;
    }
    await this.workspaceManager.removeWorktree(repoPath, worktreePath).catch(() => undefined);
  }

  private async workspacePathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}

function triggerReviewModeDescription(triggerType: QaReviewTriggerType): string {
  switch (triggerType) {
    case "completed_task_without_pr":
      return "Review a completed task with no PR and decide whether a PR should exist.";
    case "sprint_completion":
      return "Review the full sprint for integration quality before final completion.";
    case "task_completion":
    default:
      return "Review a completed task for correctness, completeness, and integration quality.";
  }
}

function normalizeQaReviewResult(bodyMarkdown: string): NormalizedQaReviewResult {
  const rawJson = extractJsonLikeBlock(bodyMarkdown);
  const parsed = JSON.parse(rawJson) as QaReviewResultPayload;
  const raw = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const verdict = parsed.verdict === "changes_requested" ? "changes_requested" : "pass";
  const summary = typeof parsed.summary === "string" && parsed.summary.trim().length > 0
    ? parsed.summary.trim()
    : verdict === "pass"
      ? "QA review passed."
      : "QA review requested follow-up fixes.";
  const findings = Array.isArray(parsed.findings)
    ? parsed.findings.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const fixInstructions = typeof parsed.fixInstructions === "string" && parsed.fixInstructions.trim().length > 0
    ? parsed.fixInstructions.trim()
    : null;
  const targetTaskKey = typeof parsed.targetTaskKey === "string" && parsed.targetTaskKey.trim().length > 0
    ? parsed.targetTaskKey.trim()
    : null;
  const shouldHavePr = typeof parsed.shouldHavePr === "boolean" ? parsed.shouldHavePr : null;

  return {
    verdict,
    summary,
    findings,
    fixInstructions,
    targetTaskKey,
    shouldHavePr,
    raw,
  };
}

function renderQaPassReport(taskKey: string, summary: string): string {
  return `\nQA passed for \`${taskKey}\`: ${summary}\n`;
}

function renderQaChangesRequestedReport(taskKey: string, summary: string, continued: boolean): string {
  return `\nQA requested follow-up for \`${taskKey}\`${continued ? " and resumed the task session" : ""}: ${summary}\n`;
}

function renderSprintQaPassReport(summary: string): string {
  return `\nSprint QA passed: ${summary}\n`;
}

function renderSprintQaChangesRequestedReport(summary: string, targetTaskKey: string | null, continued: boolean): string {
  const target = targetTaskKey ? ` Target task: \`${targetTaskKey}\`.` : "";
  return `\nSprint QA requested follow-up${continued ? " and resumed the selected task session." : "."}${target} ${summary}\n`;
}
