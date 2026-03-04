import * as fs from "fs/promises";
import * as path from "path";
import type { InstructionTemplateId } from "../instructions/instruction-template-catalog.js";
import {
  DEFAULT_AUTOMATION_INTERVENTIONS_SETTINGS,
  DEFAULT_CI_INTELLIGENCE_SETTINGS,
  DEFAULT_SPRINT_LOOP_STEP_SETTINGS,
} from "./sprint-orchestrator-defaults.js";
import { runBranchPreflightStep } from "./steps/branch-preflight-step.js";
import { runPlanningPreflightStep } from "./steps/planning-preflight-step.js";
import {
  isCiCheckFailed,
  isCiCheckPending,
} from "./ci-status-utils.js";
import type { SprintAgentArgs } from "./sprint-types.js";
import type {
  AutomationInterventionsSettings,
  AutomationLevel,
  CiIntelligenceSettings,
  DashboardSettings,
  GitTrackingStatus,
  JulesSession,
  Settings,
  SprintLoopStepSettings,
  Subtask,
} from "../contracts/app-types.js";
import { CycleRunner } from "../domain/sprint/orchestrator/cycle-runner.js";
import { WatchLoopRunner } from "../domain/sprint/orchestrator/watch-loop-runner.js";

export interface SprintOrchestratorDependencies {
  settings: Settings;
  dashboardPort: number;
  getDashboardPort?: () => number;
  completedSprints: Set<number>;
  getConsecutiveFailures: () => number;
  setConsecutiveFailures: (value: number) => void;
  isActionRequiredState: (state?: string) => boolean;
  resolveSessionName: (session: Partial<JulesSession>) => string | undefined;
  extractSessionId: (session: Partial<JulesSession>) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<any[]>;
  listSessions: () => Promise<{ sessions?: JulesSession[] }>;
  loadSubtasks: (dir: string) => Promise<Subtask[]>;
  startTask: (task: Subtask, sourceId: string | undefined, baseBranch: string, repoPath: string, sprintNumber: number) => Promise<JulesSession>;
  getGuideContent: (guideName: string, repoPath?: string) => Promise<string>;
  updateLastStatus: (status: any) => void;
  getDashboardSettings: () => DashboardSettings;
  isJulesApiConfigured: () => boolean;
  approveSessionPlan: (sessionId: string) => Promise<unknown>;
  sendSessionMessage: (sessionId: string, prompt: string) => Promise<unknown>;
  getCiStatusForScope?: (args: {
    repoPath: string;
    scope: "FEATURE_PR_CI" | "MAIN_MERGE_PR_CI";
    featureBranch: string;
    defaultBranch: string;
    featureBranchPrefix: string;
  }) => Promise<GitTrackingStatus | null>;
  autoMergeFeaturePr?: (args: { repoPath: string; prNumber: number }) => Promise<{ ok: boolean; message?: string }>;
  renderInstruction: (templateId: InstructionTemplateId, variables: Record<string, unknown>, repoPath?: string) => Promise<string>;
}

export class SprintOrchestrator {
  private readonly cycleRunner: CycleRunner;
  private readonly watchLoopRunner: WatchLoopRunner;

  constructor(private readonly deps: SprintOrchestratorDependencies) {
    this.cycleRunner = new CycleRunner(deps);
    this.watchLoopRunner = new WatchLoopRunner(
      deps,
      this.cycleRunner,
      this.renderMainMergeCiFeedback.bind(this)
    );
  }

  private getDashboardPort(): number {
    return this.deps.getDashboardPort?.() || this.deps.settings.dashboardPort || this.deps.dashboardPort;
  }

  private getLoopStepSettings(): SprintLoopStepSettings {
    return {
      ...DEFAULT_SPRINT_LOOP_STEP_SETTINGS,
      ...this.deps.getDashboardSettings().sprintLoopSteps,
    };
  }

  private getCiIntelligenceSettings(): CiIntelligenceSettings {
    return {
      ...DEFAULT_CI_INTELLIGENCE_SETTINGS,
      ...this.deps.getDashboardSettings().ciIntelligence,
    };
  }

