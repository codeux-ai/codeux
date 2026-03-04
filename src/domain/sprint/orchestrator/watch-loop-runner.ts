import * as fs from "fs/promises";
import { runCompletionStep } from "../../../sprint/steps/completion-step.js";
import type { SprintAgentArgs } from "../../../sprint/sprint-types.js";
import type {
  AutomationInterventionsSettings,
  AutomationLevel,
  CiIntelligenceSettings,
  SprintLoopStepSettings,
} from "../../../contracts/app-types.js";
import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import type { CycleRunner } from "./cycle-runner.js";

export interface WatchLoopRunnerArgs {
  args: SprintAgentArgs;
  repoPath: string;
  subtasksDir: string;
  defaultFeatureBranch: string;
  defaultBranch: string;
  githubMode: "REMOTE" | "LOCAL";
  retryFailed: boolean;
  loopSteps: SprintLoopStepSettings;
  ciIntelligence: CiIntelligenceSettings;
  automationLevel: AutomationLevel;
  automationInterventions: AutomationInterventionsSettings;
  dashboardPort: number;
}

export class WatchLoopRunner {
  constructor(
    private readonly deps: SprintOrchestratorDependencies,
    private readonly cycleRunner: CycleRunner,
    private readonly renderMainMergeCiFeedback: (args: any) => Promise<string>
  ) {}

  async run(params: WatchLoopRunnerArgs): Promise<string> {
    const {
      args,
      repoPath,
      subtasksDir,
      defaultFeatureBranch,
      defaultBranch,
      githubMode,
      retryFailed,
      loopSteps,
      ciIntelligence,
      automationLevel,
      automationInterventions,
      dashboardPort,
    } = params;

    let allFinished = false;
    const watchStartedAt = Date.now();
    let fullReport = await this.deps.renderInstruction(
      "watchHeader",
      {
        sprint_number: args.sprint_number,
        feature_branch: defaultFeatureBranch,
        dashboard_port: dashboardPort,
      },
      repoPath
    );
    fullReport += "\n";

    const watchLoopIntervalMs = Math.max(1, loopSteps.watchLoopIntervalSeconds) * 1000;
    const watchLoopOutputIntervalMs = Math.max(60, loopSteps.watchLoopOutputIntervalSeconds) * 1000;

    this.deps.logger.info("Starting watch loop", {
      sprintNumber: args.sprint_number,
      featureBranch: defaultFeatureBranch,
    });
    this.deps.logger.info(`Live dashboard available at http://localhost:${dashboardPort}`);

    while (!allFinished) {
      const { subtasks, reportText, statusTable, instructions, awaitingMerge } = await this.cycleRunner.run({
        action: args.action as "status" | "orchestrate",
        automationLevel,
        automationInterventions,
        sprintNumber: args.sprint_number,
        repoPath,
        sourceId: args.source_id,
        defaultFeatureBranch,
        subtasksDir,
        retryFailed,
        loopSteps,
        ciIntelligence,
        githubMode,
        defaultBranch,
        featureBranchPrefix: this.deps.getDashboardSettings().git.featureBranchPrefix,
      });

      const timestamp = new Date().toLocaleTimeString();
      this.deps.updateLastStatus({
        sprint_number: args.sprint_number,
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
      const readyTasks = subtasks.filter((task) => task.status === "PENDING" && task.is_independent);

      const allTerminal = subtasks.length > 0 && subtasks.every(
        (task) => (task.status === "COMPLETED" && task.is_merged) || task.status === "FAILED"
      );
      const noMoreActionPossible = runningTasks.length === 0 && readyTasks.length === 0;
      const needsManualMerge = awaitingMerge.length > 0;

      allFinished = allTerminal || noMoreActionPossible || needsManualMerge;
      const elapsedMs = Date.now() - watchStartedAt;
      const outputIntervalReached = elapsedMs >= watchLoopOutputIntervalMs;

      if (allFinished) {
        fullReport += reportText;
        fullReport += statusTable;
        fullReport += instructions;

        if (needsManualMerge) {
          fullReport += await this.deps.renderInstruction("watchMergeRequired", {}, repoPath);
        } else if (subtasks.length > 0 && !allTerminal && noMoreActionPossible) {
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
            this.deps.completedSprints.add(args.sprint_number);
            await fs.rm(subtasksDir, { recursive: true, force: true });
            fullReport += await this.deps.renderInstruction("cleanupAllMerged", { subtasks_dir: subtasksDir }, repoPath);
            fullReport += await runCompletionStep({
              defaultBranch,
              featureBranch: defaultFeatureBranch,
              sprintNumber: args.sprint_number,
              githubMode,
              ciIntelligence,
              renderInstruction: (templateId, variables) => this.deps.renderInstruction(templateId, variables, repoPath),
            });
            fullReport += await this.renderMainMergeCiFeedback({
              repoPath,
              featureBranch: defaultFeatureBranch,
              defaultBranch,
              featureBranchPrefix: this.deps.getDashboardSettings().git.featureBranchPrefix,
              ciIntelligence,
              githubMode,
            });
          } catch (cleanupError) {
            this.deps.logger.warn("Failed to cleanup subtasks", {
              subtasksDir,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            });
          }        } else if (subtasks.some((task) => task.status === "FAILED")) {
          fullReport += await this.deps.renderInstruction("cleanupFailed", { subtasks_dir: subtasksDir }, repoPath);
        } else if (subtasks.some((task) => task.status === "COMPLETED" && !task.is_merged)) {
          fullReport += await this.deps.renderInstruction("cleanupDeferred", {}, repoPath);
        } else if (subtasks.length === 0) {
          fullReport += await this.renderInstruction("cleanupEmpty", {}, repoPath);
        }

        fullReport += "\n✅ **Sprint Execution Finished.**\n";
      } else if (outputIntervalReached) {
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
      } else {
        await new Promise((resolve) => setTimeout(resolve, watchLoopIntervalMs));
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
