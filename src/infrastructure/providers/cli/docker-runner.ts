import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as pathPosix from "path/posix";
import { fileURLToPath } from "url";
import { CliWorkflowSettings, type CustomMcpServer, type ProviderConfigMode } from "../../../contracts/app-types.js";
import { isUsableCustomMcpServer } from "../../../mcp/mcp-tool-availability.js";
import { buildProviderMcpConfigArtifact } from "./mcp-config-format.js";
import type { McpConnectionInfo } from "../../../contracts/mcp-connection-types.js";
import { CommandResult, runCommandStrict, runStreamingCommand } from "../../../services/cli-process-runner.js";
import {
  DOCKER_BRIDGE_NETWORK_ARGS,
  DOCKER_HOST_GATEWAY_ARGS,
  DOCKER_NO_NEW_PRIVILEGES_ARGS,
  getDockerUserSpec,
  mapPathPrefix,
  pickContainerEnv,
  resolveConfiguredPath,
  toDockerMountArg,
  writeDockerEnvFile,
  ContainerMount,
} from "../../../services/cli-docker-utils.js";
import { CONTAINER_SETUP_SCRIPT } from "../../../services/cli-workflow-utils.js";
import { DockerBootstrapBuilder } from "./docker-bootstrap-builder.js";
import { DockerCredentialMountBuilder } from "./docker-credential-mount-builder.js";
import { DockerSetupImageCache, type DockerSetupImageCacheProgress } from "./docker-setup-image-cache.js";
import { resolveDockerRuntimeRoot } from "./docker-runtime-paths.js";
import { buildRuntimeVolumeName, WorkspaceManager, type SnapshotCheckout } from "./workspace-manager.js";
import { InvocationWorkspacePreparer, type InvocationWorkspaceGitPolicy } from "./invocation-workspace-preparer.js";
import { workspaceVolumeHelperPool, type WorkspaceVolumeHelperPool } from "./workspace-volume-helper.js";
import { CONTAINER_RUNTIME_HOME, CONTAINER_WORKSPACE_ROOT } from "./provider-runtime-artifacts.js";
import type { CliProviderId } from "./provider-command-specs.js";
import { getHomeCodeUxPath, getRepoCodeUxPath } from "../../../shared/config/code-ux-paths.js";
import { ensureDefaultCodeUxAssetsInstalled } from "../../../services/code-ux-default-assets-service.js";
import { DEFAULT_PLAYWRIGHT_MCP_SERVER_ID } from "../../../repositories/settings-defaults.js";
import { sanitizeInvocationOutputText } from "../../../services/invocation-output-sanitizer.js";
import type { PersistentSkillStorageRuntimeMount } from "../../../services/skill-service.js";
import {
  GOOGLE_DRIVE_CONTAINER_TARGET,
  type GoogleDriveRuntimeMount,
} from "../../../services/google-drive-mount-service.js";
import type {
  ProviderTranscriptChunk,
  ProviderTranscriptCursor,
} from "./provider-transcript-chunks.js";
import { managedRuntimeService, type ManagedRuntimeService } from "../../../services/managed-runtime-service.js";
import {
  PROVIDER_TOOL_MOUNT,
  providerToolManager,
  type ProviderToolManager,
} from "../../../services/provider-tool-manager.js";
import {
  PLAYWRIGHT_BROWSERS_MOUNT,
  playwrightBrowserManager,
  type PlaywrightBrowserManager,
} from "../../../services/playwright-browser-manager.js";


const BUNDLED_CONTAINER_SETUP_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.code-ux/container/setup.sh",
);

const CONTAINER_PROVIDER_ARGV_FILE = "/opt/code-ux/provider-argv.sh";
const PROVIDER_CPU_SHARES = "768";
const LAUNCH_ARTIFACT_INVALID_PREFIX = "CODE_UX_LAUNCH_ARTIFACT_INVALID:";

type LaunchArtifactKind = "runtime-volume" | "provider-tool" | "playwright-browser" | "runtime-image";

export interface IDockerRunner {
  ensureWorkspace(args: {
    cwd: string;
    repoPath: string;
    sessionId: string;
    snapshotCheckout?: SnapshotCheckout;
    gitPolicy?: InvocationWorkspaceGitPolicy;
    preserve?: boolean;
    reuseExisting?: boolean;
  }): Promise<{ cwd: string; cleanup: () => Promise<void> }>;
  runProviderInDocker(args: {
    command: string;
    args: string[];
    cwd: string;
    providerEnv: NodeJS.ProcessEnv;
    sessionId: string;
    providerLabel: CliProviderId;
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
    providerConfigMode?: ProviderConfigMode;
    providerConfigPath?: string;
    signal?: AbortSignal;
    onActivity: (desc: string, originator?: string) => void;
    onSetupImageProgress?: (progress: DockerSetupImageCacheProgress) => void;
    mcpConnection?: McpConnectionInfo | null;
    customMcpServers?: CustomMcpServer[];
    persistentSkillStorageMounts?: PersistentSkillStorageRuntimeMount[];
    googleDriveMount?: GoogleDriveRuntimeMount;
  }): Promise<CommandResult>;
  readWorkspaceFile?(cwd: string, targetPath: string): Promise<string | null>;
  readWorkspaceFileBase64?(cwd: string, targetPath: string): Promise<string | null>;
  readLatestWorkspaceFile?(cwd: string, dirPath: string, glob?: string): Promise<string | null>;
  readWorkspaceFileChunk?(cwd: string, targetPath: string, cursor: ProviderTranscriptCursor, maxBytes?: number): Promise<ProviderTranscriptChunk | null>;
  readLatestWorkspaceFileChunk?(cwd: string, dirPath: string, glob: string, cursor: ProviderTranscriptCursor, maxBytes?: number): Promise<ProviderTranscriptChunk | null>;
  readWorkspaceFileMetadata?(cwd: string, targetPath: string): Promise<string | null>;
  readWorkspaceDirectoryMetadata?(cwd: string, dirPath: string, glob?: string): Promise<string | null>;
  readWorkspaceJsonArray?(cwd: string, dirPath: string): Promise<string | null>;
  removeWorkspaceDir?(cwd: string, dirPath: string): Promise<void>;
}

