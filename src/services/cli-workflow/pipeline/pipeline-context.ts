import type { CliWorkflowSettings, DashboardSettings, ProviderId, Subtask, ThinkingMode } from "../../../contracts/app-types.js";
import type { IWorkspaceManager } from "../../../infrastructure/providers/cli/workspace-manager.js";
import type { IPrService } from "../../../infrastructure/providers/cli/pr-service.js";
import type { IProviderRunner } from "../../../infrastructure/providers/cli/provider-runner.js";
import type { WorkspaceArtifactService } from "../../../infrastructure/providers/cli/workspace-artifact-service.js";
import type { ExecutionRepository } from "../../../repositories/execution-repository.js";
import type { SessionTrackingRepository } from "../../../repositories/session-tracking-repository.js";
import type { ProjectManagementRepository } from "../../../repositories/project-management-repository.js";
import type { MemoryService } from "../../memory-service.js";
import type { Logger } from "../../../shared/logging/logger.js";
import type { CommandResult } from "../../cli-process-runner.js";

export interface PipelineContextDeps {
  sessionTracking: SessionTrackingRepository;
  executionRepository?: ExecutionRepository;
  projectManagementRepository?: ProjectManagementRepository;
  memoryService?: MemoryService;
  getDashboardSettings: () => DashboardSettings;
  getWorkerInstruction: (repoPath: string) => Promise<string>;
  getGithubToken: () => string | undefined;
  logger?: Logger;
}

export interface PipelineContext {
  sessionId: string;
  taskRunId?: string;
  workerBranch: string;
  featureBranch: string;
  task: Subtask;
  provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
  providerSettingsOverride?: {
    model: string;
    thinkingMode: ThinkingMode;
    apiKey: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
  };
  title: string;
  repoPath: string;
  worktreePath: string;
  workspaceSessionId: string;
  abortSignal?: AbortSignal;
  workflowSettings: CliWorkflowSettings;
  settings: DashboardSettings;
  initialHead: string;
  workflowSucceeded: boolean;
  preserveSuccessfulWorktree?: boolean;
  /** Worker agent preset ID for per-agent memory tagging. */
  agentPresetId?: string;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;

  workspaceManager: IWorkspaceManager;
  workspaceArtifactService: WorkspaceArtifactService;
  prService: IPrService;
  providerRunner: IProviderRunner;
  deps: PipelineContextDeps;
  runCommand: (command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
}
