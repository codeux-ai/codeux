import { randomUUID } from "crypto";
import type { InstructionTemplateId } from "../instructions/instruction-template-catalog.js";
import {
  DEFAULT_AUTOMATION_INTERVENTIONS_SETTINGS,
  DEFAULT_CI_INTELLIGENCE_SETTINGS,
  DEFAULT_SPRINT_LOOP_STEP_SETTINGS,
} from "./sprint-orchestrator-defaults.js";
import { prepareBranchForOrchestration, runBranchPreflightStep } from "./steps/branch-preflight-step.js";
import type { SprintAgentArgs } from "./sprint-types.js";
import type {
  AutomationInterventionsSettings,
  CiIntelligenceSettings,
  DashboardSettings,
  DashboardSettingsScope,
  GitTrackingStatus,
  JulesSession,
  Settings,
  SprintLoopStepSettings,
  Subtask,
  AutoMergeFeaturePrResult,
} from "../contracts/app-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { SprintExecutionStateService } from "../services/sprint-execution-state-service.js";
import type { StartSprintDispatchResult } from "../services/sprint-task-dispatch-service.js";
import type { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import { CycleRunner } from "../domain/sprint/orchestrator/cycle-runner.js";
import { WatchLoopRunner } from "../domain/sprint/orchestrator/watch-loop-runner.js";
import { SprintActionRunner } from "../domain/sprint/orchestrator/sprint-action-runner.js";
import type { Logger } from "../shared/logging/logger.js";
import { MainMergeGateService, type MergeFeedbackResult } from "../domain/sprint/ci/main-merge-gate.js";
import type { ResolvePullRequestResult } from "../services/git-status-service.js";

const SPRINT_ORCHESTRATOR_OWNER_KEY = "sprint_orchestrator";

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
  projectAttentionService: ProjectAttentionService;
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
  updateLastStatus: (status: any) => void;
  getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings;
  isJulesApiConfigured: () => boolean;
  approveSessionPlan: (sessionId: string) => Promise<unknown>;
  sendSessionMessage: (sessionId: string, prompt: string) => Promise<unknown>;
  generateWorkerClarificationReply?: (args: {
    projectId: string;
    sprintGoal: string;
    subtasks: Subtask[];
    task: Subtask;
  }) => Promise<string>;
  getCiStatusForScope?: (args: {
    repoPath: string;
    scope: "FEATURE_PR_CI" | "MAIN_MERGE_PR_CI";
    featureBranch: string;
    defaultBranch: string;
    featureBranchPrefix: string;
    cacheTtlMs?: number;
  }) => Promise<GitTrackingStatus | null>;
  autoMergeFeaturePr?: (args: { repoPath: string; prNumber: number }) => Promise<AutoMergeFeaturePrResult>;
  resolveOrCreateMainBranchPr?: (args: {
    repoPath: string;
    featureBranch: string;
    defaultBranch: string;
    title: string;
    body: string;
  }) => Promise<ResolvePullRequestResult | null>;
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

  private getLoopStepSettings(dashboardSettings: DashboardSettings): SprintLoopStepSettings {
    return {
      ...DEFAULT_SPRINT_LOOP_STEP_SETTINGS,
      ...dashboardSettings.sprintLoopSteps,
    };
  }

  private getCiIntelligenceSettings(dashboardSettings: DashboardSettings): CiIntelligenceSettings {
    return {
      ...DEFAULT_CI_INTELLIGENCE_SETTINGS,
      ...dashboardSettings.ciIntelligence,
    };
  }

  private getAutomationInterventionsSettings(dashboardSettings: DashboardSettings): AutomationInterventionsSettings {
    return {
      ...DEFAULT_AUTOMATION_INTERVENTIONS_SETTINGS,
      ...dashboardSettings.automationInterventions,
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
    const text = await this.renderInstruction(
      "planningCreated",
      {
        sprint_number: args.sprint_number ?? "selected",
        planning_target: planningTarget,
        planning_guide_block: "",
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
    sprintNumber?: number;
    sprintName?: string;
    ciIntelligence: CiIntelligenceSettings;
    githubMode: "REMOTE" | "LOCAL";
  }): Promise<MergeFeedbackResult> {
    if (!this.deps.getCiStatusForScope) {
      return {
        text: "",
        state: "unavailable",
        prNumber: null,
        prUrl: null,
        hasMergeConflict: false,
        mergeStateStatus: null,
        hasFailedChecks: false,
        hasPendingChecks: false,
        hasReviewBlockers: false,
        failedChecks: [],
      };
    }

    let gitStatus = await this.deps.getCiStatusForScope({
      repoPath: args.repoPath,
      scope: "MAIN_MERGE_PR_CI",
      featureBranch: args.featureBranch,
      defaultBranch: args.defaultBranch,
      featureBranchPrefix: args.featureBranchPrefix,
    });

    let createdPrNote = "";
    let feedback = MainMergeGateService.evaluateMergeFeedback({
      ...args,
      gitStatus,
      autoMergeMainBranchPr: this.deps.autoMergeFeaturePr,
    });
    if (
      feedback.state === "missing_pr"
      && args.githubMode === "REMOTE"
      && args.ciIntelligence.enabled
      && args.ciIntelligence.enableLivePrMonitoring
      && args.ciIntelligence.mainBranchAutoMergeMode !== "OFF"
      && this.deps.resolveOrCreateMainBranchPr
    ) {
      const pr = await this.deps.resolveOrCreateMainBranchPr({
        repoPath: args.repoPath,
        featureBranch: args.featureBranch,
        defaultBranch: args.defaultBranch,
        title: resolveMainBranchPrTitle(args),
        body: resolveMainBranchPrBody(args),
      });
      if (pr?.prUrl || pr?.prNumber) {
        createdPrNote = `\n🤖 **Main PR ${pr.created ? "Created" : "Resolved"}:** ${formatMainPrReference(pr, args.featureBranch, args.defaultBranch)}\n`;
        gitStatus = await this.deps.getCiStatusForScope({
          repoPath: args.repoPath,
          scope: "MAIN_MERGE_PR_CI",
          featureBranch: args.featureBranch,
          defaultBranch: args.defaultBranch,
          featureBranchPrefix: args.featureBranchPrefix,
        });
        feedback = MainMergeGateService.evaluateMergeFeedback({
          ...args,
          gitStatus,
          autoMergeMainBranchPr: this.deps.autoMergeFeaturePr,
        });
      }
    }
    const result = await MainMergeGateService.attemptMainAutoMerge(feedback, {
      ...args,
      gitStatus,
      autoMergeMainBranchPr: this.deps.autoMergeFeaturePr,
    });
    return createdPrNote
      ? {
          ...result,
          text: `${createdPrNote}${result.text}`,
        }
      : result;
  }

  private recordBlockedSprintRun(args: {
    action: SprintAgentArgs["action"];
    projectId: string;
    sprintId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): void {
    if (args.action !== "orchestrate") {
      return;
    }
    const sprintRun = this.deps.executionRepository.createSprintRun({
      projectId: args.projectId,
      sprintId: args.sprintId,
      triggerType: "mcp",
      triggeredBy: SPRINT_ORCHESTRATOR_OWNER_KEY,
      executorMode: "mixed",
      status: "paused",
    });
    const now = new Date().toISOString();
    this.deps.executionRepository.updateSprintRun(sprintRun.id, {
      status: "paused",
      startedAt: now,
      finishedAt: now,
      lastHeartbeatAt: now,
    });
    this.deps.executionRepository.appendSprintRunEvent(sprintRun.id, args.eventType, "system", args.payload, {
      sourceEventKey: `${args.eventType}:${args.sprintId}:${JSON.stringify(args.payload)}`,
    });
  }

  async execute(args: SprintAgentArgs): Promise<any> {
    const fallbackDashboardSettings = this.deps.getDashboardSettings();
    const initialExecutionContext = this.deps.sprintExecutionStateService.resolveContext(args, fallbackDashboardSettings);
    const dashboardSettings = this.deps.getDashboardSettings({
      projectId: initialExecutionContext.project.id,
      sprintId: initialExecutionContext.sprint.id,
    });
    const executionContext = this.deps.sprintExecutionStateService.resolveContext(args, dashboardSettings);
    const repoPath = executionContext.repoPath;
    const planningTarget = `${executionContext.project.name} / ${executionContext.sprint.name}`;
    const sprintScopeKey = `${executionContext.project.id}:${executionContext.sprint.id}`;
    const defaultFeatureBranch = executionContext.featureBranch;
    const defaultBranch = executionContext.defaultBranch;
    const githubMode = this.deps.settings.githubMode === "LOCAL" ? "LOCAL" : "REMOTE";
    const retryFailed = args.retry_failed !== false;
    const loopSteps = this.getLoopStepSettings(dashboardSettings);
    const ciIntelligence = this.getCiIntelligenceSettings(dashboardSettings);
    const automationLevel = dashboardSettings.automationLevel;
    const automationInterventions = this.getAutomationInterventionsSettings(dashboardSettings);
    const featureBranchPrefix = dashboardSettings.git.featureBranchPrefix;

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
      const branchAvailability = args.action === "orchestrate"
        ? await prepareBranchForOrchestration(repoPath, defaultFeatureBranch, defaultBranch)
        : await runBranchPreflightStep(repoPath, defaultFeatureBranch);
      const { existsLocal, existsRemote } = branchAvailability;
      const requiresRemoteBranch = args.action === "plan"
        || ("hasRemoteOrigin" in branchAvailability && branchAvailability.hasRemoteOrigin);
      if (!existsLocal || !existsRemote) {
        if (args.action === "orchestrate" && existsLocal && !requiresRemoteBranch) {
          this.deps.logger.info("Continuing sprint orchestration without a remote feature branch because no origin remote is configured.", {
            projectId: executionContext.project.id,
            sprintId: executionContext.sprint.id,
            repoPath,
            featureBranch: defaultFeatureBranch,
          });
        } else {
        const branchBlocker = await this.renderBranchBlocker(args, repoPath, defaultFeatureBranch, existsLocal, existsRemote);
        this.recordBlockedSprintRun({
          action: args.action,
          projectId: executionContext.project.id,
          sprintId: executionContext.sprint.id,
          eventType: "branch_preflight_blocked",
          payload: {
            featureBranch: defaultFeatureBranch,
            existsLocal,
            existsRemote,
          },
        });
        return { content: [{ type: "text", text: branchBlocker }] };
        }
      }
    }

    if (loopSteps.planningPreflight && (args.action === "orchestrate" || args.action === "status")) {
      const hasPlannedTasks = this.deps.sprintExecutionStateService.hasPlannedTasks(
        executionContext.project.id,
        executionContext.sprint.id,
      );
      if (!hasPlannedTasks) {
        const planningBlocker = await this.renderPlanningBlocker(planningTarget, repoPath);
        this.recordBlockedSprintRun({
          action: args.action,
          projectId: executionContext.project.id,
          sprintId: executionContext.sprint.id,
          eventType: "planning_preflight_blocked",
          payload: {
            planningTarget,
          },
        });
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
          featureBranchPrefix,
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
        const blockingRun = this.deps.executionRepository.findActiveSprintRun(
          executionContext.project.id,
          executionContext.sprint.id,
        );
        if (blockingRun) {
          const finalizedCancelledRun = blockingRun.status === "cancel_requested"
            ? this.deps.executionRepository.finalizeSprintRunCancellationIfIdle(blockingRun.id)
            : null;
          const effectiveBlockingRun = finalizedCancelledRun?.status === "cancelled"
            ? null
            : blockingRun.status === "running" || blockingRun.status === "queued" || blockingRun.status === "cancel_requested"
              ? blockingRun
              : null;

          if (effectiveBlockingRun) {
            const blockingReason = effectiveBlockingRun.status === "cancel_requested"
              ? "cancellation is still pending"
              : "another run is already active";
            return {
              content: [{
                type: "text",
                text: `Sprint ${executionContext.sprintNumber} cannot start because ${blockingReason}. Active sprint run: \`${effectiveBlockingRun.id}\` (${effectiveBlockingRun.status}).`,
              }],
            };
          }
        }

        this.deps.executionRepository.releaseStaleSprintLease(
          executionContext.project.id,
          executionContext.sprint.id,
        );

        const leaseToken = randomUUID();
        try {
          this.deps.executionRepository.acquireLease({
            scopeType: "sprint",
            scopeId: executionContext.sprint.id,
            ownerKey: SPRINT_ORCHESTRATOR_OWNER_KEY,
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
          triggeredBy: SPRINT_ORCHESTRATOR_OWNER_KEY,
          executorMode: "mixed",
          status: "running",
        });
        this.deps.executionRepository.updateSprintRun(sprintRun.id, {
          status: "running",
          startedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
        });

        try {
          try {
            return await this.actionRunner.runOrchestrate({
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
              shouldWait,
              watchLoopEnabled,
              sprintRunId: sprintRun.id,
              leaseToken,
            });
          } catch (error) {
            const failedAt = new Date().toISOString();
            const message = error instanceof Error ? error.message : String(error);
            this.deps.executionRepository.updateSprintRun(sprintRun.id, {
              status: "failed",
              finishedAt: failedAt,
              lastHeartbeatAt: failedAt,
            });
            this.deps.executionRepository.appendSprintRunEvent(sprintRun.id, "sprint_failed", "system", {
              reason: "orchestrator_exception",
              errorMessage: message,
            }, {
              sourceEventKey: `orchestrator-error:${sprintRun.id}:${message}`,
            });
            throw error;
          }
        } finally {
          this.deps.executionRepository.releaseLease("sprint", executionContext.sprint.id, leaseToken);
        }
      }
    }
  }
}

function resolveMainBranchPrTitle(args: {
  featureBranch: string;
  defaultBranch: string;
  sprintNumber?: number;
  sprintName?: string;
}): string {
  if (typeof args.sprintNumber === "number" && Number.isFinite(args.sprintNumber)) {
    return `Sprint ${args.sprintNumber}: merge ${args.featureBranch} into ${args.defaultBranch}`;
  }
  if (typeof args.sprintName === "string" && args.sprintName.trim().length > 0) {
    return `${args.sprintName.trim()}: merge ${args.featureBranch} into ${args.defaultBranch}`;
  }
  return `Merge ${args.featureBranch} into ${args.defaultBranch}`;
}

function resolveMainBranchPrBody(args: {
  featureBranch: string;
  defaultBranch: string;
  sprintNumber?: number;
  sprintName?: string;
}): string {
  const scopeLine = typeof args.sprintNumber === "number" && Number.isFinite(args.sprintNumber)
    ? `Sprint: ${args.sprintNumber}`
    : typeof args.sprintName === "string" && args.sprintName.trim().length > 0
      ? `Sprint: ${args.sprintName.trim()}`
      : "Sprint: not recorded";
  return [
    "Automated sprint completion PR opened by Sprint OS.",
    "",
    scopeLine,
    `Base: \`${args.defaultBranch}\``,
    `Head: \`${args.featureBranch}\``,
  ].join("\n");
}

function formatMainPrReference(
  pr: ResolvePullRequestResult,
  featureBranch: string,
  defaultBranch: string,
): string {
  const numberPart = pr.prNumber ? `PR #${pr.prNumber}` : "PR";
  const linkPart = pr.prUrl ? ` (${pr.prUrl})` : "";
  return `${numberPart}${linkPart} for \`${featureBranch} -> ${defaultBranch}\`.`;
}

export type { SprintAgentArgs } from "./sprint-types.js";