export class DockerRunner implements IDockerRunner {
  private readonly dockerHintLoggedSessions = new Set<string>();
  private readonly workspaceManager = new WorkspaceManager();
  private readonly invocationWorkspacePreparer = new InvocationWorkspacePreparer(this.workspaceManager);
  private readonly volumeHelperPool: WorkspaceVolumeHelperPool = workspaceVolumeHelperPool;

  constructor(
    private readonly runtimeService: ManagedRuntimeService = managedRuntimeService,
    private readonly toolManager: ProviderToolManager = providerToolManager,
    private readonly browserManager: PlaywrightBrowserManager = playwrightBrowserManager,
  ) {}

  async ensureWorkspace(args: {
    cwd: string;
    repoPath: string;
    sessionId: string;
    snapshotCheckout?: SnapshotCheckout;
    gitPolicy?: InvocationWorkspaceGitPolicy;
    preserve?: boolean;
    reuseExisting?: boolean;
  }): Promise<{ cwd: string; cleanup: () => Promise<void> }> {
    if (args.cwd.startsWith("docker-volume://")) {
      return {
        cwd: args.cwd,
        cleanup: async () => undefined,
      };
    }

    const workspaceRef = await this.invocationWorkspacePreparer.createSnapshotWorkspace({
      repoPath: args.repoPath,
      sessionId: args.sessionId,
      checkout: args.snapshotCheckout,
      reuseExisting: args.reuseExisting,
      gitPolicy: args.gitPolicy,
    });
    return {
      cwd: workspaceRef,
      cleanup: async () => {
        if (args.preserve) {
          return;
        }
        await this.workspaceManager.removeWorktree(args.repoPath, workspaceRef).catch(() => undefined);
      },
    };
  }

