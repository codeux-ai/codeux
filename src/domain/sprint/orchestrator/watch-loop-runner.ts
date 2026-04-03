import { runCompletionStep } from "../../../sprint/steps/completion-step.js";
import type { SprintAgentArgs } from "../../../sprint/sprint-types.js";
import { determineNextState, WatchLoopState } from "./watch-loop-state-machine.js";
import type { Subtask,
  AutomationInterventionsSettings,
  AutomationLevel,
  CiIntelligenceSettings,
  SprintLoopStepSettings,
 } from "../../../contracts/app-types.js";
import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import type { CycleRunner } from "./cycle-runner.js";
import type { SprintExecutionContext } from "../../../services/sprint-execution-state-service.js";
import type { MergeFeedbackResult } from "../ci/main-merge-gate.js";
import type { ProjectAttentionItemRecord } from "../../../contracts/project-attention-types.js";
import { isCompletedTaskSettled } from "../task-merge-state.js";
import { transitionSprintRun } from "./sprint-run-transitions.js";
import { buildTaskAttentionPayload } from "./attention-payload-builder.js";
import { buildConflictSummaryMarkdown, selectMergedTaskContexts } from "./conflict-summary-utils.js";

export interface WatchLoopRunnerArgs {
  args: SprintAgentArgs;
  executionContext: SprintExecutionContext;
  repoPath: string;
  defaultFeatureBranch: string;
  defaultBranch: string;
  featureBranchPrefix: string;
  githubMode: "REMOTE" | "LOCAL";
  retryFailed: boolean;
  loopSteps: SprintLoopStepSettings;
  ciIntelligence: CiIntelligenceSettings;
  automationLevel: AutomationLevel;
  automationInterventions: AutomationInterventionsSettings;
  dashboardPort: number;
  sprintRunId: string;
  leaseToken?: string;
}