  private getAutomationInterventionsSettings(): AutomationInterventionsSettings {
    return {
      ...DEFAULT_AUTOMATION_INTERVENTIONS_SETTINGS,
      ...this.deps.getDashboardSettings().automationInterventions,
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
    args: Pick<SprintAgentArgs, "action">,
    repoPath: string,
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
      repoPath
    );
  }

  private async renderPlanningBlocker(subtasksDir: string, repoPath: string): Promise<string> {
    return await this.renderInstruction(
      "planningMissing",
      {
        subtasks_dir: subtasksDir,
      },
      repoPath
    );
  }

  private async runPlanningAction(args: SprintAgentArgs, subtasksDir: string, repoPath: string): Promise<any> {
    try {
      await fs.access(subtasksDir);
      return { content: [{ type: "text", text: `Subtasks directory already exists: ${subtasksDir}.` }] };
    } catch {
      await fs.mkdir(subtasksDir, { recursive: true });

      let planningGuideBlock = "";
      try {
        const planningGuide = await this.deps.getGuideContent("sprint_agent_guide.md", repoPath);
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
        repoPath
      );

      return { content: [{ type: "text", text }] };
    }
  }

  private async renderMainMergeCiFeedback(args: {
    repoPath: string;
    featureBranch: string;
    defaultBranch: string;
    featureBranchPrefix: string;
    ciIntelligence: CiIntelligenceSettings;
    githubMode: "REMOTE" | "LOCAL";
  }): Promise<string> {
    if (
      !args.ciIntelligence.enabled ||
      !args.ciIntelligence.enableLivePrMonitoring ||
      !args.ciIntelligence.waitForCiBeforeMainMerge ||
      args.githubMode !== "REMOTE" ||
      !this.deps.getCiStatusForScope
    ) {
      return "";
    }

    const gitStatus = await this.deps.getCiStatusForScope({
      repoPath: args.repoPath,
      scope: "MAIN_MERGE_PR_CI",
      featureBranch: args.featureBranch,
      defaultBranch: args.defaultBranch,
      featureBranchPrefix: args.featureBranchPrefix,
    });

    if (!gitStatus?.available) {
      return "";
    }

    const mainMergePr = gitStatus.openPullRequests.find(
      (pr) => pr.baseRefName === args.defaultBranch && pr.headRefName === args.featureBranch
    );
    if (!mainMergePr) {
      return `\nℹ️ **Main CI Gate:** No open PR \`${args.featureBranch} -> ${args.defaultBranch}\` found. Create the PR and wait for CI.\n`;
    }

    const checks = Array.isArray(mainMergePr.checks) ? mainMergePr.checks : [];
    const hasFailedChecks = checks.some((check) => isCiCheckFailed(check.status, check.conclusion));
    const hasPendingChecks = checks.length === 0 || checks.some((check) => isCiCheckPending(check.status, check.conclusion));
    const hasReviewBlockers = mainMergePr.reviewDecision === "CHANGES_REQUESTED" || mainMergePr.comments > 0;

    let text = `\n### Main Merge CI Gate\n`;
    text += `- PR: ${mainMergePr.url}\n`;
    text += `- Check Status: \`${hasFailedChecks ? "FAILED" : hasPendingChecks ? "PENDING" : "SUCCESS"}\`\n`;
    text += `- Review Status: \`reviewDecision=${mainMergePr.reviewDecision || "NONE"}\`, comments=${mainMergePr.comments}\n`;
    text += `- Check live: \`gh pr checks ${mainMergePr.number} --watch\`\n`;

    if (hasFailedChecks) {
      const failedChecks = checks
        .filter((check) => isCiCheckFailed(check.status, check.conclusion))
        .map((check) => check.name);
      text += `- Failed checks: ${failedChecks.join(", ")}\n`;
      text += `- Logs: \`gh run list --branch ${args.featureBranch} --event pull_request --limit 5\` and \`gh run view <run-id> --log-failed\`\n`;
      text += `- Only approve merge into \`${args.defaultBranch}\` after checks are green.\n`;
    } else if (hasPendingChecks) {
      text += `- Only approve merge into \`${args.defaultBranch}\` once all required checks are green.\n`;
    } else if (hasReviewBlockers) {
      text += `- Merge into \`${args.defaultBranch}\` is blocked until open reviews/comments are resolved.\n`;
    } else {
      text += `- ✅ Required checks are green. Main merge can be approved (verify reviews/comments).\n`;
    }

    if (hasReviewBlockers) {
      text += `- Review comments: \`gh pr view ${mainMergePr.number} --comments\`\n`;
      text += `- Inline reviews: \`gh api repos/{owner}/{repo}/pulls/${mainMergePr.number}/comments\`\n`;
    }

    return `${text}\n`;
  }

