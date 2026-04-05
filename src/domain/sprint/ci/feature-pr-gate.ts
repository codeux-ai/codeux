import { evaluateMergeReadiness } from "./feature-pr/merge-readiness-policy.js";
import { getCiAutofixRetryKey } from "./feature-pr/ci-autofix-policy.js";
import { matchMergedPrForTask, matchPrForTask } from "./feature-pr/pr-matcher.js";
import { attemptAutoMerge } from "./feature-pr/automerge-policy.js";
import { evaluateInProgressState } from "./feature-pr/in-progress-policy.js";
import {
  buildCiWaitSkippedText,
  buildMergeConflictText,
  buildMergeConfirmedText,
  buildMergeReadyText,
  buildNoPrFoundText,
} from "./feature-pr/ci-notification-builder.js";
import {
  detectPullRequestCiSupport,
  type PullRequestCiSupportResult,
} from "./feature-pr/workflow-ci-detection.js";
import type { Logger } from "../../../shared/logging/logger.js";
import type {
  AutomationLevel,
  CiIntelligenceSettings,
  GitTrackingStatus,
  Subtask,
  AutoMergeFeaturePrResult,
} from "../../../contracts/app-types.js";
import type { ExecutionRepository } from "../../../repositories/execution-repository.js";
import type { WorkerCiFixPayload } from "./feature-pr/ci-autofix-policy.js";
import { isCompletedTaskAwaitingMerge, isCompletedTaskSettled, taskHasMergeEvidence, isTaskCodeComplete } from "../task-merge-state.js";
import type { TaskQaMergeGateStatus } from "../../../services/quality-assurance-service.js";

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
  hasActiveWorkerCiFixAttempt?: (task: Subtask, prNumber: number) => boolean;
  evaluateTaskQaGate?: (task: Subtask) => TaskQaMergeGateStatus;
  logger?: Logger;
}

export interface CiGateResult {
  subtasks: Subtask[];
  reportText: string;
}

export class FeaturePrGateService {
  async evaluateCiGate(subtasks: Subtask[], context: CiGateContext): Promise<CiGateResult> {
    const updatedSubtasks = [...subtasks];
    const tasksToPersist: Subtask[] = [];
    for (const task of updatedSubtasks) {
      const previousStatus = task.status;
      const previousMergeIndicator = task.merge_indicator;
      task.merge_indicator = task.is_merged
        ? (task.merge_indicator === "AUTOMERGE" ? "AUTOMERGE" : "MERGED")
        : task.merge_indicator === "MERGE_CONFLICT"
          ? "MERGE_CONFLICT"
          : taskHasMergeEvidence(task)
            ? task.merge_indicator
            : undefined;
      if (task.status === "COMPLETED" && taskHasMergeEvidence(task) && !task.is_merged) {
        task.status = "CODING_COMPLETED";
      }
      if (task.status === "CODING_COMPLETED" && isCompletedTaskSettled(task)) {
        task.status = "COMPLETED";
      }
      if (task.status === "CODING_COMPLETED" || task.status === "COMPLETED") {
        task.intervention_owner = undefined;
        task.intervention_hint = undefined;
      }
      if (task.record_id && (task.status !== previousStatus || task.merge_indicator !== previousMergeIndicator)) {
        tasksToPersist.push(task);
      }
    }

    if (tasksToPersist.length > 0) {
      await Promise.all(
        tasksToPersist.map((task) =>
          context.persistMergedTask(task).catch(() => {
            // Preserve in-memory merged state even if persistence fails.
          })
        )
      );
    }

    if (
      !context.ciIntelligence.enabled ||
      context.githubMode !== "REMOTE" ||
      (!context.ciIntelligence.enableLivePrMonitoring && context.ciIntelligence.featurePrAutoMergeMode === "OFF")
    ) {
      return { subtasks: updatedSubtasks, reportText: "" };
    }

    const completedAwaitingMerge = updatedSubtasks.filter((task) => isCompletedTaskAwaitingMerge(task));
    if (completedAwaitingMerge.length === 0) {
      return { subtasks: updatedSubtasks, reportText: "" };
    }

    if (!context.gitStatus?.available) {
      return { subtasks: updatedSubtasks, reportText: "" };
    }

    const processResults = await Promise.all(
      completedAwaitingMerge.map((task) =>
        this.processTask(task, context).catch((err) => {
          context.logger?.error(`Error processing task ${task.id}:`, { error: err });
          return { reportText: "", events: [], attentionItem: undefined };
        })
      )
    );

    let reportText = "";
    for (let i = 0; i < completedAwaitingMerge.length; i++) {
      const task = completedAwaitingMerge[i];
      const result = processResults[i];
      if (result) {
        reportText += result.reportText;
        for (const event of result.events) {
          this.appendCiGateEvent(task, context, event.state, event.payload);
        }
        if (result.attentionItem && context.openCiFixAttention) {
          context.openCiFixAttention(task, result.attentionItem);
        }
      }
    }

    return { subtasks: updatedSubtasks, reportText };
  }


