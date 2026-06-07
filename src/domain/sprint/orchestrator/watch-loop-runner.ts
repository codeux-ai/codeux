import { runCompletionStep } from "../../../sprint/steps/completion-step.js";
import type { SprintAgentArgs } from "../../../sprint/sprint-types.js";
import { runCommandStrict } from "../../../services/cli-process-runner.js";
import { determineNextState, WatchLoopState } from "./watch-loop-state-machine.js";
import type { Subtask,
  AutomationInterventionsSettings,
  AutomationLevel,
  CiIntelligenceSettings,
  DashboardSettings,
  DashboardSettingsScope,
  SprintLoopStepSettings,
  DashboardStatusSnapshot,
 } from "../../../contracts/app-types.js";
import type { InstructionTemplateId } from "../../../instructions/instruction-template-catalog.js";
import type { MemoryPromotionService } from "../../../services/memory-promotion-service.js";
import type { QualityAssuranceService } from "../../../services/quality-assurance-service.js";
import type { Logger } from "../../../shared/logging/logger.js";
import type { ExecutionRepository } from "../../../repositories/execution-repository.js";
import type { ProjectAttentionService } from "../../workers/project-attention-service.js";
import type { CycleRunner } from "./cycle-runner.js";
import type { SprintExecutionContext } from "../../../services/sprint-execution-state-service.js";
import type { MergeFeedbackResult } from "../ci/main-merge-gate.js";
import type { ProjectAttentionItemRecord } from "../../../contracts/project-attention-types.js";
import { isCompletedTaskSettled } from "../task-merge-state.js";
import { transitionSprintRun } from "./sprint-run-transitions.js";
import { buildTaskAttentionPayload } from "./attention-payload-builder.js";
import { decideMainMergeWaitOrPause, decideTerminalCompletion } from "./watch-loop-policies.js";
import { decideFinalizationTransition } from "./watch-loop-finalization-policy.js";
import { buildConflictSummaryMarkdown, selectMergedTaskContexts } from "./conflict-summary-utils.js";
import { WorkspaceManager } from "../../../infrastructure/providers/cli/workspace-manager.js";
import { evaluateSprintRunState, isMainMergeAttentionItem } from "./sprint-state-evaluator.js";
import type { HeartbeatService } from "../../../services/heartbeat-service.js";
import type { SprintIssueService } from "../../../services/sprint-issue-service.js";


export type WatchLoopExecutionDependencies = Pick<ExecutionRepository, "appendSprintRunEvent" | "finalizeSprintRunCancellationIfIdle" | "getSprintRun" | "getTaskRunByDispatchId" | "listTaskDispatches" | "listTaskRunEvents" | "updateSprintRun" | "renewLease">;
export type WatchLoopAttentionDependencies = Pick<ProjectAttentionService, "listActiveProjectItems" | "openItems" | "resolveItemsForSprintRun" | "resolveItem">;

