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
import { buildTaskAttentionPayload } from "./attention-payload-builder.js";
import { buildConflictSummaryMarkdown, selectMergedTaskContexts, type MergeConflictTaskContext } from "./conflict-summary-utils.js";
import { isTaskCodeComplete } from "../task-merge-state.js";
import { PROVIDER_IDS } from "../../../repositories/settings-defaults.js";


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

interface TaskStateSnapshot {
  id: string;
  status: Subtask["status"];
  isMerged: boolean;
  mergeIndicator: Subtask["merge_indicator"];
}

interface TaskActionRequiredSnapshot {
  status: Subtask["status"];
  sessionState: string | undefined;
}

export class CycleRunner {
  private readonly ciAutofixRetryCounts = new Map<string, number>();
  private readonly featurePrGate = new FeaturePrGateService();
  private readonly lastAutomatedInterventionKeys = new Map<string, string>();

  constructor(private readonly deps: SprintOrchestratorDependencies) {}

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
    const tasksById = new Map(subtasks.map((task) => [task.id, task]));
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
        tasksById,
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
      this.syncAutoInterventionExecutionState(subtasks, preAutomationTasks, args.sprintRunId);
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

      this.persistCiGateTaskStateChanges(taskStateBeforeCiGate, subtasks);

      const ciGateRefreshNeeded = hasMergeStateChanges(taskStateBeforeCiGate, subtasks);
      if (ciGateRefreshNeeded && args.loopSteps.statusDerivation) {
        subtasks = runStatusDerivationStep(subtasks, {
          retryFailed: args.retryFailed,
          isActionRequiredState: this.deps.isActionRequiredState,
          tasksById,
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
    this.syncProtocolAttentionItems(subtasks, protocolResult, args, gitStatus, activeWorkerMergeConflictTaskIds);

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

  private syncAutoInterventionExecutionState(
    subtasks: Subtask[],
    previousTasks: Map<string, TaskActionRequiredSnapshot>,
    sprintRunId?: string,
  ): void {
    if (!sprintRunId) {
      return;
    }

    const now = new Date().toISOString();
    for (const task of subtasks) {
      const previous = previousTasks.get(task.id);
      if (!previous || !task.record_id) {
        continue;
      }
      if (previous.status !== "BLOCKED" || task.status !== "RUNNING") {
        continue;
      }
      if (!this.deps.isActionRequiredState(previous.sessionState)) {
        continue;
      }

      const taskRun = this.deps.executionRepository.getLatestTaskRun(task.record_id, sprintRunId);
      if (!taskRun) {
        continue;
      }

      this.deps.executionRepository.updateTaskRun(taskRun.id, {
        state: "RUNNING",
        finishedAt: null,
        durationMs: null,
      });

      if (!taskRun.dispatchId) {
        continue;
      }

      const dispatch = this.deps.executionRepository.getTaskDispatch(taskRun.dispatchId);
      if (!dispatch) {
        continue;
      }

      this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
        status: "running",
        startedAt: dispatch.startedAt || taskRun.startedAt || now,
        finishedAt: null,
        lastHeartbeatAt: now,
        errorMessage: null,
      });
    }
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

  private persistCiGateTaskStateChanges(
    previous: Map<string, TaskStateSnapshot>,
    subtasks: Subtask[],
  ): void {
    for (const task of subtasks) {
      const earlier = previous.get(task.id);
      if (!earlier || !task.record_id) {
        continue;
      }

      const statusChanged = earlier.status !== task.status;
      const mergeChanged = earlier.isMerged !== Boolean(task.is_merged);
      const mergeIndicatorChanged = earlier.mergeIndicator !== task.merge_indicator;
      if (!statusChanged && !mergeChanged && !mergeIndicatorChanged) {
        continue;
      }

      this.deps.projectManagementRepository.updateTask(task.record_id, {
        status: mapSubtaskStatusToPlanningStatus(task.status),
        isMerged: Boolean(task.is_merged),
        mergeIndicator: task.merge_indicator || null,
      });
    }
  }

  private syncProtocolAttentionItems(
    subtasks: Subtask[],
    protocolResult: {
      awaitingMerge: Subtask[];
      actionRequiredTasks: Subtask[];
    },
    args: CycleRunnerArgs,
    gitStatus: GitTrackingStatus | null,
    activeWorkerMergeConflictTaskIds: Set<string>,
  ): void {
    const projectId = args.executionContext.project.id;
    const sprintId = args.executionContext.sprint.id;
    const sprintRunId = args.sprintRunId;
    const knownTaskIds = subtasks
      .map((task) => task.record_id?.trim())
      .filter((taskId): taskId is string => Boolean(taskId));

    const mergeTaskIds = new Set<string>();
    for (const task of protocolResult.awaitingMerge) {
      const taskId = task.record_id?.trim();
      if (!taskId) {
        continue;
      }
      mergeTaskIds.add(taskId);
      const pr = gitStatus?.available ? matchPrForTask(task, gitStatus) : undefined;
      const mergeConflictDetected = shouldEscalateFeatureMergeConflict(
        task,
        args,
        gitStatus,
        activeWorkerMergeConflictTaskIds,
      );
      const mergedFeatureTasks = selectMergedFeatureTaskContexts(subtasks, taskId);

      this.deps.projectAttentionService.openItem(buildTaskAttentionPayload({
        projectId,
        sprintId,
        taskId,
        sprintRunId: sprintRunId || "",
        attentionType: mergeConflictDetected ? "merge_conflict" : "merge_required",
        severity: mergeConflictDetected || task.merge_indicator === "MERGE_BLOCKED" ? "high" : "medium",
        ownerType: "worker",
        title: mergeConflictDetected ? `Merge conflict for ${task.id}` : `Merge required for ${task.id}`,
        summaryMarkdown: mergeConflictDetected
          ? buildMergeConflictSummary(task, args, pr || null, mergedFeatureTasks)
          : task.merge_indicator === "MERGE_BLOCKED"
            ? `Task \`${task.id}\` is complete but blocked on merge work that could not be resolved automatically.`
            : `Task \`${task.id}\` is complete and awaiting merge into \`${args.defaultFeatureBranch}\`.`,
        payload: {
          repoPath: args.repoPath,
          workingDirectoryHint: `cd ${args.repoPath}`,
          featureBranch: args.defaultFeatureBranch,
          defaultBranch: args.defaultBranch,
          taskKey: task.id,
          taskTitle: task.title,
          taskPrompt: task.prompt,
          mergeIndicator: task.merge_indicator || null,
          workerBranch: task.worker_branch || null,
          prUrl: task.pr_url || null,
          prNumber: pr?.number ?? null,
          mergeStateStatus: pr?.mergeStateStatus ?? null,
          conflictingBranches: {
            source: task.worker_branch || pr?.headRefName || null,
            target: args.defaultFeatureBranch,
          },
          currentTask: buildTaskContext(task),
          featureBranchTaskContexts: mergedFeatureTasks,
        },
      }));
      this.deps.projectAttentionService.resolveItemsForTask(
        projectId,
        taskId,
        [mergeConflictDetected ? "merge_required" : "merge_conflict"],
        mergeConflictDetected ? "merge_conflict_attention_replaced" : "merge_required_attention_replaced",
      );
    }

    const actionTaskIds = new Set<string>();
    for (const task of protocolResult.actionRequiredTasks) {
      const taskId = task.record_id?.trim();
      if (!taskId) {
        continue;
      }
      actionTaskIds.add(taskId);
      const ownerType: ProjectAttentionOwnerType = task.intervention_owner === "AGENT" ? "worker" : "human";
      this.deps.projectAttentionService.openItem(buildTaskAttentionPayload({
        projectId,
        sprintId,
        taskId,
        sprintRunId: sprintRunId || "",
        attentionType: "action_required",
        severity: task.intervention_owner === "AGENT" ? "high" : "medium",
        ownerType,
        title: `Action required for ${task.id}`,
        summaryMarkdown: task.intervention_hint?.trim()
          || `Task \`${task.id}\` is blocked in session state \`${task.session_state || "UNKNOWN"}\`.`,
        payload: {
          repoPath: args.repoPath,
          featureBranch: args.defaultFeatureBranch,
          defaultBranch: args.defaultBranch,
          taskKey: task.id,
          taskTitle: task.title,
          sessionState: task.session_state || null,
          provider: task.provider || null,
          interventionOwner: task.intervention_owner || "HUMAN",
        },
      }));
    }

    const ciFixTaskIds = new Set<string>();
    for (const task of subtasks) {
      const taskId = task.record_id?.trim();
      if (taskId && task.merge_indicator === "CI" && task.status === "RUNNING") {
        ciFixTaskIds.add(taskId);
      }
    }

    for (const taskId of knownTaskIds) {
      if (!mergeTaskIds.has(taskId)) {
        this.deps.projectAttentionService.resolveItemsForTask(
          projectId,
          taskId,
          ["merge_required", "merge_conflict"],
          "merge_attention_cleared",
        );
      }
      if (!actionTaskIds.has(taskId)) {
        this.deps.projectAttentionService.resolveItemsForTask(
          projectId,
          taskId,
          ["action_required"],
          "action_required_cleared",
        );
      }
      if (!ciFixTaskIds.has(taskId)) {
        this.deps.projectAttentionService.resolveItemsForTask(
          projectId,
          taskId,
          ["ci_fix_required"],
          "ci_fix_attention_cleared",
        );
      }
    }
  }
}

function shouldEscalateFeatureMergeConflict(
  task: Subtask,
  args: CycleRunnerArgs,
  gitStatus: GitTrackingStatus | null,
  activeWorkerMergeConflictTaskIds: Set<string>,
): boolean {
  if (!args.ciIntelligence.resolveMergeConflicts) {
    return false;
  }

  const taskId = task.record_id?.trim();
  if (taskId && activeWorkerMergeConflictTaskIds.has(taskId)) {
    return true;
  }

  if (task.merge_indicator === "MERGE_CONFLICT") {
    return true;
  }

  if (!gitStatus?.available) {
    return false;
  }

  const pr = matchPrForTask(task, gitStatus);
  return pr?.mergeStateStatus === "DIRTY";
}

function collectActiveWorkerMergeConflictTaskIds(subtasks: Array<{
  taskId: string | null;
  attentionType: string;
  ownerType: string;
}>): Set<string> {
  return new Set(
    subtasks
      .filter((item) => item.attentionType === "merge_conflict" && item.ownerType === "worker")
      .map((item) => item.taskId?.trim())
      .filter((taskId): taskId is string => Boolean(taskId)),
  );
}

function snapshotTaskState(subtasks: Subtask[]): Map<string, TaskStateSnapshot> {
  return new Map(subtasks.map((task) => [task.id, {
    id: task.id,
    status: task.status,
    isMerged: Boolean(task.is_merged),
    mergeIndicator: task.merge_indicator,
  }]));
}

function hasMergeStateChanges(previous: Map<string, TaskStateSnapshot>, subtasks: Subtask[]): boolean {
  return subtasks.some((task) => {
    const earlier = previous.get(task.id);
    if (!earlier) {
      return true;
    }
    return earlier.isMerged !== Boolean(task.is_merged);
  });
}

function resolveCiStatusCacheTtlMs(watchLoopIntervalSeconds: number | undefined): number {
  const watchLoopIntervalMs = Math.max(1, Number(watchLoopIntervalSeconds || 0)) * 1000;
  return Math.min(15_000, Math.max(3_000, watchLoopIntervalMs));
}

function hasActiveCiFixAttentionAttempt(
  attentionItems: ProjectAttentionItemRecord[],
  task: Subtask,
  prNumber: number,
): boolean {
  const taskRecordId = task.record_id?.trim() || null;
  return attentionItems.some((item) => {
    if (item.attentionType !== "ci_fix_required" || item.ownerType !== "worker") {
      return false;
    }

    const payload = item.payload || {};
    const payloadTaskKey = typeof payload.taskKey === "string" ? payload.taskKey.trim() : null;
    const payloadPrNumber = typeof payload.prNumber === "number" ? payload.prNumber : null;
    const sameTask = Boolean(
      (taskRecordId && item.taskId?.trim() === taskRecordId)
      || (payloadTaskKey && payloadTaskKey === task.id),
    );

    return sameTask && payloadPrNumber === prNumber;
  });
}

function mapSubtaskStatusToPlanningStatus(status: Subtask["status"]): PlanningTaskStatus {
  switch (status) {
    case "RUNNING":
      return "in_progress";
    case "COMPLETED":
      return "completed";
    case "PENDING":
    case "FAILED":
    case "BLOCKED":
    case "QUOTA":
    default:
      return "pending";
  }
}

function buildTaskContext(task: Subtask): MergeConflictTaskContext {
  return {
    taskKey: task.id,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    workerBranch: task.worker_branch || null,
    prUrl: task.pr_url || null,
  };
}

function selectMergedFeatureTaskContexts(subtasks: Subtask[], excludedTaskId: string): MergeConflictTaskContext[] {
  return selectMergedTaskContexts(subtasks, { excludedTaskId, limit: 5 });
}

function buildMergeConflictSummary(
  task: Subtask,
  args: CycleRunnerArgs,
  pr: GitPullRequestStatus | null,
  mergedFeatureTasks: MergeConflictTaskContext[],
): string {
  const sourceBranch = task.worker_branch || pr?.headRefName || "the task worker branch";
  return buildConflictSummaryMarkdown({
    repoPath: args.repoPath,
    workingDir: `cd ${args.repoPath}`,
    conflictingBranches: {
      source: sourceBranch,
      target: args.defaultFeatureBranch,
    },
    prInfo: pr ? { number: pr.number, url: pr.url } : undefined,
    taskContext: {
      id: task.id,
      title: task.title,
      prompt: task.prompt,
    },
    mergedTaskContexts: mergedFeatureTasks,
    isMainMerge: false,
  });
}
