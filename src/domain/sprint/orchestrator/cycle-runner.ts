import { applyActionRequiredAutomation } from "../../../sprint/action-required-automation.js";
import { runSessionSyncStep } from "../../../sprint/steps/session-sync-step.js";
import { runStatusDerivationStep } from "../../../sprint/steps/status-derivation-step.js";
import { runStartReadyTasksStep } from "../../../sprint/steps/start-ready-tasks-step.js";
import { runStatusTableStep } from "../../../sprint/steps/status-table-step.js";
import { runProtocolStep } from "../../../sprint/steps/protocol-step.js";
import type { SprintCycleResult } from "../../../sprint/sprint-types.js";
import type {
  AutomationInterventionsSettings,
  AutomationLevel,
  CiIntelligenceSettings,
  GitPullRequestStatus,
  GitTrackingStatus,
  SprintLoopStepSettings,
  ProviderId,
  Subtask,
} from "../../../contracts/app-types.js";
import type { TaskStatus as PlanningTaskStatus } from "../../../contracts/project-management-types.js";
import type { ProjectAttentionOwnerType } from "../../../contracts/project-attention-types.js";
import type { ProjectAttentionItemRecord } from "../../../contracts/project-attention-types.js";
import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import type { SprintExecutionContext } from "../../../services/sprint-execution-state-service.js";
import { FeaturePrGateService } from "../ci/feature-pr-gate.js";
import { matchPrForTask } from "../ci/feature-pr/pr-matcher.js";
import type { MemoryCategory } from "../../../contracts/memory-types.js";
import { isTaskCodeComplete } from "../task-merge-state.js";
import { PROVIDER_IDS } from "../../../repositories/settings-defaults.js";
import {
  CycleStateCoordinator,
  type TaskStateSnapshot,
  type TaskActionRequiredSnapshot,
  hasMergeStateChanges,
  hasActiveCiFixAttentionAttempt,
  shouldEscalateFeatureMergeConflict,
  collectActiveWorkerMergeConflictTaskIds,
  snapshotTaskState,
  resolveCiStatusCacheTtlMs,
} from "./cycle-state-coordinator.js";

export interface CycleRunnerArgs {
  action: "status" | "orchestrate";
  automationLevel: AutomationLevel;
  automationInterventions: AutomationInterventionsSettings;
  executionContext: SprintExecutionContext;
  repoPath: string;
  defaultFeatureBranch: string;
  retryFailed: boolean;
  loopSteps: SprintLoopStepSettings;
  ciIntelligence: CiIntelligenceSettings;
  githubMode: "REMOTE" | "LOCAL";
  defaultBranch: string;
  featureBranchPrefix: string;
  sprintRunId?: string;
  /** Planning agent preset ID for per-agent memory tagging. */
  planningAgentPresetId?: string;
}

export class CycleRunner {
  private readonly ciAutofixRetryCounts = new Map<string, number>();
  private readonly featurePrGate = new FeaturePrGateService();
  private readonly lastAutomatedInterventionKeys = new Map<string, string>();
  private readonly stateCoordinator: CycleStateCoordinator;

  constructor(private readonly deps: SprintOrchestratorDependencies) {
    this.stateCoordinator = new CycleStateCoordinator(this.deps);
  }

  async run(args: CycleRunnerArgs): Promise<SprintCycleResult & {
    awaitingMerge: Subtask[];
    manualMergeTasks: Subtask[];
    workerEscalatedMergeConflictTasks: Subtask[];
  }> {
    const dashboardSettings = this.deps.getDashboardSettings({
      projectId: args.executionContext.project.id,
      sprintId: args.executionContext.sprint.id,
    });

    let subtasks: Subtask[] = args.loopSteps.loadSubtasks
      ? await this.deps.sprintExecutionStateService.loadSubtasks(
          args.executionContext.project.id,
          args.executionContext.sprint.id,
          args.sprintRunId,
        )
      : [];
    const cycleEntryStates = new Map(subtasks.map((task) => [task.id, task.status]));
    const activeProjectAttentionItems = typeof this.deps.projectAttentionService?.listActiveProjectItems === "function"
      ? this.deps.projectAttentionService.listActiveProjectItems(args.executionContext.project.id)
      : [];

    const appendTaskEvent = (
      task: Subtask,
      eventType: string,
      payload: Record<string, unknown>,
      sourceEventKey?: string,
    ): void => {
      if (!args.sprintRunId || typeof task.record_id !== "string" || task.record_id.trim().length === 0) {
        return;
      }
      const taskRun = this.deps.executionRepository.getLatestTaskRun(task.record_id, args.sprintRunId);
      if (!taskRun) {
        return;
      }
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, eventType, "system", payload, {
        sourceEventKey,
      });
    };

