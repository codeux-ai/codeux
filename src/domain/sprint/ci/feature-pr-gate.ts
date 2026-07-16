import { evaluateMergeReadiness } from "./feature-pr/merge-readiness-policy.js";
import { deriveChecksFromCiRuns } from "../../../sprint/ci-status-utils.js";
import { runCommandStrict } from "../../../services/cli-process-runner.js";
import type { GuardrailService } from "../../../services/guardrail-service.js";
import { createTemporaryWorktreeBranchMerger, deleteBranchLocally, findRecoverableWorkerBranch, mergeBranchLocallyInTemporaryWorktree, resolveWorkerBranchMergeState, workerBranchHasMergeWork } from "../../../infrastructure/git/local-merge.js";
import { buildWorkerBranchPrefix } from "../../../services/cli-workflow-utils.js";
import { matchMergedPrForTask, matchPrForTask } from "./feature-pr/pr-matcher.js";
import { attemptAutoMerge } from "./feature-pr/automerge-policy.js";
import { evaluateInProgressState } from "./feature-pr/in-progress-policy.js";
import {
  buildCiWaitSkippedText,
  buildMergeConflictText,
  buildMergeConflictPendingText,
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
  GitPullRequestStatus,
  GitMergeStatus,
  GitTrackingStatus,
  Subtask,
  AutoMergeFeaturePrResult,
} from "../../../contracts/app-types.js";
import type { TaskRunRecord } from "../../../contracts/execution-types.js";
import type { ExecutionRepository } from "../../../repositories/execution-repository.js";
import type { CiFixGuardrailHandoff, WorkerCiFixPayload } from "./feature-pr/ci-autofix-policy.js";
import { evaluatePreCiGateTransition, isCompletedTaskAwaitingMerge, isTaskCodeComplete, taskHasMergeEvidence } from "../task-merge-state.js";
import type { MergeConflictDebouncer } from "./merge-conflict-debouncer.js";
import type { TaskQaMergeGateStatus } from "../../../services/quality-assurance-service.js";
import {
  hasCliGitFinalized,
  hasCliGitNoChanges,
  hasCliGitPushed,
  isCliTaskRun,
  isCliTaskRunAwaitingGitFinalization,
  resolveCliGitPushedWorkerBranch,
  type TaskRunEventLike,
} from "./cli-git-finalization.js";

const EMPTY_FEATURE_PR_CHECK_GRACE_MS = 10 * 60 * 1000;

function isExecutionCompletedForCi(
  context: CiGateContext,
  task: Subtask,
  taskRun: TaskRunRecord | null,
  listTaskRunEvents?: (taskRunId: string, limit?: number) => TaskRunEventLike[],
): boolean {
  // CLI workflows have two completion moments: provider/session completion and
  // git finalization. Branch-only merge gates must wait for the task run itself,
  // because worker branches can be created after the provider has already exited.
  if (isCliTaskRun(taskRun)) {
    return taskRun?.state === "COMPLETED" && hasCliGitFinalized(taskRun, listTaskRunEvents);
  }
  return task.session_state === "COMPLETED" || taskRun?.state === "COMPLETED";
}

