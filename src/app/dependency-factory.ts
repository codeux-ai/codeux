import type { AppConfig } from "../config/app-config.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { McpApprovalTracker } from "../services/mcp-approval-tracker.js";
import type {
  DashboardSettings,
  JulesActivity,
  JulesSession,
  Subtask,
  Settings,
  GitTrackingStatus,
  DashboardStatus,
  GetCiStatusForScopeArgs,
  GitOperations,
  ConfigurationProvider,
  SessionManager,
  EnvironmentResolver,
} from "../contracts/app-types.js";
import { createCoreDependencies, type CoreDependencies } from "./dependency-factory/core-factory.js";
import { createSprintDependencies, type SprintDependencies } from "./dependency-factory/sprint-factory.js";
import { createMcpDependencies, type McpDependencies } from "./dependency-factory/mcp-factory.js";
import { createDashboardDependencies, type DashboardDependencies } from "./dependency-factory/dashboard-factory.js";
import type { RuntimeContext } from "./runtime-context.js";

export interface RuntimeDependencies extends CoreDependencies, SprintDependencies, McpDependencies, DashboardDependencies, GitOperations, ConfigurationProvider, SessionManager, EnvironmentResolver {}

export interface ServerContext extends GitOperations, ConfigurationProvider, SessionManager, EnvironmentResolver {}

export function createRuntimeDependencies(
  options: { projectRoot: string; appConfig: AppConfig },
  context: ServerContext
): RuntimeDependencies {
  const coreDeps = createCoreDependencies(options, context);
  const sprintDeps = createSprintDependencies(options, context, coreDeps);
  const dashDeps = createDashboardDependencies(context, coreDeps, sprintDeps);
  const mcpDeps = createMcpDependencies(context, coreDeps, sprintDeps, dashDeps);

  return { ...coreDeps, ...sprintDeps, ...mcpDeps, ...dashDeps, ...context };
}
