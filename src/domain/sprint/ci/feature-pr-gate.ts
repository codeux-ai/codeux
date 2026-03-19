import { evaluateMergeReadiness } from "./feature-pr/merge-readiness-policy.js";
import { getCiAutofixRetryKey } from "./feature-pr/ci-autofix-policy.js";
import { matchMergedPrForTask, matchPrForTask } from "./feature-pr/pr-matcher.js";
import { attemptAutoMerge } from "./feature-pr/automerge-policy.js";
import { evaluateInProgressState } from "./feature-pr/in-progress-policy.js";
import {
  buildMergeConfirmedText,
  buildMergeReadyText,
  buildNoPrFoundText,
} from "./feature-pr/ci-notification-builder.js";
import type {
  AutomationLevel,
  CiIntelligenceSettings,
  GitTrackingStatus,
  Subtask,
  AutoMergeFeaturePrResult,
} from "../../../contracts/app-types.js";
import type { ExecutionRepository } from "../../../repositories/execution-repository.js";
import type { WorkerCiFixPayload } from "./feature-pr/ci-autofix-policy.js";

export interface CiGateContext {
  automationLevel: AutomationLevel;
  repoPath: string;
  featureBranch: string;
  defaultBranch: string;
  featureBranchPrefix: string;
  ciIntelligence: CiIntelligenceSettings;
  githubMode: "REMOTE" | "LOCAL";
  gitStatus: GitTrackingStatus | null;
  ciAutofixRetryCounts: Map<string, number>;
  isJulesApiConfigured: () => boolean;
  sendSessionMessage: (sessionId: string, message: string) => Promise<void>;
  autoMergeFeaturePr?: (args: { repoPath: string; prNumber: number }) => Promise<AutoMergeFeaturePrResult>;
  persistMergedTask: (task: Subtask) => Promise<void>;
  executionRepository?: ExecutionRepository;
  sprintRunId?: string;
  openCiFixAttention?: (task: Subtask, payload: WorkerCiFixPayload) => void;
}

export interface CiGateResult {
  subtasks: Subtask[];
  reportText: string;
}

