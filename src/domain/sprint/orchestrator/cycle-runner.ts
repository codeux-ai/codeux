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
  QaExhaustionPolicy,
  Subtask,
} from "../../../contracts/app-types.js";
import type { TaskStatus as PlanningTaskStatus } from "../../../contracts/project-management-types.js";
import type { ProjectAttentionOwnerType } from "../../../contracts/project-attention-types.js";
import type { ProjectAttentionItemRecord } from "../../../contracts/project-attention-types.js";
import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import type { SprintExecutionContext } from "../../../services/sprint-execution-state-service.js";
import type { TaskQaMergeGateStatus } from "../../../services/quality-assurance-service.js";
import { FeaturePrGateService } from "../ci/feature-pr-gate.js";
import { matchPrForTask } from "../ci/feature-pr/pr-matcher.js";
import { resolveCiEscalationOwner } from "../ci/feature-pr/ci-autofix-policy.js";
import type { MemoryCategory, CreateMemoryInput } from "../../../contracts/memory-types.js";
import { isTaskCodeComplete } from "../task-merge-state.js";
import pLimit from "p-limit";
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
          logger: this.deps.logger.child({ component: "session-sync-step", projectId: args.executionContext.project.id, sprintId: args.executionContext.sprint.id, sprintRunId: args.sprintRunId }),
          listAllActivities: this.deps.listAllActivities,
          getSession: this.deps.getSession,
          julesUsage: this.deps.julesUsage,
        },
        args.retryFailed,
        {
          repoPath: args.repoPath,
          sprintNumber: args.executionContext.sprintNumber,
          maxQuotaRetriesWithoutTimer: dashboardSettings.cliWorkflow.maxQuotaRetriesWithoutTimer,
          maxRateLimitRetries: dashboardSettings.cliWorkflow.maxRateLimitRetries,
          retryOnRateLimit: dashboardSettings.cliWorkflow.retryOnRateLimit,
          githubMode: args.githubMode,
        },
      );
      subtasks = syncResult.subtasks;
    }

    if (args.loopSteps.statusDerivation && subtasks.length > 0) {
      subtasks = runStatusDerivationStep(subtasks, {
        retryFailed: args.retryFailed,
        isActionRequiredState: this.deps.isActionRequiredState,
        githubMode: args.githubMode,
      });
      await this.captureTaskCompletionMemories(subtasks, cycleEntryStates, args, dashboardSettings);
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
            taskPrUrls: collectTaskPrUrls(subtasks),
            cacheTtlMs: resolveCiStatusCacheTtlMs(args.loopSteps.watchLoopIntervalSeconds),
          })
        : null;
      this.backfillTaskPrMetadataFromGitStatus(subtasks, gitStatus, args.sprintRunId);
      if (args.loopSteps.statusDerivation) {
        await this.reviewCompletedTasks(subtasks, cycleEntryStates, args, dashboardSettings);
      }

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
        guardrailService: this.deps.guardrailService,
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
        openCiFixAttentionItems: (items) => {
          if (!this.deps.projectAttentionService || items.length === 0) {
            return;
          }

          const attentionPayloads = [];
          for (const { task, payload } of items) {
            const taskId = task.record_id?.trim();
            if (!taskId) continue;

            const summaryLines = [
              `CI failed for task \`${task.id}\` on branch \`${payload.branchName}\`.`,
              `PR: ${payload.prUrl}`,
              `Failed checks: ${payload.failedChecks.join(", ")}`,
              payload.failedJobLabels.length > 0 ? `Failed jobs: ${payload.failedJobLabels.join(", ")}` : null,
            ].filter(Boolean).join("\n");

            attentionPayloads.push({
              projectId: args.executionContext.project.id,
              sprintId: args.executionContext.sprint.id,
              taskId,
              sprintRunId: args.sprintRunId,
              attentionType: "ci_fix_required" as const,
              severity: "high" as const,
              ownerType: "worker" as const,
              title: `CI fix required for ${task.id}`,
              summaryMarkdown: summaryLines,
              payload: { ...payload },
            });
          }

          if (attentionPayloads.length > 0) {
            this.deps.projectAttentionService.openItems(attentionPayloads);
          }
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
          githubMode: args.githubMode,
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
        return this.deps.providerConcurrencyService.getGlobalRunningCounts();
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
          taskRecord: task.record_id ? taskRecordMap.get(task.record_id) : undefined,
        });
      },
      resolveSessionName: this.deps.resolveSessionName,
      extractSessionId: this.deps.extractSessionId,
      logger: this.deps.logger.child({ component: "start-ready-tasks-step", projectId: args.executionContext.project.id, sprintId: args.executionContext.sprint.id, sprintRunId: args.sprintRunId }),
      shouldSkipTask: (task) => task.status === "QUOTA",
      applyTaskCodingGuardrail: (task) => this.applyTaskCodingGuardrail(task, args),
    });
  }

  /**
   * Evaluates the per-task coding guardrail before a task is (re)dispatched. Returns true
   * when the task is blocked and should be skipped this cycle. The invocation itself is
   * recorded by SprintTaskDispatchService after a successful dispatch (record-once).
   */
  private applyTaskCodingGuardrail(task: Subtask, args: CycleRunnerArgs): boolean {
    const taskId = task.record_id;
    if (!taskId) {
      return false;
    }
    const scope = {
      projectId: args.executionContext.project.id,
      sprintId: args.executionContext.sprint.id,
    };
    const evaluation = this.deps.guardrailService.evaluate(scope, taskId, "task_coding");
    if (evaluation.allowed) {
      return false;
    }
    if (evaluation.action === "WARN_ONLY") {
      this.deps.logger.warn("Task coding guardrail reached (warn only)", {
        taskId: task.id,
        count: evaluation.count,
        cap: evaluation.cap,
      });
      return false;
    }
    const owner = evaluation.action === "STOP_AND_WAIT" ? "HUMAN" : resolveCiEscalationOwner(args.automationLevel);
    task.status = "BLOCKED";
    task.intervention_owner = owner;
    task.intervention_hint = evaluation.blockedByTotalCeiling
      ? `Per-task invocation ceiling reached for task ${task.id} (${evaluation.reason ?? ""}).`
      : `Coding guardrail reached for task ${task.id}: ${evaluation.count}/${evaluation.cap} coding attempts.`;
    this.deps.logger.info("Task blocked: coding guardrail reached", {
      taskId: task.id,
      count: evaluation.count,
      cap: evaluation.cap,
      owner,
    });
    return true;
  }

  private async captureTaskCompletionMemories(
    subtasks: Subtask[],
    preDerivationStates: Map<string, Subtask["status"]>,
    args: CycleRunnerArgs,
    settings: ReturnType<SprintOrchestratorDependencies["getDashboardSettings"]>,
  ): Promise<void> {
    const memoryService = this.deps.memoryService;
    if (!memoryService || !settings?.memory?.enabled || !settings?.memory?.autoCaptureSprint) return;

    const memoryInputs: CreateMemoryInput[] = [];
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

      memoryInputs.push({
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
      });
    }

    if (memoryInputs.length > 0) {
      try {
        await memoryService.createMemoriesBatch(args.executionContext.project.id, memoryInputs);
      } catch (error) {
        this.deps.logger.warn("Failed to auto-capture task memory", {
          projectId: args.executionContext.project.id,
          sprintId: args.executionContext.sprint.id,
          sprintRunId: args.sprintRunId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async captureCiFailureMemories(
    subtasks: Subtask[],
    preGateStates: Map<string, TaskStateSnapshot>,
    args: CycleRunnerArgs,
    settings: ReturnType<SprintOrchestratorDependencies["getDashboardSettings"]>,
  ): Promise<void> {
    const memoryService = this.deps.memoryService;
    if (!memoryService || !settings?.memory?.enabled || !settings?.memory?.autoCaptureSprint) return;

    const memoryInputs: CreateMemoryInput[] = [];
    for (const task of subtasks) {
      if (task.merge_indicator !== "CI") continue;
      const prev = preGateStates.get(task.id);
      if (prev && prev.mergeIndicator === "CI") continue; // already known

      const content = `CI failure detected for task ${task.id} — ${task.title}. Branch: ${task.worker_branch || "unknown"}. PR: ${task.pr_url || "none"}.`;

      memoryInputs.push({
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
      });
    }

    if (memoryInputs.length > 0) {
      try {
        await memoryService.createMemoriesBatch(args.executionContext.project.id, memoryInputs);
      } catch (error) {
        this.deps.logger.warn("Failed to auto-capture task memory", {
          projectId: args.executionContext.project.id,
          sprintId: args.executionContext.sprint.id,
          sprintRunId: args.sprintRunId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Apply the configured QA exhaustion policy to a code-complete task whose QA
   * review budget is spent without a pass. Returns true when the policy moved the
   * task to a resting state (so the caller should skip further QA scheduling).
   * Idempotent — once the task already rests in the policy's target state this is
   * a no-op and returns false so normal processing continues.
   */
  private applyQaExhaustionPolicy(
    task: Subtask,
    qaGate: TaskQaMergeGateStatus,
    args: CycleRunnerArgs,
    policy: QaExhaustionPolicy,
  ): boolean {
    switch (policy) {
      case "FINISH_TASK":
        if (task.status === "COMPLETED") {
          return false;
        }
        this.finishUnverifiedTask(task, qaGate, args);
        return true;
      case "FAIL_TASK":
        if (task.status === "FAILED") {
          return false;
        }
        this.failUnverifiedTask(task, qaGate, args);
        return true;
      case "ESCALATE_TO_HUMAN":
      default:
        if (task.status === "QA_REVIEW_FAILED") {
          return false;
        }
        this.escalateUnverifiedTaskToHuman(task, qaGate, args);
        return true;
    }
  }

  /**
   * FINISH_TASK policy: mark the task COMPLETED despite no QA pass (fail open).
   * Clears intervention metadata so the merge gate can settle it normally.
   */
  private finishUnverifiedTask(
    task: Subtask,
    qaGate: TaskQaMergeGateStatus,
    args: CycleRunnerArgs,
  ): void {
    const taskId = task.record_id?.trim();
    task.status = "COMPLETED";
    task.intervention_owner = undefined;
    task.intervention_hint = undefined;
    if (taskId) {
      this.deps.projectManagementRepository.updateTask(taskId, { status: "completed" });
    }
    this.deps.logger.warn("QA exhausted without clearing task — finished anyway (FINISH_TASK policy)", {
      projectId: args.executionContext.project.id,
      sprintId: args.executionContext.sprint.id,
      sprintRunId: args.sprintRunId,
      taskId,
      taskKey: task.id,
      qaReason: qaGate.reason,
      runsUsed: qaGate.runsUsed,
      maxRuns: qaGate.maxRuns,
    });
  }

  /**
   * FAIL_TASK policy: mark the task FAILED and let the sprint move on. No human
   * gate — the work is discarded rather than held.
   */
  private failUnverifiedTask(
    task: Subtask,
    qaGate: TaskQaMergeGateStatus,
    args: CycleRunnerArgs,
  ): void {
    const taskId = task.record_id?.trim();
    const hint = "QA could not verify this task and the review budget is exhausted. Marked FAILED per the QA exhaustion policy.";
    task.status = "FAILED";
    task.merge_indicator = undefined;
    task.intervention_owner = undefined;
    task.intervention_hint = hint;
    // Runtime FAILED is carried by the task-run state (there is no planning
    // "failed" status). Persisting the run state makes the sprint count this task
    // as terminal (see sprint-state-evaluator) so the sprint can finish, and the
    // state survives a reload.
    if (taskId) {
      const taskRun = this.deps.executionRepository.getLatestTaskRun(taskId, args.sprintRunId);
      if (taskRun) {
        this.deps.executionRepository.updateTaskRun(taskRun.id, {
          state: "FAILED",
          finishedAt: taskRun.finishedAt ?? new Date().toISOString(),
        });
      }
    }
    this.deps.logger.warn("QA exhausted without clearing task — failed (FAIL_TASK policy)", {
      projectId: args.executionContext.project.id,
      sprintId: args.executionContext.sprint.id,
      sprintRunId: args.sprintRunId,
      taskId,
      taskKey: task.id,
      qaReason: qaGate.reason,
      runsUsed: qaGate.runsUsed,
      maxRuns: qaGate.maxRuns,
    });
  }

  /**
   * ESCALATE_TO_HUMAN policy: park the task in QA_REVIEW_FAILED and raise a
   * human-escalation attention item. This is the fail-closed end of the QA gate:
   * rather than letting an exhausted/unverified task settle as COMPLETED (which
   * silently shipped tasks with no PR), we hold it for a human. Idempotent — the
   * status flip and deduped attention item make repeat cycles no-ops.
   */
  private escalateUnverifiedTaskToHuman(
    task: Subtask,
    qaGate: TaskQaMergeGateStatus,
    args: CycleRunnerArgs,
  ): void {
    const taskId = task.record_id?.trim();
    const hint = "QA could not verify this task and the review budget is exhausted. Inspect the produced work and finish or close the task manually.";

    task.status = "QA_REVIEW_FAILED";
    task.merge_indicator = undefined;
    task.intervention_owner = "HUMAN";
    task.intervention_hint = hint;

    if (!taskId) {
      return;
    }

    this.deps.projectManagementRepository.updateTask(taskId, {
      status: "QA_REVIEW_FAILED",
      mergeIndicator: null,
    });

    this.deps.projectAttentionService?.openItems?.([
      {
        projectId: args.executionContext.project.id,
        sprintId: args.executionContext.sprint.id,
        taskId,
        sprintRunId: args.sprintRunId,
        attentionType: "human_escalation_required",
        severity: "high",
        ownerType: "human" as ProjectAttentionOwnerType,
        title: `QA could not verify ${task.id}`,
        summaryMarkdown: [
          `Task \`${task.id}\` (${task.title ?? "untitled"}) finished coding but QA never cleared it.`,
          qaGate.summary ? `\nLatest QA signal: ${qaGate.summary}` : "",
          `\nReviews used: ${qaGate.runsUsed}/${qaGate.maxRuns}. The task is held in QA_REVIEW_FAILED and will not be merged or marked complete until a human resolves it.`,
        ].filter(Boolean).join("\n"),
        payload: {
          taskKey: task.id,
          qaReason: qaGate.reason,
          runsUsed: qaGate.runsUsed,
          maxRuns: qaGate.maxRuns,
        },
      },
    ]);

    this.deps.logger.warn("QA exhausted without clearing task — escalated to human", {
      projectId: args.executionContext.project.id,
      sprintId: args.executionContext.sprint.id,
      sprintRunId: args.sprintRunId,
      taskId,
      taskKey: task.id,
      qaReason: qaGate.reason,
      runsUsed: qaGate.runsUsed,
      maxRuns: qaGate.maxRuns,
    });
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

    await this.deps.qualityAssuranceService.reconcileRunningTaskQaReviews?.({
      projectId: args.executionContext.project.id,
      sprintId: args.executionContext.sprint.id,
      tasks: subtasks,
    });

    const limit = pLimit(5);
    const reviewPromises: Promise<void>[] = [];

    for (const task of subtasks) {
      const prev = previousStates.get(task.id);
      const qaGate = this.deps.qualityAssuranceService.getTaskMergeGateStatus({
        projectId: args.executionContext.project.id,
        sprintId: args.executionContext.sprint.id,
        task,
      });
      const taskIsCodeComplete = isTaskCodeComplete(task);

      // QA spent its budget without ever clearing this task (no pass — either
      // changes still outstanding at the cap or the reviewer kept failing for
      // infra reasons). Apply the configured exhaustion policy instead of letting
      // it quietly settle as completed or loop forever.
      if (taskIsCodeComplete && qaGate.reason === "retries_exhausted") {
        if (this.applyQaExhaustionPolicy(task, qaGate, args, settings.agents.qualityAssurance.exhaustionPolicy)) {
          continue;
        }
      }

      const newlyCodeComplete = taskIsCodeComplete && !isTaskCodeComplete({ status: prev });
      const shouldRunQaReview = taskIsCodeComplete
        && (
          qaGate.reason === "pending_review"
          || qaGate.reason === "review_failed"
          || (qaGate.reason === "changes_requested" && (
            newlyCodeComplete
            || this.hasCompletedTaskRunAfterLatestQaRequest(task, qaGate, args.sprintRunId)
            || this.hasCompletedTaskFollowUpAfterLatestQaRequest(task, qaGate, args.sprintRunId)
          ))
        );

      if (!shouldRunQaReview) {
        continue;
      }

      const runReview = async () => {
        try {
          const outcome = await this.deps.qualityAssuranceService!.reviewCompletedTask({
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
              sprintRunId: args.sprintRunId,
              taskId: task.record_id || task.id,
              taskKey: task.id,
            });
          } else if (outcome.mergeBlocked) {
            this.deps.logger.info("QA blocked merge until review clears", {
              projectId: args.executionContext.project.id,
              sprintId: args.executionContext.sprint.id,
              sprintRunId: args.sprintRunId,
              taskId: task.record_id || task.id,
              taskKey: task.id,
            });
          }
        } catch (error) {
          this.deps.logger.error("QA review failed for task", {
            projectId: args.executionContext.project.id,
            sprintId: args.executionContext.sprint.id,
            sprintRunId: args.sprintRunId,
            taskId: task.record_id || task.id,
            taskKey: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      reviewPromises.push(limit(runReview));
    }

    if (reviewPromises.length > 0) {
      await Promise.all(reviewPromises);
    }
  }

  private backfillTaskPrMetadataFromGitStatus(
    subtasks: Subtask[],
    gitStatus: GitTrackingStatus | null,
    sprintRunId?: string,
  ): void {
    if (!gitStatus?.available) {
      return;
    }

    for (const task of subtasks) {
      const pr = matchPrForTask(task, gitStatus);
      if (!pr) {
        continue;
      }

      const nextWorkerBranch = pr.headRefName?.trim() || task.worker_branch;
      const nextPrUrl = pr.url?.trim() || task.pr_url;
      const workerBranchChanged = Boolean(nextWorkerBranch && nextWorkerBranch !== task.worker_branch);
      const prUrlChanged = Boolean(nextPrUrl && nextPrUrl !== task.pr_url);
      if (!workerBranchChanged && !prUrlChanged) {
        continue;
      }

      if (nextWorkerBranch) {
        task.worker_branch = nextWorkerBranch;
      }
      if (nextPrUrl) {
        task.pr_url = nextPrUrl;
      }

      if (!task.record_id || !sprintRunId) {
        continue;
      }
      const taskRun = this.deps.executionRepository.getLatestTaskRun(task.record_id, sprintRunId)
        || (task.session_id ? this.deps.executionRepository.getLatestTaskRunBySessionId(task.session_id) : null);
      if (!taskRun) {
        continue;
      }
      this.deps.executionRepository.updateTaskRun(taskRun.id, {
        workerBranch: nextWorkerBranch || taskRun.workerBranch,
        prUrl: nextPrUrl || taskRun.prUrl,
      });
    }
  }

  private hasCompletedTaskRunAfterLatestQaRequest(
    task: Subtask,
    qaGate: TaskQaMergeGateStatus,
    sprintRunId?: string,
  ): boolean {
    if (qaGate.reason !== "changes_requested" || !qaGate.latestRun?.finishedAt || !task.record_id) {
      return false;
    }

    const latestRun = this.deps.executionRepository.getLatestTaskRun(task.record_id, sprintRunId)
      || (task.session_id ? this.deps.executionRepository.getLatestTaskRunBySessionId(task.session_id) : null);
    if (latestRun?.state !== "COMPLETED" || !latestRun.finishedAt) {
      return false;
    }

    const taskFinishedAt = Date.parse(latestRun.finishedAt);
    const qaFinishedAt = Date.parse(qaGate.latestRun.finishedAt);
    return Number.isFinite(taskFinishedAt)
      && Number.isFinite(qaFinishedAt)
      && taskFinishedAt > qaFinishedAt;
  }

  private hasCompletedTaskFollowUpAfterLatestQaRequest(
    task: Subtask,
    qaGate: TaskQaMergeGateStatus,
    sprintRunId?: string,
  ): boolean {
    if (qaGate.reason !== "changes_requested" || !qaGate.latestRun?.finishedAt || !task.record_id) {
      return false;
    }

    const executionRepository = this.deps.executionRepository as Partial<SprintOrchestratorDependencies["executionRepository"]>;
    if (typeof executionRepository.listExecutionInvocations !== "function") {
      return false;
    }

    const taskRun = this.deps.executionRepository.getLatestTaskRun(task.record_id, sprintRunId)
      || (task.session_id ? this.deps.executionRepository.getLatestTaskRunBySessionId(task.session_id) : null);
    const invocations = taskRun
      ? executionRepository.listExecutionInvocations({
          projectId: task.project_id || qaGate.latestRun.projectId,
          taskRunId: taskRun.id,
          limit: 20,
        })
      : [];

    const qaFinishedAt = Date.parse(qaGate.latestRun.finishedAt);
    if (!Number.isFinite(qaFinishedAt)) {
      return false;
    }
    const qaContinuedTask = qaGate.latestRun.payload?.continued === true;
    const qaStartedAt = Date.parse(qaGate.latestRun.startedAt);

    return invocations.some((invocation) => {
      if (invocation.type !== "cli_task_followup" || invocation.status !== "completed" || !invocation.finishedAt) {
        return false;
      }
      const followUpFinishedAt = Date.parse(invocation.finishedAt);
      if (!Number.isFinite(followUpFinishedAt)) {
        return false;
      }
      if (qaContinuedTask && Number.isFinite(qaStartedAt)) {
        return followUpFinishedAt >= qaStartedAt;
      }
      return followUpFinishedAt > qaFinishedAt;
    });
  }

}

function collectTaskPrUrls(subtasks: Subtask[]): string[] {
  return Array.from(new Set(
    subtasks
      .map((task) => task.pr_url?.trim())
      .filter((url): url is string => Boolean(url))
  ));
}
