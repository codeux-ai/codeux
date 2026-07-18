import { runCompletionStep } from "../../../sprint/steps/completion-step.js";
import type { SprintAgentArgs } from "../../../sprint/sprint-types.js";
import {
  deleteBranchLocally,
  mergeBranchLocallyInTemporaryWorktree,
  preserveDirtyCheckout,
  restorePreservedDirtyCheckout,
  type LocalMergeResult,
} from "../../../infrastructure/git/local-merge.js";
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
import type { MemoryRemediationService } from "../../../services/memory-remediation-service.js";
import type { QualityAssuranceService } from "../../../services/quality-assurance-service.js";
import type { Logger } from "../../../shared/logging/logger.js";
import type { ExecutionRepository } from "../../../repositories/execution-repository.js";
import type { ProjectAttentionService } from "../../workers/project-attention-service.js";
import { resolveTransientMergeAttentionHandoffs } from "../../workers/project-attention-cleanup.js";
import type { CycleRunner } from "./cycle-runner.js";
import type { SprintExecutionContext } from "../../../services/sprint-execution-state-service.js";
import type { MergeFeedbackResult } from "../ci/main-merge-gate.js";
import type { ProjectAttentionItemRecord } from "../../../contracts/project-attention-types.js";
import { buildTaskAttentionPayload } from "./attention-payload-builder.js";
import { decideMainMergeWaitOrPause, decideTerminalCompletion, isHumanEscalatedAttentionItem } from "./watch-loop-policies.js";
import { decideFinalizationTransition } from "./watch-loop-finalization-policy.js";
import { buildConflictSummaryMarkdown, selectMergedTaskContexts } from "./conflict-summary-utils.js";
import { WorkspaceManager } from "../../../infrastructure/providers/cli/workspace-manager.js";
import { evaluateSprintRunState, isMainMergeAttentionItem } from "./sprint-state-evaluator.js";
import { evaluateSprintTransitionState } from "../task-transition-state.js";
import { CLI_GIT_FINALIZATION_EVENT_SCAN_LIMIT, isCliTaskRun } from "../ci/cli-git-finalization.js";
import type { HeartbeatService } from "../../../services/heartbeat-service.js";
import type { SprintIssueService } from "../../../services/sprint-issue-service.js";
import type { SprintRunLifecycleService } from "../../../services/sprint-run-lifecycle-service.js";
import { getFailedJobLabels, getFailedLogSnippets } from "../../../sprint/ci-status-utils.js";
import { resolveRollbackFinalizationCiIntelligence } from "./rollback-finalization-policy.js";


