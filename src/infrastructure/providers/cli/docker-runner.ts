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
import { workspaceVolumeHelperPool, type WorkspaceVolumeHelperPool } from "./workspace-volume-helper.js";
import { CONTAINER_RUNTIME_HOME, CONTAINER_WORKSPACE_ROOT } from "./provider-runtime-artifacts.js";
import type { CliProviderId } from "./provider-command-specs.js";
import { getHomeCodeUxPath, getRepoCodeUxPath } from "../../../shared/config/code-ux-paths.js";
import { ensureDefaultCodeUxAssetsInstalled } from "../../../services/code-ux-default-assets-service.js";
import { sanitizeInvocationOutputText } from "../../../services/invocation-output-sanitizer.js";
import type { PersistentSkillStorageRuntimeMount } from "../../../services/skill-service.js";


const BUNDLED_CONTAINER_SETUP_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.code-ux/container/setup.sh",
);

const CONTAINER_PROVIDER_ARGV_FILE = "/opt/code-ux/provider-argv.sh";

export interface IDockerRunner {
  ensureWorkspace(args: {
    cwd: string;
    repoPath: string;
    sessionId: string;
    snapshotCheckout?: SnapshotCheckout;
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
  }): Promise<CommandResult>;
  readWorkspaceFile?(cwd: string, targetPath: string): Promise<string | null>;
  readWorkspaceFileBase64?(cwd: string, targetPath: string): Promise<string | null>;
  readLatestWorkspaceFile?(cwd: string, dirPath: string, glob?: string): Promise<string | null>;
  readWorkspaceJsonArray?(cwd: string, dirPath: string): Promise<string | null>;
  removeWorkspaceDir?(cwd: string, dirPath: string): Promise<void>;
}

export class DockerRunner implements IDockerRunner {
  private readonly dockerHintLoggedSessions = new Set<string>();
  private readonly workspaceManager = new WorkspaceManager();
  private readonly volumeHelperPool: WorkspaceVolumeHelperPool = workspaceVolumeHelperPool;

  async ensureWorkspace(args: {
    cwd: string;
    repoPath: string;
    sessionId: string;
    snapshotCheckout?: SnapshotCheckout;
    preserve?: boolean;
    reuseExisting?: boolean;
  }): Promise<{ cwd: string; cleanup: () => Promise<void> }> {
    if (args.cwd.startsWith("docker-volume://")) {
      return {
        cwd: args.cwd,
        cleanup: async () => undefined,
      };
    }

    const workspaceRef = args.reuseExisting
      ? await this.workspaceManager.createOrReuseSnapshotWorkspace(args.repoPath, args.sessionId, args.snapshotCheckout)
      : await this.workspaceManager.createSnapshotWorkspace(args.repoPath, args.sessionId, args.snapshotCheckout);
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
  }): Promise<CommandResult> {
    const { command, args, cwd, providerEnv, sessionId, providerLabel, workflowSettings, repoPath, signal, onActivity } = input;
    const emitActivity = (desc: string, originator?: string): void => {
      onActivity(sanitizeInvocationOutputText(desc), originator);
    };
    const workspace = this.resolveWorkspace(cwd);
    await this.workspaceManager.ensureRuntimeVolume(cwd);
    const runtimeHome = CONTAINER_RUNTIME_HOME;
    const runtimeNpmPrefix = pathPosix.join(runtimeHome, ".npm-global");
    const runtimeNpmCache = pathPosix.join(runtimeHome, ".npm-cache");
    const runtimeVolumeName = buildRuntimeVolumeName(workspace.volumeName);
    const installPlaywrightBrowsers = workflowSettings.containerInstallPlaywrightBrowsers !== false;

    await this.maybeLogDockerPathMappingHint(sessionId, repoPath, emitActivity);

    const setupScriptPath = await this.resolveContainerSetupScriptPath(workflowSettings, repoPath, emitActivity);
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-docker-"));
    const runtimeRoot = resolveDockerRuntimeRoot(repoPath);
    const baseImage = workflowSettings.containerImage.trim() || "node:24-bookworm";

    try {
      const resolvedImage = await new DockerSetupImageCache().resolveImage({
        baseImage,
        setupScriptPath,
        cacheEnabled: workflowSettings.containerCacheSetupScriptImage,
        installPlaywrightBrowsers,
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

      if (this.shouldAddDockerHostGateway(workflowSettings)) {
        dockerArgs.push(...DOCKER_HOST_GATEWAY_ARGS);
      }

      const runAsRoot = workflowSettings.containerRunAsRoot === true;
      const userSpec = runAsRoot ? "" : await this.resolveDockerUserSpec(repoPath);
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
      );

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
        input.customMcpServers || [],
        workflowSettings,
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
          readonly: false,
        }));
      }

      const bootstrapScript = new DockerBootstrapBuilder().build({
        runtimeNpmPrefix,
        runtimeNpmCache,
        runSetupScript: resolvedImage.runSetupScriptAtRuntime,
      });

      dockerArgs.push(resolvedImage.image, "bash", "-c", bootstrapScript, "provider-runner", command);

      emitActivity(`Running ${providerLabel} in Docker image ${resolvedImage.image} (workspace volume: ${workspace.volumeName}, runtime volume: ${runtimeVolumeName}).`);

      // The container name is deterministic per (provider, sessionId), so a retried
      // invocation for the same session (e.g. a chat turn superseded and resumed after
      // an abort) reuses it. Docker's `--rm` cleanup from a just-killed previous run is
      // asynchronous and can still be in flight, so force-remove any stale container
      // occupying the name first rather than racing `docker run --name` against it.
      await this.removeProviderContainer(containerName);

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
        const runDocker = () => runStreamingCommand("docker", dockerArgs, process.cwd(), process.env, {
          signal,
          onStdoutLine: (line) => emitActivity(line, "agent"),
          onStderrLine: (line) => emitActivity(`[${providerLabel}] ${line}`, "provider"),
        });
        const firstResult = await runDocker();
        if (!firstResult.ok && this.isDockerNameConflict(firstResult, containerName) && !signal?.aborted) {
          emitActivity(`Retrying ${providerLabel} after reclaiming stale Docker container ${containerName}.`, "provider");
          await this.removeProviderContainer(containerName);
          await this.sleep(500);
          return await runDocker();
        }
        return firstResult;
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
  ): Promise<ContainerMount[]> {
    if (provider === "opencode") {
      return [];
    }

    const rewriteLoopbackUrls = workflowSettings
      ? this.shouldRewriteDockerLoopbackUrls(workflowSettings)
      : false;

    const applicableCustomServers = this.customServersForProvider(customServers, provider);

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

  private shouldRewriteDockerLoopbackUrls(workflowSettings: CliWorkflowSettings): boolean {
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
      || os.release().toLowerCase().includes("microsoft");
  }

  private shouldAddDockerHostGateway(workflowSettings: CliWorkflowSettings): boolean {
    return this.shouldRewriteDockerLoopbackUrls(workflowSettings) && process.platform === "linux";
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

  private rewriteCustomMcpServerForDocker(server: CustomMcpServer, enabled: boolean): CustomMcpServer {
    if (server.transport === "stdio" || !server.url) {
      return server;
    }
    return {
      ...server,
      url: this.rewriteLoopbackUrlForDocker(server.url, enabled),
    };
  }

  private resolveWorkspace(cwd: string): { volumeName: string } {
    if (!cwd.startsWith("docker-volume://")) {
      throw new Error(`Docker execution now requires an isolated workspace volume. Received: ${cwd}`);
    }
    return { volumeName: cwd.slice("docker-volume://".length) };
  }
}
