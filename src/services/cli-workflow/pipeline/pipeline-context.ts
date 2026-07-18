import type { ProviderSettingsOverride } from "../../provider-settings-override.js";
import type { CliWorkflowSettings, DashboardSettings, DashboardSettingsScope, ProviderId, QwenModelProviderSettings, Subtask, ThinkingMode } from "../../../contracts/app-types.js";
import type { AgentMemoryConfig, AgentMcpAccessConfig } from "../../../contracts/agent-preset-types.js";
import type { IWorkspaceManager } from "../../../infrastructure/providers/cli/workspace-manager.js";
import type { InvocationWorkspacePreparer } from "../../../infrastructure/providers/cli/invocation-workspace-preparer.js";
import type { IPrService } from "../../../infrastructure/providers/cli/pr-service.js";
import type { IProviderRunner } from "../../../infrastructure/providers/cli/provider-runner.js";
import type { WorkspaceArtifactService } from "../../../infrastructure/providers/cli/workspace-artifact-service.js";
import type { ExecutionRepository } from "../../../repositories/execution-repository.js";
import type { SessionTrackingRepository } from "../../../repositories/session-tracking-repository.js";
import type { ProjectManagementRepository } from "../../../repositories/project-management-repository.js";
import type { MemoryService } from "../../memory-service.js";
import type { SkillService } from "../../skill-service.js";
import type { ProviderConcurrencyService } from "../../provider-concurrency-service.js";
import type { Logger } from "../../../shared/logging/logger.js";
import type { CommandResult } from "../../cli-process-runner.js";
import type { AgentPresetRepository } from "../../../repositories/agent-preset-repository.js";
import type { McpConnectionInfo } from "../../../contracts/mcp-connection-types.js";
import type { TaskSelfReflectionRatingRepository } from "../../../repositories/task-self-reflection-rating-repository.js";
import type { TaskCodingClarificationContext } from "../../../domain/sprint/task-execution-outcome.js";

export interface PipelineContextDeps {
  sessionTracking: SessionTrackingRepository;
  executionRepository?: ExecutionRepository;
  projectManagementRepository?: ProjectManagementRepository;
  memoryService?: MemoryService;
  taskSelfReflectionRatingRepository?: TaskSelfReflectionRatingRepository;
  skillService?: SkillService;
  agentPresetRepository?: AgentPresetRepository;
  providerConcurrencyService?: ProviderConcurrencyService;
  getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings;
  getWorkerInstruction: (repoPath: string) => Promise<string>;
  getGithubToken: () => string | undefined;
  getMcpConnectionInfo?: () => McpConnectionInfo | null;
  logger?: Logger;
}

export interface PipelineContext {
  sessionId: string;
  taskRunId?: string;
  workerBranch: string;
  featureBranch: string;
  task: Subtask;
  provider: Exclude<ProviderId, "jules">;
  providerSettingsOverride?: ProviderSettingsOverride;
  title: string;
  repoPath: string;
  worktreePath: string;
  workspaceSessionId: string;
  /** Whether this invocation intentionally continues an already allocated worker branch. */
  allowExistingWorkerBranch: boolean;
  /** Fail rather than replacing a missing native conversation during a clarification continuation. */
  requireProviderSessionResume?: boolean;
  /**
   * Proof that a fresh HOST invocation atomically created and owns the local worker branch.
   * Fresh remote publication still requires the origin ref to be absent.
   */
  freshWorkerBranchOwnership?: {
    worktreePath: string;
    initialTip: string;
  };
  abortSignal?: AbortSignal;
  /** Durable execution invocation created before workspace preparation begins. */
  executionInvocationId?: string;
  workflowSettings: CliWorkflowSettings;
  settings: DashboardSettings;
  initialHead: string;
  workflowSucceeded: boolean;
  preserveSuccessfulWorktree?: boolean;
  preserveSuccessfulWorktreeForActiveSprint?: boolean;
  /** Keep the exact provider workspace available until a pending manager clarification continues. */
  preserveWorkspaceForClarification?: boolean;
  /** Worker agent preset ID for per-agent memory tagging. */
  agentPresetId?: string;
  /** Per-agent memory injection config. Undefined means use defaults (inject all). */
  agentMemoryConfig?: AgentMemoryConfig;
  /**
   * Per-agent MCP access config for the resolved worker agent. `undefined` means the run is
   * not agent-scoped (no MCP filtering); `null` means an agent exists but was never configured.
   */
  agentMcpAccess?: AgentMcpAccessConfig | null;
  /** Durable project/task/runtime identifiers supplied to request_clarification guidance. */
  taskClarificationContext?: TaskCodingClarificationContext;
  memoryTemplateOverrideEnabled?: boolean;
  memoryTemplateMarkdown?: string;

  workspaceManager: IWorkspaceManager;
  invocationWorkspacePreparer: InvocationWorkspacePreparer;
  workspaceArtifactService: WorkspaceArtifactService;
  prService: IPrService;
  providerRunner: IProviderRunner;
  deps: PipelineContextDeps;
  runCommand: (command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
}
