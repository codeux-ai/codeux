import * as fs from "fs/promises";
import * as path from "path";
import type { InstructionTemplateId } from "./instructions/catalog.js";
import { runBranchPreflightStep } from "./sprint/steps/branch-preflight-step.js";
import { runPlanningPreflightStep } from "./sprint/steps/planning-preflight-step.js";
import { runLoadSubtasksStep } from "./sprint/steps/load-subtasks-step.js";
import { runSessionSyncStep } from "./sprint/steps/session-sync-step.js";
import { runStatusDerivationStep } from "./sprint/steps/status-derivation-step.js";
import { runStartReadyTasksStep } from "./sprint/steps/start-ready-tasks-step.js";
import { runStatusTableStep } from "./sprint/steps/status-table-step.js";
import { runProtocolStep } from "./sprint/steps/protocol-step.js";
import { runCompletionStep } from "./sprint/steps/completion-step.js";
import type { SprintAgentArgs, SprintCycleResult } from "./sprint/types.js";
import type {
  CiIntelligenceSettings,
  DashboardSettings,
  JulesSession,
  Settings,
  SprintLoopStepSettings,
  Subtask,
} from "./types.js";

const DEFAULT_STEP_SETTINGS: SprintLoopStepSettings = {
  branchPreflight: true,
  planningPreflight: true,
  loadSubtasks: true,
  sessionSync: true,
  statusDerivation: true,
  startReadyTasks: true,
  mergeProtocol: true,
  actionRequiredProtocol: true,
  statusTable: true,
  watchLoop: true,
  watchLoopIntervalSeconds: 120,
};

const DEFAULT_CI_SETTINGS: CiIntelligenceSettings = {
  enabled: true,
  waitForCiBeforeMainMerge: true,
  resolveAllCommentsBeforeMainMerge: true,
  waitForCiBeforeFeatureMerge: true,
  resolveAllCommentsBeforeFeatureMerge: true,
};

export interface SprintOrchestratorDependencies {
  settings: Settings;
  dashboardPort: number;
  completedSprints: Set<number>;
  getConsecutiveFailures: () => number;
  setConsecutiveFailures: (value: number) => void;
  isActionRequiredState: (state?: string) => boolean;
  resolveSessionName: (session: Partial<JulesSession>) => string | undefined;
  extractSessionId: (session: Partial<JulesSession>) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<any[]>;
  listSessions: () => Promise<{ sessions?: JulesSession[] }>;
  loadSubtasks: (dir: string) => Promise<Subtask[]>;
  startTask: (task: Subtask, sourceId: string, baseBranch: string, repoPath: string, sprintNumber: number) => Promise<JulesSession>;
  getGuideContent: (guideName: string, repoPath?: string) => Promise<string>;
  updateLastStatus: (status: any) => void;
  getDashboardSettings: () => DashboardSettings;
  renderInstruction: (templateId: InstructionTemplateId, variables: Record<string, unknown>, repoPath?: string) => Promise<string>;
}

export class SprintOrchestrator {
  constructor(private readonly deps: SprintOrchestratorDependencies) {}

  private getLoopStepSettings(): SprintLoopStepSettings {
    return {
      ...DEFAULT_STEP_SETTINGS,
      ...this.deps.getDashboardSettings().sprintLoopSteps,
    };
  }

  private getCiIntelligenceSettings(): CiIntelligenceSettings {
    return {
      ...DEFAULT_CI_SETTINGS,
      ...this.deps.getDashboardSettings().ciIntelligence,
    };
  }

  private async renderInstruction(
    templateId: InstructionTemplateId,
    variables: Record<string, unknown>,
    repoPath?: string
  ): Promise<string> {
    return await this.deps.renderInstruction(templateId, variables, repoPath);
  }

