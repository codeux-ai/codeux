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
  SprintLoopStepSettings,
  Subtask,
} from "../../../contracts/app-types.js";
import type { ProjectAttentionOwnerType } from "../../../contracts/project-attention-types.js";
import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import type { SprintExecutionContext } from "../../../services/sprint-execution-state-service.js";
import { FeaturePrGateService } from "../ci/feature-pr-gate.js";

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
}

interface TaskStateSnapshot {
  id: string;
  isMerged: boolean;
}

export class CycleRunner {
  private readonly ciAutofixRetryCounts = new Map<string, number>();
  private readonly featurePrGate = new FeaturePrGateService();

  constructor(private readonly deps: SprintOrchestratorDependencies) {}

  async run(args: CycleRunnerArgs): Promise<SprintCycleResult & { awaitingMerge: Subtask[] }> {
    let subtasks: Subtask[] = args.loopSteps.loadSubtasks
      ? await this.deps.sprintExecutionStateService.loadSubtasks(
          args.executionContext.project.id,
          args.executionContext.sprint.id,
          args.sprintRunId,
        )
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
        }
      );
      subtasks = syncResult.subtasks;
    }

    if (args.loopSteps.statusDerivation && subtasks.length > 0) {
      subtasks = runStatusDerivationStep(subtasks, {
        retryFailed: args.retryFailed,
        isActionRequiredState: this.deps.isActionRequiredState,
      });
    }

    let reportText = "";
    if (args.loopSteps.startReadyTasks && subtasks.length > 0) {
      const startResult = await this.runStartReadyTasks(subtasks, args);
      subtasks = startResult.subtasks;
      reportText += startResult.reportText;
    }

    if (subtasks.length > 0) {
      const interventionResult = await applyActionRequiredAutomation(subtasks, {
        automationLevel: args.automationLevel,
        settings: args.automationInterventions,
        isActionRequiredState: this.deps.isActionRequiredState,
        isJulesApiConfigured: this.deps.isJulesApiConfigured,
        approveSessionPlan: this.deps.approveSessionPlan,
        sendSessionMessage: this.deps.sendSessionMessage,
        onTaskEvent: ({ task, eventType, payload, sourceEventKey }) => {
          appendTaskEvent(task, eventType, payload, sourceEventKey);
        },
      });
      subtasks = interventionResult.subtasks;
      reportText += interventionResult.reportText;
    }

    if (subtasks.length > 0) {
      const taskStateBeforeCiGate = snapshotTaskState(subtasks);
      const gitStatus = this.deps.getCiStatusForScope
        ? await this.deps.getCiStatusForScope({
            repoPath: args.repoPath,
            scope: "FEATURE_PR_CI",
            featureBranch: args.defaultFeatureBranch,
            defaultBranch: args.defaultBranch,
            featureBranchPrefix: args.featureBranchPrefix,
          })
        : null;

      const ciAutofixResult = await this.featurePrGate.evaluateCiGate(subtasks, {
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
        persistMergedTask: async (task) => {
          if (typeof task.record_id !== "string" || task.record_id.trim().length === 0) {
            return;
          }
          this.deps.projectManagementRepository.updateTask(task.record_id, {
            isMerged: Boolean(task.is_merged),
            mergeIndicator: task.merge_indicator || null,
            status: task.status === "COMPLETED" ? "completed" : undefined,
          });
        },
        executionRepository: this.deps.executionRepository,
        sprintRunId: args.sprintRunId,
      });
      subtasks = ciAutofixResult.subtasks;
      reportText += ciAutofixResult.reportText;

      const ciGateRefreshNeeded = hasMergeStateChanges(taskStateBeforeCiGate, subtasks);
      if (ciGateRefreshNeeded && args.loopSteps.statusDerivation) {
        subtasks = runStatusDerivationStep(subtasks, {
          retryFailed: args.retryFailed,
          isActionRequiredState: this.deps.isActionRequiredState,
        });
      }

      if (ciGateRefreshNeeded && args.loopSteps.startReadyTasks) {
        const startResult = await this.runStartReadyTasks(subtasks, args);
        subtasks = startResult.subtasks;
        reportText += startResult.reportText;
      }
    }

    const protocolResult = await runProtocolStep(subtasks, {
      featureBranch: args.defaultFeatureBranch,
      githubMode: args.githubMode,
      ciIntelligence: args.ciIntelligence,
      enableMergeProtocol: args.loopSteps.mergeProtocol,
      enableActionRequiredProtocol: args.loopSteps.actionRequiredProtocol,
      isActionRequiredState: this.deps.isActionRequiredState,
      renderInstruction: (templateId, variables) => this.deps.renderInstruction(templateId, variables, args.repoPath),
      onTaskEvent: ({ task, eventType, payload, sourceEventKey }) => {
        appendTaskEvent(task, eventType, payload, sourceEventKey);
      },
    });
    this.syncProtocolAttentionItems(subtasks, protocolResult, args);

    const statusTable = args.loopSteps.statusTable ? runStatusTableStep(subtasks) : "";

    return {
      subtasks,
      reportText,
      statusTable,
      instructions: protocolResult.instructions,
      awaitingMerge: protocolResult.awaitingMerge,
    };
  }

  private runStartReadyTasks(
    subtasks: Subtask[],
    args: CycleRunnerArgs,
  ): Promise<{ subtasks: Subtask[]; reportText: string }> {
    return runStartReadyTasksStep(subtasks, {
      action: args.action,
      maxFailures: this.deps.settings.maxFailures || 5,
      getConsecutiveFailures: this.deps.getConsecutiveFailures,
      setConsecutiveFailures: this.deps.setConsecutiveFailures,
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
    });
  }

  private syncProtocolAttentionItems(
    subtasks: Subtask[],
    protocolResult: {
      awaitingMerge: Subtask[];
      actionRequiredTasks: Subtask[];
    },
    args: CycleRunnerArgs,
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
      this.deps.projectAttentionService.openItem({
        projectId,
        sprintId,
        taskId,
        sprintRunId,
        attentionType: "merge_required",
        severity: task.merge_indicator === "MERGE_BLOCKED" ? "high" : "medium",
        ownerType: "worker",
        title: `Merge required for ${task.id}`,
        summaryMarkdown: task.merge_indicator === "MERGE_BLOCKED"
          ? `Task \`${task.id}\` is complete but blocked on merge work that could not be resolved automatically.`
          : `Task \`${task.id}\` is complete and awaiting merge into \`${args.defaultFeatureBranch}\`.`,
        payload: {
          repoPath: args.repoPath,
          featureBranch: args.defaultFeatureBranch,
          defaultBranch: args.defaultBranch,
          taskKey: task.id,
          taskTitle: task.title,
          mergeIndicator: task.merge_indicator || null,
          workerBranch: task.worker_branch || null,
          prUrl: task.pr_url || null,
        },
      });
    }

    const actionTaskIds = new Set<string>();
    for (const task of protocolResult.actionRequiredTasks) {
      const taskId = task.record_id?.trim();
      if (!taskId) {
        continue;
      }
      actionTaskIds.add(taskId);
      const ownerType: ProjectAttentionOwnerType = task.intervention_owner === "AGENT" ? "worker" : "human";
      this.deps.projectAttentionService.openItem({
        projectId,
        sprintId,
        taskId,
        sprintRunId,
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
      });
    }

    for (const taskId of knownTaskIds) {
      if (!mergeTaskIds.has(taskId)) {
        this.deps.projectAttentionService.resolveItemsForTask(
          projectId,
          taskId,
          ["merge_required"],
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
    }
  }
}

function snapshotTaskState(subtasks: Subtask[]): Map<string, TaskStateSnapshot> {
  return new Map(subtasks.map((task) => [task.id, {
    id: task.id,
    isMerged: Boolean(task.is_merged),
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
