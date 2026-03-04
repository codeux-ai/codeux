import * as fs from "fs/promises";
import * as path from "path";
import { evaluateMergeReadiness } from "./feature-pr/merge-readiness-policy.js";
import { getCiAutofixRetryKey } from "./feature-pr/ci-autofix-policy.js";
import { matchPrForTask } from "./feature-pr/pr-matcher.js";
import { attemptAutoMerge } from "./feature-pr/automerge-policy.js";
import { evaluateInProgressState } from "./feature-pr/in-progress-policy.js";
import { buildNoPrFoundText, buildMergeReadyText } from "./feature-pr/ci-notification-builder.js";
import type {
  AutomationLevel,
  CiIntelligenceSettings,
  GitCiRunStatus,
  GitTrackingStatus,
  Subtask,
} from "../../../contracts/app-types.js";
import type { SubtaskFileRepository } from "../../../infrastructure/repositories/subtask-file-repository.js";

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
  subtaskFileRepository: SubtaskFileRepository;
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

    let reportText = "";
    for (const task of completedAwaitingMerge) {
      const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch : null;
      const pr = matchPrForTask(task, context.gitStatus);

      if (!pr) {
        task.status = "RUNNING";
        task.merge_indicator = "CI";
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
      const shouldAutoMergeAlways = autoMergeMode === "ALWAYS";
      const shouldAutoMergeWhenGreen = autoMergeMode === "WHEN_GREEN";

      if (shouldAutoMergeAlways && !hasReviewBlockers && context.autoMergeFeaturePr) {
        reportText += await attemptAutoMerge({
          task,
          prNumber: pr.number,
          repoPath: context.repoPath,
          subtasksDir: context.subtasksDir,
          mode: "always",
          autoMergeFeaturePr: context.autoMergeFeaturePr,
          subtaskFileRepository: context.subtaskFileRepository,
        });
        if (task.is_merged) continue;
      }

      if (isMergeReady) {
        const retryKey = getCiAutofixRetryKey(task, pr.number);
        context.ciAutofixRetryCounts.delete(retryKey);

        if (shouldAutoMergeWhenGreen && context.autoMergeFeaturePr) {
          reportText += await attemptAutoMerge({
            task,
            prNumber: pr.number,
            repoPath: context.repoPath,
            subtasksDir: context.subtasksDir,
            mode: "when_green",
            autoMergeFeaturePr: context.autoMergeFeaturePr,
            subtaskFileRepository: context.subtaskFileRepository,
          });
          continue;
        }

        task.merge_indicator = task.is_merged ? "MERGED" : undefined;
        reportText += buildMergeReadyText(task.id, pr.number, context.featureBranch);
        continue;
      }

      reportText += await evaluateInProgressState({
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
      });
      if ((task.status as string) === "BLOCKED") continue;
    }

    return { subtasks: updatedSubtasks, reportText };
  }
}