export class WatchLoopRunner {
  constructor(
    private readonly deps: SprintOrchestratorDependencies,
    private readonly cycleRunner: CycleRunner,
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

  async run(params: WatchLoopRunnerArgs): Promise<string> {
    const {
      args,
      executionContext,
      repoPath,
      defaultFeatureBranch,
      defaultBranch,
      featureBranchPrefix,
      githubMode,
      retryFailed,
      loopSteps,
      ciIntelligence,
      automationLevel,
      automationInterventions,
      dashboardPort,
      sprintRunId,
      leaseToken,
    } = params;
    const scopedExecutionContext = executionContext || {
      project: { id: "unknown-project", name: "Selected Project" },
      sprint: { id: "unknown-sprint", name: "Selected Sprint" },
      sprintNumber: args.sprint_number ?? 0,
      repoPath,
      featureBranch: defaultFeatureBranch,
      defaultBranch,
      sourceId: args.source_id,
    };

    const planningAgentPresetId = await this.deps.resolvePlanningAgentPresetId?.(scopedExecutionContext.project.id);

    let allFinished = false;
    let checkpointWindowStartedAt = Date.now();
    let fullReport = await this.deps.renderInstruction(
      "watchHeader",
      {
        sprint_number: scopedExecutionContext.sprintNumber,
        feature_branch: defaultFeatureBranch,
        dashboard_port: dashboardPort,
      },
      repoPath
    );
    fullReport += "\n";

    const watchLoopIntervalMs = Math.max(1, loopSteps.watchLoopIntervalSeconds) * 1000;
    const watchLoopOutputIntervalMs = Math.max(60, loopSteps.watchLoopOutputIntervalSeconds) * 1000;

    this.deps.logger.info("Starting watch loop", {
      sprintNumber: scopedExecutionContext.sprintNumber,
      featureBranch: defaultFeatureBranch,
    });
    this.deps.logger.info(`Live dashboard available at http://localhost:${dashboardPort}`);
    this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "watch_loop_started", "system", {
      sprintNumber: scopedExecutionContext.sprintNumber,
      featureBranch: defaultFeatureBranch,
      defaultBranch,
    }, {
      sourceEventKey: `watch-loop-started:${sprintRunId}`,
    });

    while (!allFinished) {
      const controlEval = this.evaluateControlIntervention(sprintRunId);
      if (controlEval.status === "exit") {
        fullReport += controlEval.report;
        return fullReport;
      }

      const cycleResult = await this.handleCycleTransition({
        args,
        scopedExecutionContext,
        repoPath,
        defaultFeatureBranch,
        defaultBranch,
        featureBranchPrefix,
        githubMode,
        retryFailed,
        loopSteps,
        ciIntelligence,
        automationLevel,
        automationInterventions,
        sprintRunId,
        planningAgentPresetId,
      });

      const {
        subtasks,
        reportText,
        statusTable,
        instructions,
        manualMergeTasks,
        workerEscalatedMergeConflictTasks,
      } = cycleResult;

      const activeProjectAttentionItems = typeof this.deps.projectAttentionService?.listActiveProjectItems === "function"
        ? this.deps.projectAttentionService.listActiveProjectItems(scopedExecutionContext.project.id).filter((item) => (
          item.status === "open" || item.status === "claimed"
        ))
        : [];

      const {
        runningTasks,
        readyTasks,
        activeMainMergeAttentionItems,
        allTerminal,
        noMoreActionPossible,
        needsManualMerge,
        allFinished: evaluatedAllFinished,
      } = evaluateSprintRunState({
        subtasks,
        manualMergeTasks,
        workerEscalatedMergeConflictTasks,
        activeProjectAttentionItems,
        sprintRunId,
      });

      allFinished = evaluatedAllFinished;
      const elapsedMs = Date.now() - checkpointWindowStartedAt;
      const outputIntervalReached = elapsedMs >= watchLoopOutputIntervalMs;

      const nextState = determineNextState({
        allFinished,
        outputIntervalReached,
      });

      switch (nextState) {
        case WatchLoopState.FINISHED: {
          fullReport += reportText;
          fullReport += statusTable;
          fullReport += instructions;
          const finalizationResult = await this.finalizeSprintRun({
            scopedExecutionContext,
            sprintRunId,
            repoPath,
            defaultFeatureBranch,
            defaultBranch,
            featureBranchPrefix,
            githubMode,
            ciIntelligence,
            subtasks,
            runningTasks,
            readyTasks,
            manualMergeTasks,
            needsManualMerge,
            allTerminal,
            noMoreActionPossible,
            activeMainMergeAttentionItems,
          });
          fullReport += finalizationResult.report;
          if (finalizationResult.status === "exit") {
            return fullReport;
          }
          if (finalizationResult.status === "wait") {
            this.renewSprintRunHeartbeat({
              sprintRunId,
              sprintId: scopedExecutionContext.sprint.id,
              leaseToken,
            });
            checkpointWindowStartedAt = Date.now();
            allFinished = false;
            await new Promise((resolve) => setTimeout(resolve, watchLoopIntervalMs));
            break;
          }
          fullReport += "\n✅ **Sprint Execution Finished.**\n";
          return fullReport;
        }

        case WatchLoopState.CHECKPOINT: {
          this.renewSprintRunHeartbeat({
            sprintRunId,
            sprintId: scopedExecutionContext.sprint.id,
            leaseToken,
          });
          checkpointWindowStartedAt = Date.now();
          await new Promise((resolve) => setTimeout(resolve, watchLoopIntervalMs));
          break;
        }

        case WatchLoopState.RUNNING: {
          const latestRun = this.deps.executionRepository.getSprintRun(sprintRunId);
          if (latestRun?.status === "paused" || latestRun?.status === "cancelled" || latestRun?.status === "cancel_requested") {
            continue;
          }
          this.renewSprintRunHeartbeat({
            sprintRunId,
            sprintId: scopedExecutionContext.sprint.id,
            leaseToken,
          });
          await new Promise((resolve) => setTimeout(resolve, watchLoopIntervalMs));
          break;
        }
      }
    }

    return fullReport;
  }