    if (args.loopSteps.sessionSync && subtasks.length > 0) {
      const syncResult = await runSessionSyncStep(
        subtasks,
        {
          listSessions: this.deps.listSessions,
          resolveSessionName: this.deps.resolveSessionName,
          extractSessionId: this.deps.extractSessionId,
          fetchRecentActivities: this.deps.fetchRecentActivities,
          isActionRequiredState: this.deps.isActionRequiredState,
          projectManagementRepository: this.deps.projectManagementRepository,
          executionRepository: this.deps.executionRepository,
          sprintRunId: args.sprintRunId,
          logger: this.deps.logger.child({ component: "session-sync-step" }),
        },
        args.retryFailed,
        {
          repoPath: args.repoPath,
          sprintNumber: args.executionContext.sprintNumber,
          maxQuotaRetriesWithoutTimer: dashboardSettings.cliWorkflow.maxQuotaRetriesWithoutTimer,
          maxRateLimitRetries: dashboardSettings.cliWorkflow.maxRateLimitRetries,
          retryOnRateLimit: dashboardSettings.cliWorkflow.retryOnRateLimit,
        },
      );
      subtasks = syncResult.subtasks;
    }

    if (args.loopSteps.statusDerivation && subtasks.length > 0) {
      subtasks = runStatusDerivationStep(subtasks, {
        retryFailed: args.retryFailed,
        isActionRequiredState: this.deps.isActionRequiredState,
      });
      await this.captureTaskCompletionMemories(subtasks, cycleEntryStates, args, dashboardSettings);
      await this.reviewCompletedTasks(subtasks, cycleEntryStates, args, dashboardSettings);
    }

    let reportText = "";
    if (args.loopSteps.startReadyTasks && subtasks.length > 0) {
      const startResult = await this.runStartReadyTasks(subtasks, args, dashboardSettings);
      subtasks = startResult.subtasks;
      reportText += startResult.reportText;
    }

    if (subtasks.length > 0) {
      const preAutomationTasks = new Map<string, TaskActionRequiredSnapshot>(
        subtasks.map((task) => [
          task.id,
          {
            status: task.status,
            sessionState: task.session_state,
          },
        ]),
      );
      const interventionResult = await applyActionRequiredAutomation(subtasks, {
        projectId: args.executionContext.project.id,
        sprintGoal: args.executionContext.sprint.goal || "",
        automationLevel: args.automationLevel,
        settings: args.automationInterventions,
        isActionRequiredState: this.deps.isActionRequiredState,
        isJulesApiConfigured: this.deps.isJulesApiConfigured,
        approveSessionPlan: this.deps.approveSessionPlan,
        sendSessionMessage: this.deps.sendSessionMessage,
        generateWorkerClarificationReply: this.deps.generateWorkerClarificationReply,
        lastAutomatedInterventionKeys: this.lastAutomatedInterventionKeys,
        onTaskEvent: ({ task, eventType, payload, sourceEventKey }) => {
          appendTaskEvent(task, eventType, payload, sourceEventKey);
        },
      });
      subtasks = interventionResult.subtasks;
      this.stateCoordinator.syncAutoInterventionExecutionState(subtasks, preAutomationTasks, args.sprintRunId);
      reportText += interventionResult.reportText;
    }

