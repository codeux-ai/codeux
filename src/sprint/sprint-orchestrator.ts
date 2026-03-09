import { randomUUID } from "crypto";
import type { InstructionTemplateId } from "../instructions/instruction-template-catalog.js";
import {
  DEFAULT_AUTOMATION_INTERVENTIONS_SETTINGS,
  DEFAULT_CI_INTELLIGENCE_SETTINGS,
  DEFAULT_SPRINT_LOOP_STEP_SETTINGS,
} from "./sprint-orchestrator-defaults.js";
import { runBranchPreflightStep } from "./steps/branch-preflight-step.js";
import type { SprintAgentArgs } from "./sprint-types.js";
import type {
  AutomationInterventionsSettings,
  CiIntelligenceSettings,
  DashboardSettings,
  GitTrackingStatus,
  JulesSession,
  Settings,
  SprintLoopStepSettings,
  Subtask,
} from "../contracts/app-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { SprintExecutionStateService } from "../services/sprint-execution-state-service.js";
import type { StartSprintDispatchResult } from "../services/sprint-task-dispatch-service.js";
import { CycleRunner } from "../domain/sprint/orchestrator/cycle-runner.js";
import { WatchLoopRunner } from "../domain/sprint/orchestrator/watch-loop-runner.js";
import { SprintActionRunner } from "../domain/sprint/orchestrator/sprint-action-runner.js";
import type { Logger } from "../shared/logging/logger.js";
import { MainMergeGateService } from "../domain/sprint/ci/main-merge-gate.js";

export interface SprintOrchestratorDependencies {
  settings: Settings;
  dashboardPort: number;
  getDashboardPort?: () => number;
  completedSprints: Set<string>;
  getConsecutiveFailures: () => number;
  setConsecutiveFailures: (value: number) => void;
  isActionRequiredState: (state?: string) => boolean;
  resolveSessionName: (session: Partial<JulesSession>) => string | undefined;
  extractSessionId: (session: Partial<JulesSession>) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<any[]>;
  listSessions: () => Promise<{ sessions?: JulesSession[] }>;
  projectManagementRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  sprintExecutionStateService: SprintExecutionStateService;
  startTask: (
    task: Subtask,
    args: {
      projectId: string;
      sprintId: string;
      sprintRunId: string;
      sourceId?: string;
      featureBranch: string;
      repoPath: string;
      sprintNumber: number;
    },
  ) => Promise<StartSprintDispatchResult>;
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
  logger: Logger;
}

export class SprintOrchestrator {
  private readonly cycleRunner: CycleRunner;
  private readonly watchLoopRunner: WatchLoopRunner;
  private readonly actionRunner: SprintActionRunner;

  constructor(private readonly deps: SprintOrchestratorDependencies) {
    this.cycleRunner = new CycleRunner(deps);
    this.watchLoopRunner = new WatchLoopRunner(
      deps,
      this.cycleRunner,
      this.renderMainMergeCiFeedback.bind(this),
    );
    this.actionRunner = new SprintActionRunner(
      deps,
      this.cycleRunner,
      this.watchLoopRunner,
      this.runPlanningAction.bind(this),
    );
  }

  private getDashboardPort(): number {
    return this.deps.getDashboardPort?.() || (this.deps.settings.dashboardPort as number) || this.deps.dashboardPort;
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
    repoPath?: string,
  ): Promise<string> {
    return await this.deps.renderInstruction(templateId, variables, repoPath);
  }

