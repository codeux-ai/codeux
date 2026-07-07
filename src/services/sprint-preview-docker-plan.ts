import { CONTAINER_SETUP_SCRIPT } from "./cli-workflow-utils.js";
import {
  DOCKER_BRIDGE_NETWORK_ARGS,
  DOCKER_NO_NEW_PRIVILEGES_ARGS,
  toDockerMountArg,
} from "./cli-docker-utils.js";
import type { SprintPreviewPortMapping } from "../contracts/app-types.js";

export const CONTAINER_PREVIEW_PROXY_PORT = 39000;
export const CONTAINER_PREVIEW_RUNTIME_ROOT = "/code-ux-preview-runtime";
export const PREVIEW_LOG_DRIVER = "local";

export interface SprintPreviewDockerPlanArgs {
  projectId: string;
  sprintId: string;
  sessionId: string;
  containerName: string;
  hostPort: number;
  containerAppPort: number;
  portMappings?: SprintPreviewPortMapping[];
  containerWorkspacePath: string;
  containerRuntimeHome: string;
  volumeName: string;
  userSpec: string | null;
  setupScriptSource: string | null;
  shouldRunSetupScriptAtRuntime: boolean;
  containerGitUserName: string;
  containerGitUserEmail: string;
  credentialMounts: { type?: "bind" | "volume"; source: string; destination: string; readonly: boolean }[];
  effectiveInstallCommand: string | null;
  buildCommand: string | null;
  runCommand: string | null;
  /**
   * Commit SHA of the exported preview source. Passed to the container so the startup
   * script can skip the build when the branch hasn't changed since the last cached build.
   */
  sourceCommit: string | null;
  envFileSource?: string | null;
  resolvedImage: string;
  bootstrapScript: string;
}

export function buildSprintPreviewDockerCreateArgs(args: SprintPreviewDockerPlanArgs): string[] {
  const portMappings = normalizeDockerPortMappings(args.portMappings, args.containerAppPort, args.hostPort);
  const primaryMapping = portMappings[0];
  const dockerArgs = [
    "create",
    "--name", args.containerName,
    "--log-driver", PREVIEW_LOG_DRIVER,
    ...DOCKER_BRIDGE_NETWORK_ARGS,
    ...DOCKER_NO_NEW_PRIVILEGES_ARGS,
    ...portMappings.flatMap((mapping, index) => [
      "-p",
      `127.0.0.1:${mapping.hostPort}:${index === 0 ? CONTAINER_PREVIEW_PROXY_PORT : mapping.containerPort}`,
    ]),
    "--workdir", args.containerWorkspacePath,
    "--label", "code-ux.managed=true",
    "--label", "code-ux.preview=true",
    "--label", `code-ux.project-id=${args.projectId}`,
    "--label", `code-ux.sprint-id=${args.sprintId}`,
    "--label", `code-ux.session-id=${args.sessionId}`,
    "--label", `code-ux.host-port=${primaryMapping.hostPort}`,
    "--label", `code-ux.port-mappings=${portMappings.map((mapping) => `${mapping.containerPort}:${mapping.hostPort}`).join(",")}`,
    "--mount", toDockerMountArg({ type: "volume", source: args.volumeName, destination: CONTAINER_PREVIEW_RUNTIME_ROOT, readonly: false }),
    "-e", `HOME=${args.containerRuntimeHome}`,
    "-e", "HOST=0.0.0.0",
    "-e", `PORT=${primaryMapping.containerPort}`,
    "-e", "DASHBOARD_HOST=0.0.0.0",
    "-e", `DASHBOARD_PORT=${primaryMapping.containerPort}`,
    "-e", `SPRINT_PREVIEW_PORT=${primaryMapping.containerPort}`,
    "-e", `SPRINT_PREVIEW_PRIMARY_CONTAINER_PORT=${primaryMapping.containerPort}`,
    "-e", `SPRINT_PREVIEW_PRIMARY_HOST_PORT=${primaryMapping.hostPort}`,
    "-e", `SPRINT_PREVIEW_CONTAINER_PORTS=${portMappings.map((mapping) => mapping.containerPort).join(",")}`,
    "-e", `SPRINT_PREVIEW_HOST_PORTS=${portMappings.map((mapping) => mapping.hostPort).join(",")}`,
    "-e", `SPRINT_PREVIEW_PORT_MAPPINGS=${portMappings.map((mapping) => `${mapping.containerPort}:${mapping.hostPort}`).join(",")}`,
    "-e", `SPRINT_PREVIEW_PROXY_PORT=${CONTAINER_PREVIEW_PROXY_PORT}`,
    "-e", `SPRINT_PREVIEW_WORKSPACE=${args.containerWorkspacePath}`,
    "-e", `SPRINT_PREVIEW_WORKTREE=${args.containerWorkspacePath}`,
    "-e", `SPRINT_PREVIEW_INSTALL_COMMAND=${args.effectiveInstallCommand || ""}`,
    "-e", `SPRINT_PREVIEW_BUILD_COMMAND=${args.buildCommand || ""}`,
    "-e", `SPRINT_PREVIEW_RUN_COMMAND=${args.runCommand || ""}`,
    "-e", `SPRINT_PREVIEW_SOURCE_COMMIT=${args.sourceCommit || ""}`,
  ];

  if (args.envFileSource) {
    dockerArgs.push("--env-file", args.envFileSource);
  }

  if (args.userSpec) {
    dockerArgs.push("--user", args.userSpec);
  }

  if (args.setupScriptSource && args.shouldRunSetupScriptAtRuntime) {
    dockerArgs.push("--mount", toDockerMountArg({ source: args.setupScriptSource, destination: CONTAINER_SETUP_SCRIPT, readonly: true }));
  }

  dockerArgs.push(
    "-e", `CODE_UX_GIT_USER_NAME=${args.containerGitUserName}`,
    "-e", `CODE_UX_GIT_USER_EMAIL=${args.containerGitUserEmail}`,
  );

  for (const mount of args.credentialMounts) {
    dockerArgs.push("--mount", toDockerMountArg(mount));
  }

  const containerStartScript = [
    `mkdir -p "${args.containerWorkspacePath}"`,
    `tar -xf /tmp/workspace.tar -C "${args.containerWorkspacePath}"`,
    `exec bash /tmp/preview-start.sh`,
  ].join(" && ");

  dockerArgs.push(
    args.resolvedImage,
    "bash",
    "-c",
    args.bootstrapScript,
    "preview-runner",
    "bash",
    "-c",
    containerStartScript,
  );

  return dockerArgs;
}

function normalizeDockerPortMappings(
  portMappings: SprintPreviewPortMapping[] | undefined,
  containerAppPort: number,
  hostPort: number,
): Array<{ containerPort: number; hostPort: number }> {
  const normalized = (portMappings ?? [])
    .filter((mapping) =>
      Number.isInteger(mapping.containerPort)
      && mapping.containerPort >= 1
      && mapping.containerPort <= 65535
      && Number.isInteger(mapping.hostPort)
      && mapping.hostPort !== null
      && mapping.hostPort >= 1
      && mapping.hostPort <= 65535
    )
    .map((mapping) => ({
      containerPort: mapping.containerPort,
      hostPort: mapping.hostPort as number,
    }));

  return normalized.length > 0
    ? normalized
    : [{ containerPort: containerAppPort, hostPort }];
}
