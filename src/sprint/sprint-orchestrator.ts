import * as fs from "fs/promises";
import * as path from "path";
import type { InstructionTemplateId } from "../instructions/instruction-template-catalog.js";
import {
  DEFAULT_AUTOMATION_INTERVENTIONS_SETTINGS,
  DEFAULT_CI_INTELLIGENCE_SETTINGS,
  DEFAULT_SPRINT_LOOP_STEP_SETTINGS,
} from "./sprint-orchestrator-defaults.js";
import { runBranchPreflightStep } from "./steps/branch-preflight-step.js";
import { runPlanningPreflightStep } from "./steps/planning-preflight-step.js";
import { runLoadSubtasksStep } from "./steps/load-subtasks-step.js";
import { runSessionSyncStep } from "./steps/session-sync-step.js";
import { runStatusDerivationStep } from "./steps/status-derivation-step.js";
import { runStartReadyTasksStep } from "./steps/start-ready-tasks-step.js";
import { runStatusTableStep } from "./steps/status-table-step.js";
import { runProtocolStep } from "./steps/protocol-step.js";
import { runCompletionStep } from "./steps/completion-step.js";
import type { SprintAgentArgs, SprintCycleResult } from "./sprint-types.js";
import type {
  AutomationInterventionsSettings,
  AutomationLevel,
  CiIntelligenceSettings,
  DashboardSettings,
  GitCiRunStatus,
  GitTrackingStatus,
  JulesSession,
  Settings,
  SprintLoopStepSettings,
  Subtask,
} from "../contracts/app-types.js";

export interface SprintOrchestratorDependencies {
  settings: Settings;
  dashboardPort: number;
  completedSprints: Set<number>;
  getConsecutiveFailures: () => number;
  setConsecutiveFailures: (value: number) => void;
  isActionRequiredState: (state?: string) => boolean;
  resolveSessionName: (session: Partial<JulesSession>) => string | undefined;
  extractSessionId: (session: Partial<JulesSession>) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<any[]>;
  listSessions: () => Promise<{ sessions?: JulesSession[] }>;
  loadSubtasks: (dir: string) => Promise<Subtask[]>;
  startTask: (task: Subtask, sourceId: string, baseBranch: string, repoPath: string, sprintNumber: number) => Promise<JulesSession>;
  getGuideContent: (guideName: string, repoPath?: string) => Promise<string>;
  updateLastStatus: (status: any) => void;
  getDashboardSettings: () => DashboardSettings;
  isJulesApiConfigured: () => boolean;
  approveSessionPlan: (sessionId: string) => Promise<unknown>;
  sendSessionMessage: (sessionId: string, prompt: string) => Promise<unknown>;
  getCiStatusForScope?: (args: {
    repoPath: string;
    scope: "FEATURE_PR_CI" | "MAIN_MERGE_PR_CI";
    featureBranch: string;
    defaultBranch: string;
    featureBranchPrefix: string;
  }) => Promise<GitTrackingStatus | null>;
  autoMergeFeaturePr?: (args: { repoPath: string; prNumber: number }) => Promise<{ ok: boolean; message?: string }>;
  renderInstruction: (templateId: InstructionTemplateId, variables: Record<string, unknown>, repoPath?: string) => Promise<string>;
}

export class SprintOrchestrator {
  private readonly ciAutofixRetryCounts = new Map<string, number>();

  constructor(private readonly deps: SprintOrchestratorDependencies) {}

  private getLoopStepSettings(): SprintLoopStepSettings {
    return {
      ...DEFAULT_SPRINT_LOOP_STEP_SETTINGS,
      ...this.deps.getDashboardSettings().sprintLoopSteps,
    };
  }

  private getCiIntelligenceSettings(): CiIntelligenceSettings {
    return {
      ...DEFAULT_CI_INTELLIGENCE_SETTINGS,
      ...this.deps.getDashboardSettings().ciIntelligence,
    };
  }

  private getAutomationInterventionsSettings(): AutomationInterventionsSettings {
    return {
      ...DEFAULT_AUTOMATION_INTERVENTIONS_SETTINGS,
      ...this.deps.getDashboardSettings().automationInterventions,
    };
  }

  private async renderInstruction(
    templateId: InstructionTemplateId,
    variables: Record<string, unknown>,
    repoPath?: string
  ): Promise<string> {
    return await this.deps.renderInstruction(templateId, variables, repoPath);
  }

  private async renderBranchBlocker(
    args: SprintAgentArgs,
    defaultFeatureBranch: string,
    existsLocal: boolean,
    existsRemote: boolean
  ): Promise<string> {
    const createBranchStep = !existsLocal
      ? `**Step 1:** Create the branch locally:\n\`\`\`bash\ngit checkout -b ${defaultFeatureBranch}\n\`\`\`\n\n`
      : "";
    const pushBranchStep = !existsRemote
      ? `**Step ${!existsLocal ? "2" : "1"}:** Push the branch to remote origin:\n\`\`\`bash\ngit push -u origin ${defaultFeatureBranch}\n\`\`\`\n\n`
      : "";

    return await this.renderInstruction(
      "branchMissing",
      {
        feature_branch: defaultFeatureBranch,
        action: args.action,
        create_branch_step: createBranchStep,
        push_branch_step: pushBranchStep,
      },
      args.repo_path
    );
  }

  private async renderPlanningBlocker(args: SprintAgentArgs, subtasksDir: string): Promise<string> {
    return await this.renderInstruction(
      "planningMissing",
      {
        subtasks_dir: subtasksDir,
      },
      args.repo_path
    );
  }

