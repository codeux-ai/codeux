import { runCompletionStep } from "../../../sprint/steps/completion-step.js";
import type { SprintAgentArgs } from "../../../sprint/sprint-types.js";
import { determineNextState, WatchLoopState } from "./watch-loop-state-machine.js";
import type {
  AutomationInterventionsSettings,
  AutomationLevel,
  CiIntelligenceSettings,
  SprintLoopStepSettings,
} from "../../../contracts/app-types.js";
import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import type { CycleRunner } from "./cycle-runner.js";
import type { SprintExecutionContext } from "../../../services/sprint-execution-state-service.js";
import type { MergeFeedbackResult } from "../ci/main-merge-gate.js";
import { isCompletedTaskSettled } from "../task-merge-state.js";

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
    private readonly renderMainMergeCiFeedback: (args: any) => Promise<MergeFeedbackResult>
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
      const controlledRun = this.deps.executionRepository.getSprintRun(sprintRunId);
      if (controlledRun?.status === "paused") {
        fullReport += "\n⏸️ **Sprint Paused:** Dashboard control paused this sprint run.\n";
        return fullReport;
      }
      if (controlledRun?.status === "cancel_requested") {
        const finalized = this.deps.executionRepository.finalizeSprintRunCancellationIfIdle(sprintRunId);
        fullReport += finalized
          ? "\n🛑 **Sprint Cancelled:** Dashboard control cancelled this sprint run.\n"
          : "\n🛑 **Sprint Cancellation Requested:** Dashboard control requested cancellation for this sprint run. Active work is still shutting down.\n";
        return fullReport;
      }
      if (controlledRun?.status === "cancelled") {
        fullReport += "\n🛑 **Sprint Cancelled:** Dashboard control cancelled this sprint run.\n";
        return fullReport;
      }

      const {
        subtasks,
        reportText,
        statusTable,
        instructions,
        manualMergeTasks,
        workerEscalatedMergeConflictTasks,
      } = await this.cycleRunner.run({
        action: args.action as "status" | "orchestrate",
        automationLevel,
        automationInterventions,
        executionContext: scopedExecutionContext,
        repoPath,
        defaultFeatureBranch,
        retryFailed,
        loopSteps,
        ciIntelligence,
        githubMode,
        defaultBranch,
        featureBranchPrefix,
        sprintRunId,
        planningAgentPresetId,
      });

      const timestamp = new Date().toLocaleTimeString();
      this.deps.updateLastStatus({
        project_id: scopedExecutionContext.project.id,
        sprint_id: scopedExecutionContext.sprint.id,
        sprint_number: scopedExecutionContext.sprintNumber,
        source_id: args.source_id,
        repo_path: repoPath,
        feature_branch: defaultFeatureBranch,
        subtasks,
        reportText,
        statusTable,
        instructions,
        timestamp,
      });

      const runningTasks = subtasks.filter((task) => task.status === "RUNNING");
      const readyTasks = subtasks.filter((task) => task.status === "PENDING");
      const activeProjectAttentionItems = typeof this.deps.projectAttentionService?.listActiveProjectItems === "function"
        ? this.deps.projectAttentionService.listActiveProjectItems(scopedExecutionContext.project.id).filter((item) => (
          item.status === "open" || item.status === "claimed"
        ))
        : [];
      const activeWorkerAttentionItems = activeProjectAttentionItems.filter((item) => item.ownerType === "worker");
      const activeWorkerMergeConflictAttention = activeWorkerAttentionItems.some((item) => item.attentionType === "merge_conflict");
      const activeMainMergeAttentionItems = activeProjectAttentionItems.filter((item) => (
        item.sprintRunId === sprintRunId && isActiveMainMergeAttentionItem(item)
      ));

      const allTerminal = subtasks.length > 0 && subtasks.every(
        (task) => isCompletedTaskSettled(task) || task.status === "FAILED"
      );
      const quotaTasks = subtasks.filter((task) => task.status === "QUOTA");
      const noMoreActionPossible = runningTasks.length === 0 && readyTasks.length === 0 && quotaTasks.length === 0;
      const needsManualMerge = manualMergeTasks.length > 0;
      const waitingOnWorkerAttention = workerEscalatedMergeConflictTasks.length > 0
        || activeWorkerMergeConflictAttention
        || activeWorkerAttentionItems.length > 0;

      allFinished = allTerminal || ((needsManualMerge || noMoreActionPossible) && !waitingOnWorkerAttention);
      const elapsedMs = Date.now() - checkpointWindowStartedAt;
      const outputIntervalReached = elapsedMs >= watchLoopOutputIntervalMs;

      const nextState = determineNextState({
        allFinished,
        outputIntervalReached,
      });

      switch (nextState) {
        case WatchLoopState.FINISHED: {
          this.deps.projectAttentionService.resolveItemsForSprintRun(
            scopedExecutionContext.project.id,
            sprintRunId,
            ["manual_attention"],
            "watch_loop_finished",
          );
          fullReport += reportText;
          fullReport += statusTable;
          fullReport += instructions;

          if (needsManualMerge) {
            this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_merge_required", "system", {
              awaitingMergeCount: manualMergeTasks.length,
              taskIds: manualMergeTasks.map((task) => task.record_id || task.id),
            }, {
              sourceEventKey: `sprint-merge-required:${sprintRunId}`,
            });
            fullReport += await this.deps.renderInstruction("watchMergeRequired", {}, repoPath);
          } else if (subtasks.length > 0 && !allTerminal && noMoreActionPossible) {
            this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_no_more_actions", "system", {
              taskCount: subtasks.length,
              runningCount: runningTasks.length,
              readyCount: readyTasks.length,
            }, {
              sourceEventKey: `sprint-no-more-actions:${sprintRunId}`,
            });
            fullReport += await this.deps.renderInstruction("watchNoMoreActions", {}, repoPath);
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
                this.deps.projectAttentionService.openItem({
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
                    mergedTaskContexts: selectMergedTaskContexts(subtasks),
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
                    featureBranchTaskContexts: selectMergedTaskContexts(subtasks),
                  },
                });
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
              if (mergeFeedback.hasMergeConflict || remainingMainMergeAttentionItems.length > 0) {
                fullReport += completionGuidance;
                fullReport += mergeFeedback.text;
                pauseSprintRunForMainMergeBlocker({
                  executionRepository: this.deps.executionRepository,
                  sprintRunId,
                  sprintNumber: scopedExecutionContext.sprintNumber,
                  mergeFeedback,
                  attentionItems: remainingMainMergeAttentionItems,
                });
                fullReport += "\n⏸️ **Sprint Paused:** Main-branch merge is still blocked. Resolve the active main-merge conflict and resume the sprint.\n";
                return fullReport;
              }
              this.deps.completedSprints.add(`${scopedExecutionContext.project.id}:${scopedExecutionContext.sprint.id}`);
              this.deps.executionRepository.updateSprintRun(sprintRunId, {
                status: "completed",
                finishedAt: new Date().toISOString(),
                lastHeartbeatAt: new Date().toISOString(),
              });
              this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_completed", "system", {
                sprintNumber: scopedExecutionContext.sprintNumber,
                taskCount: subtasks.length,
              }, {
                sourceEventKey: `sprint-completed:${sprintRunId}`,
              });
              this.triggerAutoPromote(scopedExecutionContext.project.id, scopedExecutionContext.sprint.id);
              fullReport += await this.deps.renderInstruction("cleanupAllMerged", { planning_target: scopedExecutionContext.sprint.name }, repoPath);
              fullReport += completionGuidance;
              fullReport += mergeFeedback.text;
            } catch (cleanupError) {
              this.deps.logger.warn("Failed to finalize sprint run", {
                sprintRunId,
                error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
              });
            }
          } else if (subtasks.some((task) => task.status === "FAILED")) {
            this.deps.executionRepository.updateSprintRun(sprintRunId, {
              status: "failed",
              finishedAt: new Date().toISOString(),
              lastHeartbeatAt: new Date().toISOString(),
            });
            this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_failed", "system", {
              failedTaskCount: subtasks.filter((task) => task.status === "FAILED").length,
            }, {
              sourceEventKey: `sprint-failed:${sprintRunId}`,
            });
            fullReport += await this.deps.renderInstruction("cleanupFailed", { planning_target: scopedExecutionContext.sprint.name }, repoPath);
          } else if (manualMergeTasks.length > 0) {
            this.deps.executionRepository.updateSprintRun(sprintRunId, {
              status: "paused",
              lastHeartbeatAt: new Date().toISOString(),
            });
            this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_paused", "system", {
              reason: "awaiting_merge",
              awaitingMergeCount: manualMergeTasks.length,
            }, {
              sourceEventKey: `sprint-paused:${sprintRunId}:awaiting-merge`,
            });
            fullReport += await this.deps.renderInstruction("cleanupDeferred", {}, repoPath);
          } else if (subtasks.length === 0) {
            this.deps.executionRepository.updateSprintRun(sprintRunId, {
              status: "cancelled",
              finishedAt: new Date().toISOString(),
              lastHeartbeatAt: new Date().toISOString(),
            });
            this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_cancelled", "system", {
              reason: "empty",
            }, {
              sourceEventKey: `sprint-cancelled:${sprintRunId}:empty`,
            });
            fullReport += await this.renderInstruction("cleanupEmpty", {}, repoPath);
          } else {
            this.deps.executionRepository.updateSprintRun(sprintRunId, {
              status: "paused",
              lastHeartbeatAt: new Date().toISOString(),
            });
            this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_paused", "system", {
              reason: "manual_attention",
            }, {
              sourceEventKey: `sprint-paused:${sprintRunId}:manual-attention`,
            });
            this.deps.projectAttentionService.openItem({
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
                runningTaskIds: runningTasks.map((task) => task.record_id || task.id),
                readyTaskIds: readyTasks.map((task) => task.record_id || task.id),
                blockedTaskIds: subtasks
                  .filter((task) => task.status === "BLOCKED")
                  .map((task) => task.record_id || task.id),
              },
            });
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
    const payload = item.payload || {};
    const isMainMergeConflict = item.attentionType === "merge_conflict" && payload.mergeStage === "main";
    const isMainMergeConflictHandoff = (
      (item.attentionType === "human_escalation_required" || item.attentionType === "dashboard_reply_required")
      && payload.sourceAttentionType === "merge_conflict"
      && payload.mergeStage === "main"
    );
    if (!isMainMergeConflict && !isMainMergeConflictHandoff) {
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
    item.sprintRunId === sprintRunId && isActiveMainMergeAttentionItem(item)
  ));
}

