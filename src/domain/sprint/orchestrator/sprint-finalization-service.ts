import { runCompletionStep } from "../../../sprint/steps/completion-step.js";
import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import type { Subtask, CiIntelligenceSettings } from "../../../contracts/app-types.js";
import type { SprintExecutionContext } from "../../../services/sprint-execution-state-service.js";
import type { MergeFeedbackResult } from "../ci/main-merge-gate.js";
import { isCompletedTaskSettled } from "../task-merge-state.js";
import { transitionSprintRun } from "./sprint-run-transitions.js";
import { buildTaskAttentionPayload } from "./attention-payload-builder.js";
import { selectMergedTaskContexts } from "./conflict-summary-utils.js";
import {
  resolveMainMergeConflictAttentionItems,
  collectActiveMainMergeAttentionItems,
  pauseSprintRunForMainMergeBlocker,
  shouldKeepWatchLoopAliveForMainMerge,
  shouldPauseForMainMergeBlocker,
  buildMainMergeConflictSummary,
} from "./main-merge-blocker.js";

export function partitionSubtasksByStatus(subtasks: Subtask[]) {
  const tasksByStatus = new Map<string, Subtask[]>();
  const statusCounts: Record<string, number> = {};
  for (const task of subtasks) {
    const status = task.status || "UNKNOWN";
    let list = tasksByStatus.get(status);
    if (!list) {
      list = [];
      tasksByStatus.set(status, list);
    }
    list.push(task);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  return { tasksByStatus, statusCounts };
}

export class SprintFinalizationService {
  constructor(
    private readonly deps: SprintOrchestratorDependencies,
    private readonly renderMainMergeCiFeedback: (args: {
      repoPath: string;
      featureBranch: string;
      defaultBranch: string;
      featureBranchPrefix: string;
      sprintNumber?: number;
      sprintName?: string;
      sprintDescription?: string;
      ciIntelligence: CiIntelligenceSettings;
      githubMode: "REMOTE" | "LOCAL";
      subtasks?: Subtask[];
    }) => Promise<MergeFeedbackResult>
  ) {}

  triggerAutoPromote(projectId: string, sprintId: string): void {
    const promotionService = this.deps.memoryPromotionService;
    if (!promotionService) return;

    const settings = this.deps.getDashboardSettings({ projectId, sprintId });
    if (!settings.memory?.enabled || !settings.memory.autoPromote) return;

    promotionService.autoPromoteFromSprint(projectId, sprintId, settings.memory).catch((err) => {
      this.deps.logger.warn("Failed to auto-promote sprint memories", {
        projectId,
        sprintId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async finalizeSprintRun(params: {
    scopedExecutionContext: SprintExecutionContext & { sprintNumber: number };
    sprintRunId: string;
    repoPath: string;
    defaultFeatureBranch: string;
    defaultBranch: string;
    featureBranchPrefix: string;
    githubMode: "REMOTE" | "LOCAL";
    ciIntelligence: CiIntelligenceSettings;
    subtasks: Subtask[];
    runningTasks: Subtask[];
    readyTasks: Subtask[];
    manualMergeTasks: Subtask[];
    needsManualMerge: boolean;
    allTerminal: boolean;
    noMoreActionPossible: boolean;
    activeMainMergeAttentionItems: Array<{ id: string; sprintRunId: string | null; attentionType: string; ownerType?: string; status?: string; summaryMarkdown: string; payload: Record<string, unknown> | null }>;
  }): Promise<{ status: "continue" | "exit" | "wait"; report: string }> {
    const {
      scopedExecutionContext, sprintRunId, repoPath, defaultFeatureBranch, defaultBranch,
      featureBranchPrefix, githubMode, ciIntelligence, subtasks, runningTasks, readyTasks,
      manualMergeTasks, needsManualMerge, allTerminal, noMoreActionPossible, activeMainMergeAttentionItems
    } = params;

    let report = "";

    this.deps.projectAttentionService.resolveItemsForSprintRun(
      scopedExecutionContext.project.id,
      sprintRunId,
      ["manual_attention"],
      "watch_loop_finished",
    );

    if (needsManualMerge) {
      this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_merge_required", "system", {
        awaitingMergeCount: manualMergeTasks.length,
        taskIds: manualMergeTasks.map((task) => task.record_id || task.id),
      }, {
        sourceEventKey: `sprint-merge-required:${sprintRunId}`,
      });
      report += await this.deps.renderInstruction("watchMergeRequired", {}, repoPath);
    } else if (subtasks.length > 0 && !allTerminal && noMoreActionPossible) {
      this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_no_more_actions", "system", {
        taskCount: subtasks.length,
        runningCount: runningTasks.length,
        readyCount: readyTasks.length,
      }, {
        sourceEventKey: `sprint-no-more-actions:${sprintRunId}`,
      });
      report += await this.deps.renderInstruction("watchNoMoreActions", {}, repoPath);
    }

    if (subtasks.length > 0 && subtasks.every((task) => isCompletedTaskSettled(task))) {
      try {
        const completionGuidance = await runCompletionStep({
          defaultBranch,
          featureBranch: defaultFeatureBranch,
          sprintNumber: scopedExecutionContext.sprintNumber,
          githubMode,
          ciIntelligence,
          renderInstruction: (templateId, variables) => this.deps.renderInstruction(templateId, variables, repoPath),
        });
        const mergeFeedback = await this.renderMainMergeCiFeedback({
          repoPath,
          featureBranch: defaultFeatureBranch,
          defaultBranch,
          featureBranchPrefix,
          sprintNumber: scopedExecutionContext.sprintNumber,
          sprintName: scopedExecutionContext.sprint.name,
          sprintDescription: scopedExecutionContext.sprint.goal,
          ciIntelligence,
          githubMode,
          subtasks,
        });
        if (mergeFeedback.text) {
          this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "main_merge_gate_status", "system", {
            state: mergeFeedback.state,
            prNumber: mergeFeedback.prNumber,
            prUrl: mergeFeedback.prUrl,
            hasMergeConflict: mergeFeedback.hasMergeConflict,
            mergeStateStatus: mergeFeedback.mergeStateStatus,
            hasFailedChecks: mergeFeedback.hasFailedChecks,
            hasPendingChecks: mergeFeedback.hasPendingChecks,
            hasReviewBlockers: mergeFeedback.hasReviewBlockers,
            failedChecks: mergeFeedback.failedChecks,
          }, {
            sourceEventKey: `main-merge-gate:${sprintRunId}:${mergeFeedback.state}:${mergeFeedback.prNumber || "none"}`,
          });
        }
        if (
          ciIntelligence.resolveMainMergeConflicts
          && mergeFeedback.hasMergeConflict
          && activeMainMergeAttentionItems.length === 0
        ) {
          this.deps.projectAttentionService.openItem(buildTaskAttentionPayload({
            projectId: scopedExecutionContext.project.id,
            sprintId: scopedExecutionContext.sprint.id,
            sprintRunId,
            attentionType: "merge_conflict",
            severity: "high",
            ownerType: "worker",
            title: `Main merge conflict for ${scopedExecutionContext.sprint.name}`,
            summaryMarkdown: buildMainMergeConflictSummary({
              repoPath,
              featureBranch: defaultFeatureBranch,
              defaultBranch,
              prNumber: mergeFeedback.prNumber,
              prUrl: mergeFeedback.prUrl,
              mergedTaskContexts: selectMergedTaskContexts(subtasks, { limit: 8 }),
            }),
            payload: {
              repoPath,
              workingDirectoryHint: `cd ${repoPath}`,
              featureBranch: defaultFeatureBranch,
              defaultBranch,
              mergeStage: "main",
              prNumber: mergeFeedback.prNumber,
              prUrl: mergeFeedback.prUrl,
              mergeStateStatus: mergeFeedback.mergeStateStatus,
              conflictingBranches: {
                source: defaultFeatureBranch,
                target: defaultBranch,
              },
              sprintNumber: scopedExecutionContext.sprintNumber,
              sprintName: scopedExecutionContext.sprint.name,
              featureBranchTaskContexts: selectMergedTaskContexts(subtasks, { limit: 8 }),
            },
          }));
        } else if (ciIntelligence.resolveMainMergeConflicts && !mergeFeedback.hasMergeConflict) {
          resolveMainMergeConflictAttentionItems(
            this.deps.projectAttentionService,
            scopedExecutionContext.project.id,
            sprintRunId,
          );
        }
        const remainingMainMergeAttentionItems = collectActiveMainMergeAttentionItems(
          this.deps.projectAttentionService,
          scopedExecutionContext.project.id,
          sprintRunId,
        );
        const mainMergeMode = ciIntelligence.mainBranchAutoMergeMode;
        const shouldWaitForMainMerge = shouldKeepWatchLoopAliveForMainMerge(mainMergeMode, mergeFeedback);
        const shouldPauseForMainMerge = shouldPauseForMainMergeBlocker(mergeFeedback, remainingMainMergeAttentionItems);
        if (shouldPauseForMainMerge) {
          report += completionGuidance;
          report += mergeFeedback.text;
          pauseSprintRunForMainMergeBlocker({
            executionRepository: this.deps.executionRepository,
            sprintRunId,
            sprintNumber: scopedExecutionContext.sprintNumber,
            mergeFeedback,
            attentionItems: remainingMainMergeAttentionItems,
          });
          report += "\n⏸️ **Sprint Paused:** Main-branch merge is blocked by a conflict, failed checks, or unresolved review state. Resolve the blocker and resume the sprint.\n";
          return { status: "exit", report };
        }
        if (shouldWaitForMainMerge) {
          report += completionGuidance;
          report += mergeFeedback.text;
          report += "\n⏳ **Sprint Still Active:** Waiting for the final main-branch merge to finish before completing the sprint.\n";
          return { status: "wait", report };
        }
        if (this.deps.qualityAssuranceService) {
          const qaOutcome = await this.deps.qualityAssuranceService.reviewSprintCompletion({
            projectId: scopedExecutionContext.project.id,
            sprintId: scopedExecutionContext.sprint.id,
            sprintRunId,
            repoPath,
            subtasks,
          });
          report += qaOutcome.reportText;
          if (qaOutcome.blockedCompletion) {
            return { status: "wait", report };
          }
        }
        this.deps.completedSprints.add(`${scopedExecutionContext.project.id}:${scopedExecutionContext.sprint.id}`);
        transitionSprintRun(
          this.deps.executionRepository,
          sprintRunId,
          "completed",
          "sprint_completed",
          {
            sprintNumber: scopedExecutionContext.sprintNumber,
            taskCount: subtasks.length,
          },
          `sprint-completed:${sprintRunId}`
        );
        this.triggerAutoPromote(scopedExecutionContext.project.id, scopedExecutionContext.sprint.id);
        report += await this.deps.renderInstruction("cleanupAllMerged", { planning_target: scopedExecutionContext.sprint.name }, repoPath);
        report += completionGuidance;
        report += mergeFeedback.text;
      } catch (cleanupError) {
        this.deps.logger.warn("Failed to finalize sprint run", {
          sprintRunId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    } else {
      const { tasksByStatus, statusCounts } = partitionSubtasksByStatus(subtasks);
      const failedTaskCount = statusCounts["FAILED"] || 0;
      if (failedTaskCount > 0) {
        transitionSprintRun(
          this.deps.executionRepository,
          sprintRunId,
          "failed",
          "sprint_failed",
          { failedTaskCount },
          `sprint-failed:${sprintRunId}`
        );
        report += await this.deps.renderInstruction("cleanupFailed", { planning_target: scopedExecutionContext.sprint.name }, repoPath);
      } else if (manualMergeTasks.length > 0) {
        transitionSprintRun(
          this.deps.executionRepository,
          sprintRunId,
          "paused",
          "sprint_paused",
          {
            reason: "awaiting_merge",
            awaitingMergeCount: manualMergeTasks.length,
          },
          `sprint-paused:${sprintRunId}:awaiting-merge`
        );
        report += await this.deps.renderInstruction("cleanupDeferred", {}, repoPath);
      } else if (subtasks.length === 0) {
        transitionSprintRun(
          this.deps.executionRepository,
          sprintRunId,
          "cancelled",
          "sprint_cancelled",
          { reason: "empty" },
          `sprint-cancelled:${sprintRunId}:empty`
        );
        report += await this.deps.renderInstruction("cleanupEmpty", {}, repoPath);
      } else {
        transitionSprintRun(
          this.deps.executionRepository,
          sprintRunId,
          "paused",
          "sprint_paused",
          { reason: "manual_attention" },
          `sprint-paused:${sprintRunId}:manual-attention`
        );
        this.deps.projectAttentionService.openItem(buildTaskAttentionPayload({
          projectId: scopedExecutionContext.project.id,
          sprintId: scopedExecutionContext.sprint.id,
          sprintRunId,
          attentionType: "manual_attention",
          severity: "medium",
          ownerType: "worker",
          title: `Sprint ${scopedExecutionContext.sprint.name} needs manual attention`,
          summaryMarkdown: "Sprint execution paused because no further automatic action was available.",
          payload: {
            repoPath,
            featureBranch: defaultFeatureBranch,
            defaultBranch,
            sprintNumber: scopedExecutionContext.sprintNumber,
            runningTaskIds: (tasksByStatus.get("RUNNING") || []).map((task) => task.record_id || task.id),
            readyTaskIds: (tasksByStatus.get("PENDING") || []).map((task) => task.record_id || task.id),
            blockedTaskIds: (tasksByStatus.get("BLOCKED") || []).map((task) => task.record_id || task.id),
          },
        }));
      }
    }

    return { status: "continue", report };
  }
}