  private async renderBranchBlocker(
    args: SprintAgentArgs,
    defaultFeatureBranch: string,
    existsLocal: boolean,
    existsRemote: boolean
  ): Promise<string> {
    const createBranchStep = !existsLocal
      ? `**Step 1:** Create the branch locally:\n\`\`\`bash\ngit checkout -b ${defaultFeatureBranch}\n\`\`\`\n\n`
      : "";
    const pushBranchStep = !existsRemote
      ? `**Step ${!existsLocal ? "2" : "1"}:** Push the branch to remote origin:\n\`\`\`bash\ngit push -u origin ${defaultFeatureBranch}\n\`\`\`\n\n`
      : "";

    return await this.renderInstruction(
      "branchMissing",
      {
        feature_branch: defaultFeatureBranch,
        action: args.action,
        create_branch_step: createBranchStep,
        push_branch_step: pushBranchStep,
      },
      args.repo_path
    );
  }

  private async renderPlanningBlocker(args: SprintAgentArgs, subtasksDir: string): Promise<string> {
    return await this.renderInstruction(
      "planningMissing",
      {
        subtasks_dir: subtasksDir,
      },
      args.repo_path
    );
  }

  private async runPlanningAction(args: SprintAgentArgs, subtasksDir: string): Promise<any> {
    try {
      await fs.access(subtasksDir);
      return { content: [{ type: "text", text: `Subtasks directory already exists: ${subtasksDir}.` }] };
    } catch {
      await fs.mkdir(subtasksDir, { recursive: true });

      let planningGuideBlock = "";
      try {
        const planningGuide = await this.deps.getGuideContent("sprint_agent_guide.md", args.repo_path);
        planningGuideBlock = `\n\n### Technical Operating Standard\n\n${planningGuide}\n`;
      } catch {
        // Guide is optional.
      }

      const text = await this.renderInstruction(
        "planningCreated",
        {
          sprint_number: args.sprint_number,
          subtasks_dir: subtasksDir,
          planning_guide_block: planningGuideBlock,
        },
        args.repo_path
      );

      return { content: [{ type: "text", text }] };
    }
  }

