import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import type { CycleRunner } from "./cycle-runner.js";
import type { WatchLoopRunner } from "./watch-loop-runner.js";
import type { AutomationInterventionsSettings, AutomationLevel, CiIntelligenceSettings, SprintLoopStepSettings, Subtask } from "../../../contracts/app-types.js";
import type { SprintAgentArgs } from "../../../sprint/sprint-types.js";
import type { SprintExecutionContext } from "../../../services/sprint-execution-state-service.js";

export class SprintActionRunner {
  constructor(
    private readonly deps: SprintOrchestratorDependencies,
    private readonly cycleRunner: CycleRunner,
    private readonly watchLoopRunner: WatchLoopRunner,
    private readonly runPlanningAction: (args: SprintAgentArgs, subtasksDir: string, repoPath: string) => Promise<any>
  ) {}

  async runPlan(args: SprintAgentArgs, subtasksDir: string, repoPath: string): Promise<any> {
    return await this.runPlanningAction(args, subtasksDir, repoPath);
  }

  async runOrchestrate(options: {
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
    shouldWait: boolean;
    watchLoopEnabled: boolean;
    sprintRunId: string;
    leaseToken?: string;
  }): Promise<any> {
    if (options.watchLoopEnabled) {
      const fullReport = await this.watchLoopRunner.run({
        args: options.args,
        executionContext: options.executionContext,
        repoPath: options.repoPath,
        defaultFeatureBranch: options.defaultFeatureBranch,
        defaultBranch: options.defaultBranch,
        featureBranchPrefix: options.featureBranchPrefix,
        githubMode: options.githubMode,
        retryFailed: options.retryFailed,
        loopSteps: options.loopSteps,
        ciIntelligence: options.ciIntelligence,
        automationLevel: options.automationLevel,
        automationInterventions: options.automationInterventions,
        dashboardPort: options.dashboardPort,
        sprintRunId: options.sprintRunId,
        leaseToken: options.leaseToken,
      });
      return { content: [{ type: "text", text: fullReport }] };
    }

    const cycleResult = await this.cycleRunner.run({
      action: "orchestrate",
      automationLevel: options.automationLevel,
      automationInterventions: options.automationInterventions,
      executionContext: options.executionContext,
      repoPath: options.repoPath,
      defaultFeatureBranch: options.defaultFeatureBranch,
      retryFailed: options.retryFailed,
      loopSteps: options.loopSteps,
      ciIntelligence: options.ciIntelligence,
      githubMode: options.githubMode,
      defaultBranch: options.defaultBranch,
      featureBranchPrefix: options.featureBranchPrefix,
      sprintRunId: options.sprintRunId,
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
    shouldWait: boolean;
    watchLoopEnabled: boolean;
  }): Promise<any> {
    const cycleResult = await this.cycleRunner.run({
      action: "status",
      automationLevel: options.automationLevel,
      automationInterventions: options.automationInterventions,
      executionContext: options.executionContext,
      repoPath: options.repoPath,
      defaultFeatureBranch: options.defaultFeatureBranch,
      retryFailed: options.retryFailed,
      loopSteps: options.loopSteps,
      ciIntelligence: options.ciIntelligence,
      githubMode: options.githubMode,
      defaultBranch: options.defaultBranch,
      featureBranchPrefix: options.featureBranchPrefix,
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
    const sprintLabel = typeof args.sprint_number === "number" ? args.sprint_number : "selected";

    let report = `### Sprint ${sprintLabel} Orchestration Report\n\n`;
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

    this.deps.updateLastStatus({
      project_id: options.cycleResult.subtasks[0]?.project_id,
      sprint_number: args.sprint_number,
      sprint_id: options.cycleResult.subtasks[0]?.sprint_id,
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
