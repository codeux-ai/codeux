import { applyActionRequiredAutomation } from "../../../sprint/action-required-automation.js";
import { runSessionSyncStep } from "../../../sprint/steps/session-sync-step.js";
import { runStatusDerivationStep } from "../../../sprint/steps/status-derivation-step.js";
import {
  runStartReadyTasksStep,
  type ProviderCapLogState,
} from "../../../sprint/steps/start-ready-tasks-step.js";
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
import {
  CLI_GIT_FINALIZATION_EVENT_SCAN_LIMIT,
  isCliTaskRun,
} from "../ci/cli-git-finalization.js";
import { MergeConflictDebouncer } from "../ci/merge-conflict-debouncer.js";
import { matchPrForTask } from "../ci/feature-pr/pr-matcher.js";
import { resolveCiEscalationOwner } from "../ci/feature-pr/ci-autofix-policy.js";
import type { MemoryCategory, CreateMemoryInput } from "../../../contracts/memory-types.js";
import { isTaskCodeComplete } from "../task-merge-state.js";
import { isPendingQaContinuation, shouldVerifyContinuedQaFix } from "../../qa-review/qa-review-budget.js";
import pLimit from "p-limit";
import { workerBranchHasMergeWork } from "../../../infrastructure/git/local-merge.js";
import { PROVIDER_IDS } from "../../../repositories/settings-defaults.js";
import {
  CycleStateCoordinator,
  type TaskStateSnapshot,
  type TaskActionRequiredSnapshot,
  hasActiveCiFixAttentionAttempt,
  shouldEscalateFeatureMergeConflict,
  buildResolvedWorkerMergeConflictKey,
  collectActiveHumanMergeConflictEscalationTaskIds,
  collectActiveWorkerCiFixTaskIds,
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

export interface LocalCliGitEvidence {
  pushedTaskIds: Set<string>;
  settledTaskIds: Set<string>;
}

const DEFAULT_QA_REVIEW_PARALLELISM = 4;
const MAX_QA_REVIEW_PARALLELISM = 4;

export function resolveTaskQaReviewParallelism(settings: ReturnType<
  SprintOrchestratorDependencies["getDashboardSettings"]
>): number {
  const route = settings.aiProvider.invocationRouting.qa_review;
  const routedProviderConfigIds = [...new Set([
    ...(route.allowedProviders ?? []),
    ...(route.provider ? [route.provider] : []),
  ])];
  const providerConfigIds = routedProviderConfigIds.length > 0
    ? routedProviderConfigIds
    : settings.aiProvider.provider
      ? [settings.aiProvider.provider]
      : [];
  const configuredCapacity = providerConfigIds.reduce((total, providerConfigId) => {
    const providerSettings = settings.aiProvider.providers[providerConfigId];
    if (!providerSettings?.enabled || route.providers[providerConfigId]?.enabled === false) {
      return total;
    }
    const limit = providerSettings.maxConcurrentTasks;
    return Number.isFinite(limit) && Number(limit) > 0 ? total + Math.floor(Number(limit)) : total;
  }, 0);
  return Math.min(
    MAX_QA_REVIEW_PARALLELISM,
    Math.max(1, configuredCapacity || DEFAULT_QA_REVIEW_PARALLELISM),
  );
}

export class CycleRunner {
  private readonly featurePrGate = new FeaturePrGateService();
  private readonly lastAutomatedInterventionKeys = new Map<string, string>();
  private readonly providerCapLogState: ProviderCapLogState = new Map();
  private readonly stateCoordinator: CycleStateCoordinator;
  // Persists across cycles (CycleRunner is long-lived per orchestrator) so a
  // transient `DIRTY` PR state must persist before it escalates a conflict.
  private readonly mergeConflictDebouncer = new MergeConflictDebouncer();

  constructor(private readonly deps: SprintOrchestratorDependencies) {
    this.stateCoordinator = new CycleStateCoordinator(this.deps);
  }

  async run(args: CycleRunnerArgs): Promise<SprintCycleResult & {
    awaitingMerge: Subtask[];
    manualMergeTasks: Subtask[];
    workerEscalatedMergeConflictTasks: Subtask[];
    activeProjectAttentionItems: ProjectAttentionItemRecord[];
    localCliGitEvidence: LocalCliGitEvidence;
  }> {
    const dashboardSettings = this.deps.getDashboardSettings({
      projectId: args.executionContext.project.id,
      sprintId: args.executionContext.sprint.id,
    });
    const isAutomaticRollback = args.executionContext.sprint.kind === "rollback"
      && args.executionContext.sprint.rollbackMode === "automatic";

    // Advance the conflict debouncer once per cycle so per-PR `DIRTY` streaks are
    // counted per cycle even though several call sites observe the same PR below.
    this.mergeConflictDebouncer.beginCycle();

    let subtasks: Subtask[] = args.loopSteps.loadSubtasks
      ? await this.deps.sprintExecutionStateService.loadSubtasks(
          args.executionContext.project.id,
          args.executionContext.sprint.id,
          args.sprintRunId,
        )
      : [];
    if (isAutomaticRollback) {
      for (const task of subtasks) {
        const needsRepair = task.status !== "COMPLETED"
          || !task.is_merged
          || task.merge_indicator !== "MERGED";
        task.status = "COMPLETED";
        task.is_merged = true;
        task.merge_indicator = "MERGED";
        if (needsRepair && task.record_id) {
          this.deps.projectManagementRepository.updateTask(task.record_id, {
            status: "completed",
            isMerged: true,
            mergeIndicator: "MERGED",
          });
        }
      }
    }
    let activeProjectAttentionItems = typeof this.deps.projectAttentionService?.listActiveProjectItems === "function"
      ? this.deps.projectAttentionService.listActiveProjectItems(args.executionContext.project.id)
      : [];
    const resolvedWorkerMergeConflictState = await this.collectResolvedWorkerMergeConflictState(args);
    const resolvedWorkerMergeConflictKeys = resolvedWorkerMergeConflictState.clearKeys;
    const resolvedWorkerMergeConflictSuppressionKeys = resolvedWorkerMergeConflictState.suppressKeys;
    this.clearResolvedWorkerMergeConflictSnapshots(subtasks, args, resolvedWorkerMergeConflictKeys);
    const clearedStaleHumanConflictItemIds = this.stateCoordinator.resolveStaleHumanMergeConflictEscalations(
      subtasks,
      args,
      activeProjectAttentionItems,
    );
    const clearedStaleWorkerConflictItemIds = this.resolveStaleWorkerMergeConflictAttentionItems(
      subtasks,
      args,
      activeProjectAttentionItems,
    );
    if (clearedStaleHumanConflictItemIds.size > 0 || clearedStaleWorkerConflictItemIds.size > 0) {
      activeProjectAttentionItems = activeProjectAttentionItems.filter((item) =>
        !clearedStaleHumanConflictItemIds.has(item.id)
        && !clearedStaleWorkerConflictItemIds.has(item.id)
      );
    }
    const cycleEntryStates = new Map(subtasks.map((task) => [task.id, task.status]));

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
          sprintRunLifecycleService: this.deps.sprintRunLifecycleService,
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

    let localCliGitEvidence = this.collectLocalCliGitEvidence(subtasks, args);
    if (args.loopSteps.statusDerivation && subtasks.length > 0) {
      subtasks = runStatusDerivationStep(subtasks, {
        retryFailed: args.retryFailed,
        isActionRequiredState: this.deps.isActionRequiredState,
        githubMode: args.githubMode,
        localCliPushedTaskIds: localCliGitEvidence.pushedTaskIds,
        localCliSettledTaskIds: localCliGitEvidence.settledTaskIds,
      });
      await this.captureTaskCompletionMemories(subtasks, cycleEntryStates, args, dashboardSettings);
    }

    let reportText = "";
    let qaFinishedTaskIds = new Set<string>();
    if (subtasks.length > 0) {
      if (args.loopSteps.statusDerivation && !isAutomaticRollback) {
        qaFinishedTaskIds = await this.reviewCompletedTasks(
          subtasks,
          cycleEntryStates,
          args,
          dashboardSettings,
          localCliGitEvidence,
        );
      }
      const taskStateBeforeFastBranchGate = snapshotTaskState(subtasks);
      const fastBranchOnlyResult = await this.runFastBranchOnlyMergeGate(
        subtasks,
        args,
        dashboardSettings,
        activeProjectAttentionItems,
        qaFinishedTaskIds,
      );
      subtasks = fastBranchOnlyResult.subtasks;
      reportText += fastBranchOnlyResult.reportText;
      this.stateCoordinator.persistCiGateTaskStateChanges(taskStateBeforeFastBranchGate, subtasks);

      if (hasTaskStateChanges(taskStateBeforeFastBranchGate, subtasks) && args.loopSteps.statusDerivation) {
        localCliGitEvidence = this.collectLocalCliGitEvidence(subtasks, args);
        subtasks = runStatusDerivationStep(subtasks, {
          retryFailed: args.retryFailed,
          isActionRequiredState: this.deps.isActionRequiredState,
          githubMode: args.githubMode,
          localCliPushedTaskIds: localCliGitEvidence.pushedTaskIds,
          localCliSettledTaskIds: localCliGitEvidence.settledTaskIds,
        });
      }
    }

    if (args.loopSteps.startReadyTasks && subtasks.length > 0 && !isAutomaticRollback) {
      const startResult = await this.runStartReadyTasks(subtasks, args, dashboardSettings);
      subtasks = startResult.subtasks;
      reportText += startResult.reportText;
    }

    if (subtasks.length > 0 && !isAutomaticRollback) {
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
      const needsFeaturePrStatus = shouldFetchFeaturePrStatus(subtasks);
      gitStatus = needsFeaturePrStatus && this.deps.getCiStatusForScope
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
      if (gitStatus) {
        this.backfillTaskPrMetadataFromGitStatus(subtasks, gitStatus, args.sprintRunId);
      }

      const shouldRunCiGate = needsFeaturePrStatus || hasFastBranchOnlyMergeCandidates(subtasks, args.githubMode);
      const ciAutofixResult = shouldRunCiGate
        ? await this.featurePrGate.evaluateCiGate(subtasks, {
        evaluateTaskQaGate: this.buildTaskQaGateEvaluator(args, qaFinishedTaskIds),
        automationLevel: args.automationLevel,
        repoPath: args.repoPath,
        featureBranch: args.defaultFeatureBranch,
        defaultBranch: args.defaultBranch,
        featureBranchPrefix: args.featureBranchPrefix,
        ciIntelligence: args.ciIntelligence,
        githubMode: args.githubMode,
        deleteMergedBranches: dashboardSettings.git.deleteMergedBranches,
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
        openCiFixGuardrailHandoff: ({ task, payload, attempts, cap }) => {
          if (!this.deps.projectAttentionService) {
            return;
          }
          const taskId = task.record_id?.trim();
          if (!taskId) {
            return;
          }

          // Recovery can encounter an exhausted legacy ledger while an old
          // worker CI item or generic merge-required item is still active.
          // Resolve those machine-owned rows before opening the deduplicated
          // human handoff so neither path can relaunch coding or repair work.
          this.deps.projectAttentionService.resolveItemsForTask(
            args.executionContext.project.id,
            taskId,
            ["ci_fix_required", "merge_required"],
            "ci_fix_guardrail_handoff_opened",
          );

          const failedEvidence = payload.failedRuns.flatMap((run, runIndex) => {
            const runLabel = run.workflowName || run.name || `run-${run.id ?? runIndex + 1}`;
            const lines = [
              `### Failed run ${runIndex + 1}: ${runLabel}`,
              `- Run: ${run.id ?? "unknown"}${run.url ? ` (${run.url})` : ""}`,
              `- Event: ${run.event ?? "unknown"}`,
              `- Head branch: ${run.headBranch ?? payload.branchName}`,
            ];
            for (const job of run.failedJobs || []) {
              lines.push(`- Failed job: ${job.name} (job ${job.id ?? "unknown"})`);
              lines.push(`  - Failed steps: ${job.failedSteps.length > 0 ? job.failedSteps.join(", ") : "not reported"}`);
              lines.push(`  - Log command: ${job.logCommand || "not available"}`);
              lines.push("  - Failed-step error and assertion evidence:");
              lines.push("```text");
              lines.push(job.logExcerpt?.trim() || "No failed-step error evidence was available.");
              lines.push("```");
            }
            return lines;
          });

          this.deps.projectAttentionService.openItems([{
            projectId: args.executionContext.project.id,
            sprintId: args.executionContext.sprint.id,
            taskId,
            sprintRunId: args.sprintRunId,
            attentionType: "human_escalation_required",
            deduplicationKey: `guardrail:ci_fix:${taskId}`,
            severity: "high",
            ownerType: "human" as ProjectAttentionOwnerType,
            title: `CI autofix guardrail reached for ${task.id}`,
            summaryMarkdown: [
              `Task \`${task.id}\` has failing CI after ${attempts}/${cap > 0 ? cap : "∞"} automated repair attempts.`,
              `PR: ${payload.prUrl}`,
              `Failed checks: ${payload.failedChecks.join(", ") || "unknown"}`,
              `Failed jobs: ${payload.failedJobLabels.join(", ") || "unknown"}`,
              "",
              "Automation is stopped. A human must fix or explicitly clear this intervention before CI repair can resume.",
              "",
              ...failedEvidence,
            ].join("\n"),
            payload: {
              ...payload,
              sourceAttentionType: "ci_fix",
              guardrailPurpose: "ci_fix",
              guardrailSubject: taskId,
              guardrailAttempts: attempts,
              guardrailCap: cap,
              guardrailAction: "human_handoff",
            },
          }]);
        },
        persistMergedTask: async (task) => {
          if (typeof task.record_id !== "string" || task.record_id.trim().length === 0) {
            return;
          }
          this.deps.projectManagementRepository.updateTask(task.record_id, {
            isMerged: Boolean(task.is_merged),
            mergeIndicator: task.merge_indicator || null,
            mergeConflictSourceBranch: task.worker_branch || null,
            mergeConflictTargetBranch: args.defaultFeatureBranch || null,
            status: task.status === "COMPLETED"
              ? "completed"
              : task.status === "CODING_COMPLETED"
                ? "coding_completed"
                : task.status === "RUNNING"
                  ? "in_progress"
                  : undefined,
          });
        },
        executionRepository: this.deps.executionRepository,
        sprintRunId: args.sprintRunId,
        mergeConflictDebouncer: this.mergeConflictDebouncer,
      })
        : { subtasks, reportText: "" };
      subtasks = ciAutofixResult.subtasks;
      reportText += ciAutofixResult.reportText;
      await this.captureCiFailureMemories(subtasks, taskStateBeforeCiGate, args, dashboardSettings);

      this.stateCoordinator.persistCiGateTaskStateChanges(taskStateBeforeCiGate, subtasks);

      const ciGateRefreshNeeded = hasTaskStateChanges(taskStateBeforeCiGate, subtasks);
      if (ciGateRefreshNeeded && args.loopSteps.statusDerivation) {
        localCliGitEvidence = this.collectLocalCliGitEvidence(subtasks, args);
        subtasks = runStatusDerivationStep(subtasks, {
          retryFailed: args.retryFailed,
          isActionRequiredState: this.deps.isActionRequiredState,
          githubMode: args.githubMode,
          localCliPushedTaskIds: localCliGitEvidence.pushedTaskIds,
          localCliSettledTaskIds: localCliGitEvidence.settledTaskIds,
        });
      }

      if (ciGateRefreshNeeded && args.loopSteps.startReadyTasks && !isAutomaticRollback) {
        const startResult = await this.runStartReadyTasks(subtasks, args, dashboardSettings);
        subtasks = startResult.subtasks;
        reportText += startResult.reportText;
      }
    }

    if (
      subtasks.length > 0
      && args.action === "orchestrate"
      && args.loopSteps.loadSubtasks
      && args.loopSteps.mergeProtocol
    ) {
      // Fast local providers can finalize git work after the earlier branch gate
      // snapshots but before protocol renders manual merge instructions. Drain
      // branch-only LOCAL work one final time so protocol only pauses truly
      // unresolved merges.
      subtasks = await this.deps.sprintExecutionStateService.loadSubtasks(
        args.executionContext.project.id,
        args.executionContext.sprint.id,
        args.sprintRunId,
      );
      const taskStateBeforeProtocolFastBranchGate = snapshotTaskState(subtasks);
      const protocolFastBranchOnlyResult = await this.runFastBranchOnlyMergeGate(
        subtasks,
        args,
        dashboardSettings,
        activeProjectAttentionItems,
        qaFinishedTaskIds,
      );
      subtasks = protocolFastBranchOnlyResult.subtasks;
      reportText += protocolFastBranchOnlyResult.reportText;
      this.stateCoordinator.persistCiGateTaskStateChanges(taskStateBeforeProtocolFastBranchGate, subtasks);

      if (hasTaskStateChanges(taskStateBeforeProtocolFastBranchGate, subtasks) && args.loopSteps.statusDerivation) {
        localCliGitEvidence = this.collectLocalCliGitEvidence(subtasks, args);
        subtasks = runStatusDerivationStep(subtasks, {
          retryFailed: args.retryFailed,
          isActionRequiredState: this.deps.isActionRequiredState,
          githubMode: args.githubMode,
          localCliPushedTaskIds: localCliGitEvidence.pushedTaskIds,
          localCliSettledTaskIds: localCliGitEvidence.settledTaskIds,
        });
      }
    }

    const activeWorkerMergeConflictTaskIds = collectActiveWorkerMergeConflictTaskIds(activeProjectAttentionItems);
    const activeWorkerCiFixTaskIds = collectActiveWorkerCiFixTaskIds(activeProjectAttentionItems);
    const activeHumanMergeConflictEscalationTaskIds = collectActiveHumanMergeConflictEscalationTaskIds(activeProjectAttentionItems);
    const activeMergeConflictTaskIds = new Set([
      ...activeWorkerMergeConflictTaskIds,
      ...activeHumanMergeConflictEscalationTaskIds,
    ]);

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
        activeMergeConflictTaskIds,
        this.mergeConflictDebouncer,
        resolvedWorkerMergeConflictKeys,
      ),
      shouldSuppressMergeRequiredTask: (task) => this.isResolvedWorkerMergeConflictSnapshot(
        task,
        args,
        resolvedWorkerMergeConflictSuppressionKeys,
        gitStatus,
      ) || this.isCliTaskAwaitingGitFinalization(task, args, localCliGitEvidence)
        // Failed CI is not merge work. Once its repair guardrail is exhausted,
        // the CI gate owns a human handoff and the merge protocol must not open
        // a misleading worker merge_required item for the same task.
        || task.merge_indicator === "CI",
      renderInstruction: (templateId, variables) => this.deps.renderInstruction(templateId, variables, args.repoPath),
      onTaskEvent: ({ task, eventType, payload, sourceEventKey }) => {
        appendTaskEvent(task, eventType, payload, sourceEventKey);
      },
    });
    this.stateCoordinator.syncProtocolAttentionItems(
      subtasks,
      protocolResult,
      args,
      gitStatus,
      activeMergeConflictTaskIds,
      activeHumanMergeConflictEscalationTaskIds,
      this.mergeConflictDebouncer,
      activeWorkerCiFixTaskIds,
      resolvedWorkerMergeConflictSuppressionKeys,
      activeProjectAttentionItems,
    );
    const reconciledActiveProjectAttentionItems = typeof this.deps.projectAttentionService?.listActiveProjectItems === "function"
      ? this.deps.projectAttentionService.listActiveProjectItems(args.executionContext.project.id).filter((item) => (
        item.status === "open" || item.status === "claimed"
      ))
      : activeProjectAttentionItems;
    const statusTable = args.loopSteps.statusTable ? runStatusTableStep(subtasks) : "";

    return {
      subtasks,
      reportText,
      statusTable,
      instructions: protocolResult.instructions,
      awaitingMerge: protocolResult.awaitingMerge,
      manualMergeTasks: protocolResult.manualMergeTasks,
      workerEscalatedMergeConflictTasks: protocolResult.workerEscalatedMergeConflictTasks,
      activeProjectAttentionItems: reconciledActiveProjectAttentionItems,
      localCliGitEvidence,
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
      getAvailableProviderCapacity: async (provider) => {
        if (!(PROVIDER_IDS as readonly string[]).includes(provider)
          || typeof this.deps.providerConcurrencyService.getAvailableCapacityCount !== "function") {
          return null;
        }
        const providerSettings = dashboardSettings.aiProvider.providers[provider as ProviderId];
        return await this.deps.providerConcurrencyService.getAvailableCapacityCount(
          provider as ProviderId,
          providerSettings?.maxConcurrentTasks ?? 0,
          "task_coding",
        );
      },
      providerCapLogState: this.providerCapLogState,
      providerCapLogScope: [
        args.executionContext.project.id,
        args.executionContext.sprint.id,
        args.sprintRunId ?? "no-run",
      ].join(":"),
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

  private async runFastBranchOnlyMergeGate(
    subtasks: Subtask[],
    args: CycleRunnerArgs,
    dashboardSettings: ReturnType<SprintOrchestratorDependencies["getDashboardSettings"]>,
    activeProjectAttentionItems: ProjectAttentionItemRecord[],
    qaFinishedTaskIds: Set<string>,
  ): Promise<{ subtasks: Subtask[]; reportText: string }> {
    const branchOnlyCandidates = subtasks.filter((task) => isFastBranchOnlyMergeCandidate(task, args.githubMode));
    if (branchOnlyCandidates.length === 0) {
      return { subtasks, reportText: "" };
    }

    const result = await this.featurePrGate.evaluateCiGate(branchOnlyCandidates, {
      evaluateTaskQaGate: this.buildTaskQaGateEvaluator(args, qaFinishedTaskIds),
      automationLevel: args.automationLevel,
      repoPath: args.repoPath,
      featureBranch: args.defaultFeatureBranch,
      defaultBranch: args.defaultBranch,
      featureBranchPrefix: args.featureBranchPrefix,
      ciIntelligence: args.ciIntelligence,
      githubMode: args.githubMode,
      deleteMergedBranches: dashboardSettings.git.deleteMergedBranches,
      gitStatus: null,
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
      openCiFixAttentionItems: () => {
        // Branch-only candidates have no PR URL, so they cannot produce CI-fix items in this fast path.
      },
      persistMergedTask: async (task) => {
        if (typeof task.record_id !== "string" || task.record_id.trim().length === 0) {
          return;
        }
        this.deps.projectManagementRepository.updateTask(task.record_id, {
          isMerged: Boolean(task.is_merged),
          mergeIndicator: task.merge_indicator || null,
          mergeConflictSourceBranch: task.worker_branch || null,
          mergeConflictTargetBranch: args.defaultFeatureBranch || null,
          status: task.status === "COMPLETED"
            ? "completed"
            : task.status === "CODING_COMPLETED"
              ? "coding_completed"
              : task.status === "RUNNING"
                ? "in_progress"
                : undefined,
        });
      },
      executionRepository: this.deps.executionRepository,
      sprintRunId: args.sprintRunId,
      mergeConflictDebouncer: this.mergeConflictDebouncer,
      logger: this.deps.logger.child({
        component: "fast-branch-only-merge-gate",
        projectId: args.executionContext.project.id,
        sprintId: args.executionContext.sprint.id,
        sprintRunId: args.sprintRunId,
      }),
    });

    const updatedById = new Map(result.subtasks.map((task) => [task.id, task]));
    return {
      subtasks: subtasks.map((task) => updatedById.get(task.id) ?? task),
      reportText: result.reportText,
    };
  }

  private isCliTaskAwaitingGitFinalization(
    task: Subtask,
    args: CycleRunnerArgs,
    evidence: LocalCliGitEvidence,
  ): boolean {
    const taskId = task.record_id?.trim();
    if (!taskId || !args.sprintRunId) {
      return false;
    }
    const taskAliases = [taskId, task.id?.trim()].filter((value): value is string => Boolean(value));
    if (taskAliases.some((value) => evidence.pushedTaskIds.has(value) || evidence.settledTaskIds.has(value))) {
      return false;
    }
    const taskRun = this.deps.executionRepository.getLatestTaskRun(taskId, args.sprintRunId);
    return isCliTaskRun(taskRun);
  }

  private collectLocalCliGitEvidence(subtasks: Subtask[], args: CycleRunnerArgs): LocalCliGitEvidence {
    const pushedTaskIds = new Set<string>();
    const settledTaskIds = new Set<string>();
    if (!args.sprintRunId) {
      return { pushedTaskIds, settledTaskIds };
    }

    const recordIds = subtasks
      .map((task) => task.record_id?.trim())
      .filter((recordId): recordId is string => Boolean(recordId));
    const executionRepository = this.deps.executionRepository as Partial<
      SprintOrchestratorDependencies["executionRepository"]
    >;
    const latestRuns = typeof executionRepository.listLatestTaskRuns === "function"
      ? executionRepository.listLatestTaskRuns(recordIds, args.sprintRunId)
      : null;

    const resolvedRuns: Array<{
      task: Subtask;
      recordId: string;
      taskRun: NonNullable<ReturnType<SprintOrchestratorDependencies["executionRepository"]["getLatestTaskRun"]>>;
    }> = [];
    for (const task of subtasks) {
      const recordId = task.record_id?.trim();
      if (!recordId) {
        continue;
      }
      const taskRun = latestRuns
        ? latestRuns.get(recordId) ?? null
        : this.deps.executionRepository.getLatestTaskRun(recordId, args.sprintRunId);
      if (!isCliTaskRun(taskRun) || !taskRun?.id) {
        continue;
      }
      resolvedRuns.push({ task, recordId, taskRun });
    }

    let eventsByTaskRunId: Map<string, ReturnType<SprintOrchestratorDependencies["executionRepository"]["listTaskRunEvents"]>>;
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
        // Keep partial test doubles and older adapters compatible while the
        // production repository uses the single batched query above.
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
    this.deps.projectAttentionService?.openItems?.([{
      projectId: args.executionContext.project.id,
      sprintId: args.executionContext.sprint.id,
      taskId,
      sprintRunId: args.sprintRunId,
      attentionType: "human_escalation_required",
      deduplicationKey: `guardrail:task_coding:${taskId}`,
      severity: "high",
      ownerType: "human" as ProjectAttentionOwnerType,
      title: `Coding guardrail reached for ${task.id}`,
      summaryMarkdown: [
        `Task \`${task.id}\` (${task.title || "untitled"}) exhausted its automated coding budget.`,
        `Attempts: ${evaluation.count}/${evaluation.cap > 0 ? evaluation.cap : "∞"}.`,
        task.intervention_hint,
        "",
        "Automation is stopped. Resolve this handoff to clear the coding guardrail and allow one fresh dispatch cycle.",
      ].join("\n"),
      payload: {
        sourceAttentionType: "task_coding",
        guardrailPurpose: "task_coding",
        guardrailAttempts: evaluation.count,
        guardrailCap: evaluation.cap,
        guardrailAction: "human_handoff",
        taskKey: task.id,
        taskTitle: task.title,
        sessionId: task.session_id || null,
        sessionName: task.session_name || null,
        provider: task.provider || null,
      },
    }]);
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

  private clearResolvedWorkerMergeConflictSnapshots(
    subtasks: Subtask[],
    args: CycleRunnerArgs,
    resolvedWorkerMergeConflictKeys: Set<string>,
  ): void {
    if (resolvedWorkerMergeConflictKeys.size === 0) {
      return;
    }

    for (const task of subtasks) {
      const taskId = task.record_id?.trim();
      if (!taskId || task.merge_indicator !== "MERGE_CONFLICT") {
        continue;
      }

      const resolvedKey = buildResolvedWorkerMergeConflictKey(
        taskId,
        task.worker_branch || null,
        args.defaultFeatureBranch,
      );
      if (!this.isResolvedWorkerMergeConflictKey(taskId, resolvedKey, resolvedWorkerMergeConflictKeys)) {
        continue;
      }

      task.merge_indicator = undefined;
      task.intervention_owner = undefined;
      task.intervention_hint = undefined;
    }
  }

  private resolveStaleWorkerMergeConflictAttentionItems(
    subtasks: Subtask[],
    args: CycleRunnerArgs,
    activeProjectAttentionItems: ProjectAttentionItemRecord[],
  ): Set<string> {
    const resolvedItemIds = new Set<string>();
    if (
      activeProjectAttentionItems.length === 0
      || typeof this.deps.projectAttentionService?.resolveItem !== "function"
    ) {
      return resolvedItemIds;
    }

    const sprintId = args.executionContext.sprint.id;
    const tasksByRecordId = new Map(
      subtasks
        .map((task) => [task.record_id?.trim() || "", task] as const)
        .filter(([taskId]) => taskId.length > 0),
    );

    for (const item of activeProjectAttentionItems) {
      if (
        item.sprintId !== sprintId
        || item.attentionType !== "merge_conflict"
        || item.ownerType !== "worker"
        || !item.taskId
      ) {
        continue;
      }

      const task = tasksByRecordId.get(item.taskId.trim());
      if (
        !task
        || task.merge_indicator === "MERGE_CONFLICT"
        || (typeof task.pr_url === "string" && task.pr_url.trim().length > 0)
      ) {
        continue;
      }

      this.deps.projectAttentionService.resolveItem(item.id, {
        status: "dismissed",
        reason: "stale_worker_merge_conflict_cleared",
        resolutionSummaryMarkdown: [
          "Code UX dismissed this stale worker merge-conflict item because the task no longer carries a MERGE_CONFLICT marker.",
          "",
          "The merge gate will retry the branch merge and reopen a fresh conflict if Git still reports one.",
        ].join("\n"),
        payloadPatch: {
          staleWorkerConflictClearedByCycle: true,
          staleWorkerConflictClearedAtTaskState: {
            status: task.status,
            mergeIndicator: task.merge_indicator || null,
            isMerged: Boolean(task.is_merged),
          },
        },
      });
      resolvedItemIds.add(item.id);
    }

    return resolvedItemIds;
  }

  private async collectResolvedWorkerMergeConflictState(args: CycleRunnerArgs): Promise<{
    clearKeys: Set<string>;
    suppressKeys: Set<string>;
  }> {
    if (typeof this.deps.projectAttentionService?.listResolvedWorkerMergeConflicts === "function") {
      const resolvedConflicts = this.deps.projectAttentionService.listResolvedWorkerMergeConflicts(
        args.executionContext.project.id,
        args.executionContext.sprint.id,
      );
      const clearKeys = new Set<string>();
      const suppressKeys = new Set<string>();
      const groupedConflicts = new Map<string, {
        taskId: string;
        sourceBranch: string;
        targetBranch: string;
        itemIds: string[];
      }>();

      for (const conflict of resolvedConflicts) {
        const taskId = conflict.taskId.trim();
        if (!taskId) continue;

        const sourceBranch = conflict.sourceBranch?.trim() || "";
        const targetBranch = conflict.targetBranch?.trim() || "";
        const key = buildResolvedWorkerMergeConflictKey(taskId, sourceBranch || null, targetBranch || null);
        const group = groupedConflicts.get(key);
        if (group) {
          group.itemIds.push(conflict.itemId);
        } else {
          groupedConflicts.set(key, {
            taskId,
            sourceBranch,
            targetBranch,
            itemIds: [conflict.itemId],
          });
        }
      }

      for (const [key, conflict] of groupedConflicts) {
        let stillHasMergeWork = false;
        if (conflict.sourceBranch && conflict.targetBranch) {
          stillHasMergeWork = await workerBranchHasMergeWork({
            repoPath: args.repoPath,
            featureBranch: conflict.targetBranch,
            workerBranch: conflict.sourceBranch,
          });
          if (stillHasMergeWork) {
            this.deps.logger.info("Resolved worker conflict still has branch work; clearing conflict marker so the branch merge can retry", {
              projectId: args.executionContext.project.id,
              sprintId: args.executionContext.sprint.id,
              sprintRunId: args.sprintRunId,
              taskId: conflict.taskId,
              sourceBranch: conflict.sourceBranch,
              targetBranch: conflict.targetBranch,
              duplicateSignals: conflict.itemIds.length,
            });
          }
        }

        if (typeof this.deps.projectAttentionService.patchItemPayload === "function") {
          const consumedAt = new Date().toISOString();
          for (const itemId of conflict.itemIds) {
            this.deps.projectAttentionService.patchItemPayload(itemId, {
              branchMergeRetryConsumed: true,
              branchMergeRetryConsumedAt: consumedAt,
              branchMergeRetryHadWork: stillHasMergeWork,
            });
          }
        }

        clearKeys.add(key);
        if (!stillHasMergeWork) {
          suppressKeys.add(key);
        }
      }
      return { clearKeys, suppressKeys };
    }

    if (typeof this.deps.projectAttentionService?.listResolvedWorkerMergeConflictTaskIds === "function") {
      const keys = new Set(this.deps.projectAttentionService.listResolvedWorkerMergeConflictTaskIds(
        args.executionContext.project.id,
        args.executionContext.sprint.id,
      ));
      return { clearKeys: keys, suppressKeys: keys };
    }

    return { clearKeys: new Set<string>(), suppressKeys: new Set<string>() };
  }

  private isResolvedWorkerMergeConflictSnapshot(
    task: Subtask,
    args: CycleRunnerArgs,
    resolvedWorkerMergeConflictKeys: Set<string>,
    gitStatus: GitTrackingStatus | null,
  ): boolean {
    const taskId = task.record_id?.trim();
    if (!taskId) {
      return false;
    }

    const pr = gitStatus?.available ? matchPrForTask(task, gitStatus) : undefined;
    const resolvedKey = buildResolvedWorkerMergeConflictKey(
      taskId,
      task.worker_branch || pr?.headRefName || null,
      args.defaultFeatureBranch,
    );

    return this.isResolvedWorkerMergeConflictKey(taskId, resolvedKey, resolvedWorkerMergeConflictKeys);
  }

  private isResolvedWorkerMergeConflictKey(
    taskId: string,
    resolvedKey: string,
    resolvedWorkerMergeConflictKeys: Set<string>,
  ): boolean {
    return resolvedWorkerMergeConflictKeys.has(resolvedKey) || resolvedWorkerMergeConflictKeys.has(taskId);
  }

  private async captureCiFailureMemories(
    subtasks: Subtask[],
    preGateStates: Map<string, TaskStateSnapshot>,
    args: CycleRunnerArgs,
    settings: ReturnType<SprintOrchestratorDependencies["getDashboardSettings"]>,
  ): Promise<void> {
    void subtasks;
    void preGateStates;
    void args;
    void settings;
    // CI failures are operationally noisy and are tracked through task/CI events,
    // not short-term knowledge. Keeping them out of memory prevents remediation
    // from spending provider time cleaning transient build failures later.
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
    task.merge_indicator = undefined;
    task.intervention_owner = undefined;
    task.intervention_hint = undefined;
    if (taskId) {
      this.deps.projectManagementRepository.updateTask(taskId, {
        status: "completed",
        mergeIndicator: null,
      });
      const taskRun = this.deps.executionRepository.getLatestTaskRun(taskId, args.sprintRunId);
      if (taskRun && taskRun.state !== "COMPLETED") {
        this.deps.executionRepository.updateTaskRun(taskRun.id, {
          state: "COMPLETED",
          finishedAt: taskRun.finishedAt ?? new Date().toISOString(),
        });
      }
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
          sourceAttentionType: "qa_review",
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
    cliGitEvidence?: LocalCliGitEvidence,
  ): Promise<Set<string>> {
    const qaFinishedTaskIds = new Set<string>();
    if (!this.deps.qualityAssuranceService || !settings.agents.qualityAssurance.enabled) {
      return qaFinishedTaskIds;
    }

    await this.deps.qualityAssuranceService.reconcileRunningTaskQaReviews?.({
      projectId: args.executionContext.project.id,
      sprintId: args.executionContext.sprint.id,
      tasks: subtasks,
    });
    const qaGateStatuses = typeof this.deps.qualityAssuranceService.getTaskMergeGateStatuses === "function"
      ? this.deps.qualityAssuranceService.getTaskMergeGateStatuses({
          projectId: args.executionContext.project.id,
          sprintId: args.executionContext.sprint.id,
          tasks: subtasks,
        })
      : new Map<string, TaskQaMergeGateStatus>();

    const reviewParallelism = resolveTaskQaReviewParallelism(settings);
    const limit = pLimit(reviewParallelism);
    const reviewPromises: Promise<void>[] = [];

    for (const task of subtasks) {
      const prev = previousStates.get(task.id);
      const taskRecordId = task.record_id?.trim();
      const qaGate = (taskRecordId ? qaGateStatuses.get(taskRecordId) : null)
        ?? this.deps.qualityAssuranceService.getTaskMergeGateStatus({
          projectId: args.executionContext.project.id,
          sprintId: args.executionContext.sprint.id,
          task,
        });
      const taskIsCodeComplete = isTaskCodeComplete(task);
      // Provider completion is not task completion for a CLI workflow. QA must
      // inspect the finalized worker branch, never a workspace that is still
      // being committed/published or was interrupted in that crash window.
      if (
        taskIsCodeComplete
        && cliGitEvidence
        && this.isCliTaskAwaitingGitFinalization(task, args, cliGitEvidence)
      ) {
        continue;
      }
      const hasSameSessionFollowUpAfterLatestQaRequest = taskIsCodeComplete
        && this.hasCompletedTaskFollowUpAfterLatestQaRequest(task, qaGate, args.sprintRunId);
      const hasPendingQaFollowUp = isPendingQaContinuation(qaGate.latestRun);

      // QA spent its budget without ever clearing this task (no pass — either
      // changes still outstanding at the cap or the reviewer kept failing for
      // infra reasons). Apply the configured exhaustion policy instead of letting
      // it quietly settle as completed or loop forever.
      const qaNeedsExhaustionPolicy = qaGate.reason === "retries_exhausted"
        || qaGate.reason === "follow_up_no_progress";
      if (taskIsCodeComplete && qaNeedsExhaustionPolicy && !hasSameSessionFollowUpAfterLatestQaRequest && !hasPendingQaFollowUp) {
        const policy = settings.agents.qualityAssurance.exhaustionPolicy;
        if (this.applyQaExhaustionPolicy(task, qaGate, args, policy)) {
          if (policy === "FINISH_TASK") {
            this.addTaskQaIdentity(qaFinishedTaskIds, task);
          }
          continue;
        }
      }

      const newlyCodeComplete = taskIsCodeComplete && !isTaskCodeComplete({ status: prev });
      const shouldRunQaReview = hasPendingQaFollowUp
        || (taskIsCodeComplete
        && (
          qaGate.reason === "pending_review"
          || qaGate.reason === "review_failed"
          || (qaGate.reason === "retries_exhausted" && hasSameSessionFollowUpAfterLatestQaRequest)
          || (qaGate.reason === "changes_requested" && (
            newlyCodeComplete
            || hasSameSessionFollowUpAfterLatestQaRequest
          ))
        ));

      if (!shouldRunQaReview) {
        continue;
      }
      // A cycle should settle one resource-bounded QA wave, then merge those results and start
      // newly unblocked coding work. Queueing the entire backlog behind p-limit would still block
      // the cycle until every review finished and turn wide DAGs into coding/QA stop-the-world
      // phases even though only `reviewParallelism` reviews can run at once.
      if (reviewPromises.length >= reviewParallelism) {
        break;
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

    return qaFinishedTaskIds;
  }

  private buildTaskQaGateEvaluator(
    args: CycleRunnerArgs,
    qaFinishedTaskIds: ReadonlySet<string>,
  ): ((task: Subtask) => TaskQaMergeGateStatus) | undefined {
    const qaService = this.deps.qualityAssuranceService;
    if (!qaService) {
      return undefined;
    }

    return (task: Subtask) => {
      if (this.hasTaskQaIdentity(qaFinishedTaskIds, task)) {
        return {
          mergeAllowed: true,
          reason: "passed",
          summary: "QA exhaustion FINISH_TASK policy waived the remaining QA gate for this cycle.",
          latestRun: null,
          runsUsed: 0,
          maxRuns: 0,
        };
      }

      return qaService.getTaskMergeGateStatus({
        projectId: args.executionContext.project.id,
        sprintId: args.executionContext.sprint.id,
        task,
      });
    };
  }

  private addTaskQaIdentity(target: Set<string>, task: Subtask): void {
    const recordId = task.record_id?.trim();
    if (recordId) {
      target.add(recordId);
    }
    const taskKey = task.id?.trim();
    if (taskKey) {
      target.add(taskKey);
    }
  }

  private hasTaskQaIdentity(source: ReadonlySet<string>, task: Subtask): boolean {
    const recordId = task.record_id?.trim();
    if (recordId && source.has(recordId)) {
      return true;
    }
    const taskKey = task.id?.trim();
    return Boolean(taskKey && source.has(taskKey));
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

  private hasCompletedTaskFollowUpAfterLatestQaRequest(
    task: Subtask,
    qaGate: TaskQaMergeGateStatus,
    sprintRunId?: string,
  ): boolean {
    if (!this.hasLatestChangesRequestedQaRun(qaGate) || !qaGate.latestRun?.finishedAt || !task.record_id) {
      return false;
    }
    if (qaGate.reason === "follow_up_no_progress") {
      return false;
    }
    if (qaGate.reason === "retries_exhausted" && !shouldVerifyContinuedQaFix(qaGate.latestRun)) {
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

    const hasFollowUpInvocation = invocations.some((invocation) => {
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
    if (hasFollowUpInvocation) {
      return true;
    }

    if (!task.session_id || !taskRun?.sessionId || taskRun.sessionId !== task.session_id || taskRun.state !== "COMPLETED" || !taskRun.finishedAt) {
      return false;
    }
    const taskRunFinishedAt = Date.parse(taskRun.finishedAt);
    if (!Number.isFinite(taskRunFinishedAt)) {
      return false;
    }
    if (qaContinuedTask && Number.isFinite(qaStartedAt)) {
      return taskRunFinishedAt >= qaStartedAt;
    }
    return taskRunFinishedAt > qaFinishedAt;
  }

  private hasLatestChangesRequestedQaRun(qaGate: TaskQaMergeGateStatus): boolean {
    return qaGate.reason === "changes_requested"
      || (qaGate.reason === "retries_exhausted" && qaGate.latestRun?.outcome === "changes_requested");
  }

}

function collectTaskPrUrls(subtasks: Subtask[]): string[] {
  return Array.from(new Set(
    subtasks
      .map((task) => task.pr_url?.trim())
      .filter((url): url is string => Boolean(url))
  ));
}

function nonEmptyTaskString(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isFastBranchOnlyMergeCandidate(task: Subtask, githubMode?: "REMOTE" | "LOCAL"): boolean {
  return isTaskCodeComplete(task)
    && !task.is_merged
    && task.merge_indicator !== "MERGED"
    && task.merge_indicator !== "AUTOMERGE"
    && task.merge_indicator !== "PR_ONLY"
    && task.session_state === "COMPLETED"
    && task.provider !== "jules"
    && !nonEmptyTaskString(task.pr_url)
    && (nonEmptyTaskString(task.worker_branch) || githubMode === "LOCAL");
}

function hasFastBranchOnlyMergeCandidates(subtasks: Subtask[], githubMode?: "REMOTE" | "LOCAL"): boolean {
  return subtasks.some((task) => isFastBranchOnlyMergeCandidate(task, githubMode));
}

function hasTaskStateChanges(previous: Map<string, TaskStateSnapshot>, subtasks: Subtask[]): boolean {
  return subtasks.some((task) => {
    const earlier = previous.get(task.id);
    if (!earlier) {
      return true;
    }
    return earlier.status !== task.status
      || earlier.isMerged !== Boolean(task.is_merged)
      || earlier.mergeIndicator !== task.merge_indicator
      || earlier.workerBranch !== (task.worker_branch || null);
  });
}

function shouldFetchFeaturePrStatus(subtasks: Subtask[]): boolean {
  return subtasks.some((task) => {
    if (task.merge_indicator === "CI" || task.merge_indicator === "MERGE_BLOCKED") {
      return true;
    }
    return isTaskCodeComplete(task) && (
      nonEmptyTaskString(task.pr_url)
      || task.provider === "jules"
      || (nonEmptyTaskString(task.worker_branch) && !isFastBranchOnlyMergeCandidate(task))
    );
  });
}