  private async runOrchestrationCycle(args: {
    action: "status" | "orchestrate";
    sprintNumber: number;
    repoPath: string;
    sourceId: string;
    defaultFeatureBranch: string;
    subtasksDir: string;
    retryFailed: boolean;
    loopSteps: SprintLoopStepSettings;
    ciIntelligence: CiIntelligenceSettings;
    githubMode: "REMOTE" | "LOCAL";
  }): Promise<SprintCycleResult & { awaitingMerge: Subtask[] }> {
    let subtasks: Subtask[] = [];

    if (args.loopSteps.loadSubtasks) {
      try {
        subtasks = await runLoadSubtasksStep(this.deps.loadSubtasks, args.subtasksDir);
      } catch {
        throw new Error(`Error loading subtasks from ${args.subtasksDir}.`);
      }
    }

    if (args.loopSteps.sessionSync && subtasks.length > 0) {
      const syncResult = await runSessionSyncStep(
        subtasks,
        {
          listSessions: this.deps.listSessions,
          resolveSessionName: this.deps.resolveSessionName,
          extractSessionId: this.deps.extractSessionId,
          fetchRecentActivities: this.deps.fetchRecentActivities,
          isActionRequiredState: this.deps.isActionRequiredState,
        },
        args.retryFailed
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
      const startResult = await runStartReadyTasksStep(subtasks, {
        action: args.action,
        maxFailures: this.deps.settings.maxFailures || 5,
        getConsecutiveFailures: this.deps.getConsecutiveFailures,
        setConsecutiveFailures: this.deps.setConsecutiveFailures,
        startTask: (task) =>
          this.deps.startTask(task, args.sourceId, args.defaultFeatureBranch, args.repoPath, args.sprintNumber),
        resolveSessionName: this.deps.resolveSessionName,
        extractSessionId: this.deps.extractSessionId,
      });
      subtasks = startResult.subtasks;
      reportText += startResult.reportText;
    }

    const protocolResult = await runProtocolStep(subtasks, {
      subtasksDir: args.subtasksDir,
      featureBranch: args.defaultFeatureBranch,
      githubMode: args.githubMode,
      ciIntelligence: args.ciIntelligence,
      enableMergeProtocol: args.loopSteps.mergeProtocol,
      enableActionRequiredProtocol: args.loopSteps.actionRequiredProtocol,
      isActionRequiredState: this.deps.isActionRequiredState,
      renderInstruction: (templateId, variables) => this.renderInstruction(templateId, variables, args.repoPath),
    });

    const statusTable = args.loopSteps.statusTable ? runStatusTableStep(subtasks) : "";

    return {
      subtasks,
      reportText,
      statusTable,
      instructions: protocolResult.instructions,
      awaitingMerge: protocolResult.awaitingMerge,
    };
  }

  async execute(args: SprintAgentArgs): Promise<any> {
    const sprintsDir = path.join(args.repo_path, ".jules-subagents", "sprints");
    const subtasksDir = path.join(sprintsDir, `sprint${args.sprint_number}-subtasks`);
    const defaultFeatureBranch = args.feature_branch || `feature/sprint${args.sprint_number}-implementation`;
    const defaultBranch = typeof this.deps.settings.defaultBranch === "string" && this.deps.settings.defaultBranch.trim().length > 0
      ? this.deps.settings.defaultBranch
      : "main";
    const githubMode = this.deps.settings.githubMode === "LOCAL" ? "LOCAL" : "REMOTE";
    const retryFailed = args.retry_failed !== false;
    const loopSteps = this.getLoopStepSettings();
    const ciIntelligence = this.getCiIntelligenceSettings();

    const enabledProviders = Object.entries(this.deps.getDashboardSettings().aiProvider.providers)
      .filter(([, provider]) => provider.enabled)
      .map(([provider]) => provider);
    if (enabledProviders.length === 0 && args.action !== "plan") {
      const text = [
        "### Provider Setup Required",
        "",
        "No AI providers are enabled in dashboard settings.",
        "Enable at least one provider in the AI Provider section, then retry orchestration.",
        "",
        "Tip: You can still run `sprint_agent(action: \"plan\")` before enabling providers.",
      ].join("\n");
      return { content: [{ type: "text", text }] };
    }

    if (loopSteps.branchPreflight && (args.action === "plan" || args.action === "orchestrate")) {
      const { existsLocal, existsRemote } = runBranchPreflightStep(args.repo_path, defaultFeatureBranch);
      if (!existsLocal || !existsRemote) {
        const branchBlocker = await this.renderBranchBlocker(args, defaultFeatureBranch, existsLocal, existsRemote);
        return { content: [{ type: "text", text: branchBlocker }] };
      }
    }

    if (loopSteps.planningPreflight && (args.action === "orchestrate" || args.action === "status")) {
      const hasSubtasks = await runPlanningPreflightStep(subtasksDir);
      if (!hasSubtasks) {
        const planningBlocker = await this.renderPlanningBlocker(args, subtasksDir);
        return { content: [{ type: "text", text: planningBlocker }] };
      }
    }

    if (this.deps.completedSprints.has(args.sprint_number)) {
      return { content: [{ type: "text", text: `Sprint ${args.sprint_number} has already been finished in this session.` }] };
    }

    if (args.action === "plan") {
      return await this.runPlanningAction(args, subtasksDir);
    }

    const shouldWait = args.wait !== undefined ? args.wait : (args.action === "status" || args.action === "orchestrate");
    const watchEnabled = shouldWait && loopSteps.watchLoop;
    const watchLoopIntervalMs = Math.max(1, loopSteps.watchLoopIntervalSeconds) * 1000;

    if (watchEnabled) {
      let allFinished = false;
      const dashboardPort = this.deps.settings.dashboardPort || this.deps.dashboardPort;
      let fullReport = await this.renderInstruction(
        "watchHeader",
        {
          sprint_number: args.sprint_number,
          feature_branch: defaultFeatureBranch,
          dashboard_port: dashboardPort,
        },
        args.repo_path
      );
      fullReport += "\n";

      console.error(`Starting watch loop for Sprint ${args.sprint_number}...`);
      console.error(`Live dashboard available at http://localhost:${dashboardPort}`);

      while (!allFinished) {
        const { subtasks, reportText, statusTable, instructions, awaitingMerge } = await this.runOrchestrationCycle({
          action: args.action,
          sprintNumber: args.sprint_number,
          repoPath: args.repo_path,
          sourceId: args.source_id,
          defaultFeatureBranch,
          subtasksDir,
          retryFailed,
          loopSteps,
          ciIntelligence,
          githubMode,
        });

        const timestamp = new Date().toLocaleTimeString();
        this.deps.updateLastStatus({
          sprint_number: args.sprint_number,
          repo_path: args.repo_path,
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

        if (allFinished) {
          fullReport += reportText;
          fullReport += statusTable;
          fullReport += instructions;

          if (needsManualMerge) {
            fullReport += await this.renderInstruction("watchMergeRequired", {}, args.repo_path);
          } else if (subtasks.length > 0 && !allTerminal && noMoreActionPossible) {
            fullReport += await this.renderInstruction("watchNoMoreActions", {}, args.repo_path);
          }

          try {
            const watchGuide = await this.deps.getGuideContent("watch.md", args.repo_path);
            fullReport += `\n---\n\n### Watch Loop Operating Standard\n\n${watchGuide}`;
          } catch {
            // Guide is optional.
          }

          if (subtasks.length > 0 && subtasks.every((task) => task.status === "COMPLETED" && task.is_merged)) {
            try {
              this.deps.completedSprints.add(args.sprint_number);
              await fs.rm(subtasksDir, { recursive: true, force: true });
              fullReport += await this.renderInstruction("cleanupAllMerged", { subtasks_dir: subtasksDir }, args.repo_path);
              fullReport += await runCompletionStep({
                defaultBranch,
                featureBranch: defaultFeatureBranch,
                sprintNumber: args.sprint_number,
                githubMode,
                ciIntelligence,
                renderInstruction: (templateId, variables) => this.renderInstruction(templateId, variables, args.repo_path),
              });
            } catch (cleanupError) {
              console.error(`Warning: Failed to cleanup subtasks: ${cleanupError}`);
            }
          } else if (subtasks.some((task) => task.status === "FAILED")) {
            fullReport += await this.renderInstruction("cleanupFailed", { subtasks_dir: subtasksDir }, args.repo_path);
          } else if (subtasks.some((task) => task.status === "COMPLETED" && !task.is_merged)) {
            fullReport += await this.renderInstruction("cleanupDeferred", {}, args.repo_path);
          } else if (subtasks.length === 0) {
            fullReport += await this.renderInstruction("cleanupEmpty", {}, args.repo_path);
          }

          fullReport += "\n✅ **Sprint Execution Finished.**\n";
        } else {
          await new Promise((resolve) => setTimeout(resolve, watchLoopIntervalMs));
        }
      }

      return { content: [{ type: "text", text: fullReport }] };
    }

    const { subtasks, reportText, statusTable, instructions } = await this.runOrchestrationCycle({
      action: args.action,
      sprintNumber: args.sprint_number,
      repoPath: args.repo_path,
      sourceId: args.source_id,
      defaultFeatureBranch,
      subtasksDir,
      retryFailed,
      loopSteps,
      ciIntelligence,
      githubMode,
    });

    const dashboardPort = this.deps.settings.dashboardPort || this.deps.dashboardPort;
    let report = `### Sprint ${args.sprint_number} Orchestration Report\n\n`;
    report += `**Feature Branch:** \`${defaultFeatureBranch}\`\n`;
    report += `**Dashboard:** [http://localhost:${dashboardPort}](http://localhost:${dashboardPort})\n\n`;

    if (shouldWait && !loopSteps.watchLoop) {
      report += "⚙️ **Watch Loop Disabled:** Running a single orchestration cycle because watch mode is disabled in settings.\n\n";
    }

    report += reportText;
    report += statusTable;
    report += instructions;

    try {
      const orchGuide = await this.deps.getGuideContent("orchestrator.md", args.repo_path);
      report += `\n---\n\n### Orchestration Guidance\n\n${orchGuide}`;
    } catch {
      // Guide is optional.
    }

    this.deps.updateLastStatus({
      sprint_number: args.sprint_number,
      repo_path: args.repo_path,
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

export type { SprintAgentArgs } from "./sprint/types.js";