  private async processTask(
    task: Subtask,
    context: CiGateContext
  ): Promise<{
    reportText: string;
    events: Array<{ state: string; payload: Record<string, unknown> }>;
    attentionItem?: WorkerCiFixPayload
  }> {
    let reportText = "";
    const events: Array<{ state: string; payload: Record<string, unknown> }> = [];
    let attentionItem: WorkerCiFixPayload | undefined = undefined;

      const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch : null;
      // At this point, gitStatus is known to be available and non-null because of the check before the loop.
      const pr = matchPrForTask(task, context.gitStatus as GitTrackingStatus);
      const mergedPr = matchMergedPrForTask(task, context.gitStatus as GitTrackingStatus);

      if (mergedPr) {
        task.status = "COMPLETED";
        task.is_merged = true;
        task.merge_indicator = task.merge_indicator === "AUTOMERGE" ? "AUTOMERGE" : "MERGED";
        await this.persistMergedTask(task, context);
        events.push({ state: "merge_confirmed", payload: {
          prNumber: mergedPr.number,
          prUrl: mergedPr.url,
          mergedAt: mergedPr.mergedAt,
        } });
        reportText += buildMergeConfirmedText(task.id, mergedPr.number, context.featureBranch);
        return { reportText, events, attentionItem };
      }

      if (!pr) {
        task.status = "RUNNING";
        task.merge_indicator = "CI";
        events.push({ state: "waiting_for_pr", payload: {
          featureBranch: context.featureBranch,
        } });
        reportText += buildNoPrFoundText(task.id, context.featureBranch);
        return { reportText, events, attentionItem };
      }

      const checks = Array.isArray(pr.checks) ? pr.checks : [];
      const waitForFeatureCi = context.ciIntelligence.waitForCiBeforeFeatureMerge;
      const resolveAllCommentsBeforeFeatureMerge = context.ciIntelligence.resolveAllCommentsBeforeFeatureMerge;
      const sourceBranch = workerBranch || pr.headRefName || "the task worker branch";
      const qaGate = context.evaluateTaskQaGate?.(task);

      if (pr.mergeStateStatus === "DIRTY") {
        task.status = "CODING_COMPLETED";
        task.merge_indicator = "MERGE_CONFLICT";
        await this.persistMergedTask(task, context);
        reportText += buildMergeConflictText(task.id, pr.number, pr.url, sourceBranch, context.featureBranch);
        events.push({ state: "merge_conflict", payload: {
          prNumber: pr.number,
          prUrl: pr.url,
          mergeStateStatus: pr.mergeStateStatus,
          sourceBranch,
          targetBranch: context.featureBranch,
        } });
        return { reportText, events, attentionItem };
      }

      const ciSupport = waitForFeatureCi && checks.length === 0
        ? await detectPullRequestCiSupport(context.repoPath, pr.baseRefName || context.featureBranch)
        : null;
      const skipCiWait = ciSupport?.status === "not_applicable";

      const { hasFailedChecks, hasPendingChecks, hasReviewBlockers, isMergeReady } = evaluateMergeReadiness(
        checks,
        waitForFeatureCi && !skipCiWait,
        resolveAllCommentsBeforeFeatureMerge,
        pr.reviewDecision,
        pr.comments
      );

      const autoMergeMode = context.ciIntelligence.featurePrAutoMergeMode;

      if (autoMergeMode === "CREATE_PR" && isTaskCodeComplete(task)) {
        task.status = "COMPLETED";
        task.merge_indicator = "PR_ONLY";
        events.push({ state: "pr_created_no_merge", payload: {
          prNumber: pr.number,
          prUrl: pr.url,
        } });
        reportText += `- ✅ **PR Created (no merge):** Task \`${task.id}\` — PR #${pr.number} created. Task marked complete without automerge.\n`;
        return { reportText, events, attentionItem };
      }

      if (qaGate && !qaGate.mergeAllowed) {
        task.status = "CODING_COMPLETED";
        task.merge_indicator = "QA_PENDING";
        events.push({ state: "qa_blocked", payload: {
          reason: qaGate.reason,
          summary: qaGate.summary,
          qaRunId: qaGate.latestRun?.id || null,
          runsUsed: qaGate.runsUsed,
          maxRuns: qaGate.maxRuns,
          prNumber: pr.number,
          prUrl: pr.url,
        } });
        reportText += buildQaBlockedText(task.id, qaGate);
        return { reportText, events, attentionItem };
      }

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
        events.push({ state: mergeAttempt.state === "merged"
          ? "automerge_succeeded"
          : mergeAttempt.state === "scheduled"
            ? "automerge_scheduled"
            : mergeAttempt.state === "conflict"
              ? "automerge_conflict"
            : "automerge_failed", payload: {
          prNumber: pr.number,
          prUrl: pr.url,
          mode: "always",
        }});
        if (task.is_merged) return { reportText, events, attentionItem };
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
          events.push({ state: mergeAttempt.state === "merged"
            ? "automerge_succeeded"
            : mergeAttempt.state === "scheduled"
              ? "automerge_scheduled"
              : mergeAttempt.state === "conflict"
                ? "automerge_conflict"
              : "automerge_failed", payload: {
            prNumber: pr.number,
            prUrl: pr.url,
            mode: "when_green",
          }});
          return { reportText, events, attentionItem };
        }

