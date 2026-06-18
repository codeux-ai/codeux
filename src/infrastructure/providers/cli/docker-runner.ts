import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as pathPosix from "path/posix";
import { fileURLToPath } from "url";
import { CliWorkflowSettings, type CustomMcpServer } from "../../../contracts/app-types.js";
import { isUsableCustomMcpServer } from "../../../mcp/mcp-tool-availability.js";
import { buildProviderMcpConfigArtifact } from "./mcp-config-format.js";
import type { McpConnectionInfo } from "../../../contracts/mcp-connection-types.js";
import { CommandResult, runStreamingCommand } from "../../../services/cli-process-runner.js";
import {
  getDockerUserSpec,
  mapPathPrefix,
  pickContainerEnv,
  resolveConfiguredPath,
  toDockerMountArg,
  ContainerMount,
} from "../../../services/cli-docker-utils.js";
import { CONTAINER_SETUP_SCRIPT } from "../../../services/cli-workflow-utils.js";
import { DockerBootstrapBuilder } from "./docker-bootstrap-builder.js";
import { DockerCredentialMountBuilder } from "./docker-credential-mount-builder.js";
import { DockerSetupImageCache } from "./docker-setup-image-cache.js";
import { resolveDockerRuntimeRoot } from "./docker-runtime-paths.js";
import { WorkspaceManager } from "./workspace-manager.js";
import { workspaceVolumeHelperPool, type WorkspaceVolumeHelperPool } from "./workspace-volume-helper.js";
import { getHomeCodeUxPath, getRepoCodeUxPath } from "../../../shared/config/code-ux-paths.js";
import { ensureDefaultCodeUxAssetsInstalled } from "../../../services/code-ux-default-assets-service.js";


const BUNDLED_CONTAINER_SETUP_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.code-ux/container/setup.sh",
);

const CONTAINER_WORKSPACE_ROOT = "/workspace";
const CONTAINER_PROVIDER_ARGV_FILE = "/opt/code-ux/provider-argv.sh";