  private async runPlanningAction(args: SprintAgentArgs, subtasksDir: string): Promise<any> {
    try {
      await fs.access(subtasksDir);
      return { content: [{ type: "text", text: `Subtasks directory already exists: ${subtasksDir}.` }] };
    } catch {
      await fs.mkdir(subtasksDir, { recursive: true });

      let planningGuideBlock = "";
      try {
        const planningGuide = await this.deps.getGuideContent("sprint_agent_guide.md", args.repo_path);
        planningGuideBlock = `\n\n### Technical Operating Standard\n\n${planningGuide}\n`;
      } catch {
        // Guide is optional.
      }

      const text = await this.renderInstruction(
        "planningCreated",
        {
          sprint_number: args.sprint_number,
          subtasks_dir: subtasksDir,
          planning_guide_block: planningGuideBlock,
        },
        args.repo_path
      );

      return { content: [{ type: "text", text }] };
    }
  }

  private async runOrchestrationCycle(args: {
    action: "status" | "orchestrate";
    automationLevel: AutomationLevel;
    automationInterventions: AutomationInterventionsSettings;
    sprintNumber: number;
    repoPath: string;
    sourceId: string;
    defaultFeatureBranch: string;
    subtasksDir: string;
    retryFailed: boolean;
    loopSteps: SprintLoopStepSettings;
    ciIntelligence: CiIntelligenceSettings;
    githubMode: "REMOTE" | "LOCAL";
    defaultBranch: string;
    featureBranchPrefix: string;
  }): Promise<SprintCycleResult & { awaitingMerge: Subtask[] }> {
    let subtasks: Subtask[] = [];

    if (args.loopSteps.loadSubtasks) {
      try {
        subtasks = await runLoadSubtasksStep(this.deps.loadSubtasks, args.subtasksDir);
      } catch {
        throw new Error(`Error loading subtasks from ${args.subtasksDir}.`);
      }
    }

    if (args.loopSteps.sessionSync && subtasks.length > 0) {
      const syncResult = await runSessionSyncStep(
        subtasks,
        {
          listSessions: this.deps.listSessions,
          resolveSessionName: this.deps.resolveSessionName,
          extractSessionId: this.deps.extractSessionId,
          fetchRecentActivities: this.deps.fetchRecentActivities,
          isActionRequiredState: this.deps.isActionRequiredState,
        },
        args.retryFailed
      );
      subtasks = syncResult.subtasks;
    }

    if (args.loopSteps.statusDerivation && subtasks.length > 0) {
      subtasks = runStatusDerivationStep(subtasks, {
        retryFailed: args.retryFailed,
        isActionRequiredState: this.deps.isActionRequiredState,
      });
    }

    let reportText = "";
    if (args.loopSteps.startReadyTasks && subtasks.length > 0) {
      const startResult = await runStartReadyTasksStep(subtasks, {
        action: args.action,
        maxFailures: this.deps.settings.maxFailures || 5,
        getConsecutiveFailures: this.deps.getConsecutiveFailures,
        setConsecutiveFailures: this.deps.setConsecutiveFailures,
        startTask: (task) =>
          this.deps.startTask(task, args.sourceId, args.defaultFeatureBranch, args.repoPath, args.sprintNumber),
        resolveSessionName: this.deps.resolveSessionName,
        extractSessionId: this.deps.extractSessionId,
      });
      subtasks = startResult.subtasks;
      reportText += startResult.reportText;
    }

    if (subtasks.length > 0) {
      const interventionResult = await this.applyActionRequiredAutomation(subtasks, {
        automationLevel: args.automationLevel,
        settings: args.automationInterventions,
      });
      subtasks = interventionResult.subtasks;
      reportText += interventionResult.reportText;
    }

    if (subtasks.length > 0) {
      const ciAutofixResult = await this.applyFeatureBranchCiGate(subtasks, {
        automationLevel: args.automationLevel,
        repoPath: args.repoPath,
        subtasksDir: args.subtasksDir,
        featureBranch: args.defaultFeatureBranch,
        defaultBranch: args.defaultBranch,
        featureBranchPrefix: args.featureBranchPrefix,
        ciIntelligence: args.ciIntelligence,
        githubMode: args.githubMode,
      });
      subtasks = ciAutofixResult.subtasks;
      reportText += ciAutofixResult.reportText;
    }

    const protocolResult = await runProtocolStep(subtasks, {
      subtasksDir: args.subtasksDir,
      featureBranch: args.defaultFeatureBranch,
      githubMode: args.githubMode,
      ciIntelligence: args.ciIntelligence,
      enableMergeProtocol: args.loopSteps.mergeProtocol,
      enableActionRequiredProtocol: args.loopSteps.actionRequiredProtocol,
      isActionRequiredState: this.deps.isActionRequiredState,
      renderInstruction: (templateId, variables) => this.renderInstruction(templateId, variables, args.repoPath),
    });

    const statusTable = args.loopSteps.statusTable ? runStatusTableStep(subtasks) : "";

    return {
      subtasks,
      reportText,
      statusTable,
      instructions: protocolResult.instructions,
      awaitingMerge: protocolResult.awaitingMerge,
    };
  }

  private isJulesManagedTask(task: Subtask): boolean {
    if (task.provider && task.provider !== "jules") {
      return false;
    }
    if (typeof task.session_id === "string" && task.session_id.startsWith("cli-")) {
      return false;
    }
    if (typeof task.session_name === "string" && task.session_name.startsWith("sessions/cli-")) {
      return false;
    }
    return true;
  }