        task.merge_indicator = task.is_merged
          ? "MERGED"
          : task.merge_indicator === "MERGE_CONFLICT"
            ? "MERGE_CONFLICT"
            : undefined;
        events.push({ state: "ready_for_merge", payload: {
          prNumber: pr.number,
          prUrl: pr.url,
          ciWaitSkipped: skipCiWait,
        } });
        reportText += buildMergeReadyText(task.id, pr.number, context.featureBranch);
        if (skipCiWait) {
          reportText += buildCiWaitSkippedText(
            pr.baseRefName || context.featureBranch,
            describeCiSupportSkipReason(ciSupport.reason),
          );
        }
        return { reportText, events, attentionItem };
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
        gitStatus: context.gitStatus as GitTrackingStatus,
        ciIntelligence: context.ciIntelligence,
        automationLevel: context.automationLevel,
        ciAutofixRetryCounts: context.ciAutofixRetryCounts,
        isJulesApiConfigured: context.isJulesApiConfigured,
        sendSessionMessage: context.sendSessionMessage,
        repoPath: context.repoPath,
        defaultBranch: context.defaultBranch,
        hasActiveWorkerCiFixAttempt: context.hasActiveWorkerCiFixAttempt,
      });
      reportText += inProgressResult.reportText;
      if (skipCiWait) {
        reportText += buildCiWaitSkippedText(
          pr.baseRefName || context.featureBranch,
          describeCiSupportSkipReason(ciSupport.reason),
        );
      }

      if (inProgressResult.workerCiFixRequired && inProgressResult.workerCiFixPayload && context.openCiFixAttention) {
        attentionItem = inProgressResult.workerCiFixPayload;
      }

      events.push({ state: task.status === "BLOCKED" ? "blocked" : "waiting_checks", payload: {
        prNumber: pr.number,
        prUrl: pr.url,
        hasFailedChecks,
        hasPendingChecks,
        hasReviewBlockers,
        mergeIndicator: task.merge_indicator || null,
        interventionOwner: task.intervention_owner || null,
      } });

    return { reportText, events, attentionItem };
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

function describeCiSupportSkipReason(reason: PullRequestCiSupportResult["reason"]): string {
  switch (reason) {
    case "no_workflow_directory":
      return "repository has no `.github/workflows` directory.";
    case "no_workflow_files":
      return "repository has no workflow files.";
    case "no_pull_request_triggers":
      return "no workflow file declares a `pull_request` or `pull_request_target` trigger.";
    case "no_matching_pull_request_branches":
      return "no PR-triggered workflow matches this base branch.";
    default:
      return "no applicable PR-triggered CI workflow was detected.";
  }
}

function buildQaBlockedText(taskId: string, qaGate: TaskQaMergeGateStatus): string {
  const statusText = qaGate.reason === "pending_review" || qaGate.reason === "review_running"
    ? "QA review is still in progress."
    : qaGate.reason === "review_failed"
      ? "QA review failed and must retry before merge."
      : "QA requested follow-up work before merge.";
  const summary = qaGate.summary?.trim();
  const budget = qaGate.maxRuns > 0 ? ` (${qaGate.runsUsed}/${qaGate.maxRuns} reviews used)` : "";
  return `- ⏳ **QA Gate:** Task \`${taskId}\` cannot merge yet.${budget} ${statusText}${summary ? ` ${summary}` : ""}\n`;
}