  async runProviderInDocker(input: {
    command: string;
    args: string[];
    cwd: string;
    providerEnv: NodeJS.ProcessEnv;
    sessionId: string;
    providerLabel: CliProviderId;
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
    providerConfigMode?: ProviderConfigMode;
    providerConfigPath?: string;
    signal?: AbortSignal;
    onActivity: (desc: string, originator?: string) => void;
    onSetupImageProgress?: (progress: DockerSetupImageCacheProgress) => void;
    mcpConnection?: McpConnectionInfo | null;
    customMcpServers?: CustomMcpServer[];
    persistentSkillStorageMounts?: PersistentSkillStorageRuntimeMount[];
    googleDriveMount?: GoogleDriveRuntimeMount;
  }): Promise<CommandResult> {
    const { command, args, cwd, providerEnv, sessionId, providerLabel, workflowSettings, repoPath, signal, onActivity } = input;
    const emitActivity = (desc: string, originator?: string): void => {
      onActivity(sanitizeInvocationOutputText(desc), originator);
    };
    const workspace = this.resolveWorkspace(cwd);
    const runAsRoot = workflowSettings.containerRunAsRoot === true;
    const userSpec = runAsRoot ? "" : await this.resolveDockerUserSpec(repoPath);
    const runtimeHome = CONTAINER_RUNTIME_HOME;
    const runtimeNpmPrefix = pathPosix.join(runtimeHome, ".npm-global");
    const runtimeNpmCache = pathPosix.join(runtimeHome, ".npm-cache");
    const runtimeVolumeName = buildRuntimeVolumeName(workspace.volumeName);
    const installPlaywrightBrowsers = workflowSettings.containerInstallPlaywrightBrowsers !== false;

    await this.maybeLogDockerPathMappingHint(sessionId, repoPath, emitActivity);

    const setupScriptPath = await this.resolveContainerSetupScriptPath(workflowSettings, repoPath, emitActivity);
    const runtimeRoot = resolveDockerRuntimeRoot(repoPath);
    let baseImage = await this.runtimeService.resolveImage(
      workflowSettings,
      installPlaywrightBrowsers ? "browser" : "base",
    );
    let [preparedTool, preparedBrowser] = await Promise.all([
      providerLabel === "mockup-cli"
        ? Promise.resolve(null)
        : this.toolManager.prepare(providerLabel, workflowSettings, { resolvedImage: baseImage }),
      installPlaywrightBrowsers && workflowSettings.containerImageMode !== "custom"
        ? this.browserManager.prepare(workflowSettings, { resolvedImage: baseImage })
        : Promise.resolve(null),
    ]);
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-docker-"));

    try {
      const resolvedImage = await new DockerSetupImageCache().resolveImage({
        baseImage,
        setupScriptPath,
        cacheEnabled: workflowSettings.containerCacheSetupScriptImage,
        installPlaywrightBrowsers: workflowSettings.containerImageMode === "custom" && installPlaywrightBrowsers,
        runtimeRoot,
        repoPath,
        signal,
        onActivity: emitActivity,
        onProgress: input.onSetupImageProgress,
        mapSourcePathForDaemon: (sourcePath, label) =>
          this.mapDockerSourcePathForDaemon(sourcePath, repoPath, sessionId, label, emitActivity),
      });

      const argvFilePath = path.join(tempRoot, "provider-argv.sh");
      await this.writeRestrictiveFile(argvFilePath, this.buildProviderArgvFile(args));
      const argvFileSource = this.mapDockerSourcePathForDaemon(argvFilePath, repoPath, sessionId, "provider argv", emitActivity);
      const envFilePath = path.join(tempRoot, "provider.env");
      await writeDockerEnvFile(envFilePath, pickContainerEnv(providerEnv));
      const envFileSource = this.mapDockerSourcePathForDaemon(envFilePath, repoPath, sessionId, "provider env", emitActivity);

      const containerName = this.buildContainerName(providerLabel, sessionId);

      const dockerArgs = [
        "run",
        "--rm",
        "-i",
        "--name",
        containerName,
        ...DOCKER_BRIDGE_NETWORK_ARGS,
        ...DOCKER_NO_NEW_PRIVILEGES_ARGS,
        "--cpu-shares",
        PROVIDER_CPU_SHARES,
        ...(workflowSettings.containerImageMode !== "custom" ? ["--pull", "never"] : []),
        "--workdir",
        CONTAINER_WORKSPACE_ROOT,
        "--label",
        "code-ux.managed=true",
        "--label",
        `code-ux.session-id=${sessionId}`,
        "--label",
        `code-ux.command=${command}`,
        "--label",
        `code-ux.args-count=${args.length}`,
        "--mount",
        toDockerMountArg({
          source: workspace.volumeName,
          destination: CONTAINER_WORKSPACE_ROOT,
          readonly: false,
          type: "volume",
        }),
        "--mount",
        toDockerMountArg({
          source: runtimeVolumeName,
          destination: runtimeHome,
          readonly: false,
          type: "volume",
        }),
        "-e",
        `HOME=${runtimeHome}`,
        "-e",
        `CODE_UX_PROVIDER_ARGV_FILE=${CONTAINER_PROVIDER_ARGV_FILE}`,
        "--env-file",
        envFileSource,
        "--mount",
        toDockerMountArg({
          source: argvFileSource,
          destination: CONTAINER_PROVIDER_ARGV_FILE,
          readonly: true,
        }),
      ];

      const applicableCustomMcpServers = this.customServersForProvider(input.customMcpServers || [], providerLabel)
        .filter((server) => installPlaywrightBrowsers || server.id !== DEFAULT_PLAYWRIGHT_MCP_SERVER_ID);
      if (
        this.shouldAddDockerHostGateway(workflowSettings, input.mcpConnection || null, applicableCustomMcpServers)
        || this.providerEnvUsesDockerHostGateway(workflowSettings, providerEnv)
      ) {
        dockerArgs.push(...DOCKER_HOST_GATEWAY_ARGS);
      }

      if (!runAsRoot && userSpec) {
        dockerArgs.push("--user", userSpec);
        const passwdPath = path.join(tempRoot, "passwd");
        const [uid, gid] = userSpec.split(":");
        const passwdContent = [
          "root:x:0:0:root:/root:/bin/bash",
          "nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin",
          `worker:x:${uid}:${gid}::${runtimeHome}:/bin/bash`,
          "",
        ].join("\n");
        await fs.writeFile(passwdPath, passwdContent, "utf8");
        const passwdSource = this.mapDockerSourcePathForDaemon(passwdPath, repoPath, sessionId, "passwd", emitActivity);
        dockerArgs.push("--mount", toDockerMountArg({ source: passwdSource, destination: "/etc/passwd", readonly: true }));
      }

      dockerArgs.push(
        "-e", `CODE_UX_GIT_USER_NAME=${workflowSettings.containerGitUserName}`,
        "-e", `CODE_UX_GIT_USER_EMAIL=${workflowSettings.containerGitUserEmail}`,
        "-e", `CODE_UX_INSTALL_PLAYWRIGHT=${installPlaywrightBrowsers ? "1" : "0"}`,
        "-e", "DISABLE_AUTOUPDATER=1",
        "-e", "OPENCODE_DISABLE_AUTOUPDATE=true",
        "-e", "AGY_CLI_DISABLE_AUTO_UPDATE=true",
      );

      if (preparedTool) {
        dockerArgs.push(
          "--mount",
          toDockerMountArg({
            source: preparedTool.volumeName,
            destination: PROVIDER_TOOL_MOUNT,
            readonly: true,
            type: "volume",
          }),
          "-e",
          `CODE_UX_PROVIDER_TOOL_BIN=${PROVIDER_TOOL_MOUNT}/bin`,
        );
      }

      if (preparedBrowser) {
        dockerArgs.push(
          "--mount",
          toDockerMountArg({
            source: preparedBrowser.volumeName,
            destination: PLAYWRIGHT_BROWSERS_MOUNT,
            readonly: true,
            type: "volume",
          }),
          "-e",
          `PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_MOUNT}`,
        );
      }

      const memoryLimitMb = this.resolveContainerMemoryLimitMb(workflowSettings.containerMemoryLimitMb);
      if (memoryLimitMb > 0) {
        dockerArgs.push("--memory", `${memoryLimitMb}m`, "--memory-swap", `${memoryLimitMb}m`);
      }

      if (setupScriptPath && resolvedImage.runSetupScriptAtRuntime) {
        const setupScriptSource = this.mapDockerSourcePathForDaemon(setupScriptPath, repoPath, sessionId, "setup script", emitActivity);
        dockerArgs.push("--mount", toDockerMountArg({ source: setupScriptSource, destination: CONTAINER_SETUP_SCRIPT, readonly: true }));
      }

      const credentialMounts = await new DockerCredentialMountBuilder().build(
        workflowSettings,
        repoPath,
        emitActivity,
        {
          provider: providerLabel,
          enabled: Boolean(input.providerMountAuth),
          path: input.providerAuthPath || "",
        },
        {
          provider: providerLabel,
          mode: input.providerConfigMode || "copyHost",
          path: input.providerConfigPath || "",
        },
      );
      const providerConfigMounts = await this.buildProviderConfigMounts(
        input.mcpConnection || null,
        providerLabel,
        tempRoot,
        providerEnv,
        applicableCustomMcpServers,
        workflowSettings,
        true,
      );

      for (const mount of [...credentialMounts, ...providerConfigMounts]) {
        const source = this.mapDockerSourcePathForDaemon(mount.source, repoPath, sessionId, "credentials", emitActivity);
        dockerArgs.push("--mount", toDockerMountArg({ ...mount, source }));
      }

      for (const mount of input.persistentSkillStorageMounts || []) {
        const source = this.mapDockerSourcePathForDaemon(mount.hostPath, repoPath, sessionId, "persistent skill storage", emitActivity);
        dockerArgs.push("--mount", toDockerMountArg({
          source,
          destination: mount.containerPath,
          readonly: true,
        }));
      }

      if (input.googleDriveMount) {
        const source = this.mapDockerSourcePathForDaemon(
          input.googleDriveMount.source,
          repoPath,
          sessionId,
          "Google Drive",
          emitActivity,
        );
        dockerArgs.push("--mount", toDockerMountArg({
          source,
          destination: GOOGLE_DRIVE_CONTAINER_TARGET,
          readonly: input.googleDriveMount.readonly,
        }));
      }

      const bootstrapScript = [
        this.buildLaunchArtifactValidation({
          runtimeOwner: runAsRoot ? null : userSpec || null,
          providerBinary: preparedTool ? `${PROVIDER_TOOL_MOUNT}/bin/${preparedTool.binary}` : null,
          browserMounted: Boolean(preparedBrowser),
        }),
        new DockerBootstrapBuilder().build({
          runtimeNpmPrefix,
          runtimeNpmCache,
          runSetupScript: resolvedImage.runSetupScriptAtRuntime,
        }),
      ].filter(Boolean).join("\n");

      let launchImage = resolvedImage.image;
      dockerArgs.push(launchImage, "bash", "-c", bootstrapScript, "provider-runner", command);

      emitActivity(`Running ${providerLabel} in Docker image ${resolvedImage.image} (workspace volume: ${workspace.volumeName}, runtime volume: ${runtimeVolumeName}).`);

      let abortKillIssued = false;
      const killContainerOnAbort = (): void => {
        if (abortKillIssued) {
          return;
        }
        abortKillIssued = true;
        // SIGKILLing the local `docker run` client only detaches from the daemon; it does
        // not reliably stop the backing container, so kill the container directly on abort.
        void runCommandStrict("docker", ["kill", containerName], process.cwd()).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          emitActivity(`Ignored Docker kill failure for ${containerName} after abort: ${message}`, "provider");
        });
      };