    let gitStatus: GitTrackingStatus | null = null;
    if (subtasks.length > 0) {
      const taskStateBeforeCiGate = snapshotTaskState(subtasks);
      gitStatus = this.deps.getCiStatusForScope
        ? await this.deps.getCiStatusForScope({
            repoPath: args.repoPath,
            scope: "FEATURE_PR_CI",
            featureBranch: args.defaultFeatureBranch,
            defaultBranch: args.defaultBranch,
            featureBranchPrefix: args.featureBranchPrefix,
            cacheTtlMs: resolveCiStatusCacheTtlMs(args.loopSteps.watchLoopIntervalSeconds),
          })
        : null;

      const ciAutofixResult = await this.featurePrGate.evaluateCiGate(subtasks, {
        evaluateTaskQaGate: (() => {
          const qaService = this.deps.qualityAssuranceService;
          if (!qaService) {
            return undefined;
          }
          return (task: Subtask) => qaService.getTaskMergeGateStatus({
            projectId: args.executionContext.project.id,
            sprintId: args.executionContext.sprint.id,
            task,
          });
        })(),
        automationLevel: args.automationLevel,
        repoPath: args.repoPath,
        featureBranch: args.defaultFeatureBranch,
        defaultBranch: args.defaultBranch,
        featureBranchPrefix: args.featureBranchPrefix,
        ciIntelligence: args.ciIntelligence,
        githubMode: args.githubMode,
        gitStatus,
        ciAutofixRetryCounts: this.ciAutofixRetryCounts,
        isJulesApiConfigured: this.deps.isJulesApiConfigured,
        sendSessionMessage: async (sessionId, message) => {
          await this.deps.sendSessionMessage(sessionId, message);
        },
        autoMergeFeaturePr: this.deps.autoMergeFeaturePr,
        hasActiveWorkerCiFixAttempt: (task, prNumber) => hasActiveCiFixAttentionAttempt(
          activeProjectAttentionItems,
          task,
          prNumber,
        ),
        openCiFixAttention: (task, payload) => {
          const taskId = task.record_id?.trim();
          if (!taskId || !this.deps.projectAttentionService) {
            return;
          }
          const summaryLines = [
            `CI failed for task \`${task.id}\` on branch \`${payload.branchName}\`.`,
            `PR: ${payload.prUrl}`,
            `Failed checks: ${payload.failedChecks.join(", ")}`,
            payload.failedJobLabels.length > 0 ? `Failed jobs: ${payload.failedJobLabels.join(", ")}` : null,
          ].filter(Boolean).join("\n");

          this.deps.projectAttentionService.openItem({
            projectId: args.executionContext.project.id,
            sprintId: args.executionContext.sprint.id,
            taskId,
            sprintRunId: args.sprintRunId,
            attentionType: "ci_fix_required",
            severity: "high",
            ownerType: "worker",
            title: `CI fix required for ${task.id}`,
            summaryMarkdown: summaryLines,
            payload: { ...payload },
          });
        },
        persistMergedTask: async (task) => {
          if (typeof task.record_id !== "string" || task.record_id.trim().length === 0) {
            return;
          }
          this.deps.projectManagementRepository.updateTask(task.record_id, {
            isMerged: Boolean(task.is_merged),
            mergeIndicator: task.merge_indicator || null,
            status: task.status === "COMPLETED"
              ? "completed"
              : task.status === "CODING_COMPLETED"
                ? "coding_completed"
                : undefined,
          });
        },
        executionRepository: this.deps.executionRepository,
        sprintRunId: args.sprintRunId,
      });
      subtasks = ciAutofixResult.subtasks;
      reportText += ciAutofixResult.reportText;
      await this.captureCiFailureMemories(subtasks, taskStateBeforeCiGate, args, dashboardSettings);

      this.stateCoordinator.persistCiGateTaskStateChanges(taskStateBeforeCiGate, subtasks);

      const ciGateRefreshNeeded = hasMergeStateChanges(taskStateBeforeCiGate, subtasks);
      if (ciGateRefreshNeeded && args.loopSteps.statusDerivation) {
        subtasks = runStatusDerivationStep(subtasks, {
          retryFailed: args.retryFailed,
          isActionRequiredState: this.deps.isActionRequiredState,
        });
      }

      if (ciGateRefreshNeeded && args.loopSteps.startReadyTasks) {
        const startResult = await this.runStartReadyTasks(subtasks, args, dashboardSettings);
        subtasks = startResult.subtasks;
        reportText += startResult.reportText;
      }
    }

    const activeWorkerMergeConflictTaskIds = collectActiveWorkerMergeConflictTaskIds(activeProjectAttentionItems);

    const protocolResult = await runProtocolStep(subtasks, {
      featureBranch: args.defaultFeatureBranch,
      githubMode: args.githubMode,
      ciIntelligence: args.ciIntelligence,
      enableMergeProtocol: args.loopSteps.mergeProtocol,
      enableActionRequiredProtocol: args.loopSteps.actionRequiredProtocol,
      isActionRequiredState: this.deps.isActionRequiredState,
      isWorkerEscalatedMergeConflictTask: (task) => shouldEscalateFeatureMergeConflict(
        task,
        args,
        gitStatus,
        activeWorkerMergeConflictTaskIds,
      ),
      renderInstruction: (templateId, variables) => this.deps.renderInstruction(templateId, variables, args.repoPath),
      onTaskEvent: ({ task, eventType, payload, sourceEventKey }) => {
        appendTaskEvent(task, eventType, payload, sourceEventKey);
      },
    });
    this.stateCoordinator.syncProtocolAttentionItems(subtasks, protocolResult, args, gitStatus, activeWorkerMergeConflictTaskIds);

