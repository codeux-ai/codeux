import { evaluateMergeReadiness } from "./feature-pr/merge-readiness-policy.js";
import { deriveChecksFromCiRuns } from "../../../sprint/ci-status-utils.js";
import type { GuardrailService } from "../../../services/guardrail-service.js";
import { findRecoverableWorkerBranch, getCheckedOutRef, mergeBranchLocally, restoreCheckedOutRef } from "../../../infrastructure/git/local-merge.js";
import { buildWorkerBranchPrefix } from "../../../services/cli-workflow-utils.js";
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
import { evaluatePreCiGateTransition, isCompletedTaskAwaitingMerge, isTaskCodeComplete, taskHasMergeEvidence } from "../task-merge-state.js";
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
  guardrailService: GuardrailService;
  isJulesApiConfigured: () => boolean;
  sendSessionMessage: (sessionId: string, message: string) => Promise<void>;
  autoMergeFeaturePr?: (args: { repoPath: string; prNumber: number }) => Promise<AutoMergeFeaturePrResult>;
  persistMergedTask: (task: Subtask) => Promise<void>;
  executionRepository?: ExecutionRepository;
  sprintRunId?: string;
  openCiFixAttentionItems?: (items: Array<{ task: Subtask; payload: WorkerCiFixPayload }>) => void;
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

    // Pre-calculate and cache PR, merged PR, and execution state for each task, catching thrown errors per task.
    interface TaskCiInfo {
      pr: any;
      mergedPr: any;
      hasPr: boolean;
      isExecutionCompleted: boolean;
      error?: any;
    }
    const taskCiInfoMap = new Map<string, TaskCiInfo>();

    for (const task of updatedSubtasks) {
      let pr: any = undefined;
      let mergedPr: any = undefined;
      let hasPr = false;
      let error: any = undefined;
      try {
        if (context.gitStatus) {
          pr = matchPrForTask(task, context.gitStatus);
          mergedPr = matchMergedPrForTask(task, context.gitStatus);
        }
        hasPr = !!pr || !!mergedPr || !!task.pr_url;
      } catch (err: any) {
        error = err;
        hasPr = taskHasMergeEvidence(task);
      }

      const taskRun = context.executionRepository && context.sprintRunId && task.record_id
        ? context.executionRepository.getLatestTaskRun(task.record_id, context.sprintRunId)
        : null;
      const isExecutionCompleted = task.session_state === "COMPLETED" || taskRun?.state === "COMPLETED";

      taskCiInfoMap.set(task.id, { pr, mergedPr, hasPr, isExecutionCompleted, error });
    }

    const transitionResults = updatedSubtasks.map((task) => {
      const info = taskCiInfoMap.get(task.id)!;
      if (info.error) {
        context.logger?.error(`Error processing task ${task.id}:`, { error: info.error });
      }
      const qaGate = context.evaluateTaskQaGate?.(task);
      return {
        task,
        previousStatus: task.status,
        previousMergeIndicator: task.merge_indicator,
        transition: evaluatePreCiGateTransition(task, {
          githubMode: context.githubMode,
          qaMergeAllowed: qaGate?.mergeAllowed,
          hasPr: info.hasPr,
          isExecutionCompleted: info.isExecutionCompleted,
        }),
      };
    });

    for (const { task, previousStatus, previousMergeIndicator, transition } of transitionResults) {
      task.status = transition.status;
      task.merge_indicator = transition.merge_indicator;
      task.intervention_owner = transition.intervention_owner;
      task.intervention_hint = transition.intervention_hint;

      // A task that resolved to COMPLETED with no merge evidence (e.g. produced
      // no changes) settles honestly here via the stage resolver — we no longer
      // fabricate an is_merged/MERGED state for it, since nothing was merged.

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

    if (context.githubMode === "LOCAL") {
      // Recover lost merge evidence. In LOCAL mode the worker branch is the only
      // record that a code-complete task produced work, but that evidence can be
      // cleared from the task run during the QA re-run / settlement cycle. When a
      // code-complete task has no worker_branch, look for its branch on disk (it is
      // never pushed/deleted in LOCAL mode) and backfill it so the merge below — and
      // QA, which targets the worker branch — see the real work instead of treating
      // the task as "nothing to merge".
      for (const task of updatedSubtasks) {
        if (typeof task.worker_branch === "string" && task.worker_branch.trim()) continue;
        const info = taskCiInfoMap.get(task.id)!;
        if (!info.isExecutionCompleted || !isTaskCodeComplete(task)) continue;

        const recovered = await findRecoverableWorkerBranch({
          repoPath: context.repoPath,
          featureBranch: context.featureBranch,
          branchPrefix: buildWorkerBranchPrefix(context.featureBranch, task.id, task.provider),
        });
        if (!recovered) continue;

        task.worker_branch = recovered;
        info.hasPr = true;
        context.logger?.info(`LOCAL Mode: Recovered worker branch ${recovered} for task ${task.id} from local refs.`);
        if (context.executionRepository && context.sprintRunId && task.record_id) {
          const taskRun = context.executionRepository.getLatestTaskRun(task.record_id, context.sprintRunId);
          if (taskRun && !taskRun.workerBranch) {
            context.executionRepository.updateTaskRun(taskRun.id, { workerBranch: recovered });
          }
        }
      }

      const completedAwaitingMerge = updatedSubtasks.filter((task) => {
        const info = taskCiInfoMap.get(task.id)!;
        return isCompletedTaskAwaitingMerge(task, {
          githubMode: context.githubMode,
          hasPr: info.hasPr,
          isExecutionCompleted: info.isExecutionCompleted,
        });
      });
      if (completedAwaitingMerge.length > 0) {
        let reportText = "";
        // The host repo is the user's own working directory — capture whatever ref is
        // checked out so we can restore it once after merging every worker branch,
        // rather than leaving the repo parked on the feature branch (and without
        // churning the working tree by checking it out per task).
        const originalRef = await getCheckedOutRef(context.repoPath);
        try {
          for (const task of completedAwaitingMerge) {
            const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch : null;
            if (!workerBranch) continue;

            // Check if there is QA gate blocking us
            const qaGate = context.evaluateTaskQaGate?.(task);
            if (qaGate && !qaGate.mergeAllowed) {
              task.status = "CODING_COMPLETED";
              task.merge_indicator = "QA_PENDING";
              await context.persistMergedTask(task);
              reportText += buildQaBlockedText(task.id, qaGate);
              continue;
            }

            context.logger?.info(`LOCAL Mode: Merging worker branch ${workerBranch} into feature branch ${context.featureBranch}`);
            const merge = await mergeBranchLocally({
              repoPath: context.repoPath,
              targetBranch: context.featureBranch,
              sourceBranch: workerBranch,
              commitMessage: `Merge branch '${workerBranch}' into ${context.featureBranch}`,
            });

            if (merge.ok) {
              task.status = "COMPLETED";
              task.is_merged = true;
              task.merge_indicator = "MERGED";
              task.intervention_owner = undefined;
              task.intervention_hint = undefined;
              await context.persistMergedTask(task);

              reportText += `- ✅ **Merged locally:** Task \`${task.id}\` — branch \`${workerBranch}\` merged into \`${context.featureBranch}\`.\n`;
            } else {
              context.logger?.error(`LOCAL Mode: Failed to merge worker branch ${workerBranch} into ${context.featureBranch}: ${merge.error}`);
              task.status = "CODING_COMPLETED";
              task.merge_indicator = "MERGE_CONFLICT";
              task.intervention_owner = "HUMAN";
              task.intervention_hint = merge.conflict
                ? `Merge conflict merging ${workerBranch} into ${context.featureBranch}. Resolve it locally.`
                : `Could not merge ${workerBranch} into ${context.featureBranch}: ${merge.error}. Resolve it locally.`;
              await context.persistMergedTask(task);

              reportText += merge.conflict
                ? `- ⚠️ **Merge Conflict locally:** Task \`${task.id}\` — Conflict merging \`${workerBranch}\` into \`${context.featureBranch}\`.\n`
                : `- ⚠️ **Local merge failed:** Task \`${task.id}\` — Could not merge \`${workerBranch}\` into \`${context.featureBranch}\`: ${merge.error}\n`;
            }
          }
        } finally {
          await restoreCheckedOutRef(context.repoPath, originalRef);
        }
        return { subtasks: updatedSubtasks, reportText };
      }
      return { subtasks: updatedSubtasks, reportText: "" };
    }

    if (
      !context.ciIntelligence.enabled ||
      context.githubMode !== "REMOTE" ||
      (!context.ciIntelligence.enableLivePrMonitoring && context.ciIntelligence.featurePrAutoMergeMode === "OFF")
    ) {
      return { subtasks: updatedSubtasks, reportText: "" };
    }

    const completedAwaitingMerge = updatedSubtasks.filter((task) => {
      const info = taskCiInfoMap.get(task.id)!;
      return isCompletedTaskAwaitingMerge(task, {
        githubMode: context.githubMode,
        hasPr: info.hasPr,
        isExecutionCompleted: info.isExecutionCompleted,
      }) || task.merge_indicator === "QA_PENDING";
    });
    if (completedAwaitingMerge.length === 0) {
      return { subtasks: updatedSubtasks, reportText: "" };
    }

    if (!context.gitStatus?.available) {
      return { subtasks: updatedSubtasks, reportText: "" };
    }

    const processResults = await Promise.all(
      completedAwaitingMerge.map((task) => {
        const info = taskCiInfoMap.get(task.id)!;
        if (info.error) {
          return Promise.resolve({ reportText: "", events: [], attentionItem: undefined });
        }
        return this.processTask(task, context, info.pr, info.mergedPr).catch((err) => {
          context.logger?.error(`Error processing task ${task.id}:`, { error: err });
          return { reportText: "", events: [], attentionItem: undefined };
        });
      })
    );

    let reportText = "";
    const itemsToOpen: Array<{ task: Subtask; payload: WorkerCiFixPayload }> = [];

    for (let i = 0; i < completedAwaitingMerge.length; i++) {
      const task = completedAwaitingMerge[i];
      const result = processResults[i];
      if (result) {
        reportText += result.reportText;
        for (const event of result.events) {
          this.appendCiGateEvent(task, context, event.state, event.payload);
        }
        if (result.attentionItem) {
          itemsToOpen.push({ task, payload: result.attentionItem });
        }
      }
    }

    if (itemsToOpen.length > 0 && context.openCiFixAttentionItems) {
      context.openCiFixAttentionItems(itemsToOpen);
    }

    return { subtasks: updatedSubtasks, reportText };
  }


  private async processTask(
    task: Subtask,
    context: CiGateContext,
    cachedPr: any,
    cachedMergedPr: any
  ): Promise<{
    reportText: string;
    events: Array<{ state: string; payload: Record<string, unknown> }>;
    attentionItem?: WorkerCiFixPayload
  }> {
    let reportText = "";
    const events: Array<{ state: string; payload: Record<string, unknown> }> = [];
    let attentionItem: WorkerCiFixPayload | undefined = undefined;

    const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch : null;
    const pr = cachedPr;
    const mergedPr = cachedMergedPr;

      // Jules sessions don't include workerBranch in their API output, so task_runs.worker_branch
      // can be null even when the PR exists. Backfill it the first time gitStatus surfaces the PR's
      // headRefName so subsequent cycles can find the branch without needing gitStatus.
      if (!workerBranch && context.executionRepository && context.sprintRunId && task.record_id) {
        const headRef = pr?.headRefName || mergedPr?.headRefName;
        if (headRef) {
          const taskRun = context.executionRepository.getLatestTaskRun(task.record_id, context.sprintRunId);
          if (taskRun && !taskRun.workerBranch) {
            context.executionRepository.updateTaskRun(taskRun.id, { workerBranch: headRef });
          }
          task.worker_branch = headRef;
        }
      }

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
        const taskRun = context.executionRepository && context.sprintRunId && task.record_id
          ? context.executionRepository.getLatestTaskRun(task.record_id, context.sprintRunId)
          : null;
        const isExecutionCompleted = task.session_state === "COMPLETED" || taskRun?.state === "COMPLETED";

        if (isExecutionCompleted) {
          const qaGate = context.evaluateTaskQaGate?.(task);
          if (qaGate && !qaGate.mergeAllowed) {
            task.status = "CODING_COMPLETED";
            task.merge_indicator = "QA_PENDING";
            events.push({ state: "qa_blocked", payload: {
              reason: qaGate.reason,
              summary: qaGate.summary,
              qaRunId: qaGate.latestRun?.id || null,
              runsUsed: qaGate.runsUsed,
              maxRuns: qaGate.maxRuns,
              prNumber: null,
              prUrl: null,
            } });
            reportText += buildQaBlockedText(task.id, qaGate);
            return { reportText, events, attentionItem };
          }

          // Coding is done but there is a worker branch with no PR to merge.
          // Do not fabricate a merge — leave the task awaiting a (manual) merge
          // so it is surfaced honestly rather than marked COMPLETED/MERGED.
          task.status = "CODING_COMPLETED";
          task.merge_indicator = undefined;
          await this.persistMergedTask(task, context);
          events.push({ state: "awaiting_merge_no_pr", payload: {
            featureBranch: context.featureBranch,
          } });
          reportText += buildNoPrFoundText(task.id, context.featureBranch);
          return { reportText, events, attentionItem };
        }

        task.status = "RUNNING";
        task.merge_indicator = "CI";
        events.push({ state: "waiting_for_pr", payload: {
          featureBranch: context.featureBranch,
        } });
        reportText += buildNoPrFoundText(task.id, context.featureBranch);
        return { reportText, events, attentionItem };
      }

      // When the PR itself carries no status-check rollup (GitLab, GitHub REST fallback),
      // fall back to the branch's workflow runs so CI completion is still observed instead of
      // waiting forever on an empty check list.
      let checks = Array.isArray(pr.checks) && pr.checks.length > 0 ? pr.checks : [];
      if (checks.length === 0 && context.gitStatus) {
        checks = deriveChecksFromCiRuns(context.gitStatus, pr.headRefName || workerBranch);
      }
      const autoMergeMode = context.ciIntelligence.featurePrAutoMergeMode;
      const waitForFeatureCi = autoMergeMode === "WHEN_GREEN";
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

      // The PR is no longer reporting a merge conflict. Clear any stale MERGE_CONFLICT
      // indicator so the task can settle normally — otherwise the indicator stays sticky
      // (see normalizeTaskMergeIndicator) and the conflict-resolution loop never ends even
      // though the conflict is already resolved.
      if (task.merge_indicator === "MERGE_CONFLICT" && pr.mergeStateStatus && pr.mergeStateStatus !== "UNKNOWN") {
        task.merge_indicator = undefined;
        await this.persistMergedTask(task, context);
        events.push({ state: "merge_conflict_cleared", payload: {
          prNumber: pr.number,
          prUrl: pr.url,
          mergeStateStatus: pr.mergeStateStatus,
        } });
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

      const shouldAutoMergeAlways = autoMergeMode === "ALWAYS";
      const shouldAutoMergeWhenGreen = autoMergeMode === "WHEN_GREEN";

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
        if (task.record_id) {
          context.guardrailService.reset(task.record_id);
        }

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

        // The PR reached merge-ready, so any earlier conflict is resolved — never keep a
        // stale MERGE_CONFLICT indicator here.
        task.merge_indicator = task.is_merged ? "MERGED" : undefined;
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
        guardrailService: context.guardrailService,
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

      if (inProgressResult.workerCiFixRequired && inProgressResult.workerCiFixPayload && context.openCiFixAttentionItems) {
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
