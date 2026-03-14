import type { AppConfig } from "../config/app-config.js";
import type {
  DashboardSettings,
  JulesActivity,
  JulesSession,
  Subtask,
  Settings,
  GitTrackingStatus,
  DashboardStatus,
  GetCiStatusForScopeArgs,
  AutoMergeFeaturePrArgs,
  PersistTaskMergedFlagArgs,
} from "../contracts/app-types.js";
import { createCoreDependencies, type CoreDependencies } from "./dependency-factory/core-factory.js";
import { createSprintDependencies, type SprintDependencies } from "./dependency-factory/sprint-factory.js";
import { createMcpDependencies, type McpDependencies } from "./dependency-factory/mcp-factory.js";
import { createDashboardDependencies, type DashboardDependencies } from "./dependency-factory/dashboard-factory.js";
import type { RuntimeContext } from "./runtime-context.js";

export interface RuntimeDependencies extends CoreDependencies, SprintDependencies, McpDependencies, DashboardDependencies {}

export interface ServerContext {
  runtimeContext: RuntimeContext;
  getProjectRoot: () => string;
  getAppConfig: () => AppConfig;
  getEffectiveJulesApiKey: () => string | undefined;
  getEffectiveGithubToken: () => string | undefined;
  getDashboardPort: () => number;
  isJulesApiConfigured: () => boolean;
  getMissingJulesApiKeyInstruction: () => string;
  isActionRequiredState: (state?: string) => boolean;
  resolveSessionName: (session: Partial<JulesSession>) => string | undefined;
  extractSessionId: (session: Partial<JulesSession>) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>;
  listSessionsForSync: () => Promise<{ sessions?: JulesSession[] }>;
  getCiStatusForScope: (args: GetCiStatusForScopeArgs) => Promise<GitTrackingStatus | null>;
  autoMergeFeaturePr: (args: AutoMergeFeaturePrArgs) => Promise<{ ok: boolean; message?: string }>;
  resolveSessionNameFromTask: (task: Subtask) => string | undefined;
  resolveGitStatusRepoPath: () => string;
  fetchGitStatusForRepo: (repoPath: string, cacheTtlMs?: number) => Promise<GitTrackingStatus>;
  invalidateGitStatusCache?: (repoPath: string) => void;
  persistTaskMergedFlag: (args: PersistTaskMergedFlagArgs) => Promise<void>;
  normalizeName: (type: string, id: string) => string;
  isTrackedCliSession: (sessionId: string) => boolean;
}

export function createRuntimeDependencies(
  options: { projectRoot: string; appConfig: AppConfig },
  context: ServerContext
): RuntimeDependencies {
  const coreDeps = createCoreDependencies(options, context);
  const sprintDeps = createSprintDependencies(options, context, coreDeps);
  const mcpDeps = createMcpDependencies(context, coreDeps, sprintDeps);
  const dashDeps = createDashboardDependencies(context, coreDeps, sprintDeps);

  return { ...coreDeps, ...sprintDeps, ...mcpDeps, ...dashDeps };
}