export class FeaturePrGateService {
  async evaluateCiGate(subtasks: Subtask[], context: CiGateContext): Promise<CiGateResult> {
    const updatedSubtasks = [...subtasks];
    for (const task of updatedSubtasks) {
      task.merge_indicator = task.is_merged
        ? "MERGED"
        : task.merge_indicator === "MERGE_CONFLICT"
          ? "MERGE_CONFLICT"
          : undefined;
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

    const completedAwaitingMerge = updatedSubtasks.filter((task) => (
      task.status === "COMPLETED"
      && !task.is_merged
      && (
        (typeof task.worker_branch === "string" && task.worker_branch.trim().length > 0)
        || (typeof task.pr_url === "string" && task.pr_url.trim().length > 0)
      )
    ));
    if (completedAwaitingMerge.length === 0) {
      return { subtasks: updatedSubtasks, reportText: "" };
    }

    if (!context.gitStatus?.available) {
      return { subtasks: updatedSubtasks, reportText: "" };
    }

    let reportText = "";
    for (const task of completedAwaitingMerge) {
      const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch : null;
      const pr = matchPrForTask(task, context.gitStatus);
      const mergedPr = matchMergedPrForTask(task, context.gitStatus);

      if (mergedPr) {
        task.status = "COMPLETED";
        task.is_merged = true;
        task.merge_indicator = task.merge_indicator === "AUTOMERGE" ? "AUTOMERGE" : "MERGED";
        await this.persistMergedTask(task, context);
        this.appendCiGateEvent(task, context, "merge_confirmed", {
          prNumber: mergedPr.number,
          prUrl: mergedPr.url,
          mergedAt: mergedPr.mergedAt,
        });
        reportText += buildMergeConfirmedText(task.id, mergedPr.number, context.featureBranch);
        continue;
      }

      if (!pr) {
        task.status = "RUNNING";
        task.merge_indicator = "CI";
        this.appendCiGateEvent(task, context, "waiting_for_pr", {
          featureBranch: context.featureBranch,
        });
        reportText += buildNoPrFoundText(task.id, context.featureBranch);
        continue;
      }

      const checks = Array.isArray(pr.checks) ? pr.checks : [];
      const waitForFeatureCi = context.ciIntelligence.waitForCiBeforeFeatureMerge;
      const resolveAllCommentsBeforeFeatureMerge = context.ciIntelligence.resolveAllCommentsBeforeFeatureMerge;

      const { hasFailedChecks, hasPendingChecks, hasReviewBlockers, isMergeReady } = evaluateMergeReadiness(
        checks,
        waitForFeatureCi,
        resolveAllCommentsBeforeFeatureMerge,
        pr.reviewDecision,
        pr.comments
      );

      const autoMergeMode = context.ciIntelligence.featurePrAutoMergeMode;
      const shouldAutoMergeAlways = autoMergeMode === "ALWAYS" && !waitForFeatureCi;
      const shouldAutoMergeWhenGreen = autoMergeMode === "WHEN_GREEN" || (autoMergeMode === "ALWAYS" && waitForFeatureCi);

      if (shouldAutoMergeAlways && !hasReviewBlockers && context.autoMergeFeaturePr) {
        const mergeAttempt = await attemptAutoMerge({
          task,
          prNumber: pr.number,
          repoPath: context.repoPath,
          mode: "always",
          autoMergeFeaturePr: context.autoMergeFeaturePr,
          persistMergedTask: context.persistMergedTask,
        });
        reportText += mergeAttempt.reportText;
        this.appendCiGateEvent(task, context, mergeAttempt.state === "merged"
          ? "automerge_succeeded"
          : mergeAttempt.state === "scheduled"
            ? "automerge_scheduled"
            : mergeAttempt.state === "conflict"
              ? "automerge_conflict"
            : "automerge_failed", {
          prNumber: pr.number,
          prUrl: pr.url,
          mode: "always",
        });
        if (task.is_merged) continue;
      }

      if (isMergeReady) {
        const retryKey = getCiAutofixRetryKey(task, pr.number);
        context.ciAutofixRetryCounts.delete(retryKey);

        if (shouldAutoMergeWhenGreen && context.autoMergeFeaturePr) {
          const mergeAttempt = await attemptAutoMerge({
            task,
            prNumber: pr.number,
            repoPath: context.repoPath,
            mode: "when_green",
            autoMergeFeaturePr: context.autoMergeFeaturePr,
            persistMergedTask: context.persistMergedTask,
          });
          reportText += mergeAttempt.reportText;
          this.appendCiGateEvent(task, context, mergeAttempt.state === "merged"
            ? "automerge_succeeded"
            : mergeAttempt.state === "scheduled"
              ? "automerge_scheduled"
              : mergeAttempt.state === "conflict"
                ? "automerge_conflict"
              : "automerge_failed", {
            prNumber: pr.number,
            prUrl: pr.url,
            mode: "when_green",
          });
          continue;
        }

        task.merge_indicator = task.is_merged
          ? "MERGED"
          : task.merge_indicator === "MERGE_CONFLICT"
            ? "MERGE_CONFLICT"
            : undefined;
        this.appendCiGateEvent(task, context, "ready_for_merge", {
          prNumber: pr.number,
          prUrl: pr.url,
        });
        reportText += buildMergeReadyText(task.id, pr.number, context.featureBranch);
        continue;
      }

      const inProgressResult = await evaluateInProgressState({
        task,
        pr,
        checks,
        hasFailedChecks,
        hasPendingChecks,
        hasReviewBlockers,
        workerBranch,
        featureBranch: context.featureBranch,
        gitStatus: context.gitStatus,
        ciIntelligence: context.ciIntelligence,
        automationLevel: context.automationLevel,
        ciAutofixRetryCounts: context.ciAutofixRetryCounts,
        isJulesApiConfigured: context.isJulesApiConfigured,
        sendSessionMessage: context.sendSessionMessage,
        repoPath: context.repoPath,
        defaultBranch: context.defaultBranch,
      });
      reportText += inProgressResult.reportText;

      if (inProgressResult.workerCiFixRequired && inProgressResult.workerCiFixPayload && context.openCiFixAttention) {
        context.openCiFixAttention(task, inProgressResult.workerCiFixPayload);
      }

      this.appendCiGateEvent(task, context, task.status === "BLOCKED" ? "blocked" : "waiting_checks", {
        prNumber: pr.number,
        prUrl: pr.url,
        hasFailedChecks,
        hasPendingChecks,
        hasReviewBlockers,
        mergeIndicator: task.merge_indicator || null,
        interventionOwner: task.intervention_owner || null,
      });
      if ((task.status as string) === "BLOCKED") continue;
    }

    return { subtasks: updatedSubtasks, reportText };
  }

  private appendCiGateEvent(
    task: Subtask,
    context: CiGateContext,
    state: string,
    payload: Record<string, unknown>,
  ): void {
    if (!context.executionRepository || !context.sprintRunId || !task.record_id) {
      return;
    }

    const taskRun = context.executionRepository.getLatestTaskRun(task.record_id, context.sprintRunId);
    if (!taskRun) {
      return;
    }

    const sourceEventKey = [
      "ci-gate",
      state,
      String(payload.prNumber || "none"),
      payload.hasFailedChecks ? "failed" : "ok",
      payload.hasPendingChecks ? "pending" : "settled",
      payload.hasReviewBlockers ? "review" : "clear",
      String(payload.mode || "manual"),
      String(payload.mergeIndicator || task.merge_indicator || ""),
    ].join(":");

    context.executionRepository.appendTaskRunEvent(taskRun.id, "ci_gate_status", "system", {
      state,
      taskId: task.id,
      ...payload,
    }, {
      sourceEventKey,
    });
  }

  private async persistMergedTask(task: Subtask, context: CiGateContext): Promise<void> {
    try {
      await context.persistMergedTask(task);
    } catch {
      // Preserve in-memory merged state even if persistence fails.
    }
  }
}