function isActiveMainMergeAttentionItem(item: {
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
  const now = new Date().toISOString();
  args.executionRepository.updateSprintRun(args.sprintRunId, {
    status: "paused",
    lastHeartbeatAt: now,
  });
  args.executionRepository.appendSprintRunEvent(args.sprintRunId, "sprint_paused", "system", {
    reason: "main_merge_blocked",
    sprintNumber: args.sprintNumber,
    mainMergeState: args.mergeFeedback.state,
    prNumber: args.mergeFeedback.prNumber,
    prUrl: args.mergeFeedback.prUrl,
    hasMergeConflict: args.mergeFeedback.hasMergeConflict,
    attentionItemIds: args.attentionItems.map((item) => item.id),
    attentionTypes: args.attentionItems.map((item) => item.attentionType),
  }, {
    sourceEventKey: `sprint-paused:${args.sprintRunId}:main-merge-blocked:${args.mergeFeedback.state}:${args.mergeFeedback.prNumber || "none"}`,
  });
}

function selectMergedTaskContexts(subtasks: Array<{
  id: string;
  title: string;
  prompt: string;
  worker_branch?: string | null;
  pr_url?: string | null;
  is_merged?: boolean;
}>): Array<{
  taskKey: string;
  taskTitle: string;
  taskPrompt: string;
  workerBranch: string | null;
  prUrl: string | null;
}> {
  return subtasks
    .filter((task) => task.is_merged)
    .slice(0, 8)
    .map((task) => ({
      taskKey: task.id,
      taskTitle: task.title,
      taskPrompt: task.prompt,
      workerBranch: task.worker_branch || null,
      prUrl: task.pr_url || null,
    }));
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
  const lines = [
    `Main-branch merge conflict detected for \`${args.featureBranch} -> ${args.defaultBranch}\`.`,
    `Repo path: \`${args.repoPath}\``,
    `Working directory: \`cd ${args.repoPath}\``,
  ];

  if (args.prNumber) {
    lines.push(`PR: #${args.prNumber}${args.prUrl ? ` (${args.prUrl})` : ""}`);
  } else if (args.prUrl) {
    lines.push(`PR: ${args.prUrl}`);
  }

  if (args.mergedTaskContexts.length > 0) {
    lines.push("", "Merged task prompts already on the feature branch:");
    for (const task of args.mergedTaskContexts) {
      lines.push(`- \`${task.taskKey}\` ${task.taskTitle}: ${task.taskPrompt}`);
    }
  }

  return lines.join("\n");
}