export interface CiGateContext {
  automationLevel: AutomationLevel;
  repoPath: string;
  featureBranch: string;
  defaultBranch: string;
  featureBranchPrefix: string;
  ciIntelligence: CiIntelligenceSettings;
  githubMode: "REMOTE" | "LOCAL";
  /** When true, delete a LOCAL-mode worker branch after it merges into the feature branch. */
  deleteMergedBranches?: boolean;
  gitStatus: GitTrackingStatus | null;
  guardrailService: GuardrailService;
  isJulesApiConfigured: () => boolean;
  sendSessionMessage: (sessionId: string, message: string) => Promise<void>;
  autoMergeFeaturePr?: (args: { repoPath: string; prNumber: number }) => Promise<AutoMergeFeaturePrResult>;
  persistMergedTask: (task: Subtask) => Promise<void>;
  executionRepository?: ExecutionRepository;
  sprintRunId?: string;
  openCiFixAttentionItems?: (items: Array<{ task: Subtask; payload: WorkerCiFixPayload }>) => void;
  openCiFixGuardrailHandoff?: (handoff: CiFixGuardrailHandoff) => void;
  hasActiveWorkerCiFixAttempt?: (task: Subtask, prNumber: number) => boolean;
  evaluateTaskQaGate?: (task: Subtask) => TaskQaMergeGateStatus;
  /**
   * Debounces transient `DIRTY` PR states so a conflict is only acted on once it
   * has persisted across cycles (see {@link MergeConflictDebouncer}). Shared with
   * the protocol/attention layer so both agree on what counts as a real conflict.
   */
  mergeConflictDebouncer?: MergeConflictDebouncer;
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
      pr: GitPullRequestStatus | undefined;
      mergedPr: GitMergeStatus | undefined;
      hasPr: boolean;
      isExecutionCompleted: boolean;
      cliRunAwaitingGitFinalization: boolean;
      cliGitNoChanges: boolean;
      cliGitPushed: boolean;
      taskRun: TaskRunRecord | null;
      error?: unknown;
    }
    const taskCiInfoMap = new Map<string, TaskCiInfo>();
    const taskRecordIds = updatedSubtasks
      .map((task) => task.record_id?.trim())
      .filter((taskId): taskId is string => Boolean(taskId));
    const listLatestTaskRuns = context.executionRepository
      ? (context.executionRepository as Partial<Pick<ExecutionRepository, "listLatestTaskRuns">>).listLatestTaskRuns
      : undefined;
    const latestTaskRuns = context.executionRepository && context.sprintRunId && listLatestTaskRuns
      ? listLatestTaskRuns.call(context.executionRepository, taskRecordIds, context.sprintRunId)
      : null;

    for (const task of updatedSubtasks) {
      let pr: GitPullRequestStatus | undefined = undefined;
      let mergedPr: GitMergeStatus | undefined = undefined;
      let hasPr = false;
      let error: unknown = undefined;
      try {
        if (context.gitStatus) {
          pr = matchPrForTask(task, context.gitStatus);
          mergedPr = matchMergedPrForTask(task, context.gitStatus);
        }
        hasPr = !!pr || !!mergedPr || !!task.pr_url;
      } catch (err) {
        error = err;
        hasPr = taskHasMergeEvidence(task);
      }

      const taskRun = context.executionRepository && context.sprintRunId && task.record_id
        ? latestTaskRuns
          ? latestTaskRuns.get(task.record_id) ?? null
          : context.executionRepository.getLatestTaskRun(task.record_id, context.sprintRunId)
        : null;
      // All CLI git decisions below use the same immutable event snapshot. A
      // gate evaluation never appends git-finalization events, so rereading the
      // same 500-row window four times only adds database work on wide DAGs.
      let taskRunEvents: TaskRunEventLike[] | undefined;
      const listTaskRunEvents = taskRun?.id && context.executionRepository
        ? (taskRunId: string, limit?: number): TaskRunEventLike[] => {
            if (taskRunId !== taskRun.id) {
              return context.executionRepository!.listTaskRunEvents(taskRunId, limit, {
                eventTypes: ["cli_git_pushed", "cli_git_no_changes"],
                skipValidation: true,
              });
            }
            taskRunEvents ??= context.executionRepository!.listTaskRunEvents(taskRun.id, limit, {
              eventTypes: ["cli_git_pushed", "cli_git_no_changes"],
              skipValidation: true,
            });
            return taskRunEvents;
          }
        : undefined;
      const recoveredPushedBranch = resolveCliGitPushedWorkerBranch(taskRun, listTaskRunEvents);
      const taskRunWorkerBranch = taskRun?.workerBranch || recoveredPushedBranch;
      if (
        taskRunWorkerBranch
        && (typeof task.worker_branch !== "string" || task.worker_branch.trim().length === 0)
      ) {
        task.worker_branch = taskRunWorkerBranch;
        if (taskRun?.id && !taskRun.workerBranch && recoveredPushedBranch && context.executionRepository) {
          context.executionRepository.updateTaskRun(taskRun.id, { workerBranch: recoveredPushedBranch });
        }
      }
      const isExecutionCompleted = isExecutionCompletedForCi(context, task, taskRun, listTaskRunEvents);
      const cliRunAwaitingGitFinalization = isCliTaskRunAwaitingGitFinalization(taskRun, listTaskRunEvents);
      const cliGitNoChanges = hasCliGitNoChanges(taskRun, listTaskRunEvents);
      const cliGitPushed = hasCliGitPushed(taskRun, listTaskRunEvents);

      taskCiInfoMap.set(task.id, {
        pr,
        mergedPr,
        hasPr,
        isExecutionCompleted,
        cliRunAwaitingGitFinalization,
        cliGitNoChanges,
        cliGitPushed,
        taskRun,
        error,
      });
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
      const info = taskCiInfoMap.get(task.id)!;
      task.status = transition.status;
      task.merge_indicator = transition.merge_indicator;
      task.intervention_owner = transition.intervention_owner;
      task.intervention_hint = transition.intervention_hint;

      if (
        context.githubMode === "LOCAL"
        && info.cliGitPushed
        && !info.cliGitNoChanges
        && info.isExecutionCompleted
        && isTaskCodeComplete(task)
        && (typeof task.worker_branch !== "string" || task.worker_branch.trim().length === 0)
      ) {
        task.status = "CODING_COMPLETED";
        task.merge_indicator = "MERGE_BLOCKED";
        task.intervention_owner = "HUMAN";
        task.intervention_hint = `Completed local CLI task ${task.id} recorded pushed git work, but Code UX could not recover its worker branch.`;
      }

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
        if (task.merge_indicator === "MERGE_BLOCKED") {
          task.merge_indicator = undefined;
          task.intervention_owner = undefined;
          task.intervention_hint = undefined;
        }
        context.logger?.info(`LOCAL Mode: Recovered worker branch ${recovered} for task ${task.id} from local refs.`);
        if (context.executionRepository && context.sprintRunId && task.record_id) {
          const taskRun = info.taskRun;
          if (taskRun && !taskRun.workerBranch) {
            context.executionRepository.updateTaskRun(taskRun.id, { workerBranch: recovered });
            taskRun.workerBranch = recovered;
          }
        }
      }
    }

    const completedAwaitingBranchMerge = updatedSubtasks.filter((task) => {
      const info = taskCiInfoMap.get(task.id)!;
      if (context.githubMode === "REMOTE" && info.hasPr) {
        return false;
      }
      if (context.githubMode === "REMOTE" && !info.isExecutionCompleted) {
        return false;
      }
      if (context.githubMode === "LOCAL" && info.cliRunAwaitingGitFinalization) {
        return false;
      }
      return isCompletedTaskAwaitingMerge(task, {
        githubMode: context.githubMode,
        hasPr: info.hasPr,
        isExecutionCompleted: info.isExecutionCompleted,
      });
    });
    if (completedAwaitingBranchMerge.length > 0) {
      context.logger?.info("Branch-only merge gate found completed tasks awaiting branch merge", {
        githubMode: context.githubMode,
        featureBranch: context.featureBranch,
        taskCount: completedAwaitingBranchMerge.length,
        taskIds: completedAwaitingBranchMerge.map((task) => task.id),
      });
    }
    if (completedAwaitingBranchMerge.length > 0) {
      let reportText = "";
      // A LOCAL-mode DAG can finish many independent worker branches at once.
      // Reuse one detached worktree for that cycle while publishing the target ref
      // after each merge, rather than paying worktree setup and cleanup per task.
      const localMerger = context.githubMode === "LOCAL"
        ? createTemporaryWorktreeBranchMerger({
            repoPath: context.repoPath,
            targetBranch: context.featureBranch,
          })
        : null;
      try {
        for (const task of completedAwaitingBranchMerge) {
          const workerBranch = typeof task.worker_branch === "string" ? task.worker_branch : null;
          if (!workerBranch) {
            const info = taskCiInfoMap.get(task.id)!;
            if (
              context.githubMode === "LOCAL"
              && info.cliGitPushed
              && !info.cliGitNoChanges
              && info.isExecutionCompleted
            ) {
              task.status = "CODING_COMPLETED";
              task.merge_indicator = "MERGE_BLOCKED";
              task.intervention_owner = "HUMAN";
              task.intervention_hint = `Completed local CLI task ${task.id} recorded pushed git work, but Code UX could not recover its worker branch.`;
              await context.persistMergedTask(task);
              context.logger?.warn("LOCAL Mode: Blocking completed CLI task because pushed git work has no recoverable worker branch", {
                taskId: task.id,
                taskRunId: info.taskRun?.id,
              });
              reportText += `- ⚠️ **Branch evidence missing:** Task \`${task.id}\` recorded local git work, but no worker branch could be recovered.\n`;
            }
            continue;
          }

          const info = taskCiInfoMap.get(task.id)!;
          const mergeResolution = await resolveWorkerBranchMergeState({
            repoPath: context.repoPath,
            featureBranch: context.featureBranch,
            workerBranch,
          });
          if (mergeResolution.state !== "unmerged") {
            const recoveredCompletedMerge = context.githubMode === "LOCAL"
              && info.cliGitPushed
              && !info.cliGitNoChanges
              && mergeResolution.state === "merged";
            task.status = "COMPLETED";
            task.is_merged = recoveredCompletedMerge;
            task.merge_indicator = recoveredCompletedMerge ? "MERGED" : undefined;
            task.worker_branch = undefined;
            if (context.executionRepository && context.sprintRunId && task.record_id) {
              const taskRun = info.taskRun;
              if (taskRun?.id) {
                context.executionRepository.updateTaskRun(taskRun.id, { workerBranch: null });
                taskRun.workerBranch = null;
                context.executionRepository.appendTaskRunEvent(taskRun.id, "ci_gate_status", "system", {
                  state: recoveredCompletedMerge ? "merged_branch" : "no_merge_work",
                  taskId: task.id,
                  featureBranch: context.featureBranch,
                  workerBranch,
                  ...(recoveredCompletedMerge ? { githubMode: context.githubMode } : {}),
                }, {
                  sourceEventKey: recoveredCompletedMerge
                    ? `ci-gate:merged_branch:${context.featureBranch}:${workerBranch}`
                    : `ci-gate:no_merge_work:none:${workerBranch}`,
                });
              }
            }
            await context.persistMergedTask(task);
            reportText += recoveredCompletedMerge
              ? `- ✅ **Recovered local merge:** Task \`${task.id}\` was already merged into \`${context.featureBranch}\`; merge metadata was restored.\n`
              : `- ✅ **No merge work:** Task \`${task.id}\` completed without a PR because no worker branch with unmerged commits exists.\n`;
            continue;
          }

            // Check if there is QA gate blocking us
            const qaGate = context.evaluateTaskQaGate?.(task);
            if (qaGate && !qaGate.mergeAllowed) {
              task.status = "CODING_COMPLETED";
              task.merge_indicator = "QA_PENDING";
              await context.persistMergedTask(task);
              reportText += buildQaBlockedText(task.id, qaGate);
              continue;
            }

            const modeLabel = context.githubMode === "LOCAL" ? "LOCAL" : "REMOTE branch-only";
            context.logger?.info(`${modeLabel} Mode: Merging worker branch ${workerBranch} into feature branch ${context.featureBranch}`);
            const mergeArgs = {
              repoPath: context.repoPath,
              targetBranch: context.featureBranch,
              sourceBranch: workerBranch,
              commitMessage: `Merge branch '${workerBranch}' into ${context.featureBranch}`,
            };
            const merge = localMerger
              ? await localMerger.merge(workerBranch, mergeArgs.commitMessage)
              : await mergeBranchLocallyInTemporaryWorktree(mergeArgs);

            if (merge.ok) {
              if (context.githubMode === "REMOTE") {
                try {
                  await runCommandStrict(
                    "git",
                    ["push", "origin", `refs/heads/${context.featureBranch}:refs/heads/${context.featureBranch}`],
                    context.repoPath,
                  );
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  context.logger?.error(`REMOTE branch-only Mode: Failed to push feature branch ${context.featureBranch}: ${message}`);
                  task.status = "CODING_COMPLETED";
                  task.is_merged = false;
                  task.merge_indicator = "MERGE_BLOCKED";
                  task.intervention_owner = "HUMAN";
                  task.intervention_hint = `Merged ${workerBranch} into ${context.featureBranch} locally, but could not push the feature branch: ${message}`;
                  await context.persistMergedTask(task);
                  reportText += `- ⚠️ **Remote branch push failed:** Task \`${task.id}\` — merged \`${workerBranch}\` into \`${context.featureBranch}\` locally, but pushing the feature branch failed: ${message}\n`;
                  continue;
                }
              }

              task.status = "COMPLETED";
              task.is_merged = true;
              task.merge_indicator = "MERGED";
              task.worker_branch = undefined;
              task.intervention_owner = undefined;
              task.intervention_hint = undefined;
              if (context.executionRepository && context.sprintRunId && task.record_id) {
                const taskRun = info.taskRun;
                if (taskRun?.id) {
                  context.executionRepository.updateTaskRun(taskRun.id, { workerBranch: null });
                  taskRun.workerBranch = null;
                  context.executionRepository.appendTaskRunEvent(taskRun.id, "ci_gate_status", "system", {
                    state: "merged_branch",
                    taskId: task.id,
                    featureBranch: context.featureBranch,
                    workerBranch,
                    githubMode: context.githubMode,
                  }, {
                    sourceEventKey: `ci-gate:merged_branch:${context.featureBranch}:${workerBranch}`,
                  });
                }
              }
              await context.persistMergedTask(task);

              // Worker branch is now fully contained in the feature branch; drop it so dead
              // per-task branches do not pile up in the repo.
              if (context.deleteMergedBranches) {
                const deleted = await deleteBranchLocally({ repoPath: context.repoPath, branch: workerBranch });
                if (deleted) {
                  context.logger?.info(`LOCAL Mode: Deleted merged worker branch ${workerBranch}`);
                }
              }

              reportText += context.githubMode === "LOCAL"
                ? `- ✅ **Merged locally:** Task \`${task.id}\` — branch \`${workerBranch}\` merged into \`${context.featureBranch}\`.\n`
                : `- ✅ **Merged branch:** Task \`${task.id}\` — branch \`${workerBranch}\` merged into \`${context.featureBranch}\` and pushed.\n`;
            } else {
              context.logger?.error(`${modeLabel} Mode: Failed to merge worker branch ${workerBranch} into ${context.featureBranch}: ${merge.error}`);
              task.status = "CODING_COMPLETED";
              task.merge_indicator = "MERGE_CONFLICT";
              task.intervention_owner = "HUMAN";
              task.intervention_hint = merge.conflict
                ? `Merge conflict merging ${workerBranch} into ${context.featureBranch}. Resolve it locally.`
                : `Could not merge ${workerBranch} into ${context.featureBranch}: ${merge.error}. Resolve it locally.`;
              await context.persistMergedTask(task);

              reportText += merge.conflict
                ? `- ⚠️ **Merge Conflict:** Task \`${task.id}\` — conflict merging \`${workerBranch}\` into \`${context.featureBranch}\`.\n`
                : `- ⚠️ **Branch merge failed:** Task \`${task.id}\` — could not merge \`${workerBranch}\` into \`${context.featureBranch}\`: ${merge.error}\n`;
            }
        }
      } finally {
        await localMerger?.close();
      }
      return { subtasks: updatedSubtasks, reportText };
    }

    if (context.githubMode === "LOCAL") {
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
      return Boolean(info.mergedPr) || isCompletedTaskAwaitingMerge(task, {
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
        return this.processTask(task, context, info.pr, info.mergedPr, info.taskRun).catch((err) => {
          context.logger?.error(`Error processing task ${task.id}:`, { error: err });
          return { reportText: "", events: [], attentionItem: undefined };
        });
      })
    );

    let reportText = "";
    const itemsToOpen: Array<{ task: Subtask; payload: WorkerCiFixPayload }> = [];

    for (let i = 0; i < completedAwaitingMerge.length; i++) {
      const task = completedAwaitingMerge[i];
      const info = taskCiInfoMap.get(task.id)!;
      const result = processResults[i];
      if (result) {
        reportText += result.reportText;
        for (const event of result.events) {
          this.appendCiGateEvent(task, context, event.state, event.payload, info.taskRun);
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
    cachedPr: GitPullRequestStatus | undefined,
    cachedMergedPr: GitMergeStatus | undefined,
    cachedTaskRun: TaskRunRecord | null,
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
          const taskRun = cachedTaskRun;
          if (taskRun && !taskRun.workerBranch) {
            context.executionRepository.updateTaskRun(taskRun.id, { workerBranch: headRef });
            taskRun.workerBranch = headRef;
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
        const isExecutionCompleted = isExecutionCompletedForCi(context, task, cachedTaskRun);

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

          const hasMergeWork = workerBranch
            ? await workerBranchHasMergeWork({
              repoPath: context.repoPath,
              featureBranch: context.featureBranch,
              workerBranch,
            })
            : false;
          if (!hasMergeWork) {
            task.status = "COMPLETED";
            task.merge_indicator = undefined;
            task.worker_branch = undefined;
            if (cachedTaskRun?.id && context.executionRepository) {
              context.executionRepository.updateTaskRun(cachedTaskRun.id, { workerBranch: null });
              cachedTaskRun.workerBranch = null;
            }
            await this.persistMergedTask(task, context);
            events.push({ state: "no_merge_work", payload: {
              featureBranch: context.featureBranch,
              workerBranch,
            } });
            reportText += `- ✅ **No merge work:** Task \`${task.id}\` completed without a PR because no worker branch with unmerged commits exists.\n`;
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

      // A single `DIRTY` reading is not a reliable conflict signal — GitHub
      // returns it transiently while recomputing mergeability after a push/base
      // advance. Only treat it as a real conflict once it has persisted across
      // cycles; until then keep the task waiting and re-check next cycle instead
      // of escalating a phantom conflict.
      const conflictConfirmed = context.mergeConflictDebouncer
        ? context.mergeConflictDebouncer.observe(pr.url, pr.mergeStateStatus)
        : pr.mergeStateStatus === "DIRTY";
      if (conflictConfirmed) {
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
      if (pr.mergeStateStatus === "DIRTY") {
        // Suspected-but-unconfirmed conflict: hold in the CI-wait state so the gate
        // re-evaluates next cycle once GitHub has settled the mergeable state.
        task.status = "RUNNING";
        task.merge_indicator = "CI";
        await this.persistMergedTask(task, context);
        events.push({ state: "merge_conflict_pending", payload: {
          prNumber: pr.number,
          prUrl: pr.url,
          mergeStateStatus: pr.mergeStateStatus,
        } });
        reportText += buildMergeConflictPendingText(task.id, pr.number, context.featureBranch);
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
      const staleEmptyChecks = shouldTreatEmptyFeaturePrChecksAsSkipped({
        pr,
        gitStatus: context.gitStatus,
        checks,
        waitForFeatureCi,
      });
      const skipCiWait = ciSupport?.status === "not_applicable" || staleEmptyChecks;
      const ciWaitSkipReason = ciSupport?.status === "not_applicable"
        ? describeCiSupportSkipReason(ciSupport.reason)
        : staleEmptyChecks
          ? `no PR checks or tracked CI runs appeared within ${Math.round(EMPTY_FEATURE_PR_CHECK_GRACE_MS / 60_000)} minutes for this clean PR.`
          : null;

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
            ciWaitSkipReason || "no applicable PR-triggered CI workflow was detected.",
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
        onCiFixGuardrailExhausted: context.openCiFixGuardrailHandoff,
      });
      reportText += inProgressResult.reportText;
      if (skipCiWait) {
        reportText += buildCiWaitSkippedText(
          pr.baseRefName || context.featureBranch,
          ciWaitSkipReason || "no applicable PR-triggered CI workflow was detected.",
        );
      }

      if (inProgressResult.workerCiFixRequired && inProgressResult.workerCiFixPayload && context.openCiFixAttentionItems) {
        attentionItem = inProgressResult.workerCiFixPayload;
      }

      await this.persistMergedTask(task, context);

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
    cachedTaskRun: TaskRunRecord | null,
  ): void {
    if (!context.executionRepository || !context.sprintRunId || !task.record_id) {
      return;
    }

    const taskRun = cachedTaskRun;
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

function shouldTreatEmptyFeaturePrChecksAsSkipped(args: {
  pr: GitPullRequestStatus;
  gitStatus: GitTrackingStatus | null;
  checks: Array<{ name: string; status: string | null; conclusion: string | null }>;
  waitForFeatureCi: boolean;
}): boolean {
  if (!args.waitForFeatureCi || args.checks.length > 0 || args.pr.isDraft) {
    return false;
  }
  if ((args.gitStatus?.ciRuns || []).length > 0) {
    return false;
  }

  const mergeState = String(args.pr.mergeStateStatus || "").trim().toUpperCase();
  if (mergeState !== "CLEAN") {
    return false;
  }

  const updatedAtMs = args.pr.updatedAt ? Date.parse(args.pr.updatedAt) : Number.NaN;
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return Date.now() - updatedAtMs >= EMPTY_FEATURE_PR_CHECK_GRACE_MS;
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
