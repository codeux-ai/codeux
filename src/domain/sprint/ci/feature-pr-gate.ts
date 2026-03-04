import * as fs from "fs/promises";
import * as path from "path";
import {
  isCiFailure,
  isCiPending,
  selectFailedCiRuns,
  getFailedJobLabels,
  summarizeFailedRuns,
  getFailedLogSnippets,
} from "../../../sprint/ci-status-utils.js";
import {
  isJulesManagedTask,
  resolveTaskSessionId,
} from "../../../sprint/action-required-automation.js";
import type {
  AutomationLevel,
  CiIntelligenceSettings,
  GitCiRunStatus,
  GitTrackingStatus,
  Subtask,
} from "../../../contracts/app-types.js";

export interface CiGateContext {
  automationLevel: AutomationLevel;
  repoPath: string;
  subtasksDir: string;
  featureBranch: string;
  defaultBranch: string;
  featureBranchPrefix: string;
  ciIntelligence: CiIntelligenceSettings;
  githubMode: "REMOTE" | "LOCAL";
  gitStatus: GitTrackingStatus | null;
  ciAutofixRetryCounts: Map<string, number>;
  isJulesApiConfigured: () => boolean;
  sendSessionMessage: (sessionId: string, message: string) => Promise<void>;
  autoMergeFeaturePr?: (args: { repoPath: string; prNumber: number }) => Promise<{ ok: boolean; message?: string }>;
}

export interface CiGateResult {
  subtasks: Subtask[];
  reportText: string;
}