  private async renderBranchBlocker(
    args: Pick<SprintAgentArgs, "action">,
    repoPath: string,
    defaultFeatureBranch: string,
    existsLocal: boolean,
    existsRemote: boolean,
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
      repoPath,
    );
  }

  private async renderPlanningBlocker(planningTarget: string, repoPath: string): Promise<string> {
    return await this.renderInstruction(
      "planningMissing",
      {
        planning_target: planningTarget,
      },
      repoPath,
    );
  }

  private async runPlanningAction(args: SprintAgentArgs, planningTarget: string, repoPath: string): Promise<any> {
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
        sprint_number: args.sprint_number ?? "selected",
        planning_target: planningTarget,
        planning_guide_block: planningGuideBlock,
      },
      repoPath,
    );

    return { content: [{ type: "text", text }] };
  }

  private async renderMainMergeCiFeedback(args: {
    repoPath: string;
    featureBranch: string;
    defaultBranch: string;
    featureBranchPrefix: string;
    ciIntelligence: CiIntelligenceSettings;
    githubMode: "REMOTE" | "LOCAL";
  }): Promise<string> {
    if (!this.deps.getCiStatusForScope) {
      return "";
    }

    const gitStatus = await this.deps.getCiStatusForScope({
      repoPath: args.repoPath,
      scope: "MAIN_MERGE_PR_CI",
      featureBranch: args.featureBranch,
      defaultBranch: args.defaultBranch,
      featureBranchPrefix: args.featureBranchPrefix,
    });

    return MainMergeGateService.renderMergeFeedback({
      ...args,
      gitStatus,
    });
  }

  async execute(args: SprintAgentArgs): Promise<any> {
    const dashboardSettings = this.deps.getDashboardSettings();
    const executionContext = this.deps.sprintExecutionStateService.resolveContext(args, dashboardSettings);
    const repoPath = executionContext.repoPath;
    const planningTarget = `${executionContext.project.name} / ${executionContext.sprint.name}`;
    const sprintScopeKey = `${executionContext.project.id}:${executionContext.sprint.id}`;
    const defaultFeatureBranch = executionContext.featureBranch;
    const defaultBranch = executionContext.defaultBranch;
    const githubMode = this.deps.settings.githubMode === "LOCAL" ? "LOCAL" : "REMOTE";
    const retryFailed = args.retry_failed !== false;
    const loopSteps = this.getLoopStepSettings();
    const ciIntelligence = this.getCiIntelligenceSettings();
    const automationLevel = dashboardSettings.automationLevel;
    const automationInterventions = this.getAutomationInterventionsSettings();

    const enabledProviders = Object.entries(dashboardSettings.aiProvider.providers)
      .filter(([, provider]) => provider.enabled)
      .map(([provider]) => provider);
    if (enabledProviders.length === 0 && args.action !== "plan") {
      const text = [
        "### Provider Setup Required",
        "",
        "No AI providers are enabled in dashboard settings.",
        "Enable at least one provider in the AI Provider section, then retry orchestration.",
        "",
        "Tip: Create or import sprint tasks in the dashboard before orchestration.",
      ].join("\n");
      return { content: [{ type: "text", text }] };
    }

    if (loopSteps.branchPreflight && (args.action === "plan" || args.action === "orchestrate")) {
      const { existsLocal, existsRemote } = await runBranchPreflightStep(repoPath, defaultFeatureBranch);
      if (!existsLocal || !existsRemote) {
        const branchBlocker = await this.renderBranchBlocker(args, repoPath, defaultFeatureBranch, existsLocal, existsRemote);
        return { content: [{ type: "text", text: branchBlocker }] };
      }
    }

    if (loopSteps.planningPreflight && (args.action === "orchestrate" || args.action === "status")) {
      const hasPlannedTasks = this.deps.sprintExecutionStateService.hasPlannedTasks(
        executionContext.project.id,
        executionContext.sprint.id,
      );
      if (!hasPlannedTasks) {
        const planningBlocker = await this.renderPlanningBlocker(planningTarget, repoPath);
        return { content: [{ type: "text", text: planningBlocker }] };
      }
    }

    if (
      this.deps.completedSprints.has(sprintScopeKey)
      || (typeof args.sprint_number === "number" && (this.deps.completedSprints as Set<unknown>).has(args.sprint_number))
    ) {
      return { content: [{ type: "text", text: `Sprint ${executionContext.sprintNumber} has already been finished in this session.` }] };
    }

    const dashboardPort = this.getDashboardPort();
    const supportsWatchMode = args.action === "orchestrate";
    const requestedWait = args.wait !== undefined ? args.wait : supportsWatchMode;
    const shouldWait = supportsWatchMode && requestedWait;
    const watchLoopEnabled = shouldWait && loopSteps.watchLoop;

    switch (args.action) {
      case "plan":
        return await this.actionRunner.runPlan(args, planningTarget, repoPath);
      case "status":
        return await this.actionRunner.runStatus({
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
          shouldWait,
          watchLoopEnabled,
        });
      case "orchestrate":
      default: {
        const leaseToken = randomUUID();
        try {
          this.deps.executionRepository.acquireLease({
            scopeType: "sprint",
            scopeId: executionContext.sprint.id,
            ownerKey: "sprint_agent",
            leaseToken,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          });
        } catch {
          const activeRun = this.deps.executionRepository.findActiveSprintRun(
            executionContext.project.id,
            executionContext.sprint.id,
          );
          const activeRunText = activeRun
            ? ` Active sprint run: \`${activeRun.id}\` (${activeRun.status}).`
            : "";
          return {
            content: [{
              type: "text",
              text: `Sprint ${executionContext.sprintNumber} is already being orchestrated for project ${executionContext.project.name}.${activeRunText}`,
            }],
          };
        }

        const sprintRun = this.deps.executionRepository.createSprintRun({
          projectId: executionContext.project.id,
          sprintId: executionContext.sprint.id,
          triggerType: "mcp",
          triggeredBy: "sprint_agent",
          executorMode: "mixed",
          status: "running",
        });
        this.deps.executionRepository.updateSprintRun(sprintRun.id, {
          status: "running",
          startedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
        });

        try {
          return await this.actionRunner.runOrchestrate({
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
            shouldWait,
            watchLoopEnabled,
            sprintRunId: sprintRun.id,
            leaseToken,
          });
        } finally {
          this.deps.executionRepository.releaseLease("sprint", executionContext.sprint.id, leaseToken);
        }
      }
    }
  }
}

export type { SprintAgentArgs } from "./sprint-types.js";