export interface IDockerRunner {
  ensureWorkspace(args: {
    cwd: string;
    repoPath: string;
    sessionId: string;
    preserve?: boolean;
    reuseExisting?: boolean;
  }): Promise<{ cwd: string; cleanup: () => Promise<void> }>;
  runProviderInDocker(args: {
    command: string;
    args: string[];
    cwd: string;
    providerEnv: NodeJS.ProcessEnv;
    sessionId: string;
    providerLabel: "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity";
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
    signal?: AbortSignal;
    onActivity: (desc: string, originator?: string) => void;
    mcpConnection?: McpConnectionInfo | null;
    customMcpServers?: CustomMcpServer[];
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
      ? await this.workspaceManager.createOrReuseSnapshotWorkspace(args.repoPath, args.sessionId)
      : await this.workspaceManager.createSnapshotWorkspace(args.repoPath, args.sessionId);
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
    providerLabel: "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity";
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
    signal?: AbortSignal;
    onActivity: (desc: string, originator?: string) => void;
    mcpConnection?: McpConnectionInfo | null;
    customMcpServers?: CustomMcpServer[];
  }): Promise<CommandResult> {
    const { command, args, cwd, providerEnv, sessionId, providerLabel, workflowSettings, repoPath, signal, onActivity } = input;
    const workspace = this.resolveWorkspace(cwd);
    const runtimeHome = pathPosix.join(CONTAINER_WORKSPACE_ROOT, ".code-ux-home");
    const runtimeNpmPrefix = pathPosix.join(runtimeHome, ".npm-global");
    const runtimeNpmCache = pathPosix.join(runtimeHome, ".npm-cache");

    await this.maybeLogDockerPathMappingHint(sessionId, repoPath, onActivity);

    const setupScriptPath = await this.resolveContainerSetupScriptPath(workflowSettings, repoPath, onActivity);
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-docker-"));
    const runtimeRoot = resolveDockerRuntimeRoot(repoPath);
    const baseImage = workflowSettings.containerImage.trim() || "node:24-bookworm";

    try {
      const resolvedImage = await new DockerSetupImageCache().resolveImage({
        baseImage,
        setupScriptPath,
        cacheEnabled: workflowSettings.containerCacheSetupScriptImage,
        runtimeRoot,
        repoPath,
        signal,
        onActivity,
        mapSourcePathForDaemon: (sourcePath, label) =>
          this.mapDockerSourcePathForDaemon(sourcePath, repoPath, sessionId, label, onActivity),
      });

      const argvFilePath = path.join(tempRoot, "provider-argv.sh");
      await fs.writeFile(argvFilePath, this.buildProviderArgvFile(args), "utf8");
      const argvFileSource = this.mapDockerSourcePathForDaemon(argvFilePath, repoPath, sessionId, "provider argv", onActivity);

      const dockerArgs = [
        "run",
        "--rm",
        "-i",
        "--name",
        this.buildContainerName(providerLabel, sessionId),
        "--network",
        "host",
        "--workdir",
        CONTAINER_WORKSPACE_ROOT,
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
        "-e",
        `HOME=${runtimeHome}`,
        "-e",
        `CODE_UX_PROVIDER_ARGV_FILE=${CONTAINER_PROVIDER_ARGV_FILE}`,
        "--mount",
        toDockerMountArg({
          source: argvFileSource,
          destination: CONTAINER_PROVIDER_ARGV_FILE,
          readonly: true,
        }),
      ];

      const userSpec = await this.resolveDockerUserSpec(repoPath);
      if (userSpec) {
        dockerArgs.push("--user", userSpec);
        const passwdPath = path.join(tempRoot, "passwd");
        const [uid, gid] = userSpec.split(":");
        const passwdContent = [
          "root:x:0:0:root:/root:/bin/bash",
          "nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin",
          `worker:x:${uid}:${gid}::${runtimeHome}:/bin/bash`,
          "",
        ].join("\n");
        await fs.writeFile(passwdPath, passwdContent);
        const passwdSource = this.mapDockerSourcePathForDaemon(passwdPath, repoPath, sessionId, "passwd", onActivity);
        dockerArgs.push("--mount", toDockerMountArg({ source: passwdSource, destination: "/etc/passwd", readonly: true }));
      }

      for (const variable of pickContainerEnv(providerEnv)) {
        dockerArgs.push("-e", `${variable.key}=${variable.value}`);
      }
      dockerArgs.push(
        "-e", `CODE_UX_GIT_USER_NAME=${workflowSettings.containerGitUserName}`,
        "-e", `CODE_UX_GIT_USER_EMAIL=${workflowSettings.containerGitUserEmail}`,
      );

      if (setupScriptPath && resolvedImage.runSetupScriptAtRuntime) {
        const setupScriptSource = this.mapDockerSourcePathForDaemon(setupScriptPath, repoPath, sessionId, "setup script", onActivity);
        dockerArgs.push("--mount", toDockerMountArg({ source: setupScriptSource, destination: CONTAINER_SETUP_SCRIPT, readonly: true }));
      }

      const credentialMounts = await new DockerCredentialMountBuilder().build(
        workflowSettings,
        repoPath,
        onActivity,
        {
          provider: providerLabel,
          enabled: Boolean(input.providerMountAuth),
          path: input.providerAuthPath || "",
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
        const source = this.mapDockerSourcePathForDaemon(mount.source, repoPath, sessionId, "credentials", onActivity);
        dockerArgs.push("--mount", toDockerMountArg({ ...mount, source }));
      }

      const bootstrapScript = new DockerBootstrapBuilder().build({
        runtimeNpmPrefix,
        runtimeNpmCache,
        runSetupScript: resolvedImage.runSetupScriptAtRuntime,
      });

      dockerArgs.push(resolvedImage.image, "bash", "-c", bootstrapScript, "provider-runner", command);

      onActivity(`Running ${providerLabel} in Docker image ${resolvedImage.image} (isolated volume: ${workspace.volumeName}).`);

      return await runStreamingCommand("docker", dockerArgs, process.cwd(), process.env, {
        signal,
        onStdoutLine: (line) => onActivity(line, "agent"),
        onStderrLine: (line) => onActivity(`[${providerLabel}] ${line}`, "provider"),
      });
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

  private buildContainerName(
    providerLabel: "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity",
    sessionId: string,
  ): string {
    const safeProvider = providerLabel.replace(/[^a-zA-Z0-9_.-]+/g, "-").toLowerCase();
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_.-]+/g, "-").toLowerCase().slice(0, 48);
    return `code-ux-${safeProvider}-${safeSessionId || "session"}`.slice(0, 120);
  }

  private shellSingleQuote(value: string): string {
    return `'${value.replaceAll("'", "'\"'\"'")}'`;
  }

  async readWorkspaceFile(cwd: string, targetPath: string): Promise<string | null> {
    const workspace = this.resolveWorkspace(cwd);
    try {
      const result = await this.volumeHelperPool.exec(workspace.volumeName, ["cat", targetPath]);
      return result.ok ? result.stdout : null;
    } catch {
      return null;
    }
  }

  async readWorkspaceFileBase64(cwd: string, targetPath: string): Promise<string | null> {
    const workspace = this.resolveWorkspace(cwd);
    try {
      const result = await this.volumeHelperPool.exec(workspace.volumeName, ["base64", targetPath]);
      return result.ok ? result.stdout : null;
    } catch {
      return null;
    }
  }

  async readLatestWorkspaceFile(cwd: string, dirPath: string, glob = "*.json"): Promise<string | null> {
    const workspace = this.resolveWorkspace(cwd);
    try {
      const script = `f=$(ls -1t "${dirPath}"/${glob} 2>/dev/null | head -1); [ -n "$f" ] && cat "$f"`;
      const result = await this.volumeHelperPool.exec(workspace.volumeName, ["sh", "-c", script]);
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
      const result = await this.volumeHelperPool.exec(workspace.volumeName, ["sh", "-c", script]);
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
      await this.volumeHelperPool.exec(workspace.volumeName, ["rm", "-rf", dirPath]);
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
    provider: "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity",
  ): CustomMcpServer[] {
    return servers.filter((server) =>
      server.enabled
      && isUsableCustomMcpServer(server)
      && (!server.providers || server.providers.length === 0 || server.providers.includes(provider))
    );
  }

  private async buildProviderConfigMounts(
    conn: McpConnectionInfo | null,
    provider: "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity",
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
    await fs.writeFile(filePath, artifact.content);

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
