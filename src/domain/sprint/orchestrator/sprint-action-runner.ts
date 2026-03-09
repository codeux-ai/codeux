import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import type { CycleRunner } from "./cycle-runner.js";
import type { WatchLoopRunner } from "./watch-loop-runner.js";
import type { AutomationInterventionsSettings, AutomationLevel, CiIntelligenceSettings, SprintLoopStepSettings, Subtask } from "../../../contracts/app-types.js";
import type { SprintAgentArgs } from "../../../sprint/sprint-types.js";
import type { ResolvedSprintExecutionContext } from "../../../services/sprint-execution-bridge-service.js";

export class SprintActionRunner {
  constructor(
    private readonly deps: SprintOrchestratorDependencies,
    private readonly cycleRunner: CycleRunner,
    private readonly watchLoopRunner: WatchLoopRunner,
    private readonly runPlanningAction: (
      args: SprintAgentArgs,
      subtasksDir: string,
      repoPath: string,
      context?: ResolvedSprintExecutionContext | null
    ) => Promise<any>
  ) {}

  async runPlan(
    args: SprintAgentArgs,
    subtasksDir: string,
    repoPath: string,
    context?: ResolvedSprintExecutionContext | null
  ): Promise<any> {
    return await this.runPlanningAction(args, subtasksDir, repoPath, context);
  }

  async runOrchestrate(options: {
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
    shouldWait: boolean;
    watchLoopEnabled: boolean;
  }): Promise<any> {
    if (options.watchLoopEnabled) {
      const fullReport = await this.watchLoopRunner.run({
        args: options.args,
        repoPath: options.repoPath,
        subtasksDir: options.subtasksDir,
        defaultFeatureBranch: options.defaultFeatureBranch,
        defaultBranch: options.defaultBranch,
        githubMode: options.githubMode,
        retryFailed: options.retryFailed,
        loopSteps: options.loopSteps,
        ciIntelligence: options.ciIntelligence,
        automationLevel: options.automationLevel,
        automationInterventions: options.automationInterventions,
        dashboardPort: options.dashboardPort,
      });
      return { content: [{ type: "text", text: fullReport }] };
    }

    const cycleResult = await this.cycleRunner.run({
      action: "orchestrate",
      automationLevel: options.automationLevel,
      automationInterventions: options.automationInterventions,
      sprintNumber: options.args.sprint_number,
      repoPath: options.repoPath,
      sourceId: options.args.source_id,
      defaultFeatureBranch: options.defaultFeatureBranch,
      subtasksDir: options.subtasksDir,
      retryFailed: options.retryFailed,
      loopSteps: options.loopSteps,
      ciIntelligence: options.ciIntelligence,
      githubMode: options.githubMode,
      defaultBranch: options.defaultBranch,
      featureBranchPrefix: this.deps.getDashboardSettings().git.featureBranchPrefix,
    });

    return await this.composeReport({
      args: options.args,
      repoPath: options.repoPath,
      defaultFeatureBranch: options.defaultFeatureBranch,
      dashboardPort: options.dashboardPort,
      shouldWait: options.shouldWait,
      watchLoopEnabled: options.watchLoopEnabled,
      cycleResult,
    });
  }

  async runStatus(options: {
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
    shouldWait: boolean;
    watchLoopEnabled: boolean;
  }): Promise<any> {
    const cycleResult = await this.cycleRunner.run({
      action: "status",
      automationLevel: options.automationLevel,
      automationInterventions: options.automationInterventions,
      sprintNumber: options.args.sprint_number,
      repoPath: options.repoPath,
      sourceId: options.args.source_id,
      defaultFeatureBranch: options.defaultFeatureBranch,
      subtasksDir: options.subtasksDir,
      retryFailed: options.retryFailed,
      loopSteps: options.loopSteps,
      ciIntelligence: options.ciIntelligence,
      githubMode: options.githubMode,
      defaultBranch: options.defaultBranch,
      featureBranchPrefix: this.deps.getDashboardSettings().git.featureBranchPrefix,
    });

    return await this.composeReport({
      args: options.args,
      repoPath: options.repoPath,
      defaultFeatureBranch: options.defaultFeatureBranch,
      dashboardPort: options.dashboardPort,
      shouldWait: options.shouldWait,
      watchLoopEnabled: options.watchLoopEnabled,
      cycleResult,
    });
  }

  async composeReport(options: {
    args: SprintAgentArgs;
    repoPath: string;
    defaultFeatureBranch: string;
    dashboardPort: number;
    shouldWait: boolean;
    watchLoopEnabled: boolean;
    cycleResult: {
      subtasks: Subtask[];
      reportText: string;
      statusTable: string;
      instructions: string;
    };
  }): Promise<any> {
    const { args, repoPath, defaultFeatureBranch, dashboardPort, shouldWait, watchLoopEnabled, cycleResult } = options;
    const { subtasks, reportText, statusTable, instructions } = cycleResult;

    let report = `### Sprint ${args.sprint_number} Orchestration Report\n\n`;
    report += `**Feature Branch:** \`${defaultFeatureBranch}\`\n`;
    report += `**Dashboard:** [http://localhost:${dashboardPort}](http://localhost:${dashboardPort})\n\n`;

    if (args.action === "status" && args.wait) {
      report += "ℹ️ **Status Action is Instant:** Ignoring `wait: true` and returning a single-cycle status report.\n\n";
    } else if (shouldWait && !watchLoopEnabled) {
      report += "⚙️ **Watch Loop Disabled:** Running a single orchestration cycle because watch mode is disabled in settings.\n\n";
    }

    report += reportText;
    report += statusTable;
    report += instructions;

    try {
      const orchGuide = await this.deps.getGuideContent("orchestrator.md", repoPath);
      report += `\n---\n\n### Orchestration Guidance\n\n${orchGuide}`;
    } catch {
      // Guide is optional.
    }

    this.deps.updateLastStatus({
      sprint_number: args.sprint_number,
      source_id: args.source_id,
      repo_path: repoPath,
      feature_branch: defaultFeatureBranch,
      subtasks,
      reportText,
      statusTable,
      instructions,
      timestamp: new Date().toLocaleTimeString(),
    });

    return { content: [{ type: "text", text: report }] };
  }
}
