import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as pathPosix from "path/posix";
import { fileURLToPath } from "url";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
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
import { WorkspaceManager } from "./workspace-manager.js";
import { getHomeCodeUxPath, getRepoCodeUxPath } from "../../../shared/config/code-ux-paths.js";
import { ensureDefaultCodeUxAssetsInstalled } from "../../../services/code-ux-default-assets-service.js";
import {
  CLAUDE_CODE_MCP_CONFIG_MOUNT,
  CODEX_MCP_CONFIG_MOUNT,
  GEMINI_MCP_SETTINGS_MOUNT,
  QWEN_CODE_SETTINGS_MOUNT,
} from "./docker-bootstrap-builder.js";

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
  }): Promise<{ cwd: string; cleanup: () => Promise<void> }>;
  runProviderInDocker(args: {
    command: string;
    args: string[];
    cwd: string;
    providerEnv: NodeJS.ProcessEnv;
    sessionId: string;
    providerLabel: "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode";
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
    signal?: AbortSignal;
    onActivity: (desc: string, originator?: string) => void;
    mcpConnection?: McpConnectionInfo | null;
  }): Promise<CommandResult>;
  readWorkspaceFile?(cwd: string, targetPath: string): Promise<string | null>;
}

export class DockerRunner implements IDockerRunner {
  private readonly dockerHintLoggedSessions = new Set<string>();
  private readonly workspaceManager = new WorkspaceManager();

  async ensureWorkspace(args: {
    cwd: string;
    repoPath: string;
    sessionId: string;
  }): Promise<{ cwd: string; cleanup: () => Promise<void> }> {
    if (args.cwd.startsWith("docker-volume://")) {
      return {
        cwd: args.cwd,
        cleanup: async () => undefined,
      };
    }

    const workspaceRef = await this.workspaceManager.createSnapshotWorkspace(args.repoPath, args.sessionId);
    return {
      cwd: workspaceRef,
      cleanup: async () => {
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
    providerLabel: "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode";
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
    signal?: AbortSignal;
    onActivity: (desc: string, originator?: string) => void;
    mcpConnection?: McpConnectionInfo | null;
  }): Promise<CommandResult> {
    const { command, args, cwd, providerEnv, sessionId, providerLabel, workflowSettings, repoPath, signal, onActivity } = input;
    const workspace = this.resolveWorkspace(cwd);
    const runtimeHome = pathPosix.join(CONTAINER_WORKSPACE_ROOT, ".code-ux-home");
    const runtimeNpmPrefix = pathPosix.join(runtimeHome, ".npm-global");
    const runtimeNpmCache = pathPosix.join(runtimeHome, ".npm-cache");

    await this.maybeLogDockerPathMappingHint(sessionId, repoPath, onActivity);

    const setupScriptPath = await this.resolveContainerSetupScriptPath(workflowSettings, repoPath, onActivity);
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-docker-"));
    const baseImage = workflowSettings.containerImage.trim() || "node:24-bookworm";

    try {
      const resolvedImage = await new DockerSetupImageCache().resolveImage({
        baseImage,
        setupScriptPath,
        cacheEnabled: workflowSettings.containerCacheSetupScriptImage,
        runtimeRoot: tempRoot,
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
      const providerConfigMounts = await this.buildProviderConfigMounts(input.mcpConnection || null, providerLabel, tempRoot, providerEnv);

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

  private shellSingleQuote(value: string): string {
    return `'${value.replaceAll("'", "'\"'\"'")}'`;
  }

  async readWorkspaceFile(cwd: string, targetPath: string): Promise<string | null> {
    const workspace = this.resolveWorkspace(cwd);
    try {
      const result = await runStreamingCommand(
        "docker",
        [
          "run",
          "--rm",
          "-i",
          "--workdir",
          CONTAINER_WORKSPACE_ROOT,
          "--mount",
          toDockerMountArg({
            source: workspace.volumeName,
            destination: CONTAINER_WORKSPACE_ROOT,
            readonly: false,
            type: "volume",
          }),
          "alpine:3.20",
          "cat",
          targetPath,
        ],
        process.cwd(),
        process.env,
      );
      return result.ok ? result.stdout : null;
    } catch {
      return null;
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

  private async buildProviderConfigMounts(
    conn: McpConnectionInfo | null,
    provider: "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode",
    tempRoot: string,
    providerEnv: NodeJS.ProcessEnv,
  ): Promise<ContainerMount[]> {
    const headers: Record<string, string> = {};
    if (conn?.authToken) {
      headers.Authorization = `Bearer ${conn.authToken}`;
    }

    if (provider === "claude-code" && conn) {
      const filePath = path.join(tempRoot, "claude-mcp.json");
      await fs.writeFile(filePath, JSON.stringify({
        mcpServers: {
          code_ux: {
            type: "http",
            url: conn.url,
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
          },
        },
      }, null, 2));
      return [{ source: filePath, destination: CLAUDE_CODE_MCP_CONFIG_MOUNT, readonly: true }];
    }

    if (provider === "gemini" && conn) {
      const filePath = path.join(tempRoot, "gemini-settings.json");
      await fs.writeFile(filePath, JSON.stringify({
        mcpServers: {
          code_ux: {
            httpUrl: conn.url,
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
          },
        },
      }, null, 2));
      return [{ source: filePath, destination: GEMINI_MCP_SETTINGS_MOUNT, readonly: true }];
    }

    if (provider === "qwen-code") {
      const filePath = path.join(tempRoot, "qwen-settings.json");
      let settings: Record<string, unknown> = {};
      if (providerEnv.QWEN_SETTINGS_CONTENT) {
        try {
          settings = JSON.parse(providerEnv.QWEN_SETTINGS_CONTENT) as Record<string, unknown>;
        } catch {
          settings = {};
        }
      }
      if (conn) {
        const existingMcpServers = settings.mcpServers as Record<string, unknown> || {};
        settings.mcpServers = {
          ...existingMcpServers,
          code_ux: existingMcpServers.code_ux || {
            httpUrl: conn.url,
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
          },
        };
      }
      if (Object.keys(settings).length === 0) {
        return [];
      }
      await fs.writeFile(filePath, JSON.stringify(settings, null, 2));
      return [{ source: filePath, destination: QWEN_CODE_SETTINGS_MOUNT, readonly: true }];
    }

    if (provider === "opencode") {
      return [];
    }

    if (!conn) {
      return [];
    }
    const filePath = path.join(tempRoot, "codex-config.toml");
    const lines = ["[mcp_servers.code-ux]", `url = "${conn.url}"`];
    if (conn.authToken) {
      lines.push(`http_headers = { "Authorization" = "Bearer ${conn.authToken}" }`);
    }
    await fs.writeFile(filePath, lines.join("\n") + "\n");
    return [{ source: filePath, destination: CODEX_MCP_CONFIG_MOUNT, readonly: true }];
  }

  private resolveWorkspace(cwd: string): { volumeName: string } {
    if (!cwd.startsWith("docker-volume://")) {
      throw new Error(`Docker execution now requires an isolated workspace volume. Received: ${cwd}`);
    }
    return { volumeName: cwd.slice("docker-volume://".length) };
  }
}
