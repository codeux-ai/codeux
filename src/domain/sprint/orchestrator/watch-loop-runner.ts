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
import { SprintFinalizationService, partitionSubtasksByStatus } from "./sprint-finalization-service.js";
import { isMainMergeAttentionItem } from "./main-merge-blocker.js";

export { isMainMergeAttentionItem };

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
  private finalizationService: SprintFinalizationService;

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
  ) {
    this.finalizationService = new SprintFinalizationService(deps, renderMainMergeCiFeedback);
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
          const finalizationResult = await this.finalizationService.finalizeSprintRun({
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