  private resolveTaskSessionId(task: Subtask): string | null {
    if (typeof task.session_id === "string" && task.session_id.trim().length > 0) {
      return task.session_id.replace(/^sessions\//, "");
    }
    if (typeof task.session_name === "string" && task.session_name.trim().length > 0) {
      return task.session_name.replace(/^sessions\//, "");
    }
    return null;
  }

  private getCiAutofixRetryKey(task: Subtask, prNumber: number): string {
    const sessionId = this.resolveTaskSessionId(task) || task.id;
    return `${sessionId}:${prNumber}`;
  }

  private resolveCiEscalationOwner(automationLevel: AutomationLevel): "AGENT" | "HUMAN" {
    return automationLevel === "FULL" ? "AGENT" : "HUMAN";
  }

  private shouldAutoIntervene(
    state: string | undefined,
    automationLevel: AutomationLevel,
    settings: AutomationInterventionsSettings
  ): boolean {
    if (!this.deps.isActionRequiredState(state)) {
      return false;
    }
    if (automationLevel === "FULL") {
      return true;
    }
    if (automationLevel === "ALWAYS_ASK") {
      return false;
    }
    if (state === "AWAITING_PLAN_APPROVAL") {
      return settings.autoApprovePlan;
    }
    if (state === "AWAITING_USER_FEEDBACK") {
      return settings.autoAnswerClarification;
    }
    if (state === "PAUSED") {
      return settings.autoResumePaused;
    }
    return false;
  }

  private getSemiAutoDisabledReason(state: string | undefined, settings: AutomationInterventionsSettings): string {
    if (state === "AWAITING_PLAN_APPROVAL" && !settings.autoApprovePlan) {
      return "SEMI_AUTO policy disabled auto-approval for session plans.";
    }
    if (state === "AWAITING_USER_FEEDBACK" && !settings.autoAnswerClarification) {
      return "SEMI_AUTO policy disabled auto-answer for clarification requests.";
    }
    if (state === "PAUSED" && !settings.autoResumePaused) {
      return "SEMI_AUTO policy disabled auto-resume for paused sessions.";
    }
    return "SEMI_AUTO policy did not allow auto-intervention for this state.";
  }

  private getLatestAgentPrompt(task: Subtask): string {
    const activities = Array.isArray(task.activities) ? task.activities : [];
    for (let index = activities.length - 1; index >= 0; index -= 1) {
      const entry = activities[index] as Record<string, unknown>;
      const agentMessaged = entry.agentMessaged as Record<string, unknown> | undefined;
      const agentMessage = typeof agentMessaged?.agentMessage === "string" ? agentMessaged.agentMessage.trim() : "";
      if (agentMessage.length > 0) {
        return agentMessage;
      }
      const description = typeof entry.description === "string" ? entry.description.trim() : "";
      if (description.length > 0) {
        return description;
      }
    }
    return "";
  }

  private buildClarificationAutoReply(task: Subtask, template: string): string {
    const latestPrompt = this.getLatestAgentPrompt(task);
    const contextBlock = latestPrompt.length > 0
      ? `Context from latest agent request: "${latestPrompt.slice(0, 400)}"\n\n`
      : "";
    return `${contextBlock}${template}`;
  }

  private async applyActionRequiredAutomation(
    subtasks: Subtask[],
    args: {
      automationLevel: AutomationLevel;
      settings: AutomationInterventionsSettings;
    }
  ): Promise<{ subtasks: Subtask[]; reportText: string }> {
    let reportText = "";

    for (const task of subtasks) {
      task.intervention_owner = undefined;
      task.intervention_hint = undefined;

      if (task.status !== "BLOCKED" || !this.deps.isActionRequiredState(task.session_state)) {
        continue;
      }

      if (!this.isJulesManagedTask(task)) {
        task.intervention_owner = "AGENT";
        task.intervention_hint = "Task is not Jules-managed; resolve manually in provider-specific workflow.";
        continue;
      }

      if (!this.deps.isJulesApiConfigured()) {
        task.intervention_owner = "HUMAN";
        task.intervention_hint = "Jules API key is not configured; automatic intervention is unavailable.";
        continue;
      }

      const autoIntervene = this.shouldAutoIntervene(task.session_state, args.automationLevel, args.settings);
      if (!autoIntervene) {
        task.intervention_owner = "HUMAN";
        task.intervention_hint = args.automationLevel === "ALWAYS_ASK"
          ? "Automation level is ALWAYS_ASK."
          : this.getSemiAutoDisabledReason(task.session_state, args.settings);
        continue;
      }

      const sessionId = this.resolveTaskSessionId(task);
      if (!sessionId) {
        task.intervention_owner = "AGENT";
        task.intervention_hint = "No session id available for automatic intervention.";
        continue;
      }

      try {
        if (task.session_state === "AWAITING_PLAN_APPROVAL") {
          await this.deps.approveSessionPlan(sessionId);
          task.status = "RUNNING";
          reportText += `🤖 **Auto-Approved Plan:** Task \`${task.id}\` session \`${sessionId}\` moved back to in-progress.\n`;
          continue;
        }

        if (task.session_state === "AWAITING_USER_FEEDBACK") {
          const reply = this.buildClarificationAutoReply(task, args.settings.clarificationAnswerTemplate);
          await this.deps.sendSessionMessage(sessionId, reply);
          task.status = "RUNNING";
          reportText += `🤖 **Auto-Answered Clarification:** Task \`${task.id}\` session \`${sessionId}\` received an automated response and stays in progress.\n`;
          continue;
        }

        if (task.session_state === "PAUSED") {
          await this.deps.sendSessionMessage(
            sessionId,
            "Continue execution using the current plan and repository conventions. Resume work and report progress."
          );
          task.status = "RUNNING";
          reportText += `🤖 **Auto-Resumed Session:** Task \`${task.id}\` session \`${sessionId}\` was nudged to continue.\n`;
          continue;
        }
      } catch (error) {
        task.intervention_owner = "AGENT";
        task.intervention_hint = `Auto-intervention failed: ${error instanceof Error ? error.message : String(error)}`;
        reportText += `⚠️ **Auto-Intervention Failed:** Task \`${task.id}\` could not be unblocked automatically.\n`;
      }
    }

    return { subtasks, reportText };
  }

  private isCiCheckFailed(status: string, conclusion: string | null): boolean {
    const normalizedStatus = status.toLowerCase();
    const normalizedConclusion = (conclusion || "").toLowerCase();
    if (normalizedStatus !== "completed") {
      return false;
    }
    return normalizedConclusion.length > 0 && normalizedConclusion !== "success" && normalizedConclusion !== "neutral" && normalizedConclusion !== "skipped";
  }

  private isCiCheckPending(status: string, conclusion: string | null): boolean {
    const normalizedStatus = status.toLowerCase();
    if (normalizedStatus !== "completed") {
      return true;
    }
    return conclusion === null;
  }

  private isCiRunFailed(status: string, conclusion: string | null): boolean {
    const normalizedStatus = status.toLowerCase();
    const normalizedConclusion = (conclusion || "").toLowerCase();
    if (normalizedStatus !== "completed") {
      return false;
    }
    return normalizedConclusion.length > 0 && normalizedConclusion !== "success" && normalizedConclusion !== "neutral" && normalizedConclusion !== "skipped";
  }

  private selectFailedCiRuns(gitStatus: GitTrackingStatus, branchName: string): GitCiRunStatus[] {
    const runs = Array.isArray(gitStatus.ciRuns) ? gitStatus.ciRuns : [];
    const failedRuns = runs.filter((run) => this.isCiRunFailed(run.status, run.conclusion));
    const branchMatched = failedRuns.filter((run) => run.headBranch === branchName);
    if (branchMatched.length > 0) {
      return branchMatched.slice(0, 2);
    }
    return failedRuns.slice(0, 2);
  }

  private getFailedJobLabels(failedRuns: GitCiRunStatus[]): string[] {
    const labels: string[] = [];
    for (const run of failedRuns) {
      const runLabel = run.workflowName || run.name;
      const jobs = Array.isArray(run.failedJobs) ? run.failedJobs : [];
      for (const job of jobs) {
        labels.push(`${runLabel}/${job.name}`);
      }
    }
    return labels;
  }

  private getFailedLogSnippets(failedRuns: GitCiRunStatus[]): string[] {
    const snippets: string[] = [];
    for (const run of failedRuns) {
      const runLabel = `${run.workflowName || run.name} (#${run.id ?? "?"})`;
      const jobs = Array.isArray(run.failedJobs) ? run.failedJobs : [];
      for (const job of jobs) {
        if (!job.logExcerpt || job.logExcerpt.trim().length === 0) {
          continue;
        }
        snippets.push(`[${runLabel} / ${job.name}]\n${job.logExcerpt}`);
      }
    }
    return snippets.slice(0, 3);
  }

  private summarizeFailedRuns(failedRuns: GitCiRunStatus[]): string {
    if (failedRuns.length === 0) {
      return "none";
    }
    return failedRuns
      .map((run) => `${run.workflowName || run.name}#${run.id ?? "?"}`)
      .join(", ");
  }

  private async notifyJulesAboutFailedCi(args: {
    task: Subtask;
    prNumber: number;
    prUrl: string;
    branchName: string;
    failedChecks: string[];
    failedRuns: GitCiRunStatus[];
    attempt: number;
    maxRetries: number;
  }): Promise<{ sent: boolean; reason?: string }> {
    if (!this.isJulesManagedTask(args.task)) {
      return { sent: false, reason: "Task is not Jules-managed." };
    }
    if (!this.deps.isJulesApiConfigured()) {
      return { sent: false, reason: "Jules API key is not configured." };
    }
    const sessionId = this.resolveTaskSessionId(args.task);
    if (!sessionId) {
      return { sent: false, reason: "No session id available." };
    }

    const failedChecksLine = args.failedChecks.length > 0 ? args.failedChecks.join(", ") : "unknown checks";
    const failedRunsLine = this.summarizeFailedRuns(args.failedRuns);
    const failedJobsLine = this.getFailedJobLabels(args.failedRuns);
    const failedLogSnippets = this.getFailedLogSnippets(args.failedRuns);
    const prompt = [
      `CI failed for your task PR #${args.prNumber} on branch ${args.branchName}.`,
      `PR URL: ${args.prUrl}.`,
      `Failed checks: ${failedChecksLine}.`,
      `Failed runs: ${failedRunsLine}.`,
      `Failed jobs: ${failedJobsLine.length > 0 ? failedJobsLine.join(", ") : "unknown jobs"}.`,
      `Autofix attempt ${args.attempt} of ${args.maxRetries}.`,
      "Please fix the CI issues, commit the necessary changes, and push updates to the same branch.",
      "Continue until checks are green.",
      failedLogSnippets.length > 0
        ? `Failed job logs (excerpt):\n${failedLogSnippets.join("\n\n")}`
        : "Failed job logs were not available from CI metadata. Use `gh run view <run-id> --log-failed`.",
    ].join("\n");

    await this.deps.sendSessionMessage(sessionId, prompt);
    return { sent: true };
  }

  private async applyFeatureBranchCiGate(
    subtasks: Subtask[],
    args: {
      automationLevel: AutomationLevel;
      repoPath: string;
      subtasksDir: string;
      featureBranch: string;
      defaultBranch: string;
      featureBranchPrefix: string;
      ciIntelligence: CiIntelligenceSettings;
      githubMode: "REMOTE" | "LOCAL";
    }
  ): Promise<{ subtasks: Subtask[]; reportText: string }> {
    for (const task of subtasks) {
      task.merge_indicator = task.is_merged ? "MERGED" : undefined;
      if (task.status === "COMPLETED") {
        task.intervention_owner = undefined;
        task.intervention_hint = undefined;
      }
    }

    if (
      !args.ciIntelligence.enabled ||
      !args.ciIntelligence.enableLivePrMonitoring ||
      !args.ciIntelligence.waitForCiBeforeFeatureMerge ||
      args.githubMode !== "REMOTE" ||
      !this.deps.getCiStatusForScope
    ) {
      return { subtasks, reportText: "" };
    }

    const completedAwaitingMerge = subtasks.filter((task) => task.status === "COMPLETED" && !task.is_merged);
    if (completedAwaitingMerge.length === 0) {
      return { subtasks, reportText: "" };
    }

    const gitStatus = await this.deps.getCiStatusForScope({
      repoPath: args.repoPath,
      scope: "FEATURE_PR_CI",
      featureBranch: args.featureBranch,
      defaultBranch: args.defaultBranch,
      featureBranchPrefix: args.featureBranchPrefix,
    });

    if (!gitStatus?.available) {
      return { subtasks, reportText: "" };
    }

    const prByHeadBranch = new Map<string, (typeof gitStatus.openPullRequests)[number]>();
    const prByUrl = new Map<string, (typeof gitStatus.openPullRequests)[number]>();
    for (const pr of gitStatus.openPullRequests) {
      if (pr.headRefName) {
        prByHeadBranch.set(pr.headRefName, pr);
      }
      if (typeof pr.url === "string" && pr.url.trim().length > 0) {
        prByUrl.set(pr.url.trim(), pr);
      }
    }

    let reportText = "";
    for (const task of completedAwaitingMerge) {
      const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch : null;
      const taskPrUrl = typeof task.pr_url === "string" ? task.pr_url.trim() : "";
      const pr = (workerBranch ? prByHeadBranch.get(workerBranch) : undefined) || (taskPrUrl ? prByUrl.get(taskPrUrl) : undefined);
      if (!pr) {
        task.status = "RUNNING";
        task.merge_indicator = "CI";
        reportText += `⏳ **CI/Review Merge Gate:** Task \`${task.id}\` stays in progress because no open feature PR could be matched.\n`;
        reportText += `   - Expected: PR with base \`${args.featureBranch}\` and matching worker branch or task PR URL.\n`;
        continue;
      }

      const checks = Array.isArray(pr.checks) ? pr.checks : [];
      const hasFailedChecks = checks.some((check) => this.isCiCheckFailed(check.status, check.conclusion));
      const hasPendingChecks = checks.length === 0 || checks.some((check) => this.isCiCheckPending(check.status, check.conclusion));
      const hasReviewBlockers = args.ciIntelligence.resolveAllCommentsBeforeFeatureMerge
        ? pr.reviewDecision === "CHANGES_REQUESTED" || pr.comments > 0
        : false;

      if (!hasFailedChecks && !hasPendingChecks && !hasReviewBlockers) {
        const retryKey = this.getCiAutofixRetryKey(task, pr.number);
        this.ciAutofixRetryCounts.delete(retryKey);
        if (args.ciIntelligence.autoMergeFeaturePrWhenGreen && this.deps.autoMergeFeaturePr) {
          const mergeResult = await this.deps.autoMergeFeaturePr({ repoPath: args.repoPath, prNumber: pr.number });
          if (mergeResult.ok) {
            task.is_merged = true;
            task.merge_indicator = "AUTOMERGE";
            await this.persistTaskMergedFlag(args.subtasksDir, task.id);
            reportText += `🤖 **Auto-Merged:** Task \`${task.id}\` was merged automatically (PR #${pr.number}).\n`;
          } else {
            reportText += `⚠️ **Auto-Merge Failed:** Task \`${task.id}\` (PR #${pr.number}) - ${mergeResult.message || "unknown error"}\n`;
            reportText += `   - Manual check: \`gh pr merge ${pr.number} --merge --delete-branch\`\n`;
          }
          continue;
        }
        task.merge_indicator = task.is_merged ? "MERGED" : undefined;
        reportText += `✅ **Feature PR Ready:** Task \`${task.id}\` can be approved for merge into \`${args.featureBranch}\` (PR #${pr.number}).\n`;
        continue;
      }

      task.status = "RUNNING";
      task.merge_indicator = hasReviewBlockers && !hasFailedChecks && !hasPendingChecks ? "MERGE_BLOCKED" : "CI";
      const ciStateLabel = hasFailedChecks ? "failed" : hasPendingChecks ? "pending" : "green";
      const header = args.ciIntelligence.waitForJulesCiAutofix ? "CI/Review Autofix Wait" : "CI/Review Merge Gate";
      reportText += `⏳ **${header}:** Task \`${task.id}\` stays in progress (PR #${pr.number}, branch \`${workerBranch || args.featureBranch}\`).\n`;
      reportText += `   - PR: ${pr.url}\n`;
      reportText += `   - CI Status: \`${ciStateLabel.toUpperCase()}\`\n`;
      reportText += `   - Check live: \`gh pr checks ${pr.number} --watch\`\n`;
      if (hasFailedChecks) {
        const failedChecks = checks
          .filter((check) => this.isCiCheckFailed(check.status, check.conclusion))
          .map((check) => check.name);
        const branchName = workerBranch || args.featureBranch;
        const failedRuns = this.selectFailedCiRuns(gitStatus, branchName);
        const failedJobLabels = this.getFailedJobLabels(failedRuns);
        reportText += `   - Failed checks: ${failedChecks.join(", ")}\n`;
        if (failedRuns.length > 0) {
          reportText += `   - Failed runs: ${this.summarizeFailedRuns(failedRuns)}\n`;
          reportText += `   - Failed run URLs: ${failedRuns.map((run) => run.url).filter((url) => url.length > 0).join(", ")}\n`;
        }
        if (failedJobLabels.length > 0) {
          reportText += `   - Failed jobs: ${failedJobLabels.join(", ")}\n`;
        }
        reportText += `   - Logs: \`gh run list --branch ${workerBranch || args.featureBranch} --event pull_request --limit 5\` and then \`gh run view <run-id> --log-failed\`\n`;
        if (args.ciIntelligence.waitForJulesCiAutofix) {
          const retryKey = this.getCiAutofixRetryKey(task, pr.number);
          const maxRetries = Math.max(0, args.ciIntelligence.julesCiAutofixMaxRetries);
          const currentRetries = this.ciAutofixRetryCounts.get(retryKey) || 0;
          if (currentRetries >= maxRetries) {
            const owner = this.resolveCiEscalationOwner(args.automationLevel);
            task.status = "BLOCKED";
            task.intervention_owner = owner;
            task.intervention_hint = `CI autofix retry limit reached (${currentRetries}/${maxRetries}) for task ${task.id} - PR: ${pr.url} - Failed checks: ${failedChecks.join(", ")} - Failed jobs: ${failedJobLabels.length > 0 ? failedJobLabels.join(", ") : "unknown jobs"} - Failed runs: ${this.summarizeFailedRuns(failedRuns)}`;
            reportText += `   - 🚨 CI autofix retries exhausted (${currentRetries}/${maxRetries}).\n`;
            reportText += `   - Escalation (${owner}): Task \`${task.id}\` has failing CI and cannot be merged yet.\n`;
            reportText += `   - PR Link: ${pr.url}\n`;
            reportText += `   - Required next action: fix failing checks, then continue merge flow.\n`;
            continue;
          }
          const notifyResult = await this.notifyJulesAboutFailedCi({
            task,
            prNumber: pr.number,
            prUrl: pr.url,
            branchName,
            failedChecks,
            failedRuns,
            attempt: currentRetries + 1,
            maxRetries,
          });
          this.ciAutofixRetryCounts.set(retryKey, currentRetries + 1);
          if (notifyResult.sent) {
            reportText += `   - Jules session notified to fix CI and continue work (attempt ${currentRetries + 1}/${maxRetries}).\n`;
          } else if (notifyResult.reason) {
            reportText += `   - CI autofix notify skipped: ${notifyResult.reason}\n`;
          }
        }
      }
      if (hasReviewBlockers) {
        reportText += `   - Review Blocker: \`reviewDecision=${pr.reviewDecision || "NONE"}\`, comments=${pr.comments}\n`;
        reportText += `   - Review comments: \`gh pr view ${pr.number} --comments\`\n`;
        reportText += `   - Inline reviews: \`gh api repos/{owner}/{repo}/pulls/${pr.number}/comments\`\n`;
      }
    }

    return { subtasks, reportText };
  }

  private async persistTaskMergedFlag(subtasksDir: string, taskId: string): Promise<void> {
    const filePath = path.join(subtasksDir, `${taskId}.md`);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      let updated = content;
      if (/^\s*merged:\s*(true|false)\s*$/m.test(content)) {
        updated = content.replace(/^\s*merged:\s*(true|false)\s*$/m, "merged: true");
      } else if (/^\s*prompt:\s*/m.test(content)) {
        updated = content.replace(/^\s*prompt:\s*/m, "merged: true\nprompt:");
      } else {
        updated = `${content.trimEnd()}\nmerged: true\n`;
      }
      if (updated !== content) {
        await fs.writeFile(filePath, updated, "utf-8");
      }
    } catch {
      // Keep runtime status update even if file persistence fails.
    }
  }

  private async renderMainMergeCiFeedback(args: {
    repoPath: string;
    featureBranch: string;
    defaultBranch: string;
    featureBranchPrefix: string;
    ciIntelligence: CiIntelligenceSettings;
    githubMode: "REMOTE" | "LOCAL";
  }): Promise<string> {
    if (
      !args.ciIntelligence.enabled ||
      !args.ciIntelligence.enableLivePrMonitoring ||
      !args.ciIntelligence.waitForCiBeforeMainMerge ||
      args.githubMode !== "REMOTE" ||
      !this.deps.getCiStatusForScope
    ) {
      return "";
    }

    const gitStatus = await this.deps.getCiStatusForScope({
      repoPath: args.repoPath,
      scope: "MAIN_MERGE_PR_CI",
      featureBranch: args.featureBranch,
      defaultBranch: args.defaultBranch,
      featureBranchPrefix: args.featureBranchPrefix,
    });

    if (!gitStatus?.available) {
      return "";
    }

    const mainMergePr = gitStatus.openPullRequests.find(
      (pr) => pr.baseRefName === args.defaultBranch && pr.headRefName === args.featureBranch
    );
    if (!mainMergePr) {
      return `\nℹ️ **Main CI Gate:** No open PR \`${args.featureBranch} -> ${args.defaultBranch}\` found. Create the PR and wait for CI.\n`;
    }

    const checks = Array.isArray(mainMergePr.checks) ? mainMergePr.checks : [];
    const hasFailedChecks = checks.some((check) => this.isCiCheckFailed(check.status, check.conclusion));
    const hasPendingChecks = checks.length === 0 || checks.some((check) => this.isCiCheckPending(check.status, check.conclusion));
    const hasReviewBlockers = mainMergePr.reviewDecision === "CHANGES_REQUESTED" || mainMergePr.comments > 0;

    let text = `\n### Main Merge CI Gate\n`;
    text += `- PR: ${mainMergePr.url}\n`;
    text += `- Check Status: \`${hasFailedChecks ? "FAILED" : hasPendingChecks ? "PENDING" : "SUCCESS"}\`\n`;
    text += `- Review Status: \`reviewDecision=${mainMergePr.reviewDecision || "NONE"}\`, comments=${mainMergePr.comments}\n`;
    text += `- Check live: \`gh pr checks ${mainMergePr.number} --watch\`\n`;

    if (hasFailedChecks) {
      const failedChecks = checks
        .filter((check) => this.isCiCheckFailed(check.status, check.conclusion))
        .map((check) => check.name);
      text += `- Failed checks: ${failedChecks.join(", ")}\n`;
      text += `- Logs: \`gh run list --branch ${args.featureBranch} --event pull_request --limit 5\` and \`gh run view <run-id> --log-failed\`\n`;
      text += `- Only approve merge into \`${args.defaultBranch}\` after checks are green.\n`;
    } else if (hasPendingChecks) {
      text += `- Only approve merge into \`${args.defaultBranch}\` once all required checks are green.\n`;
    } else if (hasReviewBlockers) {
      text += `- Merge into \`${args.defaultBranch}\` is blocked until open reviews/comments are resolved.\n`;
    } else {
      text += `- ✅ Required checks are green. Main merge can be approved (verify reviews/comments).\n`;
    }

    if (hasReviewBlockers) {
      text += `- Review comments: \`gh pr view ${mainMergePr.number} --comments\`\n`;
      text += `- Inline reviews: \`gh api repos/{owner}/{repo}/pulls/${mainMergePr.number}/comments\`\n`;
    }

    return `${text}\n`;
  }

  async execute(args: SprintAgentArgs): Promise<any> {
    const sprintsDir = path.join(args.repo_path, ".jules-subagents", "sprints");
    const subtasksDir = path.join(sprintsDir, `sprint${args.sprint_number}-subtasks`);
    const defaultFeatureBranch = args.feature_branch || `feature/sprint${args.sprint_number}-implementation`;
    const defaultBranch = typeof this.deps.settings.defaultBranch === "string" && this.deps.settings.defaultBranch.trim().length > 0
      ? this.deps.settings.defaultBranch
      : "main";
    const githubMode = this.deps.settings.githubMode === "LOCAL" ? "LOCAL" : "REMOTE";
    const retryFailed = args.retry_failed !== false;
    const loopSteps = this.getLoopStepSettings();
    const ciIntelligence = this.getCiIntelligenceSettings();
    const automationLevel = this.deps.getDashboardSettings().automationLevel;
    const automationInterventions = this.getAutomationInterventionsSettings();

    const enabledProviders = Object.entries(this.deps.getDashboardSettings().aiProvider.providers)
      .filter(([, provider]) => provider.enabled)
      .map(([provider]) => provider);
    if (enabledProviders.length === 0 && args.action !== "plan") {
      const text = [
        "### Provider Setup Required",
        "",
        "No AI providers are enabled in dashboard settings.",
        "Enable at least one provider in the AI Provider section, then retry orchestration.",
        "",
        "Tip: You can still run `sprint_agent(action: \"plan\")` before enabling providers.",
      ].join("\n");
      return { content: [{ type: "text", text }] };
    }

    if (loopSteps.branchPreflight && (args.action === "plan" || args.action === "orchestrate")) {
      const { existsLocal, existsRemote } = runBranchPreflightStep(args.repo_path, defaultFeatureBranch);
      if (!existsLocal || !existsRemote) {
        const branchBlocker = await this.renderBranchBlocker(args, defaultFeatureBranch, existsLocal, existsRemote);
        return { content: [{ type: "text", text: branchBlocker }] };
      }
    }

    if (loopSteps.planningPreflight && (args.action === "orchestrate" || args.action === "status")) {
      const hasSubtasks = await runPlanningPreflightStep(subtasksDir);
      if (!hasSubtasks) {
        const planningBlocker = await this.renderPlanningBlocker(args, subtasksDir);
        return { content: [{ type: "text", text: planningBlocker }] };
      }
    }

    if (this.deps.completedSprints.has(args.sprint_number)) {
      return { content: [{ type: "text", text: `Sprint ${args.sprint_number} has already been finished in this session.` }] };
    }

    if (args.action === "plan") {
      return await this.runPlanningAction(args, subtasksDir);
    }

    const supportsWatchMode = args.action === "orchestrate";
    const requestedWait = args.wait !== undefined ? args.wait : supportsWatchMode;
    const shouldWait = supportsWatchMode && requestedWait;
    const watchEnabled = shouldWait && loopSteps.watchLoop;
    const watchLoopIntervalMs = Math.max(1, loopSteps.watchLoopIntervalSeconds) * 1000;
    const watchLoopOutputIntervalMs = Math.max(60, loopSteps.watchLoopOutputIntervalSeconds) * 1000;

    if (watchEnabled) {
      let allFinished = false;
      const watchStartedAt = Date.now();
      const dashboardPort = this.deps.settings.dashboardPort || this.deps.dashboardPort;
      let fullReport = await this.renderInstruction(
        "watchHeader",
        {
          sprint_number: args.sprint_number,
          feature_branch: defaultFeatureBranch,
          dashboard_port: dashboardPort,
        },
        args.repo_path
      );
      fullReport += "\n";

      console.error(`Starting watch loop for Sprint ${args.sprint_number}...`);
      console.error(`Live dashboard available at http://localhost:${dashboardPort}`);

      while (!allFinished) {
        const { subtasks, reportText, statusTable, instructions, awaitingMerge } = await this.runOrchestrationCycle({
          action: args.action,
          automationLevel,
          automationInterventions,
          sprintNumber: args.sprint_number,
          repoPath: args.repo_path,
          sourceId: args.source_id,
          defaultFeatureBranch,
          subtasksDir,
          retryFailed,
          loopSteps,
          ciIntelligence,
          githubMode,
          defaultBranch,
          featureBranchPrefix: this.deps.getDashboardSettings().git.featureBranchPrefix,
        });

        const timestamp = new Date().toLocaleTimeString();
        this.deps.updateLastStatus({
          sprint_number: args.sprint_number,
          repo_path: args.repo_path,
          feature_branch: defaultFeatureBranch,
          subtasks,
          reportText,
          statusTable,
          instructions,
          timestamp,
        });

        const runningTasks = subtasks.filter((task) => task.status === "RUNNING");
        const readyTasks = subtasks.filter((task) => task.status === "PENDING" && task.is_independent);

        const allTerminal = subtasks.length > 0 && subtasks.every(
          (task) => (task.status === "COMPLETED" && task.is_merged) || task.status === "FAILED"
        );
        const noMoreActionPossible = runningTasks.length === 0 && readyTasks.length === 0;
        const needsManualMerge = awaitingMerge.length > 0;

        allFinished = allTerminal || noMoreActionPossible || needsManualMerge;
        const elapsedMs = Date.now() - watchStartedAt;
        const outputIntervalReached = elapsedMs >= watchLoopOutputIntervalMs;

        if (allFinished) {
          fullReport += reportText;
          fullReport += statusTable;
          fullReport += instructions;

          if (needsManualMerge) {
            fullReport += await this.renderInstruction("watchMergeRequired", {}, args.repo_path);
          } else if (subtasks.length > 0 && !allTerminal && noMoreActionPossible) {
            fullReport += await this.renderInstruction("watchNoMoreActions", {}, args.repo_path);
          }

          try {
            const watchGuide = await this.deps.getGuideContent("watch.md", args.repo_path);
            fullReport += `\n---\n\n### Watch Loop Operating Standard\n\n${watchGuide}`;
          } catch {
            // Guide is optional.
          }

          if (subtasks.length > 0 && subtasks.every((task) => task.status === "COMPLETED" && task.is_merged)) {
            try {
              this.deps.completedSprints.add(args.sprint_number);
              await fs.rm(subtasksDir, { recursive: true, force: true });
              fullReport += await this.renderInstruction("cleanupAllMerged", { subtasks_dir: subtasksDir }, args.repo_path);
              fullReport += await runCompletionStep({
                defaultBranch,
                featureBranch: defaultFeatureBranch,
                sprintNumber: args.sprint_number,
                githubMode,
                ciIntelligence,
                renderInstruction: (templateId, variables) => this.renderInstruction(templateId, variables, args.repo_path),
              });
              fullReport += await this.renderMainMergeCiFeedback({
                repoPath: args.repo_path,
                featureBranch: defaultFeatureBranch,
                defaultBranch,
                featureBranchPrefix: this.deps.getDashboardSettings().git.featureBranchPrefix,
                ciIntelligence,
                githubMode,
              });
            } catch (cleanupError) {
              console.error(`Warning: Failed to cleanup subtasks: ${cleanupError}`);
            }
          } else if (subtasks.some((task) => task.status === "FAILED")) {
            fullReport += await this.renderInstruction("cleanupFailed", { subtasks_dir: subtasksDir }, args.repo_path);
          } else if (subtasks.some((task) => task.status === "COMPLETED" && !task.is_merged)) {
            fullReport += await this.renderInstruction("cleanupDeferred", {}, args.repo_path);
          } else if (subtasks.length === 0) {
            fullReport += await this.renderInstruction("cleanupEmpty", {}, args.repo_path);
          }

          fullReport += "\n✅ **Sprint Execution Finished.**\n";
        } else if (outputIntervalReached) {
          const pendingTasks = subtasks.filter((task) => task.status === "PENDING");
          const completedTasks = subtasks.filter((task) => task.status === "COMPLETED");
          const failedTasks = subtasks.filter((task) => task.status === "FAILED");

          fullReport += reportText;
          fullReport += statusTable;
          fullReport += instructions;
          fullReport += await this.renderInstruction(
            "watchContinue",
            {
              elapsed_seconds: Math.floor(elapsedMs / 1000),
              action: args.action,
              running_tasks: runningTasks.length,
              pending_tasks: pendingTasks.length,
              completed_tasks: completedTasks.length,
              failed_tasks: failedTasks.length,
            },
            args.repo_path
          );
          return { content: [{ type: "text", text: fullReport }] };
        } else {
          await new Promise((resolve) => setTimeout(resolve, watchLoopIntervalMs));
        }
      }

      return { content: [{ type: "text", text: fullReport }] };
    }

    const { subtasks, reportText, statusTable, instructions } = await this.runOrchestrationCycle({
      action: args.action,
      automationLevel,
      automationInterventions,
      sprintNumber: args.sprint_number,
      repoPath: args.repo_path,
      sourceId: args.source_id,
      defaultFeatureBranch,
      subtasksDir,
      retryFailed,
      loopSteps,
      ciIntelligence,
      githubMode,
      defaultBranch,
      featureBranchPrefix: this.deps.getDashboardSettings().git.featureBranchPrefix,
    });

    const dashboardPort = this.deps.settings.dashboardPort || this.deps.dashboardPort;
    let report = `### Sprint ${args.sprint_number} Orchestration Report\n\n`;
    report += `**Feature Branch:** \`${defaultFeatureBranch}\`\n`;
    report += `**Dashboard:** [http://localhost:${dashboardPort}](http://localhost:${dashboardPort})\n\n`;

    if (args.action === "status" && args.wait) {
      report += "ℹ️ **Status Action is Instant:** Ignoring `wait: true` and returning a single-cycle status report.\n\n";
    } else if (shouldWait && !loopSteps.watchLoop) {
      report += "⚙️ **Watch Loop Disabled:** Running a single orchestration cycle because watch mode is disabled in settings.\n\n";
    }

    report += reportText;
    report += statusTable;
    report += instructions;

    try {
      const orchGuide = await this.deps.getGuideContent("orchestrator.md", args.repo_path);
      report += `\n---\n\n### Orchestration Guidance\n\n${orchGuide}`;
    } catch {
      // Guide is optional.
    }

    this.deps.updateLastStatus({
      sprint_number: args.sprint_number,
      repo_path: args.repo_path,
      feature_branch: defaultFeatureBranch,
      subtasks,
      reportText,
      statusTable,
      instructions,
      timestamp: new Date().toLocaleTimeString(),
    });

    return { content: [{ type: "text", text: report }] };
  }
}

export type { SprintAgentArgs } from "./sprint-types.js";