    const statusTable = args.loopSteps.statusTable ? runStatusTableStep(subtasks) : "";

    return {
      subtasks,
      reportText,
      statusTable,
      instructions: protocolResult.instructions,
      awaitingMerge: protocolResult.awaitingMerge,
      manualMergeTasks: protocolResult.manualMergeTasks,
      workerEscalatedMergeConflictTasks: protocolResult.workerEscalatedMergeConflictTasks,
    };
  }

  private runStartReadyTasks(
    subtasks: Subtask[],
    args: CycleRunnerArgs,
    dashboardSettings: ReturnType<SprintOrchestratorDependencies["getDashboardSettings"]>,
  ): Promise<{ subtasks: Subtask[]; reportText: string }> {
    const taskIds = subtasks.map(t => t.record_id).filter((id): id is string => !!id);
    const taskRecords = this.deps.projectManagementRepository.getTasksByIds(taskIds);
    const taskRecordMap = new Map(taskRecords.map(t => [t.id, t]));

    return runStartReadyTasksStep(subtasks, {
      action: args.action,
      maxFailures: this.deps.settings.maxFailures || 5,
      getConsecutiveFailures: this.deps.getConsecutiveFailures,
      setConsecutiveFailures: this.deps.setConsecutiveFailures,
      getProviderForTask: (task) => {
        const taskRecord = task.record_id ? taskRecordMap.get(task.record_id) : undefined;
        return this.deps.taskService?.resolveTaskProvider(
          task,
          { projectId: args.executionContext.project.id, sprintId: args.executionContext.sprint.id },
          taskRecord?.executorType
        ) || null;
      },
      getProviderSettings: (provider) => {
        if (typeof provider === "string" && (PROVIDER_IDS as readonly string[]).includes(provider)) {
          return dashboardSettings.aiProvider.providers[provider as ProviderId] || {};
        }
        return {};
      },
      getRunningCounts: () => {
        const counts: Record<string, number> = {};
        for (const t of subtasks) {
          if (t.status === "RUNNING") {
            const p = t.provider || (t.record_id ? this.deps.taskService?.resolveTaskProvider(
              t,
              { projectId: args.executionContext.project.id, sprintId: args.executionContext.sprint.id },
              taskRecordMap.get(t.record_id)?.executorType
            ) : null);
            if (p) {
              counts[p] = (counts[p] || 0) + 1;
            }
          }
        }
        return counts;
      },
      startTask: (task) => {
        if (!args.sprintRunId) {
          throw new Error("Missing sprint run id for orchestrate action.");
        }
        return this.deps.startTask(task, {
          projectId: args.executionContext.project.id,
          sprintId: args.executionContext.sprint.id,
          sprintRunId: args.sprintRunId,
          sourceId: args.executionContext.sourceId,
          featureBranch: args.defaultFeatureBranch,
          repoPath: args.repoPath,
          sprintNumber: args.executionContext.sprintNumber,
        });
      },
      resolveSessionName: this.deps.resolveSessionName,
      extractSessionId: this.deps.extractSessionId,
      logger: this.deps.logger.child({ component: "start-ready-tasks-step" }),
      shouldSkipTask: (task) => task.status === "QUOTA",
    });
  }

  private async captureTaskCompletionMemories(
    subtasks: Subtask[],
    preDerivationStates: Map<string, Subtask["status"]>,
    args: CycleRunnerArgs,
    settings: ReturnType<SprintOrchestratorDependencies["getDashboardSettings"]>,
  ): Promise<void> {
    const memoryService = this.deps.memoryService;
    if (!memoryService || !settings?.memory?.enabled || !settings?.memory?.autoCaptureSprint) return;

    const pendingCaptures: { taskId: string; promise: Promise<void> }[] = [];
    for (const task of subtasks) {
      const prev = preDerivationStates.get(task.id);
      if (prev === task.status) continue;

      let category: MemoryCategory;
      let content: string;
      let strength: number;

      if (task.status === "COMPLETED" && prev !== "COMPLETED") {
        category = "context";
        content = `Task completed: ${task.id} — ${task.title}. ${task.prompt}`;
        strength = 0.7;
      } else if (task.status === "FAILED" && prev !== "FAILED") {
        category = "error";
        content = `Task failed: ${task.id} — ${task.title}. ${task.prompt}`;
        strength = 0.8;
      } else {
        continue;
      }

      pendingCaptures.push({
        taskId: task.id,
        promise: memoryService.createMemory(args.executionContext.project.id, {
          scope: "sprint",
          sprintId: args.executionContext.sprint.id,
          agentPresetId: args.planningAgentPresetId ?? null,
          content,
          category,
          strength,
          source: {
            type: "auto_capture",
            originType: "task_status_change",
            originId: task.record_id || task.id,
          },
        }).then(() => {}),
      });
    }

    await this.captureMemoriesForTasks(pendingCaptures, args);
  }

  private async captureCiFailureMemories(
    subtasks: Subtask[],
    preGateStates: Map<string, TaskStateSnapshot>,
    args: CycleRunnerArgs,
    settings: ReturnType<SprintOrchestratorDependencies["getDashboardSettings"]>,
  ): Promise<void> {
    const memoryService = this.deps.memoryService;
    if (!memoryService || !settings?.memory?.enabled || !settings?.memory?.autoCaptureSprint) return;

    const pendingCaptures: { taskId: string; promise: Promise<void> }[] = [];
    for (const task of subtasks) {
      if (task.merge_indicator !== "CI") continue;
      const prev = preGateStates.get(task.id);
      if (prev && prev.mergeIndicator === "CI") continue; // already known

      const content = `CI failure detected for task ${task.id} — ${task.title}. Branch: ${task.worker_branch || "unknown"}. PR: ${task.pr_url || "none"}.`;

      pendingCaptures.push({
        taskId: task.id,
        promise: memoryService.createMemory(args.executionContext.project.id, {
          scope: "sprint",
          sprintId: args.executionContext.sprint.id,
          agentPresetId: args.planningAgentPresetId ?? null,
          content,
          category: "error",
          strength: 0.7,
          source: {
            type: "auto_capture",
            originType: "ci_failure",
            originId: task.record_id || task.id,
          },
        }).then(() => {}),
      });
    }

    await this.captureMemoriesForTasks(pendingCaptures, args);
  }

  private async reviewCompletedTasks(
    subtasks: Subtask[],
    previousStates: Map<string, Subtask["status"]>,
    args: CycleRunnerArgs,
    settings: ReturnType<SprintOrchestratorDependencies["getDashboardSettings"]>,
  ): Promise<void> {
    if (!this.deps.qualityAssuranceService || !settings.agents.qualityAssurance.enabled) {
      return;
    }

    for (const task of subtasks) {
      const prev = previousStates.get(task.id);
      const qaGate = this.deps.qualityAssuranceService.getTaskMergeGateStatus({
        projectId: args.executionContext.project.id,
        sprintId: args.executionContext.sprint.id,
        task,
      });
      const taskIsCodeComplete = isTaskCodeComplete(task);
      const newlyCodeComplete = taskIsCodeComplete && !isTaskCodeComplete({ status: prev });
      const shouldRunQaReview = taskIsCodeComplete
        && (
          qaGate.reason === "pending_review"
          || qaGate.reason === "review_failed"
          || (qaGate.reason === "changes_requested" && newlyCodeComplete)
        );

      if (!shouldRunQaReview) {
        continue;
      }

      const outcome = await this.deps.qualityAssuranceService.reviewCompletedTask({
        projectId: args.executionContext.project.id,
        sprintId: args.executionContext.sprint.id,
        sprintRunId: args.sprintRunId,
        repoPath: args.repoPath,
        task,
        subtasks,
      });

      if (outcome.reopenedTask) {
        this.deps.logger.info("QA reopened completed task for follow-up fixes", {
          projectId: args.executionContext.project.id,
          sprintId: args.executionContext.sprint.id,
          taskId: task.record_id || task.id,
          taskKey: task.id,
        });
      } else if (outcome.mergeBlocked) {
        this.deps.logger.info("QA blocked merge until review clears", {
          projectId: args.executionContext.project.id,
          sprintId: args.executionContext.sprint.id,
          taskId: task.record_id || task.id,
          taskKey: task.id,
        });
      }
    }
  }

  private async captureMemoriesForTasks(
    captures: { taskId: string; promise: Promise<void> }[],
    args: CycleRunnerArgs,
  ): Promise<void> {
    if (captures.length === 0) return;

    const results = await Promise.allSettled(captures.map(p => p.promise));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.deps.logger.warn("Failed to auto-capture task memory", {
          taskId: captures[index].taskId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
  }
}
