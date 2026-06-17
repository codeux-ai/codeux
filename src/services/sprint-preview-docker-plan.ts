import { CONTAINER_SETUP_SCRIPT } from "./cli-workflow-utils.js";
import { pickContainerEnv, toDockerMountArg } from "./cli-docker-utils.js";

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
  resolvedImage: string;
  bootstrapScript: string;
}

export function buildSprintPreviewDockerCreateArgs(args: SprintPreviewDockerPlanArgs): string[] {
  const dockerArgs = [
    "create",
    "--name", args.containerName,
    "--log-driver", PREVIEW_LOG_DRIVER,
    "-p", `127.0.0.1:${args.hostPort}:${CONTAINER_PREVIEW_PROXY_PORT}`,
    "--workdir", args.containerWorkspacePath,
    "--label", "code-ux.preview=true",
    "--label", `code-ux.project-id=${args.projectId}`,
    "--label", `code-ux.sprint-id=${args.sprintId}`,
    "--label", `code-ux.session-id=${args.sessionId}`,
    "--label", `code-ux.host-port=${args.hostPort}`,
    "--mount", toDockerMountArg({ type: "volume", source: args.volumeName, destination: CONTAINER_PREVIEW_RUNTIME_ROOT, readonly: false }),
    "-e", `HOME=${args.containerRuntimeHome}`,
    "-e", "HOST=0.0.0.0",
    "-e", `PORT=${args.containerAppPort}`,
    "-e", "DASHBOARD_HOST=0.0.0.0",
    "-e", `DASHBOARD_PORT=${args.containerAppPort}`,
    "-e", `SPRINT_PREVIEW_PORT=${args.containerAppPort}`,
    "-e", `SPRINT_PREVIEW_PROXY_PORT=${CONTAINER_PREVIEW_PROXY_PORT}`,
    "-e", `SPRINT_PREVIEW_WORKSPACE=${args.containerWorkspacePath}`,
    "-e", `SPRINT_PREVIEW_WORKTREE=${args.containerWorkspacePath}`,
    "-e", `SPRINT_PREVIEW_INSTALL_COMMAND=${args.effectiveInstallCommand || ""}`,
    "-e", `SPRINT_PREVIEW_BUILD_COMMAND=${args.buildCommand || ""}`,
    "-e", `SPRINT_PREVIEW_RUN_COMMAND=${args.runCommand || ""}`,
  ];

  if (args.userSpec) {
    dockerArgs.push("--user", args.userSpec);
  }

  if (args.setupScriptSource && args.shouldRunSetupScriptAtRuntime) {
    dockerArgs.push("--mount", toDockerMountArg({ source: args.setupScriptSource, destination: CONTAINER_SETUP_SCRIPT, readonly: true }));
  }

  for (const variable of pickContainerEnv(process.env)) {
    dockerArgs.push("-e", `${variable.key}=${variable.value}`);
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