export class FeaturePrGateService {
  async evaluateCiGate(subtasks: Subtask[], context: CiGateContext): Promise<CiGateResult> {
    const updatedSubtasks = [...subtasks];
    for (const task of updatedSubtasks) {
      task.merge_indicator = task.is_merged ? "MERGED" : undefined;
      if (task.status === "COMPLETED") {
        task.intervention_owner = undefined;
        task.intervention_hint = undefined;
      }
    }

    if (
      !context.ciIntelligence.enabled ||
      context.githubMode !== "REMOTE" ||
      (!context.ciIntelligence.enableLivePrMonitoring && context.ciIntelligence.featurePrAutoMergeMode === "OFF")
    ) {
      return { subtasks: updatedSubtasks, reportText: "" };
    }

    const completedAwaitingMerge = updatedSubtasks.filter(
      (task) => task.status === "COMPLETED" && !task.is_merged
    );
    if (completedAwaitingMerge.length === 0) {
      return { subtasks: updatedSubtasks, reportText: "" };
    }

    if (!context.gitStatus?.available) {
      return { subtasks: updatedSubtasks, reportText: "" };
    }

    const prByHeadBranch = new Map<string, (typeof context.gitStatus.openPullRequests)[number]>();
    const prByUrl = new Map<string, (typeof context.gitStatus.openPullRequests)[number]>();
    for (const pr of context.gitStatus.openPullRequests) {
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
      const pr =
        (workerBranch ? prByHeadBranch.get(workerBranch) : undefined) ||
        (taskPrUrl ? prByUrl.get(taskPrUrl) : undefined);

      if (!pr) {
        task.status = "RUNNING";
        task.merge_indicator = "CI";
        reportText += `⏳ **CI/Review Merge Gate:** Task \`${task.id}\` stays in progress because no open feature PR could be matched.\n`;
        reportText += `   - Expected: PR with base \`${context.featureBranch}\` and matching worker branch or task PR URL.\n`;
        continue;
      }

      const checks = Array.isArray(pr.checks) ? pr.checks : [];
      const waitForFeatureCi = context.ciIntelligence.waitForCiBeforeFeatureMerge;
      const hasFailedChecks = waitForFeatureCi
        ? checks.some((check) => isCiFailure(check.status, check.conclusion))
        : false;
      const hasPendingChecks = waitForFeatureCi
        ? checks.length === 0 || checks.some((check) => isCiPending(check.status, check.conclusion))
        : false;
      const hasReviewBlockers = context.ciIntelligence.resolveAllCommentsBeforeFeatureMerge
        ? pr.reviewDecision === "CHANGES_REQUESTED" || pr.comments > 0
        : false;

      const autoMergeMode = context.ciIntelligence.featurePrAutoMergeMode;
      const shouldAutoMergeAlways = autoMergeMode === "ALWAYS";
      const shouldAutoMergeWhenGreen = autoMergeMode === "WHEN_GREEN";
      const isMergeReady = !hasFailedChecks && !hasPendingChecks && !hasReviewBlockers;

      if (shouldAutoMergeAlways && !hasReviewBlockers && context.autoMergeFeaturePr) {
        const mergeResult = await context.autoMergeFeaturePr({
          repoPath: context.repoPath,
          prNumber: pr.number,
        });
        if (mergeResult.ok) {
          task.is_merged = true;
          task.merge_indicator = "AUTOMERGE";
          await this.persistTaskMergedFlag(context.subtasksDir, task.id);
          reportText += `🤖 **Auto-Merged:** Task \`${task.id}\` was merged automatically (PR #${pr.number}, mode: always).\n`;
          continue;
        }
        reportText += `⚠️ **Auto-Merge Failed:** Task \`${task.id}\` (PR #${pr.number}, mode: always) - ${
          mergeResult.message || "unknown error"
        }\n`;
      }

      if (isMergeReady) {
        const retryKey = this.getCiAutofixRetryKey(task, pr.number);
        context.ciAutofixRetryCounts.delete(retryKey);
        if (shouldAutoMergeWhenGreen && context.autoMergeFeaturePr) {
          const mergeResult = await context.autoMergeFeaturePr({
            repoPath: context.repoPath,
            prNumber: pr.number,
          });
          if (mergeResult.ok) {
            task.is_merged = true;
            task.merge_indicator = "AUTOMERGE";
            await this.persistTaskMergedFlag(context.subtasksDir, task.id);
            reportText += `🤖 **Auto-Merged:** Task \`${task.id}\` was merged automatically (PR #${pr.number}).\n`;
          } else {
            reportText += `⚠️ **Auto-Merge Failed:** Task \`${task.id}\` (PR #${pr.number}) - ${
              mergeResult.message || "unknown error"
            }\n`;
            reportText += `   - Manual check: \`gh pr merge ${pr.number} --merge --delete-branch\`\n`;
          }
          continue;
        }
        task.merge_indicator = task.is_merged ? "MERGED" : undefined;
        reportText += `✅ **Feature PR Ready:** Task \`${task.id}\` can be approved for merge into \`${context.featureBranch}\` (PR #${pr.number}).\n`;
        continue;
      }

      task.status = "RUNNING";
      task.merge_indicator = hasReviewBlockers && !hasFailedChecks && !hasPendingChecks ? "MERGE_BLOCKED" : "CI";
      const ciStateLabel = hasFailedChecks ? "failed" : hasPendingChecks ? "pending" : "green";
      const header = context.ciIntelligence.waitForJulesCiAutofix ? "CI/Review Autofix Wait" : "CI/Review Merge Gate";
      reportText += `⏳ **${header}:** Task \`${task.id}\` stays in progress (PR #${pr.number}, branch \`${
        workerBranch || context.featureBranch
      }\`).\n`;
      reportText += `   - PR: ${pr.url}\n`;
      reportText += `   - CI Status: \`${ciStateLabel.toUpperCase()}\`\n`;
      reportText += `   - Check live: \`gh pr checks ${pr.number} --watch\`\n`;

      if (hasFailedChecks) {
        const failedChecks = checks
          .filter((check) => isCiFailure(check.status, check.conclusion))
          .map((check) => check.name);
        const branchName = workerBranch || context.featureBranch;
        const failedRuns = selectFailedCiRuns(context.gitStatus, branchName);
        const failedJobLabels = getFailedJobLabels(failedRuns);
        reportText += `   - Failed checks: ${failedChecks.join(", ")}\n`;
        if (failedRuns.length > 0) {
          reportText += `   - Failed runs: ${summarizeFailedRuns(failedRuns)}\n`;
          reportText += `   - Failed run URLs: ${failedRuns
            .map((run) => run.url)
            .filter((url) => url.length > 0)
            .join(", ")}\n`;
        }
        if (failedJobLabels.length > 0) {
          reportText += `   - Failed jobs: ${failedJobLabels.join(", ")}\n`;
        }
        reportText += `   - Logs: \`gh run list --branch ${
          workerBranch || context.featureBranch
        } --event pull_request --limit 5\` and then \`gh run view <run-id> --log-failed\`\n`;

        if (context.ciIntelligence.waitForJulesCiAutofix) {
          const retryKey = this.getCiAutofixRetryKey(task, pr.number);
          const maxRetries = Math.max(0, context.ciIntelligence.julesCiAutofixMaxRetries);
          const currentRetries = context.ciAutofixRetryCounts.get(retryKey) || 0;

          if (currentRetries >= maxRetries) {
            const owner = this.resolveCiEscalationOwner(context.automationLevel);
            task.status = "BLOCKED";
            task.intervention_owner = owner;
            task.intervention_hint = `CI autofix retry limit reached (${currentRetries}/${maxRetries}) for task ${
              task.id
            } - PR: ${pr.url} - Failed checks: ${failedChecks.join(", ")} - Failed jobs: ${
              failedJobLabels.length > 0 ? failedJobLabels.join(", ") : "unknown jobs"
            } - Failed runs: ${summarizeFailedRuns(failedRuns)}`;
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
            isJulesApiConfigured: context.isJulesApiConfigured,
            sendSessionMessage: context.sendSessionMessage,
          });
          context.ciAutofixRetryCounts.set(retryKey, currentRetries + 1);
          if (notifyResult.sent) {
            reportText += `   - Jules session notified to fix CI and continue work (attempt ${
              currentRetries + 1
            }/${maxRetries}).\n`;
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

    return { subtasks: updatedSubtasks, reportText };
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
    isJulesApiConfigured: () => boolean;
    sendSessionMessage: (sessionId: string, message: string) => Promise<void>;
  }): Promise<{ sent: boolean; reason?: string }> {
    if (!isJulesManagedTask(args.task)) {
      return { sent: false, reason: "Task is not Jules-managed." };
    }
    if (!args.isJulesApiConfigured()) {
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

    await args.sendSessionMessage(sessionId, prompt);
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