      if (signal) {
        signal.addEventListener("abort", killContainerOnAbort, { once: true });
        if (signal.aborted) {
          killContainerOnAbort();
        }
      }

      try {
        const runDocker = async (): Promise<CommandResult> => {
          await this.workspaceManager.ensureRuntimeVolume(cwd, {
            initializeOwnership: !runAsRoot,
            ownerSpec: userSpec || undefined,
          });
          return runStreamingCommand("docker", dockerArgs, process.cwd(), process.env, {
            signal,
            onStdoutLine: (line) => emitActivity(line, "agent"),
            onStderrLine: (line) => emitActivity(`[${providerLabel}] ${line}`, "provider"),
          });
        };
        let result = await runDocker();
        const repairedArtifacts = new Set<LaunchArtifactKind>();
        let reclaimedContainerName = false;
        for (;;) {
          if (result.ok || signal?.aborted) break;
          const invalidArtifact = this.detectInvalidLaunchArtifact(result, workflowSettings.containerImageMode !== "custom");
          if (invalidArtifact && !repairedArtifacts.has(invalidArtifact)) {
            repairedArtifacts.add(invalidArtifact);
            emitActivity(`Repairing invalid Docker launch artifact (${invalidArtifact}) before retrying ${providerLabel}.`, "provider");
            if (invalidArtifact === "runtime-volume") {
              await this.workspaceManager.repairRuntimeVolume(cwd, {
                initializeOwnership: !runAsRoot,
                ownerSpec: userSpec || undefined,
              });
            } else if (invalidArtifact === "provider-tool" && preparedTool) {
              const previousVolume = preparedTool.volumeName;
              this.toolManager.invalidatePreparedVolume(previousVolume);
              preparedTool = await this.toolManager.prepare(providerLabel, workflowSettings, { resolvedImage: baseImage });
              this.replaceDockerVolumeSource(dockerArgs, previousVolume, preparedTool.volumeName);
            } else if (invalidArtifact === "playwright-browser" && preparedBrowser) {
              const previousVolume = preparedBrowser.volumeName;
              this.browserManager.invalidatePreparedVolume(previousVolume);
              preparedBrowser = await this.browserManager.prepare(workflowSettings, { resolvedImage: baseImage });
              this.replaceDockerVolumeSource(dockerArgs, previousVolume, preparedBrowser.volumeName);
            } else if (invalidArtifact === "runtime-image") {
              this.runtimeService.invalidateImage(baseImage);
              const repairedBaseImage = await this.runtimeService.resolveImage(
                workflowSettings,
                installPlaywrightBrowsers ? "browser" : "base",
              );
              const repairedImage = await new DockerSetupImageCache().resolveImage({
                baseImage: repairedBaseImage,
                setupScriptPath,
                cacheEnabled: workflowSettings.containerCacheSetupScriptImage,
                installPlaywrightBrowsers: workflowSettings.containerImageMode === "custom" && installPlaywrightBrowsers,
                runtimeRoot,
                repoPath,
                signal,
                onActivity: emitActivity,
                onProgress: input.onSetupImageProgress,
                mapSourcePathForDaemon: (sourcePath, label) =>
                  this.mapDockerSourcePathForDaemon(sourcePath, repoPath, sessionId, label, emitActivity),
              });
              this.replaceDockerImage(dockerArgs, launchImage, repairedImage.image);
              baseImage = repairedBaseImage;
              launchImage = repairedImage.image;
            }
            result = await runDocker();
            continue;
          }
          if (!reclaimedContainerName && this.isDockerNameConflict(result, containerName)) {
            reclaimedContainerName = true;
            emitActivity(`Retrying ${providerLabel} after reclaiming stale Docker container ${containerName}.`, "provider");
            await this.removeProviderContainer(containerName);
            await this.sleep(500);
            result = await runDocker();
            continue;
          }
          break;
        }
        return result;
      } finally {
        if (signal) {
          signal.removeEventListener("abort", killContainerOnAbort);
        }
      }
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private buildProviderArgvFile(args: string[]): string {
    const quotedArgs = args.map((arg) => this.shellSingleQuote(arg)).join(" ");
    return [
      "# Generated by Code UX. Mounted into the provider container to avoid host command-line length limits.",
      `CODE_UX_PROVIDER_ARGS=(${quotedArgs})`,
      "",
    ].join("\n");
  }