export type WatchLoopExecutionDependencies = Pick<ExecutionRepository, "appendSprintRunEvent" | "getSprintRun" | "getLatestTaskRun" | "getTaskRunByDispatchId" | "listTaskDispatches" | "listTaskRunEvents" | "listTaskRunEventsForRuns">;
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
  memoryRemediationService?: MemoryRemediationService;
  qualityAssuranceService?: QualityAssuranceService;
  sprintIssueService?: SprintIssueService;
  executionRepository: WatchLoopExecutionDependencies;
  sprintRunLifecycleService: Pick<SprintRunLifecycleService, "transition" | "finalizeCancellationIfIdle">;
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
  private readonly lastStatusSnapshotFingerprints = new Map<string, string>();

  constructor(
    private readonly deps: WatchLoopDependencies,
    private readonly cycleRunner: CycleRunner,
    private readonly renderMainMergeCiFeedback: (args: {
      repoPath: string;
      projectId: string;
      sprintId: string;
      sprintRunId: string;
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

  private publishStatusSnapshot(params: {
    args: SprintAgentArgs;
    scopedExecutionContext: SprintExecutionContext & { sprintNumber: number };
    repoPath: string;
    defaultFeatureBranch: string;
    subtasks: Subtask[];
    reportText: string;
    statusTable: string;
    instructions: string;
    sprintRunId?: string;
    force?: boolean;
  }): void {
    const snapshot = {
      project_id: params.scopedExecutionContext.project.id,
      sprint_id: params.scopedExecutionContext.sprint.id,
      sprint_number: params.scopedExecutionContext.sprintNumber,
      source_id: params.args.source_id,
      repo_path: params.repoPath,
      feature_branch: params.defaultFeatureBranch,
      subtasks: params.subtasks,
      reportText: params.reportText,
      statusTable: params.statusTable,
      instructions: params.instructions,
      timestamp: new Date().toLocaleTimeString(),
    } as DashboardStatusSnapshot;

    if (!params.force && params.sprintRunId) {
      const fingerprint = buildStatusSnapshotFingerprint(snapshot);
      if (this.lastStatusSnapshotFingerprints.get(params.sprintRunId) === fingerprint) {
        return;
      }
      this.lastStatusSnapshotFingerprints.set(params.sprintRunId, fingerprint);
    }

    this.deps.updateLastStatus(snapshot);
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
    let previousCycleProgressFingerprint: string | null = null;
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
      const cycleProgressFingerprint = buildCycleProgressFingerprint(subtasks, manualMergeTasks);
      const madeCycleProgress = previousCycleProgressFingerprint !== null
        && previousCycleProgressFingerprint !== cycleProgressFingerprint;
      previousCycleProgressFingerprint = cycleProgressFingerprint;

      const activeProjectAttentionItems = typeof this.deps.projectAttentionService?.listActiveProjectItems === "function"
        ? (cycleResult.activeProjectAttentionItems ?? this.deps.projectAttentionService.listActiveProjectItems(scopedExecutionContext.project.id)).filter((item) => (
          item.status === "open" || item.status === "claimed"
        ))
        : [];
      // CycleRunner already loaded this evidence after its final merge drain.
      // Reusing that snapshot avoids a second getLatestTaskRun/event scan per
      // task while preserving the direct-read fallback for older test doubles.
      const localCliGitEvidence = cycleResult.localCliGitEvidence ?? this.collectLocalCliGitEvidence({
        githubMode,
        sprintRunId,
        subtasks,
      });

      const {
        runningTasks,
        readyTasks,
        activeMainMergeAttentionItems,
        settledTasks,
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
        githubMode,
        localCliPushedTaskIds: localCliGitEvidence.pushedTaskIds,
        localCliSettledTaskIds: localCliGitEvidence.settledTaskIds,
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
            allTasksSettled: subtasks.length > 0 && settledTasks.length === subtasks.length,
            allTerminal,
            noMoreActionPossible,
            activeMainMergeAttentionItems,
          });
          fullReport += finalizationResult.report;
          if (finalizationResult.status === "exit") {
            this.publishStatusSnapshot({
              args,
              scopedExecutionContext,
              repoPath,
              defaultFeatureBranch,
              subtasks,
              reportText: reportText + finalizationResult.report,
              statusTable,
              instructions,
              sprintRunId,
              force: true,
            });
            return fullReport;
          }
          if (finalizationResult.status === "wait") {
            this.publishStatusSnapshot({
              args,
              scopedExecutionContext,
              repoPath,
              defaultFeatureBranch,
              subtasks,
              reportText: reportText + finalizationResult.report,
              statusTable,
              instructions,
              sprintRunId,
              force: true,
            });
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
          await this.sleep(selectWatchLoopDelayMs(watchLoopIntervalMs, madeCycleProgress));
          break;
        }

        case WatchLoopState.RUNNING: {
          await this.sleep(selectWatchLoopDelayMs(watchLoopIntervalMs, madeCycleProgress));
          break;
        }
      }
    }

    } finally {
      this.deps.heartbeatService.stopHeartbeat(sprintRunId);
      this.lastStatusSnapshotFingerprints.delete(sprintRunId);
    }
    return fullReport;
  }

  private triggerMemoryRemediation(args: {
    projectId: string;
    sprintId: string;
    sprintRunId: string;
    repoPath: string;
    sprintName: string;
    sprintGoal: string;
  }): void {
    const remediationService = this.deps.memoryRemediationService;
    const settings = this.deps.getDashboardSettings({ projectId: args.projectId, sprintId: args.sprintId });
    if (!settings.memory?.enabled || settings.memory.remediationMode === "off") return;

    if (remediationService) {
      remediationService.remediateSprintMemories(args).then((result) => {
        this.deps.executionRepository.appendSprintRunEvent(args.sprintRunId, "memory_remediation_completed", "system", {
          mode: result.mode,
          aiUsed: result.aiUsed,
          promotedCount: result.promoted.length,
          candidateCount: result.candidateCount,
          skippedReason: result.skippedReason,
        }, {
          sourceEventKey: `memory-remediation:${args.sprintRunId}`,
        });
      }).catch((err) => {
        this.deps.logger.warn("Failed to remediate sprint memories", {
          projectId: args.projectId,
          sprintId: args.sprintId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return;
    }

    const promotionService = this.deps.memoryPromotionService;
    if (!promotionService || !settings.memory.autoPromote) return;
    promotionService.autoPromoteFromSprint(args.projectId, args.sprintId, settings.memory).catch((err) => {
      this.deps.logger.warn("Failed to auto-promote sprint memories", {
        projectId: args.projectId,
        sprintId: args.sprintId,
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
      const finalized = this.deps.sprintRunLifecycleService.finalizeCancellationIfIdle(sprintRunId);
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
    const cycleStartedAtMs = Date.now();
    const cycleStartedAt = new Date(cycleStartedAtMs).toISOString();
    const stallThresholdMs = Math.max(
      30_000,
      Math.max(1, params.loopSteps.watchLoopIntervalSeconds) * 3_000,
    );
    let stalled = false;
    const watchdog = setTimeout(() => {
      stalled = true;
      this.deps.logger.warn("Sprint watch cycle exceeded its progress deadline", {
        sprintRunId: params.sprintRunId,
        projectId: params.scopedExecutionContext.project.id,
        sprintId: params.scopedExecutionContext.sprint.id,
        cycleStartedAt,
        stallThresholdMs,
      });
      try {
        this.deps.executionRepository.appendSprintRunEvent(
          params.sprintRunId,
          "watch_cycle_stalled",
          "system",
          {
            cycleStartedAt,
            stallThresholdMs,
          },
          {
            sourceEventKey: `watch-cycle-stalled:${params.sprintRunId}:${cycleStartedAt}`,
          },
        );
      } catch (error) {
        this.deps.logger.warn("Failed to persist sprint watch-cycle stall event", {
          sprintRunId: params.sprintRunId,
          error,
        });
      }
    }, stallThresholdMs);
    watchdog.unref?.();

    let cycleResult: Awaited<ReturnType<CycleRunner["run"]>>;
    try {
      cycleResult = await this.cycleRunner.run({
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
    } finally {
      clearTimeout(watchdog);
      const cycleDurationMs = Date.now() - cycleStartedAtMs;
      const log = stalled ? this.deps.logger.info.bind(this.deps.logger) : this.deps.logger.debug?.bind(this.deps.logger);
      log?.("Sprint watch cycle completed", {
        sprintRunId: params.sprintRunId,
        cycleStartedAt,
        cycleDurationMs,
        recoveredFromStall: stalled,
      });
    }

    this.publishStatusSnapshot({
      args: params.args,
      scopedExecutionContext: params.scopedExecutionContext,
      repoPath: params.repoPath,
      defaultFeatureBranch: params.defaultFeatureBranch,
      subtasks: cycleResult.subtasks,
      reportText: cycleResult.reportText,
      statusTable: cycleResult.statusTable,
      instructions: cycleResult.instructions,
      sprintRunId: params.sprintRunId,
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
    allTasksSettled?: boolean;
    allTerminal: boolean;
    noMoreActionPossible: boolean;
    activeMainMergeAttentionItems: Array<{ id: string; sprintId?: string | null; sprintRunId: string | null; attentionType: string; ownerType?: string; status?: string; summaryMarkdown: string; payload: Record<string, unknown> | null }>;
  }): Promise<{ status: "continue" | "exit" | "wait"; report: string }> {
    const {
      scopedExecutionContext, sprintRunId, repoPath, defaultFeatureBranch, defaultBranch,
      featureBranchPrefix, githubMode, ciIntelligence: configuredCiIntelligence, subtasks, runningTasks, readyTasks,
      manualMergeTasks, needsManualMerge, allTasksSettled, allTerminal, noMoreActionPossible,
      activeMainMergeAttentionItems,
    } = params;

    // Remote rollbacks cannot bypass the PR boundary. Automatic remote rollbacks
    // force green-check auto-merge; agent-assisted remote rollbacks retain the
    // configured policy, with OFF promoted to a human CREATE_PR handoff. LOCAL
    // rollbacks keep the normal branch-to-default local finalization path.
    const ciIntelligence = resolveRollbackFinalizationCiIntelligence(
      configuredCiIntelligence,
      scopedExecutionContext.sprint.kind === "rollback"
        ? scopedExecutionContext.sprint.rollbackMode
        : null,
      githubMode,
    );

    let report = "";
    const mainMergeScope = {
      sprintId: scopedExecutionContext.sprint.id,
      sprintRunId,
      sourceBranch: defaultFeatureBranch,
      targetBranch: defaultBranch,
    };
    const mainMergeAttentionItems = activeMainMergeAttentionItems.filter((item) =>
      isMainMergeAttentionInScope(item, mainMergeScope)
    );
    const allTasksSettledForFinalization = allTasksSettled ?? (
      subtasks.length > 0
      && evaluateSprintTransitionState({
        subtasks,
        manualMergeTasks,
        workerEscalatedMergeConflictTasks: [],
        activeProjectAttentionItems: [],
        sprintRunId,
        githubMode,
      }).settledTasks.length === subtasks.length
    );
    const isAutomaticRollback = scopedExecutionContext.sprint.kind === "rollback"
      && scopedExecutionContext.sprint.rollbackMode === "automatic";

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

    if (allTasksSettledForFinalization) {
      try {
        if (this.deps.qualityAssuranceService && !isAutomaticRollback) {
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
          projectId: scopedExecutionContext.project.id,
          sprintId: scopedExecutionContext.sprint.id,
          sprintRunId,
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
          githubMode !== "LOCAL"
          && ciIntelligence.resolveMainMergeConflicts
          && mergeFeedback.hasMergeConflict
          && mainMergeAttentionItems.length === 0
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
              conflictingBranches: {
                source: defaultFeatureBranch,
                target: defaultBranch,
              },
              prNumber: mergeFeedback.prNumber,
              prUrl: mergeFeedback.prUrl,
              mergeStateStatus: mergeFeedback.mergeStateStatus,
              sprintNumber: scopedExecutionContext.sprintNumber,
              sprintName: scopedExecutionContext.sprint.name,
              featureBranchTaskContexts: selectMergedTaskContexts(subtasks, { limit: 8 }),
            },
          })]);
        } else if (
          githubMode !== "LOCAL"
          && ciIntelligence.resolveMainMergeConflicts
          && !mergeFeedback.hasMergeConflict
        ) {
          resolveMainMergeAttentionItems(
            this.deps.projectAttentionService,
            scopedExecutionContext.project.id,
            mainMergeScope,
            {
              kinds: ["merge_conflict"],
              reason: "main_merge_conflict_cleared",
              note: "Resolved automatically because the main branch merge conflict no longer exists.",
            },
          );
        }
        // Failing CI checks on the final feature→default merge PR: dispatch a worker
        // to fix them (bounded by the ci_fix guardrail) rather than pausing for a human.
        // The worker escalates to a human once it exhausts its attempts.
        if (
          githubMode !== "LOCAL"
          && ciIntelligence.resolveMainMergeFailedChecks
          && mergeFeedback.state === "failed_checks"
          && mergeFeedback.hasFailedChecks
          && mainMergeAttentionItems.length === 0
        ) {
          this.deps.projectAttentionService.openItems([buildTaskAttentionPayload({
            projectId: scopedExecutionContext.project.id,
            sprintId: scopedExecutionContext.sprint.id,
            sprintRunId,
            attentionType: "ci_fix_required",
            severity: "high",
            ownerType: "worker",
            title: `Main merge CI failing for ${scopedExecutionContext.sprint.name}`,
            summaryMarkdown: buildMainMergeCiFixSummary({
              featureBranch: defaultFeatureBranch,
              defaultBranch,
              prNumber: mergeFeedback.prNumber,
              prUrl: mergeFeedback.prUrl,
              failedChecks: mergeFeedback.failedChecks,
              mergedTaskContexts: selectMergedTaskContexts(subtasks, { limit: 8 }),
            }),
            payload: {
              repoPath,
              workingDirectoryHint: `cd ${repoPath}`,
              workerBranch: defaultFeatureBranch,
              branchName: defaultFeatureBranch,
              featureBranch: defaultBranch,
              defaultBranch,
              mergeStage: "main",
              conflictingBranches: {
                source: defaultFeatureBranch,
                target: defaultBranch,
              },
              prNumber: mergeFeedback.prNumber,
              prUrl: mergeFeedback.prUrl,
              mergeStateStatus: mergeFeedback.mergeStateStatus,
              failedChecks: mergeFeedback.failedChecks,
              failedRuns: mergeFeedback.failedRuns || [],
              failedJobLabels: getFailedJobLabels(mergeFeedback.failedRuns || []),
              failedLogSnippets: getFailedLogSnippets(mergeFeedback.failedRuns || []),
              sprintNumber: scopedExecutionContext.sprintNumber,
              sprintName: scopedExecutionContext.sprint.name,
              featureBranchTaskContexts: selectMergedTaskContexts(subtasks, { limit: 8 }),
            },
          })]);
        } else if (
          githubMode !== "LOCAL"
          && ciIntelligence.resolveMainMergeFailedChecks
          && !mergeFeedback.hasFailedChecks
          && mergeFeedback.state !== "pending_checks"
        ) {
          resolveMainMergeAttentionItems(
            this.deps.projectAttentionService,
            scopedExecutionContext.project.id,
            mainMergeScope,
            {
              kinds: ["ci_fix_required"],
              reason: "main_merge_checks_passed",
              note: "Resolved automatically because the main branch merge checks are no longer failing.",
            },
          );
        }
        const remainingMainMergeAttentionItems = collectActiveMainMergeAttentionItems(
          this.deps.projectAttentionService,
          scopedExecutionContext.project.id,
          mainMergeScope,
        );
        const mainMergeMode = ciIntelligence.mainBranchAutoMergeMode;
        const decision = decideMainMergeWaitOrPause({
          mergeFeedback,
          attentionItems: remainingMainMergeAttentionItems,
          mainMergeMode,
          sprintNumber: scopedExecutionContext.sprintNumber,
        });

        if (decision && githubMode !== "LOCAL") {
          report += completionGuidance;
          report += mergeFeedback.text;

          if (decision.status === "exit" && decision.terminalState === "paused" && decision.pauseReason === "main_merge_blocked") {
            this.deps.sprintRunLifecycleService.transition({
              sprintRunId,
              status: "paused",
              eventType: "sprint_paused",
              eventPayload: {
                reason: "main_merge_blocked",
                ...decision.pausePayload,
              },
              sourceEventKey: `sprint-paused:${sprintRunId}:main-merge-blocked:${mergeFeedback.state}:${mergeFeedback.prNumber || "none"}`,
            });
          }

          if (decision.reportModifier) {
            report += decision.reportModifier;
          }

          return { status: decision.status, report };
        }

        if (githubMode === "LOCAL") {
          if (mainMergeAttentionItems.length > 0) {
            const humanMustAct = mainMergeAttentionItems.some((item) => isHumanEscalatedAttentionItem(item));
            if (!humanMustAct) {
              return {
                status: "wait",
                report: report + `- ⏳ **Local Merge Conflict:** Existing main-merge attention is still assigned to a worker for \`${defaultFeatureBranch}\` → \`${defaultBranch}\`. Sprint remains active.\n`,
              };
            }

            this.deps.sprintRunLifecycleService.transition({
              sprintRunId,
              status: "paused",
              eventType: "sprint_paused",
              eventPayload: {
                reason: "main_merge_blocked",
                message: `Local merge conflict merging ${defaultFeatureBranch} into ${defaultBranch} still requires human attention.`,
              },
              sourceEventKey: `sprint-paused:${sprintRunId}:local-main-merge-attention-active`,
            });
            return {
              status: "exit",
              report: report + `- ⏸️ **Local Merge Conflict:** Existing main-merge attention requires a human before \`${defaultFeatureBranch}\` can merge into \`${defaultBranch}\`. Resolve conflicts locally.\n`,
            };
          }

          this.deps.logger.info(`LOCAL Mode: Merging feature branch ${defaultFeatureBranch} into default branch ${defaultBranch}`);
          let dirtyCheckout = null as Awaited<ReturnType<typeof preserveDirtyCheckout>>;
          try {
            dirtyCheckout = await preserveDirtyCheckout(repoPath);
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.deps.logger.error(`LOCAL Mode: Failed to preserve dirty checkout before merge: ${errorMessage}`);
            return {
              status: "exit",
              report: report + `- ⚠️ **Local Merge Blocked:** Failed to preserve dirty work before merging \`${defaultFeatureBranch}\` into \`${defaultBranch}\`. Error: ${errorMessage}\n`,
            };
          }

          let mainMerge: LocalMergeResult = {
            ok: false,
            conflict: false,
            error: "Local merge did not run.",
          };
          try {
            mainMerge = await mergeBranchLocallyInTemporaryWorktree({
              repoPath,
              targetBranch: defaultBranch,
              sourceBranch: defaultFeatureBranch,
              commitMessage: `Merge branch '${defaultFeatureBranch}' into ${defaultBranch}`,
              fallbackTargetBranches: [
                scopedExecutionContext.project.defaultBranch || "",
                "main",
                "master",
              ],
            });
          } catch (err) {
            mainMerge = {
              ok: false,
              conflict: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }

          if (mainMerge.ok) {
            report += `- ✅ **Merged locally:** Sprint feature branch \`${defaultFeatureBranch}\` merged into default branch \`${defaultBranch}\`.\n`;
            if (dirtyCheckout) {
              const dirtyRestore = await restorePreservedDirtyCheckout(repoPath, dirtyCheckout.dirtyRefBranch);
              if (dirtyRestore.ok) {
                report += `- ✅ **Dirty checkout restored:** Preserved local work from \`${dirtyCheckout.dirtyRefBranch}\` was copied back into the visible checkout as uncommitted changes.\n`;
              } else {
                this.deps.projectAttentionService.openItems([{
                  projectId: scopedExecutionContext.project.id,
                  sprintId: scopedExecutionContext.sprint.id,
                  sprintRunId,
                  attentionType: "action_required",
                  severity: dirtyRestore.conflict ? "high" : "medium",
                  ownerType: "system",
                  title: dirtyRestore.conflict ? "Local dirty work conflicts with sprint merge" : "Local dirty work preserved",
                  summaryMarkdown: dirtyRestore.conflict
                    ? `User-created dirty work was preserved on branch \`${dirtyCheckout.dirtyRefBranch}\`, but could not be copied back into the visible checkout because it conflicts with the merged sprint output. Review that branch and manually recover the needed changes.`
                    : `User-created dirty work was preserved on branch \`${dirtyCheckout.dirtyRefBranch}\`, but Code UX could not copy it back into the visible checkout. Review that branch and manually recover the needed changes.`,
                  payload: {
                    reason: dirtyRestore.conflict ? "local_dirty_checkout_restore_conflict" : "local_dirty_checkout_restore_failed",
                    dirtyRefBranch: dirtyCheckout.dirtyRefBranch,
                    originalRef: dirtyCheckout.originalRef,
                    defaultBranch,
                    featureBranch: defaultFeatureBranch,
                    restoredPaths: dirtyRestore.restoredPaths,
                    error: dirtyRestore.error || null,
                  },
                }]);
                report += dirtyRestore.conflict
                  ? `- ⚠️ **Dirty checkout conflict:** Preserved local work remains on \`${dirtyCheckout.dirtyRefBranch}\` because it conflicts with the merged sprint output.\n`
                  : `- ⚠️ **Dirty checkout preserved:** Preserved local work remains on \`${dirtyCheckout.dirtyRefBranch}\` because it could not be copied back automatically.\n`;
              }
            }
            // The sprint's work is now on the default branch; drop the feature branch so finished
            // sprints don't leave dead branches behind. Temporary-worktree merges leave the visible
            // checkout untouched, and git refuses to delete the currently checked-out branch anyway.
            const deleteMergedBranches = this.deps.getDashboardSettings({
              projectId: scopedExecutionContext.project.id,
              sprintId: scopedExecutionContext.sprint.id,
            }).git.deleteMergedBranches;
            if (deleteMergedBranches) {
              const deleted = await deleteBranchLocally({ repoPath, branch: defaultFeatureBranch });
              if (deleted) {
                this.deps.logger.info(`LOCAL Mode: Deleted merged feature branch ${defaultFeatureBranch}`);
              }
            }
            resolveMainMergeAttentionItems(
              this.deps.projectAttentionService,
              scopedExecutionContext.project.id,
              mainMergeScope,
              {
                kinds: ["merge_conflict", "ci_fix_required"],
                reason: "main_merge_completed",
                note: "Resolved automatically because the feature branch merged into the default branch.",
              },
            );
          } else {
            this.deps.logger.error(`LOCAL Mode: Failed to merge feature branch ${defaultFeatureBranch} into ${defaultBranch}: ${mainMerge.error}`);
            if (dirtyCheckout) {
              this.deps.projectAttentionService.openItems([{
                projectId: scopedExecutionContext.project.id,
                sprintId: scopedExecutionContext.sprint.id,
                sprintRunId,
                attentionType: "action_required",
                severity: "medium",
                ownerType: "system",
                title: "Local dirty work preserved",
                summaryMarkdown: `User-created dirty work was preserved on branch \`${dirtyCheckout.dirtyRefBranch}\` before Code UX attempted the sprint merge. The sprint merge did not complete, so Code UX left the preserved dirty branch intact for manual recovery.`,
                payload: {
                  reason: "local_dirty_checkout_preserved_merge_failed",
                  dirtyRefBranch: dirtyCheckout.dirtyRefBranch,
                  originalRef: dirtyCheckout.originalRef,
                  defaultBranch,
                  featureBranch: defaultFeatureBranch,
                  error: mainMerge.error || null,
                },
              }]);
              report += `- ⚠️ **Dirty checkout preserved:** Local dirty work remains on \`${dirtyCheckout.dirtyRefBranch}\` because the sprint merge did not complete.\n`;
            }

            const isWorkerOwned = ciIntelligence.resolveMainMergeConflicts;
            if (mainMergeAttentionItems.length === 0) {
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
                  : `LOCAL Mode: Merge conflict merging feature branch \`${defaultFeatureBranch}\` into default branch \`${defaultBranch}\`. Resolve it locally.\n\nError: ${mainMerge.error}`,
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

            // A virtual worker is actively resolving the conflict — keep the sprint
            // alive and wait for it, rather than flipping the run to `paused`. Pausing
            // mid-resolution misrepresents in-progress work as a stalled sprint and
            // requires a manual resume even though the orchestrator is still working.
            // Only pause once the worker has given up and escalated to a human (or when
            // worker resolution is disabled, so a human must act from the start).
            const humanMustAct =
              !isWorkerOwned ||
              mainMergeAttentionItems.some((item) => isHumanEscalatedAttentionItem(item));

            if (!humanMustAct) {
              return {
                status: "wait",
                report: report + `- ⏳ **Local Merge Conflict:** Resolving \`${defaultFeatureBranch}\` → \`${defaultBranch}\` automatically via virtual worker. Sprint remains active.\n`,
              };
            }

            this.deps.sprintRunLifecycleService.transition({
              sprintRunId,
              status: "paused",
              eventType: "sprint_paused",
              eventPayload: {
                reason: "main_merge_blocked",
                message: `Local merge conflict merging ${defaultFeatureBranch} into ${defaultBranch}. Resolve conflicts locally.`,
              },
              sourceEventKey: `sprint-paused:${sprintRunId}:local-main-merge-blocked`,
            });

            return {
              status: "exit",
              report: report + `- ⚠️ **Local Merge Conflict:** Failed to merge \`${defaultFeatureBranch}\` into \`${defaultBranch}\`. Resolve conflicts locally.\n`,
            };
          }
        }
        if (githubMode === "REMOTE" && mergeFeedback.state !== "merged") {
          report += completionGuidance;
          report += mergeFeedback.text;

          const remoteFinalMergeCanProgress =
            ciIntelligence.mainBranchAutoMergeMode === "WHEN_GREEN"
            || ciIntelligence.mainBranchAutoMergeMode === "ALWAYS";

          if (remoteFinalMergeCanProgress) {
            return {
              status: "wait",
              report: report + "\n⏳ **Sprint Still Active:** Waiting for GitHub to report the final completion PR as merged before completing the sprint.\n",
            };
          }

          this.deps.sprintRunLifecycleService.transition({
            sprintRunId,
            status: "paused",
            eventType: "sprint_paused",
            eventPayload: {
              reason: "main_merge_blocked",
              mainMergeState: mergeFeedback.state,
              prNumber: mergeFeedback.prNumber,
              prUrl: mergeFeedback.prUrl,
            },
            sourceEventKey: `sprint-paused:${sprintRunId}:remote-main-merge-not-merged:${mergeFeedback.state}:${mergeFeedback.prNumber || "none"}`,
          });

          return {
            status: "exit",
            report: report + "\n⏸️ **Sprint Paused:** Final completion PR is not merged. Merge the PR into the default branch, then resume the sprint.\n",
          };
        }
        this.deps.completedSprints.add(`${scopedExecutionContext.project.id}:${scopedExecutionContext.sprint.id}`);
        this.deps.sprintRunLifecycleService.transition({
          sprintRunId,
          status: "completed",
          eventType: "sprint_completed",
          eventPayload: {
            sprintNumber: scopedExecutionContext.sprintNumber,
            taskCount: subtasks.length,
          },
          sourceEventKey: `sprint-completed:${sprintRunId}`,
        });
        // The sprint has finished merging — reap any merge attention items that
        // are still open for this run (e.g. a transient escalation the auto-merge
        // gate raised then superseded). Left behind, they keep the project pinned
        // to `intervention` forever even though there is nothing left to merge.
        this.deps.projectAttentionService.resolveItemsForSprintRun(
          scopedExecutionContext.project.id,
          sprintRunId,
          ["merge_required", "merge_conflict"],
          "sprint_completed",
        );
        resolveTransientMergeAttentionHandoffs(
          this.deps.projectAttentionService,
          scopedExecutionContext.project.id,
          sprintRunId,
          "sprint_completed",
        );
        if (!isAutomaticRollback) {
          this.triggerMemoryRemediation({
            projectId: scopedExecutionContext.project.id,
            sprintId: scopedExecutionContext.sprint.id,
            sprintRunId,
            repoPath,
            sprintName: scopedExecutionContext.sprint.name,
            sprintGoal: scopedExecutionContext.sprint.goal,
          });
        }
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
          this.deps.sprintRunLifecycleService.transition({
            sprintRunId,
            status: "failed",
            eventType: "sprint_failed",
            eventPayload: { failedTaskCount: finalizationTransition.failedTaskCount },
            sourceEventKey: `sprint-failed:${sprintRunId}`,
          });
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
          const retryableLocalWorkerMerge = githubMode === "LOCAL"
            && manualMergeTasks.length > 0
            && manualMergeTasks.every((task) => Boolean(task.worker_branch)
              && task.merge_indicator !== "MERGE_BLOCKED"
              && task.merge_indicator !== "MERGE_CONFLICT");
          if (retryableLocalWorkerMerge) {
            // A branch-only merge drain can miss a worker that completes while the
            // drain is running. Keep LOCAL runs alive for the next drain instead
            // of pausing a clean, retryable worker branch indefinitely.
            break;
          }
          this.deps.sprintRunLifecycleService.transition({
            sprintRunId,
            status: "paused",
            eventType: "sprint_paused",
            eventPayload: {
              reason: "awaiting_merge",
              awaitingMergeCount: finalizationTransition.awaitingMergeCount,
            },
            sourceEventKey: `sprint-paused:${sprintRunId}:awaiting-merge`,
          });
          report += await this.deps.renderInstruction("cleanupDeferred", {}, repoPath);
          break;
        }
        case "cancelled_empty": {
          this.deps.sprintRunLifecycleService.transition({
            sprintRunId,
            status: "cancelled",
            eventType: "sprint_cancelled",
            eventPayload: { reason: "empty" },
            sourceEventKey: `sprint-cancelled:${sprintRunId}:empty`,
          });
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
          this.deps.sprintRunLifecycleService.transition({
            sprintRunId,
            status: "paused",
            eventType: "sprint_paused",
            eventPayload: { reason: "manual_attention" },
            sourceEventKey: `sprint-paused:${sprintRunId}:manual-attention`,
          });
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

  private collectLocalCliGitEvidence(args: {
    githubMode: "REMOTE" | "LOCAL";
    sprintRunId: string;
    subtasks: Subtask[];
  }): { pushedTaskIds: Set<string>; settledTaskIds: Set<string> } {
    const pushedTaskIds = new Set<string>();
    const settledTaskIds = new Set<string>();
    if (args.githubMode !== "LOCAL") {
      return { pushedTaskIds, settledTaskIds };
    }

    const resolvedRuns: Array<{
      task: Subtask;
      recordId: string;
      taskRun: NonNullable<ReturnType<ExecutionRepository["getLatestTaskRun"]>>;
    }> = [];
    for (const task of args.subtasks) {
      const recordId = task.record_id?.trim();
      if (!recordId) {
        continue;
      }
      const taskRun = this.deps.executionRepository.getLatestTaskRun(recordId, args.sprintRunId);
      if (!isCliTaskRun(taskRun) || !taskRun?.id) {
        continue;
      }
      resolvedRuns.push({ task, recordId, taskRun });
    }

    let eventsByTaskRunId: Map<string, ReturnType<ExecutionRepository["listTaskRunEvents"]>>;
    try {
      eventsByTaskRunId = this.deps.executionRepository.listTaskRunEventsForRuns(
        resolvedRuns.map(({ taskRun }) => taskRun.id),
        {
          eventTypes: ["cli_git_pushed", "cli_git_no_changes", "ci_gate_status"],
          limitPerRun: CLI_GIT_FINALIZATION_EVENT_SCAN_LIMIT,
        },
      );
    } catch {
      eventsByTaskRunId = new Map();
    }

    for (const { task, recordId, taskRun } of resolvedRuns) {
      let events = eventsByTaskRunId.get(taskRun.id);
      if (!events) {
        try {
          events = this.deps.executionRepository.listTaskRunEvents(
            taskRun.id,
            CLI_GIT_FINALIZATION_EVENT_SCAN_LIMIT,
            {
              eventTypes: ["cli_git_pushed", "cli_git_no_changes", "ci_gate_status"],
              skipValidation: true,
            },
          );
        } catch {
          continue;
        }
      }

      const taskIds = [recordId, task.id?.trim()].filter((taskId): taskId is string => Boolean(taskId));
      const addTaskIds = (target: Set<string>): void => {
        for (const taskId of taskIds) {
          target.add(taskId);
        }
      };

      if (events.some((event) => event.eventType === "cli_git_pushed")) {
        addTaskIds(pushedTaskIds);
      }
      if (events.some((event) => {
        if (event.eventType === "cli_git_no_changes") {
          return true;
        }
        if (event.eventType !== "ci_gate_status") {
          return false;
        }
        const state = typeof event.payload?.state === "string" ? event.payload.state : "";
        return state === "merged_branch" || state === "no_merge_work";
      })) {
        addTaskIds(settledTaskIds);
      }
    }

    return { pushedTaskIds, settledTaskIds };
  }

  private resolveWorkspaceReferenceFromTaskRunEvents(taskRunId: string): string | undefined {
    const events = this.deps.executionRepository.listTaskRunEvents(taskRunId, 200, {
      eventTypes: ["cli_workspace_bound", "cli_prepare_completed", "cli_worktree_preserved"],
      skipValidation: true,
    });
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

const FAST_FOLLOW_UP_DELAY_MS = 250;

export function selectWatchLoopDelayMs(watchLoopIntervalMs: number, madeCycleProgress: boolean): number {
  return madeCycleProgress
    ? Math.min(watchLoopIntervalMs, FAST_FOLLOW_UP_DELAY_MS)
    : watchLoopIntervalMs;
}

function buildCycleProgressFingerprint(subtasks: Subtask[], manualMergeTasks: Subtask[]): string {
  const taskState = subtasks.map((task) => [
    task.id,
    task.status,
    Boolean(task.is_merged),
    task.merge_indicator || "",
    task.worker_branch || "",
  ].join(":"));
  const manualMergeTaskIds = manualMergeTasks.map((task) => task.id).sort();
  return `${taskState.join("|")}#${manualMergeTaskIds.join(",")}`;
}
/**
 * Classifies a main-merge attention item by the blocker it addresses, looking through
 * escalation handoffs (which carry the original type on `payload.sourceAttentionType`).
 * Returns null for items that are not main-merge blockers.
 */
function mainMergeAttentionItemKind(
  item: { attentionType: string; payload: Record<string, unknown> | null },
): "merge_conflict" | "ci_fix_required" | null {
  if (!isMainMergeAttentionItem(item)) {
    return null;
  }
  if (item.attentionType === "merge_conflict") {
    return "merge_conflict";
  }
  if (item.attentionType === "ci_fix_required") {
    return "ci_fix_required";
  }
  const source = (item.payload || {}).sourceAttentionType;
  if (source === "merge_conflict") {
    return "merge_conflict";
  }
  if (source === "ci_fix_required" || source === "ci_fix") {
    return "ci_fix_required";
  }
  return null;
}

function resolveMainMergeAttentionItems(
  projectAttentionService: {
    listActiveProjectItems: (projectId: string) => Array<{
      id: string;
      sprintId?: string | null;
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
  scope: {
    sprintId: string;
    sprintRunId: string;
    sourceBranch: string;
    targetBranch: string;
  },
  options: {
    kinds: Array<"merge_conflict" | "ci_fix_required">;
    reason: string;
    note: string;
  },
): void {
  const activeItems = projectAttentionService.listActiveProjectItems(projectId);
  for (const item of activeItems) {
    if (!isMainMergeAttentionInScope(item, scope)) {
      continue;
    }
    const kind = mainMergeAttentionItemKind(item);
    if (!kind || !options.kinds.includes(kind)) {
      continue;
    }

    projectAttentionService.resolveItem(item.id, {
      status: "resolved",
      reason: options.reason,
      resolutionSummaryMarkdown: [
        item.summaryMarkdown.trim(),
        "",
        options.note,
      ].filter(Boolean).join("\n"),
    });
  }
}

function collectActiveMainMergeAttentionItems(
  projectAttentionService: {
    listActiveProjectItems: (projectId: string) => Array<{
      id: string;
      sprintId?: string | null;
      sprintRunId: string | null;
      attentionType: string;
      ownerType?: string;
      status?: string;
      summaryMarkdown: string;
      payload: Record<string, unknown> | null;
    }>;
  },
  projectId: string,
  scope: {
    sprintId: string;
    sprintRunId: string;
    sourceBranch: string;
    targetBranch: string;
  },
): Array<{
  id: string;
  sprintId?: string | null;
  sprintRunId: string | null;
  attentionType: string;
  ownerType?: string;
  status?: string;
  summaryMarkdown: string;
  payload: Record<string, unknown> | null;
}> {
  return projectAttentionService.listActiveProjectItems(projectId).filter((item) => (
    isMainMergeAttentionInScope(item, scope)
  ));
}

function buildStatusSnapshotFingerprint(snapshot: DashboardStatusSnapshot): string {
  return JSON.stringify({
    project_id: snapshot.project_id,
    sprint_id: snapshot.sprint_id,
    sprint_number: snapshot.sprint_number,
    source_id: snapshot.source_id,
    repo_path: snapshot.repo_path,
    feature_branch: snapshot.feature_branch,
    reportText: snapshot.reportText,
    statusTable: snapshot.statusTable,
    instructions: snapshot.instructions,
    subtasks: (snapshot.subtasks || []).map((task) => {
      const activities = Array.isArray(task.activities) ? task.activities : [];
      const latestActivity = activities.length > 0 ? activities[activities.length - 1] : null;
      return {
        record_id: task.record_id,
        project_id: task.project_id,
        sprint_id: task.sprint_id,
        id: task.id,
        title: task.title,
        depends_on: task.depends_on,
        status: task.status,
        session_id: task.session_id,
        session_name: task.session_name,
        session_state: task.session_state,
        provider: task.provider,
        model: task.model,
        worker_branch: task.worker_branch,
        pr_url: task.pr_url,
        is_independent: task.is_independent,
        is_merged: Boolean(task.is_merged),
        merge_indicator: task.merge_indicator,
        intervention_owner: task.intervention_owner,
        intervention_hint: task.intervention_hint,
        latestReview: task.latestReview,
        qa_review: task.qa_review,
        activitiesLength: activities.length,
        latestActivity,
      };
    }),
  });
}

function isMainMergeAttentionInScope(
  item: {
    sprintId?: string | null;
    sprintRunId: string | null;
    attentionType: string;
    payload: Record<string, unknown> | null;
  },
  scope: {
    sprintId: string;
    sprintRunId: string;
    sourceBranch: string;
    targetBranch: string;
  },
): boolean {
  if (!isMainMergeAttentionItem(item)) {
    return false;
  }

  if (item.sprintId && item.sprintId !== scope.sprintId) {
    return false;
  }

  if (!item.sprintId && item.sprintRunId !== scope.sprintRunId) {
    return false;
  }

  const payload = item.payload || {};
  const conflictingBranches = typeof payload.conflictingBranches === "object" && payload.conflictingBranches !== null
    ? payload.conflictingBranches as Record<string, unknown>
    : null;
  const sourceBranch = typeof conflictingBranches?.source === "string"
    ? conflictingBranches.source
    : item.attentionType === "ci_fix_required" && typeof payload.workerBranch === "string"
      ? payload.workerBranch
      : item.attentionType === "ci_fix_required" && typeof payload.branchName === "string"
        ? payload.branchName
        : typeof payload.featureBranch === "string"
          ? payload.featureBranch
          : null;
  const targetBranch = typeof conflictingBranches?.target === "string"
    ? conflictingBranches.target
    : typeof payload.defaultBranch === "string"
      ? payload.defaultBranch
      : null;

  return (!sourceBranch || sourceBranch === scope.sourceBranch)
    && (!targetBranch || targetBranch === scope.targetBranch);
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

function buildMainMergeCiFixSummary(args: {
  featureBranch: string;
  defaultBranch: string;
  prNumber: number | null;
  prUrl: string | null;
  failedChecks: string[];
  mergedTaskContexts: Array<{
    taskKey: string;
    taskTitle: string;
    workerBranch: string | null;
    prUrl: string | null;
  }>;
}): string {
  const lines = [
    `The final merge of \`${args.featureBranch}\` into \`${args.defaultBranch}\` is blocked by failing CI checks.`,
    args.prNumber ? `PR: ${args.prUrl ?? `#${args.prNumber}`}` : null,
    args.failedChecks.length > 0 ? `Failed checks: ${args.failedChecks.join(", ")}` : null,
    "",
    `Check out \`${args.featureBranch}\`, reproduce and fix the failing checks (these run against the integrated branch, so the failure may only appear when all sprint tasks are combined), then push so the checks re-run.`,
  ];
  if (args.mergedTaskContexts.length > 0) {
    lines.push("", "Tasks merged into this branch:");
    for (const ctx of args.mergedTaskContexts) {
      lines.push(`- ${ctx.taskKey}: ${ctx.taskTitle}`);
    }
  }
  return lines.filter((line) => line !== null).join("\n");
}