  private triggerAutoPromote(projectId: string, sprintId: string): void {
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

  private async renderInstruction(
    templateId: any,
    variables: Record<string, unknown>,
    repoPath?: string
  ): Promise<string> {
    return await this.deps.renderInstruction(templateId, variables, repoPath);
  }

  private renewSprintRunHeartbeat(args: {
    sprintRunId: string;
    sprintId: string;
    leaseToken?: string;
  }): void {
    const now = new Date().toISOString();
    this.deps.executionRepository.updateSprintRun(args.sprintRunId, {
      status: "running",
      lastHeartbeatAt: now,
    });
    if (args.leaseToken) {
      this.deps.executionRepository.renewLease({
        scopeType: "sprint",
        scopeId: args.sprintId,
        leaseToken: args.leaseToken,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
    }
  }

  private evaluateControlIntervention(sprintRunId: string): { status: "continue" } | { status: "exit", report: string } {
    const controlledRun = this.deps.executionRepository.getSprintRun(sprintRunId);
    if (controlledRun?.status === "paused") {
      return { status: "exit", report: "\n⏸️ **Sprint Paused:** Dashboard control paused this sprint run.\n" };
    }
    if (controlledRun?.status === "cancel_requested") {
      const finalized = this.deps.executionRepository.finalizeSprintRunCancellationIfIdle(sprintRunId);
      return {
        status: "exit",
        report: finalized
          ? "\n🛑 **Sprint Cancelled:** Dashboard control cancelled this sprint run.\n"
          : "\n🛑 **Sprint Cancellation Requested:** Dashboard control requested cancellation for this sprint run. Active work is still shutting down.\n"
      };
    }
    if (controlledRun?.status === "cancelled") {
      return { status: "exit", report: "\n🛑 **Sprint Cancelled:** Dashboard control cancelled this sprint run.\n" };
    }
    return { status: "continue" };
  }

  private async handleCycleTransition(params: {
    args: SprintAgentArgs;
    scopedExecutionContext: SprintExecutionContext & { sprintNumber: number };
    repoPath: string;
    defaultFeatureBranch: string;
    defaultBranch: string;
    featureBranchPrefix: string;
    githubMode: "REMOTE" | "LOCAL";
    retryFailed: boolean;
    loopSteps: SprintLoopStepSettings;
    ciIntelligence: CiIntelligenceSettings;
    automationLevel: AutomationLevel;
    automationInterventions: AutomationInterventionsSettings;
    sprintRunId: string;
    planningAgentPresetId?: string;
  }) {
    const cycleResult = await this.cycleRunner.run({
      action: params.args.action as "status" | "orchestrate",
      automationLevel: params.automationLevel,
      automationInterventions: params.automationInterventions,
      executionContext: params.scopedExecutionContext,
      repoPath: params.repoPath,
      defaultFeatureBranch: params.defaultFeatureBranch,
      retryFailed: params.retryFailed,
      loopSteps: params.loopSteps,
      ciIntelligence: params.ciIntelligence,
      githubMode: params.githubMode,
      defaultBranch: params.defaultBranch,
      featureBranchPrefix: params.featureBranchPrefix,
      sprintRunId: params.sprintRunId,
      planningAgentPresetId: params.planningAgentPresetId,
    });

    const timestamp = new Date().toLocaleTimeString();
    this.deps.updateLastStatus({
      project_id: params.scopedExecutionContext.project.id,
      sprint_id: params.scopedExecutionContext.sprint.id,
      sprint_number: params.scopedExecutionContext.sprintNumber,
      source_id: params.args.source_id,
      repo_path: params.repoPath,
      feature_branch: params.defaultFeatureBranch,
      subtasks: cycleResult.subtasks,
      reportText: cycleResult.reportText,
      statusTable: cycleResult.statusTable,
      instructions: cycleResult.instructions,
      timestamp,
    });

    return cycleResult;
  }

  private async finalizeSprintRun(params: {
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
        report += await this.renderInstruction("cleanupEmpty", {}, repoPath);
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
function resolveMainMergeConflictAttentionItems(
  projectAttentionService: {
    listActiveProjectItems: (projectId: string) => Array<{
      id: string;
      sprintRunId: string | null;
      attentionType: string;
      summaryMarkdown: string;
      payload: Record<string, unknown> | null;
    }>;
    resolveItem: (itemId: string, input?: {
      status?: "resolved" | "dismissed" | "expired";
      reason?: string;
      resolutionSummaryMarkdown?: string;
      workerEndpointId?: string | null;
      payloadPatch?: Record<string, unknown> | null;
    }) => unknown;
  },
  projectId: string,
  sprintRunId: string,
): void {
  const activeItems = projectAttentionService.listActiveProjectItems(projectId);
  for (const item of activeItems) {
    if (item.sprintRunId !== sprintRunId) {
      continue;
    }
    if (!isMainMergeAttentionItem(item)) {
      continue;
    }

    projectAttentionService.resolveItem(item.id, {
      status: "resolved",
      reason: "main_merge_conflict_cleared",
      resolutionSummaryMarkdown: [
        item.summaryMarkdown.trim(),
        "",
        "Resolved automatically because the main branch merge conflict no longer exists.",
      ].filter(Boolean).join("\n"),
    });
  }
}

function collectActiveMainMergeAttentionItems(
  projectAttentionService: {
    listActiveProjectItems: (projectId: string) => Array<{
      id: string;
      sprintRunId: string | null;
      attentionType: string;
      ownerType?: string;
      status?: string;
      summaryMarkdown: string;
      payload: Record<string, unknown> | null;
    }>;
  },
  projectId: string,
  sprintRunId: string,
): Array<{
  id: string;
  sprintRunId: string | null;
  attentionType: string;
  summaryMarkdown: string;
  payload: Record<string, unknown> | null;
}> {
  return projectAttentionService.listActiveProjectItems(projectId).filter((item) => (
    item.sprintRunId === sprintRunId && isMainMergeAttentionItem(item)
  ));
}

export function isMainMergeAttentionItem(item: {
  attentionType: string;
  payload: Record<string, unknown> | null;
}): boolean {
  const payload = item.payload || {};
  const isMainMergeConflict = item.attentionType === "merge_conflict" && payload.mergeStage === "main";
  const isMainMergeConflictHandoff = (
    (item.attentionType === "human_escalation_required" || item.attentionType === "dashboard_reply_required")
    && payload.sourceAttentionType === "merge_conflict"
    && payload.mergeStage === "main"
  );
  return isMainMergeConflict || isMainMergeConflictHandoff;
}

function pauseSprintRunForMainMergeBlocker(args: {
  executionRepository: Pick<SprintOrchestratorDependencies["executionRepository"], "updateSprintRun" | "appendSprintRunEvent">;
  sprintRunId: string;
  sprintNumber: number;
  mergeFeedback: MergeFeedbackResult;
  attentionItems: Array<{ id: string; attentionType: string }>;
}): void {
  transitionSprintRun(
    args.executionRepository,
    args.sprintRunId,
    "paused",
    "sprint_paused",
    {
      reason: "main_merge_blocked",
      sprintNumber: args.sprintNumber,
      mainMergeState: args.mergeFeedback.state,
      prNumber: args.mergeFeedback.prNumber,
      prUrl: args.mergeFeedback.prUrl,
      hasMergeConflict: args.mergeFeedback.hasMergeConflict,
      attentionItemIds: args.attentionItems.map((item) => item.id),
      attentionTypes: args.attentionItems.map((item) => item.attentionType),
    },
    `sprint-paused:${args.sprintRunId}:main-merge-blocked:${args.mergeFeedback.state}:${args.mergeFeedback.prNumber || "none"}`
  );
}

function shouldKeepWatchLoopAliveForMainMerge(
  mode: CiIntelligenceSettings["mainBranchAutoMergeMode"],
  mergeFeedback: MergeFeedbackResult,
): boolean {
  if (mode !== "WHEN_GREEN" && mode !== "ALWAYS") {
    return false;
  }

  return (
    mergeFeedback.state === "missing_pr"
    || mergeFeedback.state === "pending_checks"
    || mergeFeedback.state === "ready_for_merge"
    || mergeFeedback.state === "automerge_scheduled"
    || mergeFeedback.state === "automerge_failed"
  );
}

function shouldPauseForMainMergeBlocker(
  mergeFeedback: MergeFeedbackResult,
  attentionItems: Array<{ id: string }>,
): boolean {
  return (
    attentionItems.length > 0
    || mergeFeedback.state === "merge_conflict"
    || mergeFeedback.state === "failed_checks"
    || mergeFeedback.state === "review_blocked"
  );
}



function buildMainMergeConflictSummary(args: {
  repoPath: string;
  featureBranch: string;
  defaultBranch: string;
  prNumber: number | null;
  prUrl: string | null;
  mergedTaskContexts: Array<{
    taskKey: string;
    taskTitle: string;
    taskPrompt: string;
    workerBranch: string | null;
    prUrl: string | null;
  }>;
}): string {
  return buildConflictSummaryMarkdown({
    repoPath: args.repoPath,
    workingDir: `cd ${args.repoPath}`,
    conflictingBranches: {
      source: args.featureBranch,
      target: args.defaultBranch,
    },
    prInfo: {
      number: args.prNumber,
      url: args.prUrl,
    },
    mergedTaskContexts: args.mergedTaskContexts,
    isMainMerge: true,
  });
}

function partitionSubtasksByStatus(subtasks: Subtask[]) {
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

export function evaluateSprintRunState(params: {
  subtasks: Subtask[];
  manualMergeTasks: Subtask[];
  workerEscalatedMergeConflictTasks: Subtask[];
  activeProjectAttentionItems: ProjectAttentionItemRecord[];
  sprintRunId: string;
}) {
  const { subtasks, manualMergeTasks, workerEscalatedMergeConflictTasks, activeProjectAttentionItems, sprintRunId } = params;

  const { tasksByStatus, statusCounts } = partitionSubtasksByStatus(subtasks);

  const runningTasks = tasksByStatus.get("RUNNING") || [];
  const readyTasks = tasksByStatus.get("PENDING") || [];
  const activeWorkerAttentionItems = activeProjectAttentionItems.filter((item) => item.ownerType === "worker");
  const activeWorkerMergeConflictAttention = activeWorkerAttentionItems.some((item) => item.attentionType === "merge_conflict");
  const activeMainMergeAttentionItems = activeProjectAttentionItems.filter((item) => (
    item.sprintRunId === sprintRunId && isMainMergeAttentionItem(item)
  ));

  let settledCount = 0;
  for (const task of subtasks) {
    if (isCompletedTaskSettled(task)) {
      settledCount++;
    }
  }

  const allTerminal = subtasks.length > 0 && ((statusCounts["FAILED"] || 0) + settledCount) === subtasks.length;
  const quotaTasks = tasksByStatus.get("QUOTA") || [];
  const noMoreActionPossible = runningTasks.length === 0 && readyTasks.length === 0 && quotaTasks.length === 0;
  const needsManualMerge = manualMergeTasks.length > 0;
  const waitingOnWorkerAttention = workerEscalatedMergeConflictTasks.length > 0
    || activeWorkerMergeConflictAttention
    || activeWorkerAttentionItems.length > 0;

  const allFinished = allTerminal || ((needsManualMerge || noMoreActionPossible) && !waitingOnWorkerAttention);

  return {
    runningTasks,
    readyTasks,
    activeWorkerAttentionItems,
    activeWorkerMergeConflictAttention,
    activeMainMergeAttentionItems,
    allTerminal,
    quotaTasks,
    noMoreActionPossible,
    needsManualMerge,
    waitingOnWorkerAttention,
    allFinished,
  };
}