  async execute(args: SprintAgentArgs): Promise<any> {
    const repoPath = typeof args.repo_path === "string" && args.repo_path.trim().length > 0 ? args.repo_path : process.cwd();
    const sprintsDir = path.join(repoPath, ".jules-subagents", "sprints");
    const subtasksDir = path.join(sprintsDir, `sprint${args.sprint_number}-subtasks`);
    const defaultFeatureBranch = args.feature_branch || `feature/sprint${args.sprint_number}-implementation`;
    const defaultBranch = typeof this.deps.settings.defaultBranch === "string" && this.deps.settings.defaultBranch.trim().length > 0
      ? this.deps.settings.defaultBranch
      : "main";
    const githubMode = this.deps.settings.githubMode === "LOCAL" ? "LOCAL" : "REMOTE";
    const retryFailed = args.retry_failed !== false;
    const loopSteps = this.getLoopStepSettings();
    const ciIntelligence = this.getCiIntelligenceSettings();
    const automationLevel = this.deps.getDashboardSettings().automationLevel;
    const automationInterventions = this.getAutomationInterventionsSettings();

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
      const { existsLocal, existsRemote } = runBranchPreflightStep(repoPath, defaultFeatureBranch);
      if (!existsLocal || !existsRemote) {
        const branchBlocker = await this.renderBranchBlocker(args, repoPath, defaultFeatureBranch, existsLocal, existsRemote);
        return { content: [{ type: "text", text: branchBlocker }] };
      }
    }

    if (loopSteps.planningPreflight && (args.action === "orchestrate" || args.action === "status")) {
      const hasSubtasks = await runPlanningPreflightStep(subtasksDir);
      if (!hasSubtasks) {
        const planningBlocker = await this.renderPlanningBlocker(subtasksDir, repoPath);
        return { content: [{ type: "text", text: planningBlocker }] };
      }
    }

    if (this.deps.completedSprints.has(args.sprint_number)) {
      return { content: [{ type: "text", text: `Sprint ${args.sprint_number} has already been finished in this session.` }] };
    }

    if (args.action === "plan") {
      return await this.runPlanningAction(args, subtasksDir, repoPath);
    }

    const supportsWatchMode = args.action === "orchestrate";
    const requestedWait = args.wait !== undefined ? args.wait : supportsWatchMode;
    const shouldWait = supportsWatchMode && requestedWait;
    const watchEnabled = shouldWait && loopSteps.watchLoop;
    const dashboardPort = this.getDashboardPort();

    if (watchEnabled) {
      const fullReport = await this.watchLoopRunner.run({
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
      });
      return { content: [{ type: "text", text: fullReport }] };
    }

    const { subtasks, reportText, statusTable, instructions } = await this.cycleRunner.run({
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

    let report = `### Sprint ${args.sprint_number} Orchestration Report\n\n`;
    report += `**Feature Branch:** \`${defaultFeatureBranch}\`\n`;
    report += `**Dashboard:** [http://localhost:${dashboardPort}](http://localhost:${dashboardPort})\n\n`;

    if (args.action === "status" && args.wait) {
      report += "ℹ️ **Status Action is Instant:** Ignoring `wait: true` and returning a single-cycle status report.\n\n";
    } else if (shouldWait && !loopSteps.watchLoop) {
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

export type { SprintAgentArgs } from "./sprint-types.js";
