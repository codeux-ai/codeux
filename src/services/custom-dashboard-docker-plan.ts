import { CONTAINER_SETUP_SCRIPT } from "./cli-workflow-utils.js";
import {
  DOCKER_BRIDGE_NETWORK_ARGS,
  DOCKER_NO_NEW_PRIVILEGES_ARGS,
  toDockerMountArg,
} from "./cli-docker-utils.js";

export const CUSTOM_DASHBOARD_VALIDATION_CONTAINER_PORT = 4173;
export const CUSTOM_DASHBOARD_VALIDATION_LOG_DRIVER = "local";
export const CUSTOM_DASHBOARD_VALIDATION_CONTAINER_WORKSPACE = "/code-ux-custom-dashboard/workspace";
export const CUSTOM_DASHBOARD_VALIDATION_CONTAINER_HOME = "/code-ux-custom-dashboard/home";
export const CUSTOM_DASHBOARD_VALIDATION_CONTAINER_NPM_PREFIX = "/code-ux-custom-dashboard/npm-global";
export const CUSTOM_DASHBOARD_VALIDATION_CONTAINER_NPM_CACHE = "/code-ux-custom-dashboard/npm-cache";

interface CustomDashboardValidationDockerBaseArgs {
  projectId: string;
  dashboardId: string;
  revisionId: string;
  sessionId: string;
  workspacePath: string;
  runtimeHomePath: string;
  hostPort?: number | null;
  containerName?: string;
  userSpec: string | null;
  setupScriptSource?: string | null;
  shouldRunSetupScriptAtRuntime: boolean;
  resolvedImage: string;
  bootstrapScript: string;
}

export interface CustomDashboardValidationDockerRunArgs extends CustomDashboardValidationDockerBaseArgs {
  command: string;
}

export interface CustomDashboardValidationDockerCreateArgs extends CustomDashboardValidationDockerBaseArgs {
  hostPort: number;
  containerName: string;
  startCommand: string;
}

export function buildCustomDashboardValidationDockerRunArgs(
  args: CustomDashboardValidationDockerRunArgs,
): string[] {
  const dockerArgs = [
    "run",
    "--rm",
    "--log-driver", CUSTOM_DASHBOARD_VALIDATION_LOG_DRIVER,
    ...DOCKER_BRIDGE_NETWORK_ARGS,
    ...DOCKER_NO_NEW_PRIVILEGES_ARGS,
    "--workdir", CUSTOM_DASHBOARD_VALIDATION_CONTAINER_WORKSPACE,
    "--label", "code-ux.managed=true",
    "--label", "code-ux.custom-dashboard-validation-build=true",
    "--label", `code-ux.project-id=${args.projectId}`,
    "--label", `code-ux.dashboard-id=${args.dashboardId}`,
    "--label", `code-ux.revision-id=${args.revisionId}`,
    "--label", `code-ux.session-id=${args.sessionId}`,
    "--mount", toDockerMountArg({
      source: args.workspacePath,
      destination: CUSTOM_DASHBOARD_VALIDATION_CONTAINER_WORKSPACE,
      readonly: false,
    }),
    "--mount", toDockerMountArg({
      source: args.runtimeHomePath,
      destination: CUSTOM_DASHBOARD_VALIDATION_CONTAINER_HOME,
      readonly: false,
    }),
    "-e", `HOME=${CUSTOM_DASHBOARD_VALIDATION_CONTAINER_HOME}`,
    "-e", `NPM_CONFIG_PREFIX=${CUSTOM_DASHBOARD_VALIDATION_CONTAINER_NPM_PREFIX}`,
    "-e", `NPM_CONFIG_CACHE=${CUSTOM_DASHBOARD_VALIDATION_CONTAINER_NPM_CACHE}`,
  ];

  appendCommonDockerArgs(dockerArgs, args);
  dockerArgs.push(
    args.resolvedImage,
    "bash",
    "-c",
    args.bootstrapScript,
    "dashboard-validator",
    "bash",
    "-lc",
    args.command,
  );
  return dockerArgs;
}

export function buildCustomDashboardValidationDockerCreateArgs(
  args: CustomDashboardValidationDockerCreateArgs,
): string[] {
  const dockerArgs = [
    "create",
    "--name", args.containerName,
    "--log-driver", CUSTOM_DASHBOARD_VALIDATION_LOG_DRIVER,
    ...DOCKER_BRIDGE_NETWORK_ARGS,
    ...DOCKER_NO_NEW_PRIVILEGES_ARGS,
    "-p", `127.0.0.1:${args.hostPort}:${CUSTOM_DASHBOARD_VALIDATION_CONTAINER_PORT}`,
    "--workdir", CUSTOM_DASHBOARD_VALIDATION_CONTAINER_WORKSPACE,
    "--label", "code-ux.managed=true",
    "--label", "code-ux.custom-dashboard-validation=true",
    "--label", `code-ux.project-id=${args.projectId}`,
    "--label", `code-ux.dashboard-id=${args.dashboardId}`,
    "--label", `code-ux.revision-id=${args.revisionId}`,
    "--label", `code-ux.session-id=${args.sessionId}`,
    "--label", `code-ux.host-port=${args.hostPort}`,
    "--mount", toDockerMountArg({
      source: args.workspacePath,
      destination: CUSTOM_DASHBOARD_VALIDATION_CONTAINER_WORKSPACE,
      readonly: false,
    }),
    "--mount", toDockerMountArg({
      source: args.runtimeHomePath,
      destination: CUSTOM_DASHBOARD_VALIDATION_CONTAINER_HOME,
      readonly: false,
    }),
    "-e", `HOME=${CUSTOM_DASHBOARD_VALIDATION_CONTAINER_HOME}`,
    "-e", "HOST=0.0.0.0",
    "-e", `PORT=${CUSTOM_DASHBOARD_VALIDATION_CONTAINER_PORT}`,
    "-e", `DASHBOARD_HOST=0.0.0.0`,
    "-e", `DASHBOARD_PORT=${CUSTOM_DASHBOARD_VALIDATION_CONTAINER_PORT}`,
  ];

  appendCommonDockerArgs(dockerArgs, args);
  dockerArgs.push(
    args.resolvedImage,
    "bash",
    "-c",
    args.bootstrapScript,
    "dashboard-validator",
    "bash",
    "-lc",
    args.startCommand,
  );
  return dockerArgs;
}

function appendCommonDockerArgs(
  dockerArgs: string[],
  args: CustomDashboardValidationDockerBaseArgs,
): void {
  if (args.userSpec) {
    dockerArgs.push("--user", args.userSpec);
  }

  if (args.setupScriptSource && args.shouldRunSetupScriptAtRuntime) {
    dockerArgs.push("--mount", toDockerMountArg({
      source: args.setupScriptSource,
      destination: CONTAINER_SETUP_SCRIPT,
      readonly: true,
    }));
  }
}