  private buildLaunchArtifactValidation(args: {
    runtimeOwner: string | null;
    providerBinary: string | null;
    browserMounted: boolean;
  }): string {
    const checks: string[] = [];
    if (args.runtimeOwner) {
      checks.push(
        `if [ "$(cat ${this.shellSingleQuote(`${CONTAINER_RUNTIME_HOME}/.codeux-owner`)} 2>/dev/null || true)" != ${this.shellSingleQuote(args.runtimeOwner)} ] || [ "$(stat -c '%u:%g' ${this.shellSingleQuote(CONTAINER_RUNTIME_HOME)} 2>/dev/null || true)" != ${this.shellSingleQuote(args.runtimeOwner)} ]; then echo ${this.shellSingleQuote(`${LAUNCH_ARTIFACT_INVALID_PREFIX}runtime-volume`)} >&2; exit 86; fi`,
      );
    }
    if (args.providerBinary) {
      checks.push(
        `if [ ! -x ${this.shellSingleQuote(args.providerBinary)} ] || [ ! -f ${this.shellSingleQuote(`${PROVIDER_TOOL_MOUNT}/.codeux-provider-tool.json`)} ]; then echo ${this.shellSingleQuote(`${LAUNCH_ARTIFACT_INVALID_PREFIX}provider-tool`)} >&2; exit 86; fi`,
      );
    }
    if (args.browserMounted) {
      checks.push(
        `if [ ! -f ${this.shellSingleQuote(`${PLAYWRIGHT_BROWSERS_MOUNT}/.codeux-playwright-browser.json`)} ]; then echo ${this.shellSingleQuote(`${LAUNCH_ARTIFACT_INVALID_PREFIX}playwright-browser`)} >&2; exit 86; fi`,
      );
    }
    return checks.join("\n");
  }

  private detectInvalidLaunchArtifact(result: CommandResult, managedImage: boolean): LaunchArtifactKind | null {
    if (result.ok) return null;
    const text = `${result.stderr || ""}\n${result.stdout || ""}`;
    for (const kind of ["runtime-volume", "provider-tool", "playwright-browser"] as const) {
      if (text.includes(`${LAUNCH_ARTIFACT_INVALID_PREFIX}${kind}`)) return kind;
    }
    if (
      managedImage
      && /(?:no such image|unable to find image|manifest unknown|pull access denied)/i.test(text)
    ) {
      return "runtime-image";
    }
    return null;
  }

  private replaceDockerVolumeSource(dockerArgs: string[], previousVolume: string, nextVolume: string): void {
    if (previousVolume === nextVolume) return;
    const source = `source=${previousVolume},`;
    const replacement = `source=${nextVolume},`;
    for (let index = 0; index < dockerArgs.length; index += 1) {
      if (dockerArgs[index].includes(source)) dockerArgs[index] = dockerArgs[index].replace(source, replacement);
    }
  }

  private replaceDockerImage(dockerArgs: string[], previousImage: string, nextImage: string): void {
    const index = dockerArgs.lastIndexOf(previousImage);
    if (index >= 0) dockerArgs[index] = nextImage;
  }

  private async writeRestrictiveFile(filePath: string, content: string | Buffer): Promise<void> {
    if (typeof content === "string") {
      await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
    } else {
      await fs.writeFile(filePath, content, { mode: 0o600 });
    }
    if (process.platform !== "win32") {
      await fs.chmod(filePath, 0o600);
    }
  }

