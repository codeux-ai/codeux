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

export interface WatchLoopRunnerArgs {
  args: SprintAgentArgs;
  executionContext: SprintExecutionContext;
  repoPath: string;
  defaultFeatureBranch: string;
  defaultBranch: string;
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

    let allFinished = false;
    const watchStartedAt = Date.now();
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

      const { subtasks, reportText, statusTable, instructions, awaitingMerge } = await this.cycleRunner.run({
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
        featureBranchPrefix: this.deps.getDashboardSettings().git.featureBranchPrefix,
        sprintRunId,
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

      const allTerminal = subtasks.length > 0 && subtasks.every(
        (task) => (task.status === "COMPLETED" && task.is_merged) || task.status === "FAILED"
      );
      const noMoreActionPossible = runningTasks.length === 0 && readyTasks.length === 0;
      const needsManualMerge = awaitingMerge.length > 0;

      allFinished = allTerminal || noMoreActionPossible || needsManualMerge;
      const elapsedMs = Date.now() - watchStartedAt;
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
              awaitingMergeCount: awaitingMerge.length,
              taskIds: awaitingMerge.map((task) => task.record_id || task.id),
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

          try {
            const watchGuide = await this.deps.getGuideContent("watch.md", repoPath);
            fullReport += `\n---\n\n### Watch Loop Operating Standard\n\n${watchGuide}`;
          } catch {
            // Guide is optional.
          }

          if (subtasks.length > 0 && subtasks.every((task) => task.status === "COMPLETED" && task.is_merged)) {
            try {
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
              fullReport += await this.deps.renderInstruction("cleanupAllMerged", { planning_target: scopedExecutionContext.sprint.name }, repoPath);
              fullReport += await runCompletionStep({
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
                featureBranchPrefix: this.deps.getDashboardSettings().git.featureBranchPrefix,
                ciIntelligence,
                githubMode,
              });
              if (mergeFeedback.text) {
                this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "main_merge_gate_status", "system", {
                  state: mergeFeedback.state,
                  prNumber: mergeFeedback.prNumber,
                  prUrl: mergeFeedback.prUrl,
                  hasFailedChecks: mergeFeedback.hasFailedChecks,
                  hasPendingChecks: mergeFeedback.hasPendingChecks,
                  hasReviewBlockers: mergeFeedback.hasReviewBlockers,
                  failedChecks: mergeFeedback.failedChecks,
                }, {
                  sourceEventKey: `main-merge-gate:${sprintRunId}:${mergeFeedback.state}:${mergeFeedback.prNumber || "none"}`,
                });
              }
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
          } else if (subtasks.some((task) => task.status === "COMPLETED" && !task.is_merged)) {
            this.deps.executionRepository.updateSprintRun(sprintRunId, {
              status: "paused",
              lastHeartbeatAt: new Date().toISOString(),
            });
            this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_paused", "system", {
              reason: "awaiting_merge",
              awaitingMergeCount: subtasks.filter((task) => task.status === "COMPLETED" && !task.is_merged).length,
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
          const pendingTasks = subtasks.filter((task) => task.status === "PENDING");
          const completedTasks = subtasks.filter((task) => task.status === "COMPLETED");
          const failedTasks = subtasks.filter((task) => task.status === "FAILED");

          fullReport += reportText;
          fullReport += statusTable;
          fullReport += instructions;
          fullReport += await this.deps.renderInstruction(
            "watchContinue",
            {
              elapsed_seconds: Math.floor(elapsedMs / 1000),
              action: args.action,
              running_tasks: runningTasks.length,
              pending_tasks: pendingTasks.length,
              completed_tasks: completedTasks.length,
              failed_tasks: failedTasks.length,
            },
            repoPath
          );
          return fullReport;
        }

        case WatchLoopState.RUNNING: {
          const now = new Date().toISOString();
          const latestRun = this.deps.executionRepository.getSprintRun(sprintRunId);
          if (latestRun?.status === "paused" || latestRun?.status === "cancelled" || latestRun?.status === "cancel_requested") {
            continue;
          }
          this.deps.executionRepository.updateSprintRun(sprintRunId, {
            status: "running",
            lastHeartbeatAt: now,
          });
          if (leaseToken) {
            this.deps.executionRepository.renewLease({
              scopeType: "sprint",
              scopeId: scopedExecutionContext.sprint.id,
              leaseToken,
              expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            });
          }
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
}
