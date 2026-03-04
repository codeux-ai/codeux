import * as fs from "fs/promises";
import * as path from "path";
import type { InstructionTemplateId } from "../../../instructions/instruction-template-catalog.js";
import { applyActionRequiredAutomation, isJulesManagedTask, resolveTaskSessionId } from "../../../sprint/action-required-automation.js";
import {
  getFailedJobLabels,
  getFailedLogSnippets,
  isCiCheckFailed,
  isCiCheckPending,
  selectFailedCiRuns,
  summarizeFailedRuns,
} from "../../../sprint/ci-status-utils.js";
import { runLoadSubtasksStep } from "../../../sprint/steps/load-subtasks-step.js";
import { runSessionSyncStep } from "../../../sprint/steps/session-sync-step.js";
import { runStatusDerivationStep } from "../../../sprint/steps/status-derivation-step.js";
import { runStartReadyTasksStep } from "../../../sprint/steps/start-ready-tasks-step.js";
import { runStatusTableStep } from "../../../sprint/steps/status-table-step.js";
import { runProtocolStep } from "../../../sprint/steps/protocol-step.js";
import type { SprintCycleResult } from "../../../sprint/sprint-types.js";
import type {
  AutomationInterventionsSettings,
  AutomationLevel,
  CiIntelligenceSettings,
  GitCiRunStatus,
  SprintLoopStepSettings,
  Subtask,
} from "../../../contracts/app-types.js";
import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";

export interface CycleRunnerArgs {
  action: "status" | "orchestrate";
  automationLevel: AutomationLevel;
  automationInterventions: AutomationInterventionsSettings;
  sprintNumber: number;
  repoPath: string;
  sourceId?: string;
  defaultFeatureBranch: string;
  subtasksDir: string;
  retryFailed: boolean;
  loopSteps: SprintLoopStepSettings;
  ciIntelligence: CiIntelligenceSettings;
  githubMode: "REMOTE" | "LOCAL";
  defaultBranch: string;
  featureBranchPrefix: string;
}

export class CycleRunner {
  private readonly ciAutofixRetryCounts = new Map<string, number>();

  constructor(private readonly deps: SprintOrchestratorDependencies) {}

  async run(args: CycleRunnerArgs): Promise<SprintCycleResult & { awaitingMerge: Subtask[] }> {
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
        args.retryFailed,
        {
          repoPath: args.repoPath,
          sprintNumber: args.sprintNumber,
        }
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
      const interventionResult = await applyActionRequiredAutomation(subtasks, {
        automationLevel: args.automationLevel,
        settings: args.automationInterventions,
        isActionRequiredState: this.deps.isActionRequiredState,
        isJulesApiConfigured: this.deps.isJulesApiConfigured,
        approveSessionPlan: this.deps.approveSessionPlan,
        sendSessionMessage: this.deps.sendSessionMessage,
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
      renderInstruction: (templateId, variables) => this.deps.renderInstruction(templateId, variables, args.repoPath),
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
      args.githubMode !== "REMOTE" ||
      !this.deps.getCiStatusForScope ||
      (!args.ciIntelligence.enableLivePrMonitoring && args.ciIntelligence.featurePrAutoMergeMode === "OFF")
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
      const waitForFeatureCi = args.ciIntelligence.waitForCiBeforeFeatureMerge;
      const hasFailedChecks = waitForFeatureCi
        ? checks.some((check) => isCiCheckFailed(check.status, check.conclusion))
        : false;
      const hasPendingChecks = waitForFeatureCi
        ? checks.length === 0 || checks.some((check) => isCiCheckPending(check.status, check.conclusion))
        : false;
      const hasReviewBlockers = args.ciIntelligence.resolveAllCommentsBeforeFeatureMerge
        ? pr.reviewDecision === "CHANGES_REQUESTED" || pr.comments > 0
        : false;

      const autoMergeMode = args.ciIntelligence.featurePrAutoMergeMode;
      const shouldAutoMergeAlways = autoMergeMode === "ALWAYS";
      const shouldAutoMergeWhenGreen = autoMergeMode === "WHEN_GREEN";
      const isMergeReady = !hasFailedChecks && !hasPendingChecks && !hasReviewBlockers;

      if (shouldAutoMergeAlways && !hasReviewBlockers && this.deps.autoMergeFeaturePr) {
        const mergeResult = await this.deps.autoMergeFeaturePr({ repoPath: args.repoPath, prNumber: pr.number });
        if (mergeResult.ok) {
          task.is_merged = true;
          task.merge_indicator = "AUTOMERGE";
          await this.persistTaskMergedFlag(args.subtasksDir, task.id);
          reportText += `🤖 **Auto-Merged:** Task \`${task.id}\` was merged automatically (PR #${pr.number}, mode: always).\n`;
          continue;
        }
        reportText += `⚠️ **Auto-Merge Failed:** Task \`${task.id}\` (PR #${pr.number}, mode: always) - ${mergeResult.message || "unknown error"}\n`;
      }

      if (isMergeReady) {
        const retryKey = this.getCiAutofixRetryKey(task, pr.number);
        this.ciAutofixRetryCounts.delete(retryKey);
        if (shouldAutoMergeWhenGreen && this.deps.autoMergeFeaturePr) {
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
          .filter((check) => isCiCheckFailed(check.status, check.conclusion))
          .map((check) => check.name);
        const branchName = workerBranch || args.featureBranch;
        const failedRuns = selectFailedCiRuns(gitStatus, branchName);
        const failedJobLabels = getFailedJobLabels(failedRuns);
        reportText += `   - Failed checks: ${failedChecks.join(", ")}\n`;
        if (failedRuns.length > 0) {
          reportText += `   - Failed runs: ${summarizeFailedRuns(failedRuns)}\n`;
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
            task.intervention_hint = `CI autofix retry limit reached (${currentRetries}/${maxRetries}) for task ${task.id} - PR: ${pr.url} - Failed checks: ${failedChecks.join(", ")} - Failed jobs: ${failedJobLabels.length > 0 ? failedJobLabels.join(", ") : "unknown jobs"} - Failed runs: ${summarizeFailedRuns(failedRuns)}`;
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

  private getCiAutofixRetryKey(task: Subtask, prNumber: number): string {
    const sessionId = resolveTaskSessionId(task) || task.id;
    return `${sessionId}:${prNumber}`;
  }

  private resolveCiEscalationOwner(automationLevel: AutomationLevel): "AGENT" | "HUMAN" {
    return automationLevel === "FULL" ? "AGENT" : "HUMAN";
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
    if (!isJulesManagedTask(args.task)) {
      return { sent: false, reason: "Task is not Jules-managed." };
    }
    if (!this.deps.isJulesApiConfigured()) {
      return { sent: false, reason: "Jules API key is not configured." };
    }
    const sessionId = resolveTaskSessionId(args.task);
    if (!sessionId) {
      return { sent: false, reason: "No session id available." };
    }

    const failedChecksLine = args.failedChecks.length > 0 ? args.failedChecks.join(", ") : "unknown checks";
    const failedRunsLine = summarizeFailedRuns(args.failedRuns);
    const failedJobsLine = getFailedJobLabels(args.failedRuns);
    const failedLogSnippets = getFailedLogSnippets(args.failedRuns);
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
}