  private buildContainerName(
    providerLabel: CliProviderId,
    sessionId: string,
  ): string {
    const safeProvider = providerLabel.replace(/[^a-zA-Z0-9_.-]+/g, "-").toLowerCase();
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_.-]+/g, "-").toLowerCase().slice(0, 48);
    return `code-ux-${safeProvider}-${safeSessionId || "session"}`.slice(0, 120);
  }

  private async removeProviderContainer(containerName: string): Promise<void> {
    await runCommandStrict("docker", ["rm", "-f", "-v", containerName], process.cwd()).catch(() => undefined);
  }

  private isDockerNameConflict(result: CommandResult, containerName: string): boolean {
    const text = `${result.stderr || ""}\n${result.stdout || ""}`;
    return text.includes("Conflict. The container name")
      && text.includes(`/${containerName}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private shellSingleQuote(value: string): string {
    return `'${value.replaceAll("'", "'\"'\"'")}'`;
  }

  private resolveContainerMemoryLimitMb(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.round(value));
  }

  async readWorkspaceFile(cwd: string, targetPath: string): Promise<string | null> {
    const workspace = this.resolveWorkspace(cwd);
    try {
      const result = await this.volumeHelperPool.exec(workspace.volumeName, ["cat", targetPath], buildRuntimeVolumeName(workspace.volumeName));
      return result.ok ? result.stdout : null;
    } catch {
      return null;
    }
  }

  async readWorkspaceFileBase64(cwd: string, targetPath: string): Promise<string | null> {
    const workspace = this.resolveWorkspace(cwd);
    try {
      const result = await this.volumeHelperPool.exec(workspace.volumeName, ["base64", targetPath], buildRuntimeVolumeName(workspace.volumeName));
      return result.ok ? result.stdout : null;
    } catch {
      return null;
    }
  }

  async readLatestWorkspaceFile(cwd: string, dirPath: string, glob = "*.json"): Promise<string | null> {
    const workspace = this.resolveWorkspace(cwd);
    try {
      const script = `f=$(ls -1t "${dirPath}"/${glob} 2>/dev/null | head -1); [ -n "$f" ] && cat "$f"`;
      const result = await this.volumeHelperPool.exec(workspace.volumeName, ["sh", "-c", script], buildRuntimeVolumeName(workspace.volumeName));
      return result.ok && result.stdout.trim() ? result.stdout : null;
    } catch {
      return null;
    }
  }

  async readWorkspaceFileMetadata(cwd: string, targetPath: string): Promise<string | null> {
    const workspace = this.resolveWorkspace(cwd);
    const script = `[ -f ${this.shellSingleQuote(targetPath)} ] && stat -c '%d:%i:%s:%Y' ${this.shellSingleQuote(targetPath)}`;
    try {
      const result = await this.volumeHelperPool.exec(
        workspace.volumeName,
        ["sh", "-c", script],
        buildRuntimeVolumeName(workspace.volumeName),
      );
      return result.ok && result.stdout.trim() ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  async readWorkspaceDirectoryMetadata(cwd: string, dirPath: string, glob = "*.json"): Promise<string | null> {
    if (!/^[*?.A-Za-z0-9_-]+$/.test(glob)) return null;
    const workspace = this.resolveWorkspace(cwd);
    const quotedDir = this.shellSingleQuote(dirPath);
    const script = `for f in ${quotedDir}/${glob}; do [ -f "$f" ] || continue; stat -c '%n:%s:%Y' "$f"; done | cksum`;
    try {
      const result = await this.volumeHelperPool.exec(
        workspace.volumeName,
        ["sh", "-c", script],
        buildRuntimeVolumeName(workspace.volumeName),
      );
      return result.ok && result.stdout.trim() ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  async readWorkspaceFileChunk(
    cwd: string,
    targetPath: string,
    cursor: ProviderTranscriptCursor,
    maxBytes = 2 * 1024 * 1024,
  ): Promise<ProviderTranscriptChunk | null> {
    return this.readWorkspaceFileChunkWithSelector(cwd, `f=${this.shellSingleQuote(targetPath)}`, cursor, maxBytes);
  }

  async readLatestWorkspaceFileChunk(
    cwd: string,
    dirPath: string,
    glob: string,
    cursor: ProviderTranscriptCursor,
    maxBytes = 2 * 1024 * 1024,
  ): Promise<ProviderTranscriptChunk | null> {
    if (!/^[*?.A-Za-z0-9_-]+$/.test(glob)) {
      return null;
    }
    const quotedDir = this.shellSingleQuote(dirPath);
    return this.readWorkspaceFileChunkWithSelector(
      cwd,
      `f=$(ls -1t ${quotedDir}/${glob} 2>/dev/null | head -1)`,
      cursor,
      maxBytes,
    );
  }

  private async readWorkspaceFileChunkWithSelector(
    cwd: string,
    fileSelector: string,
    cursor: ProviderTranscriptCursor,
    maxBytes: number,
  ): Promise<ProviderTranscriptChunk | null> {
    const workspace = this.resolveWorkspace(cwd);
    const offset = Number.isSafeInteger(cursor.offset) && cursor.offset >= 0 ? cursor.offset : 0;
    const boundedMaxBytes = Math.min(Math.max(Math.floor(maxBytes), 1), 2 * 1024 * 1024);
    const expectedSource = this.shellSingleQuote(cursor.sourceId || "");
    const script = [
      fileSelector,
      `[ -n "$f" ] && [ -f "$f" ] || exit 3`,
      `size=$(wc -c < "$f" | tr -d ' ')`,
      `source_id=$(stat -c '%d:%i' "$f" 2>/dev/null || stat -c '%i' "$f" 2>/dev/null)`,
      `start=${offset}`,
      `reset=0`,
      `if [ "$source_id" != ${expectedSource} ] || [ "$size" -lt "$start" ]; then start=0; reset=1; fi`,
      `count=$((size - start)); [ "$count" -gt ${boundedMaxBytes} ] && count=${boundedMaxBytes}`,
      `next=$((start + count))`,
      `printf '__CODEUX_CHUNK_V1__\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$source_id" "$start" "$next" "$size" "$reset"`,
      // Alpine 3.20's BusyBox dd supports byte-based offsets. Keep a large I/O
      // block size here: bs=1 makes a multi-megabyte telemetry poll perform one
      // read/write operation per byte under high concurrency.
      `[ "$count" -eq 0 ] || dd if="$f" ibs=64k obs=64k skip="$start" count="$count" iflag=skip_bytes,count_bytes status=none 2>/dev/null | base64`,
    ].join("; ");
    try {
      const result = await this.volumeHelperPool.exec(
        workspace.volumeName,
        ["sh", "-c", script],
        buildRuntimeVolumeName(workspace.volumeName),
      );
      return result.ok ? this.parseWorkspaceFileChunk(result.stdout) : null;
    } catch {
      return null;
    }
  }

  private parseWorkspaceFileChunk(stdout: string): ProviderTranscriptChunk | null {
    const newlineIndex = stdout.indexOf("\n");
    const header = (newlineIndex >= 0 ? stdout.slice(0, newlineIndex) : stdout).trim();
    const [marker, sourceId, startText, nextText, totalText, resetText] = header.split("\t");
    const startOffset = Number(startText);
    const nextOffset = Number(nextText);
    const totalBytes = Number(totalText);
    if (
      marker !== "__CODEUX_CHUNK_V1__"
      || !sourceId
      || !Number.isSafeInteger(startOffset)
      || !Number.isSafeInteger(nextOffset)
      || !Number.isSafeInteger(totalBytes)
      || startOffset < 0
      || nextOffset < startOffset
      || totalBytes < nextOffset
    ) {
      return null;
    }
    const contentBase64 = newlineIndex >= 0
      ? stdout.slice(newlineIndex + 1).replace(/\s+/g, "")
      : "";
    return {
      sourceId,
      startOffset,
      nextOffset,
      totalBytes,
      contentBase64,
      reset: resetText === "1",
    };
  }

  /**
   * Reads every `*.json` file in a workspace-volume directory and returns them
   * wrapped as a single JSON array string. Each qwen-code OpenAI log file is a
   * standalone JSON object, so concatenating them inside `[ ... ]` yields valid
   * JSON the caller can parse and aggregate. Returns null when the directory is
   * empty or unreadable.
   */
  async readWorkspaceJsonArray(cwd: string, dirPath: string): Promise<string | null> {
    const workspace = this.resolveWorkspace(cwd);
    try {
      const script = `first=1; printf '['; for f in "${dirPath}"/*.json; do [ -e "$f" ] || continue; [ "$first" -eq 1 ] || printf ','; cat "$f"; first=0; done; printf ']'`;
      const result = await this.volumeHelperPool.exec(workspace.volumeName, ["sh", "-c", script], buildRuntimeVolumeName(workspace.volumeName));
      if (!result.ok) return null;
      const trimmed = result.stdout.trim();
      return trimmed && trimmed !== "[]" ? trimmed : null;
    } catch {
      return null;
    }
  }

  /** Removes a directory inside the workspace volume (used to clear stale provider logs). */
  async removeWorkspaceDir(cwd: string, dirPath: string): Promise<void> {
    const workspace = this.resolveWorkspace(cwd);
    try {
      await this.volumeHelperPool.exec(workspace.volumeName, ["rm", "-rf", dirPath], buildRuntimeVolumeName(workspace.volumeName));
    } catch {
      // best-effort cleanup
    }
  }

  private async maybeLogDockerPathMappingHint(sessionId: string, repoPath: string, onActivity: (desc: string) => void): Promise<void> {
    if (this.dockerHintLoggedSessions.has(sessionId)) return;
    this.dockerHintLoggedSessions.add(sessionId);
    try { await fs.access("/.dockerenv"); } catch { return; }
    const workspaceMapping = (process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT || "").trim();
    if (workspaceMapping.length > 0) return;
    onActivity(`Docker mode is running inside a container. Only setup-script and credential host paths may still require ${repoPath ? "host path mapping" : "daemon-visible paths"}.`);
  }

  private mapDockerSourcePathForDaemon(sourcePath: string, repoPath: string, sessionId: string, label: string, onActivity: (desc: string) => void): string {
    const normalizedSource = path.resolve(sourcePath);
    const workspaceMapping = (process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT || "").trim();
    const homeMapping = (process.env.JULES_DOCKER_HOST_HOME_ROOT || "").trim();
    let mapped = normalizedSource;
    if (workspaceMapping.length > 0) mapped = mapPathPrefix(mapped, repoPath, workspaceMapping);
    if (homeMapping.length > 0) mapped = mapPathPrefix(mapped, os.homedir(), homeMapping);
    if (mapped !== normalizedSource) onActivity(`Mapped Docker ${label} mount source from ${normalizedSource} to ${mapped}.`);
    return mapped;
  }

  private async resolveDockerUserSpec(workspacePath: string): Promise<string> {
    try {
      const stats = await fs.stat(workspacePath);
      if (typeof stats.uid === "number" && typeof stats.gid === "number" && stats.uid !== 0) {
        return `${stats.uid}:${stats.gid}`;
      }
    } catch {
      // ignore and fall back to process uid/gid
    }
    return getDockerUserSpec();
  }

  private async resolveContainerSetupScriptPath(
    workflowSettings: CliWorkflowSettings,
    repoPath: string,
    onActivity: (desc: string) => void,
  ): Promise<string | undefined> {
    const configured = workflowSettings.containerSetupScriptPath.trim();
    if (configured) {
      const resolved = resolveConfiguredPath(repoPath, configured);
      try {
        await fs.access(resolved);
        onActivity(`Resolved configured container setup script: ${resolved}`);
        return resolved;
      } catch {
        onActivity(`Configured container setup script not found: ${resolved}`);
        return undefined;
      }
    }

    // Managed images already contain the Code UX baseline. Only an explicitly
    // configured script is allowed to create a local extension image.
    if (workflowSettings.containerImageMode !== "custom") {
      return undefined;
    }

    await ensureDefaultCodeUxAssetsInstalled();
    const candidates = [
      getRepoCodeUxPath(repoPath, "container", "setup.sh"),
      getHomeCodeUxPath("container", "setup.sh"),
      BUNDLED_CONTAINER_SETUP_SCRIPT,
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        onActivity(`Resolved default container setup script: ${candidate}`);
        return candidate;
      } catch {
        // continue
      }
    }

    if (workflowSettings.containerCacheSetupScriptImage) {
      onActivity("Docker setup image cache is enabled, but no container setup script was resolved.");
    }
    return undefined;
  }

  private customServersForProvider(
    servers: CustomMcpServer[],
    provider: CliProviderId,
  ): CustomMcpServer[] {
    return servers.filter((server) =>
      server.enabled
      && isUsableCustomMcpServer(server)
      && (!server.providers || server.providers.length === 0 || server.providers.includes(provider))
    );
  }

  private async buildProviderConfigMounts(
    conn: McpConnectionInfo | null,
    provider: CliProviderId,
    tempRoot: string,
    providerEnv: NodeJS.ProcessEnv,
    customServers: CustomMcpServer[] = [],
    workflowSettings?: CliWorkflowSettings,
    customServersPreFiltered = false,
  ): Promise<ContainerMount[]> {
    if (provider === "opencode") {
      return [];
    }

    const applicableCustomServers = customServersPreFiltered
      ? customServers
      : this.customServersForProvider(customServers, provider);
    const rewriteLoopbackUrls = workflowSettings
      ? this.shouldRewriteDockerLoopbackUrls(workflowSettings, conn, applicableCustomServers)
      : false;

    const artifact = buildProviderMcpConfigArtifact(provider, conn, applicableCustomServers, {
      qwenSettingsContent: providerEnv.QWEN_SETTINGS_CONTENT,
      rewriteEnabled: rewriteLoopbackUrls,
      rewriteUrl: (url, enabled) => this.rewriteLoopbackUrlForDocker(url, enabled),
    });

    if (!artifact) {
      return [];
    }

    // Standardize filename for backwards-compatibility in Docker temp mount
    let mountFilename = artifact.filename;
    if (provider === "claude-code") mountFilename = "claude-mcp.json";
    if (provider === "gemini") mountFilename = "gemini-settings.json";
    if (provider === "qwen-code") mountFilename = "qwen-settings.json";
    if (provider === "codex") mountFilename = "codex-config.toml";
    if (provider === "antigravity") mountFilename = "antigravity-mcp.json";

    const filePath = path.join(tempRoot, mountFilename);
    await this.writeRestrictiveFile(filePath, artifact.content);

    return [{ source: filePath, destination: artifact.dockerMountDestination, readonly: true }];
  }

  private shouldRewriteDockerLoopbackUrls(
    workflowSettings: CliWorkflowSettings,
    conn: McpConnectionInfo | null = null,
    customServers: CustomMcpServer[] = [],
  ): boolean {
    if (workflowSettings.executionMode !== "DOCKER") {
      return false;
    }
    const override = process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    if (override === "0" || override === "false") {
      return false;
    }
    if (override === "1" || override === "true") {
      return true;
    }
    return process.platform === "darwin"
      || process.platform === "win32"
      || os.release().toLowerCase().includes("microsoft")
      || this.hasLoopbackMcpEndpoint(conn, customServers);
  }

  private shouldAddDockerHostGateway(
    workflowSettings: CliWorkflowSettings,
    conn: McpConnectionInfo | null,
    customServers: CustomMcpServer[],
  ): boolean {
    return this.shouldRewriteDockerLoopbackUrls(workflowSettings, conn, customServers) && process.platform === "linux";
  }

  private providerEnvUsesDockerHostGateway(
    workflowSettings: CliWorkflowSettings,
    providerEnv: NodeJS.ProcessEnv,
  ): boolean {
    if (workflowSettings.executionMode !== "DOCKER" || process.platform !== "linux") {
      return false;
    }
    const hostReachabilityEnvKeys = [
      "ANTHROPIC_BASE_URL",
      "OPENAI_BASE_URL",
      "OPENCODE_CONFIG_CONTENT",
      "QWEN_SETTINGS_CONTENT",
    ];
    return hostReachabilityEnvKeys.some((key) => providerEnv[key]?.includes("host.docker.internal"));
  }

  private rewriteLoopbackUrlForDocker(rawUrl: string, enabled: boolean): string {
    if (!enabled) {
      return rawUrl;
    }
    try {
      const url = new URL(rawUrl);
      if (
        url.hostname === "127.0.0.1"
        || url.hostname === "localhost"
        || url.hostname === "::1"
        || url.hostname === "0.0.0.0"
        || url.hostname === "::"
      ) {
        url.hostname = "host.docker.internal";
        return url.toString();
      }
    } catch {
      return rawUrl;
    }
    return rawUrl;
  }

  private hasLoopbackMcpEndpoint(conn: McpConnectionInfo | null, customServers: CustomMcpServer[]): boolean {
    if (conn && this.isLoopbackUrl(conn.url)) {
      return true;
    }
    return customServers.some((server) =>
      server.transport !== "stdio"
      && typeof server.url === "string"
      && this.isLoopbackUrl(server.url)
    );
  }

  private isLoopbackUrl(rawUrl: string): boolean {
    try {
      const url = new URL(rawUrl);
      return url.hostname === "127.0.0.1"
        || url.hostname === "localhost"
        || url.hostname === "::1"
        || url.hostname === "[::1]"
        || url.hostname === "0.0.0.0"
        || url.hostname === "::"
        || url.hostname === "[::]";
    } catch {
      return false;
    }
  }

  private resolveWorkspace(cwd: string): { volumeName: string } {
    if (!cwd.startsWith("docker-volume://")) {
      throw new Error(`Docker execution now requires an isolated workspace volume. Received: ${cwd}`);
    }
    return { volumeName: cwd.slice("docker-volume://".length) };
  }
}
