import type { CliWorkflowSettings, DashboardSettings, ProviderId, Subtask } from "../../../contracts/app-types.js";
import type { IWorkspaceManager } from "../../../infrastructure/providers/cli/workspace-manager.js";
import type { IPrService } from "../../../infrastructure/providers/cli/pr-service.js";
import type { IProviderRunner } from "../../../infrastructure/providers/cli/provider-runner.js";
import type { SessionTrackingRepository } from "../../../repositories/session-tracking-repository.js";
import type { Logger } from "../../../shared/logging/logger.js";
import type { CommandResult } from "../../cli-process-runner.js";

export interface PipelineContextDeps {
  sessionTracking: SessionTrackingRepository;
  getDashboardSettings: () => DashboardSettings;
  getGuideContent: (guideName: string, repoPath?: string) => Promise<string>;
  getGithubToken: () => string | undefined;
  logger?: Logger;
}

export interface PipelineContext {
  sessionId: string;
  workerBranch: string;
  featureBranch: string;
  task: Subtask;
  provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
  title: string;
  repoPath: string;
  worktreePath: string;
  workflowSettings: CliWorkflowSettings;
  settings: DashboardSettings;
  initialHead: string;
  workflowSucceeded: boolean;

  workspaceManager: IWorkspaceManager;
  prService: IPrService;
  providerRunner: IProviderRunner;
  deps: PipelineContextDeps;
  runCommand: (command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
}