export interface WatchLoopDependencies {
  logger: Logger;
  completedSprints: Set<string>;
  sleep?: (ms: number) => Promise<void>;
  getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings;
  renderInstruction: (templateId: InstructionTemplateId, variables: Record<string, unknown>, repoPath?: string) => Promise<string>;
  updateLastStatus: (status: DashboardStatusSnapshot) => void;
  resolvePlanningAgentPresetId?: (projectId: string) => Promise<string | undefined>;
  memoryPromotionService?: MemoryPromotionService;
  qualityAssuranceService?: QualityAssuranceService;
  sprintIssueService?: SprintIssueService;
  executionRepository: WatchLoopExecutionDependencies;
  projectAttentionService: WatchLoopAttentionDependencies;
  heartbeatService: HeartbeatService;
  workspaceManager: WorkspaceManager;
}

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
    private readonly deps: WatchLoopDependencies,
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

  private async sleep(ms: number): Promise<void> {
    if (typeof this.deps.sleep === "function") {
      await this.deps.sleep(ms);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

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

    this.deps.heartbeatService.startHeartbeat(sprintRunId, scopedExecutionContext.sprint.id, leaseToken);
    try {
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
            checkpointWindowStartedAt = Date.now();
            allFinished = false;
            await this.sleep(watchLoopIntervalMs);
            break;
          }
          fullReport += "\n✅ **Sprint Execution Finished.**\n";
          return fullReport;
        }

        case WatchLoopState.CHECKPOINT: {
          checkpointWindowStartedAt = Date.now();
          await this.sleep(watchLoopIntervalMs);
          break;
        }

        case WatchLoopState.RUNNING: {
          await this.sleep(watchLoopIntervalMs);
          break;
        }
      }
    }

    } finally {
      this.deps.heartbeatService.stopHeartbeat(sprintRunId);
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
    } as DashboardStatusSnapshot);

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
          this.deps.projectAttentionService.openItems([buildTaskAttentionPayload({
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
          })]);
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
        const decision = decideMainMergeWaitOrPause({
          mergeFeedback,
          attentionItems: remainingMainMergeAttentionItems,
          mainMergeMode,
          sprintNumber: scopedExecutionContext.sprintNumber,
        });

        if (decision && !(githubMode === "LOCAL" && subtasks.every(task => isCompletedTaskSettled(task) && task.is_merged))) {
          report += completionGuidance;
          report += mergeFeedback.text;

          if (decision.status === "exit" && decision.terminalState === "paused" && decision.pauseReason === "main_merge_blocked") {
            transitionSprintRun(
              this.deps.executionRepository,
              sprintRunId,
              "paused",
              "sprint_paused",
              {
                reason: "main_merge_blocked",
                ...decision.pausePayload,
              },
              `sprint-paused:${sprintRunId}:main-merge-blocked:${mergeFeedback.state}:${mergeFeedback.prNumber || "none"}`
            );
          }

          if (decision.reportModifier) {
            report += decision.reportModifier;
          }

          return { status: decision.status, report };
        }

        if (githubMode === "LOCAL") {
          try {
            this.deps.logger.info(`LOCAL Mode: Merging feature branch ${defaultFeatureBranch} into default branch ${defaultBranch}`);
            await runCommandStrict("git", ["checkout", defaultBranch], repoPath);
            await runCommandStrict(
              "git",
              ["merge", "--no-ff", "-m", `Merge branch '${defaultFeatureBranch}' into ${defaultBranch}`, defaultFeatureBranch],
              repoPath
            );
            report += `- ✅ **Merged locally:** Sprint feature branch \`${defaultFeatureBranch}\` merged into default branch \`${defaultBranch}\`.\n`;
            resolveMainMergeConflictAttentionItems(
              this.deps.projectAttentionService,
              scopedExecutionContext.project.id,
              sprintRunId,
            );
          } catch (err: any) {
            this.deps.logger.error(`LOCAL Mode: Failed to merge feature branch ${defaultFeatureBranch} into ${defaultBranch}`, err);
            try {
              await runCommandStrict("git", ["merge", "--abort"], repoPath);
            } catch (abortErr) {}

            const isWorkerOwned = ciIntelligence.resolveMainMergeConflicts;
            if (activeMainMergeAttentionItems.length === 0) {
              this.deps.projectAttentionService.openItems([buildTaskAttentionPayload({
                projectId: scopedExecutionContext.project.id,
                sprintId: scopedExecutionContext.sprint.id,
                sprintRunId,
                attentionType: "merge_conflict",
                severity: "high",
                ownerType: isWorkerOwned ? "worker" : "human",
                title: `Main merge conflict for ${scopedExecutionContext.sprint.name}`,
                summaryMarkdown: isWorkerOwned
                  ? `LOCAL Mode: Merge conflict merging feature branch \`${defaultFeatureBranch}\` into default branch \`${defaultBranch}\`. Virtual worker will attempt to resolve it automatically.`
                  : `LOCAL Mode: Merge conflict merging feature branch \`${defaultFeatureBranch}\` into default branch \`${defaultBranch}\`. Resolve it locally.\n\nError: ${err.message || String(err)}`,
                payload: {
                  repoPath,
                  workingDirectoryHint: `cd ${repoPath}`,
                  featureBranch: defaultFeatureBranch,
                  defaultBranch,
                  mergeStage: "main",
                  conflictingBranches: {
                    source: defaultFeatureBranch,
                    target: defaultBranch,
                  },
                  sprintNumber: scopedExecutionContext.sprintNumber,
                  sprintName: scopedExecutionContext.sprint.name,
                  featureBranchTaskContexts: selectMergedTaskContexts(subtasks, { limit: 8 }),
                },
              })]);
            }

            transitionSprintRun(
              this.deps.executionRepository,
              sprintRunId,
              "paused",
              "sprint_paused",
              {
                reason: "main_merge_blocked",
                message: isWorkerOwned
                  ? `Local merge conflict merging ${defaultFeatureBranch} into ${defaultBranch}. Virtual worker is resolving conflicts automatically.`
                  : `Local merge conflict merging ${defaultFeatureBranch} into ${defaultBranch}. Resolve conflicts locally.`,
              },
              `sprint-paused:${sprintRunId}:local-main-merge-blocked`
            );

            return {
              status: "exit",
              report: report + (isWorkerOwned
                ? `- ⏳ **Local Merge Conflict:** Failed to merge \`${defaultFeatureBranch}\` into \`${defaultBranch}\`. Virtual worker is resolving conflicts automatically.\n`
                : `- ⚠️ **Local Merge Conflict:** Failed to merge \`${defaultFeatureBranch}\` into \`${defaultBranch}\`. Resolve conflicts locally.\n`),
            };
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
        const issueCloseOutcome = await this.deps.sprintIssueService?.closeLinkedIssues(
          scopedExecutionContext.project.id,
          scopedExecutionContext.sprint.id,
        );
        await this.cleanupTerminalSprintCliWorkspaces({
          projectId: scopedExecutionContext.project.id,
          sprintId: scopedExecutionContext.sprint.id,
          sprintRunId,
          repoPath,
        });
        report += await this.deps.renderInstruction("cleanupAllMerged", { planning_target: scopedExecutionContext.sprint.name }, repoPath);
        report += completionGuidance;
        report += mergeFeedback.text;
        if (issueCloseOutcome?.reportText) {
          report += issueCloseOutcome.reportText;
        }
      } catch (cleanupError) {
        this.deps.logger.warn("Failed to finalize sprint run", {
          sprintRunId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    } else {
      const decision = decideTerminalCompletion({
        subtasks,
        manualMergeTasks,
      });

      const finalizationTransition = decideFinalizationTransition(decision);

      switch (finalizationTransition.type) {
        case "failed": {
          transitionSprintRun(
            this.deps.executionRepository,
            sprintRunId,
            "failed",
            "sprint_failed",
            { failedTaskCount: finalizationTransition.failedTaskCount },
            `sprint-failed:${sprintRunId}`
          );
          await this.cleanupTerminalSprintCliWorkspaces({
            projectId: scopedExecutionContext.project.id,
            sprintId: scopedExecutionContext.sprint.id,
            sprintRunId,
            repoPath,
          });
          report += await this.deps.renderInstruction("cleanupFailed", { planning_target: scopedExecutionContext.sprint.name }, repoPath);
          break;
        }
        case "paused_awaiting_merge": {
          transitionSprintRun(
            this.deps.executionRepository,
            sprintRunId,
            "paused",
            "sprint_paused",
            {
              reason: "awaiting_merge",
              awaitingMergeCount: finalizationTransition.awaitingMergeCount,
            },
            `sprint-paused:${sprintRunId}:awaiting-merge`
          );
          report += await this.deps.renderInstruction("cleanupDeferred", {}, repoPath);
          break;
        }
        case "cancelled_empty": {
          transitionSprintRun(
            this.deps.executionRepository,
            sprintRunId,
            "cancelled",
            "sprint_cancelled",
            { reason: "empty" },
            `sprint-cancelled:${sprintRunId}:empty`
          );
          await this.cleanupTerminalSprintCliWorkspaces({
            projectId: scopedExecutionContext.project.id,
            sprintId: scopedExecutionContext.sprint.id,
            sprintRunId,
            repoPath,
          });
          report += await this.renderInstruction("cleanupEmpty", {}, repoPath);
          break;
        }
        case "paused_manual_attention": {
          transitionSprintRun(
            this.deps.executionRepository,
            sprintRunId,
            "paused",
            "sprint_paused",
            { reason: "manual_attention" },
            `sprint-paused:${sprintRunId}:manual-attention`
          );
          this.deps.projectAttentionService.openItems([buildTaskAttentionPayload({
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
              runningTaskIds: finalizationTransition.runningTaskIds,
              readyTaskIds: finalizationTransition.readyTaskIds,
              blockedTaskIds: finalizationTransition.blockedTaskIds,
            },
          })]);
          break;
        }
        case "completed": {
          const settings = this.deps.getDashboardSettings({ projectId: scopedExecutionContext.project.id, sprintId: scopedExecutionContext.sprint.id });
          if (settings.jira?.autoCloseLinkedIssues) {
            try {
              const issueCloseOutcome = await this.deps.sprintIssueService?.closeLinkedIssues(scopedExecutionContext.project.id, scopedExecutionContext.sprint.id);
              if (issueCloseOutcome?.reportText) {
                report += issueCloseOutcome.reportText;
              }
            } catch (err) {
              this.deps.logger.warn("Failed to auto-close linked issues", { sprintRunId, error: err instanceof Error ? err.message : String(err) });
            }
          }
          break;
        }
        case "unhandled":
          break;
      }
    }

    return { status: "continue", report };
  }

  private async cleanupTerminalSprintCliWorkspaces(args: {
    projectId: string;
    sprintId: string;
    sprintRunId: string;
    repoPath: string;
  }): Promise<void> {
    const dispatches = this.deps.executionRepository.listTaskDispatches({
      projectId: args.projectId,
      sprintId: args.sprintId,
      sprintRunId: args.sprintRunId,
    });
    const cleanedSessionIds = new Set<string>();

    for (const dispatch of dispatches) {
      if (dispatch.executorType !== "docker_cli") {
        continue;
      }
      const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(dispatch.id);
      const sessionId = taskRun?.sessionId?.trim();
      const workspaceRefFromEvents = taskRun
        ? this.resolveWorkspaceReferenceFromTaskRunEvents(taskRun.id)
        : undefined;
      if (!sessionId || cleanedSessionIds.has(sessionId)) {
        if (workspaceRefFromEvents) {
          await this.deps.workspaceManager.removeWorktree(args.repoPath, workspaceRefFromEvents).catch(() => undefined);
        }
        continue;
      }
      cleanedSessionIds.add(sessionId);

      const worktreePath = workspaceRefFromEvents || await this.deps.workspaceManager.resolveResumeWorktreePath(
        args.repoPath,
        sessionId,
        "DOCKER",
      ).catch(() => undefined) || await this.deps.workspaceManager.resolveResumeWorktreePath(
        args.repoPath,
        sessionId,
        "HOST",
      ).catch(() => undefined);
      if (!worktreePath) {
        continue;
      }
      await this.deps.workspaceManager.removeWorktree(args.repoPath, worktreePath).catch(() => undefined);
    }
  }

  private resolveWorkspaceReferenceFromTaskRunEvents(taskRunId: string): string | undefined {
    const events = this.deps.executionRepository.listTaskRunEvents(taskRunId, 200);
    for (const event of events) {
      if (event.eventType !== "cli_workspace_bound" && event.eventType !== "cli_prepare_completed" && event.eventType !== "cli_worktree_preserved") {
        continue;
      }
      const payload = event.payload;
      if (!payload || typeof payload !== "object") {
        continue;
      }
      const worktreePath = (payload as Record<string, unknown>).worktreePath;
      if (typeof worktreePath !== "string" || worktreePath.trim().length === 0) {
        continue;
      }
      return worktreePath;
    }
    return undefined;
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
