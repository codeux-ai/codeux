import * as fs from "fs/promises";
import * as path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { CliWorkflowSettings, ProviderId } from "../../../contracts/app-types.js";
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
import { getHomeSprintOsPath, getRepoSprintOsPath } from "../../../shared/config/sprint-os-paths.js";

const BUNDLED_CONTAINER_SETUP_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.sprint-os/container/setup.sh",
);

export interface IDockerRunner {
  runProviderInDocker(args: {
    command: string;
    args: string[];
    cwd: string;
    providerEnv: NodeJS.ProcessEnv;
    sessionId: string;
    providerLabel: "gemini" | "codex" | "claude-code";
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    signal?: AbortSignal;
    onActivity: (desc: string, originator?: string) => void;
    mcpConnection?: McpConnectionInfo | null;
  }): Promise<CommandResult>;
}

export class DockerRunner implements IDockerRunner {
  private readonly dockerHintLoggedSessions = new Set<string>();

  async runProviderInDocker(input: {
    command: string;
    args: string[];
    cwd: string;
    providerEnv: NodeJS.ProcessEnv;
    sessionId: string;
    providerLabel: "gemini" | "codex" | "claude-code";
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    signal?: AbortSignal;
    onActivity: (desc: string, originator?: string) => void;
    mcpConnection?: McpConnectionInfo | null;
  }): Promise<CommandResult> {
    const { command, args, cwd, providerEnv, sessionId, providerLabel, workflowSettings, repoPath, signal, onActivity } = input;

    await this.maybeLogDockerPathMappingHint(sessionId, repoPath, onActivity);
    const runtimeRoot = resolveDockerRuntimeRoot(repoPath);
    const runtimeHome = path.join(runtimeRoot, `home-${providerLabel}-${sessionId}`);
    const runtimeNpmPrefix = path.join(runtimeRoot, "npm-global");
    const runtimeNpmCache = path.join(runtimeRoot, "npm-cache");

    await fs.mkdir(path.join(runtimeHome, ".config"), { recursive: true });
    await fs.mkdir(path.join(runtimeHome, ".codex"), { recursive: true });
    await fs.mkdir(path.join(runtimeHome, ".gemini"), { recursive: true });
    await fs.mkdir(runtimeNpmPrefix, { recursive: true });
    await fs.mkdir(runtimeNpmCache, { recursive: true });

    if (input.mcpConnection) {
      await this.writeProviderMcpConfig(input.mcpConnection, runtimeHome, providerLabel, cwd);
    }

    const repoSource = this.mapDockerSourcePathForDaemon(repoPath, repoPath, sessionId, "workspace", onActivity);
    const runtimeSource = this.mapDockerSourcePathForDaemon(runtimeRoot, repoPath, sessionId, "runtime", onActivity);
    const setupScriptPath = await this.resolveContainerSetupScriptPath(workflowSettings, repoPath, sessionId, onActivity);
    const baseImage = workflowSettings.containerImage.trim() || "node:18";
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

    // When the cwd is a worktree inside the repo, mount the repo read-only so the provider
    // agent cannot modify files outside the worktree. The worktree directory and .git/worktrees
    // get separate read-write mounts (more specific paths take precedence in Docker).
    const worktreeIsInsideRepo = cwd.startsWith(repoPath + path.sep);
    const repoMountReadonly = worktreeIsInsideRepo;

    const dockerArgs = [
      "run", "--rm", "-i", "--network", "host", "--workdir", cwd,
      "--label", `sprint-os.session-id=${sessionId}`,
      "--label", `sprint-os.command=${command}`,
      "--label", `sprint-os.args=${args.join(" ")}`,
      "--mount", toDockerMountArg({ source: repoSource, destination: repoPath, readonly: repoMountReadonly }),
      "--mount", toDockerMountArg({ source: runtimeSource, destination: runtimeRoot, readonly: false }),
      "-e", `HOME=${runtimeHome}`
    ];

    if (worktreeIsInsideRepo) {
      const worktreeSource = this.mapDockerSourcePathForDaemon(cwd, repoPath, sessionId, "worktree", onActivity);
      // Mount .git/ read-write so all git internals (objects, refs, worktrees,
      // logs, packed-refs, etc.) remain fully functional. The repo working tree
      // stays read-only — only the worktree directory is writable for source files.
      const gitDir = path.join(repoPath, ".git");
      const gitDirSource = this.mapDockerSourcePathForDaemon(gitDir, repoPath, sessionId, "git-dir", onActivity);
      dockerArgs.push(
        "--mount", toDockerMountArg({ source: worktreeSource, destination: cwd, readonly: false }),
        "--mount", toDockerMountArg({ source: gitDirSource, destination: gitDir, readonly: false }),
      );
    }

    const userSpec = await this.resolveDockerUserSpec(cwd);
    if (userSpec) {
      dockerArgs.push("--user", userSpec);
      // Generate a passwd file so that os.userInfo() works inside the container.
      // Without this, tools like Gemini CLI fail with uv_os_get_passwd ENOENT.
      const passwdPath = path.join(runtimeRoot, "passwd");
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

    const passthroughEnv = pickContainerEnv(providerEnv);
    for (const variable of passthroughEnv) {
      dockerArgs.push("-e", `${variable.key}=${variable.value}`);
    }

    if (setupScriptPath && resolvedImage.runSetupScriptAtRuntime) {
      const setupScriptSource = this.mapDockerSourcePathForDaemon(setupScriptPath, repoPath, sessionId, "setup script", onActivity);
      dockerArgs.push("--mount", toDockerMountArg({ source: setupScriptSource, destination: CONTAINER_SETUP_SCRIPT, readonly: true }));
    }

    const credentialMounts = await new DockerCredentialMountBuilder().build(workflowSettings, repoPath, onActivity);
    for (const mount of credentialMounts) {
      const source = this.mapDockerSourcePathForDaemon(mount.source, repoPath, sessionId, "credentials", onActivity);
      dockerArgs.push("--mount", toDockerMountArg({ ...mount, source }));
    }

    const bootstrapScript = new DockerBootstrapBuilder().build({
      runtimeNpmPrefix,
      runtimeNpmCache,
      runSetupScript: resolvedImage.runSetupScriptAtRuntime,
    });

    dockerArgs.push(resolvedImage.image, "bash", "-c", bootstrapScript, "provider-runner", command, ...args);

    onActivity(`Running ${providerLabel} in Docker image ${resolvedImage.image} (credentials mounted: ${credentialMounts.length > 0 ? "yes" : "no"}).`);

    return await runStreamingCommand("docker", dockerArgs, cwd, process.env, {
      signal,
      onStdoutLine: (line) => onActivity(line, "agent"),
      onStderrLine: (line) => onActivity(`[${providerLabel}] ${line}`, "provider"),
    });
  }

  private async maybeLogDockerPathMappingHint(sessionId: string, repoPath: string, onActivity: (desc: string) => void): Promise<void> {
    if (this.dockerHintLoggedSessions.has(sessionId)) return;
    this.dockerHintLoggedSessions.add(sessionId);
    try { await fs.access("/.dockerenv"); } catch { return; }
    const workspaceMapping = (process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT || "").trim();
    if (workspaceMapping.length > 0) return;
    onActivity("Docker mode is running inside a container. If docker daemon is outside, set JULES_DOCKER_HOST_WORKSPACE_ROOT.");
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

  private async resolveDockerUserSpec(workspacePath: string): Promise<string | undefined> {
    try {
      const stats = await fs.stat(workspacePath);
      if (typeof stats.uid === "number" && typeof stats.gid === "number") return `${stats.uid}:${stats.gid}`;
    } catch { /* ignore */ }
    return getDockerUserSpec();
  }

  private async resolveContainerSetupScriptPath(workflowSettings: CliWorkflowSettings, repoPath: string, sessionId: string, onActivity: (desc: string) => void): Promise<string | undefined> {
    const configured = workflowSettings.containerSetupScriptPath.trim();
    if (configured) {
      const p = resolveConfiguredPath(repoPath, configured);
      try {
        await fs.access(p);
        onActivity(`Resolved configured container setup script: ${p}`);
        return p;
      } catch {
        onActivity(`Configured container setup script not found: ${p}`);
        return undefined;
      }
    }
    const candidates = [
      getRepoSprintOsPath(repoPath, "container", "setup.sh"),
      getHomeSprintOsPath("container", "setup.sh"),
      BUNDLED_CONTAINER_SETUP_SCRIPT,
    ];
    for (const c of candidates) {
      try {
        await fs.access(c);
        onActivity(`Resolved default container setup script: ${c}`);
        return c;
      } catch {
        /* next */
      }
    }
    if (workflowSettings.containerCacheSetupScriptImage) {
      onActivity("Docker setup image cache is enabled, but no container setup script was resolved.");
    }
    return undefined;
  }

  private async writeProviderMcpConfig(
    conn: McpConnectionInfo,
    runtimeHome: string,
    provider: "gemini" | "codex" | "claude-code",
    cwd: string,
  ): Promise<void> {
    const headers: Record<string, string> = {};
    if (conn.authToken) {
      headers["Authorization"] = `Bearer ${conn.authToken}`;
    }

    if (provider === "claude-code") {
      const config = {
        mcpServers: {
          "sprint-os": {
            type: "http",
            url: conn.url,
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
          },
        },
      };
      await fs.writeFile(path.join(runtimeHome, ".mcp.json"), JSON.stringify(config, null, 2));
    } else if (provider === "gemini") {
      const mcpServers = {
        "sprint-os": {
          httpUrl: conn.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        },
      };
      // Write to user-level config
      await fs.writeFile(path.join(runtimeHome, ".gemini", "settings.json"), JSON.stringify({ mcpServers }, null, 2));
      // Also merge into project-level config so Gemini CLI discovers MCP regardless of scope
      const projectSettingsPath = path.join(cwd, ".gemini", "settings.json");
      let projectSettings: Record<string, unknown> = {};
      try {
        projectSettings = JSON.parse(await fs.readFile(projectSettingsPath, "utf8"));
      } catch { /* no existing project settings */ }
      projectSettings.mcpServers = { ...(projectSettings.mcpServers as Record<string, unknown> || {}), ...mcpServers };
      await fs.mkdir(path.join(cwd, ".gemini"), { recursive: true });
      await fs.writeFile(projectSettingsPath, JSON.stringify(projectSettings, null, 2));
    } else if (provider === "codex") {
      const lines = ["[mcp_servers.sprint-os]", `url = "${conn.url}"`];
      if (conn.authToken) {
        lines.push(`http_headers = { "Authorization" = "Bearer ${conn.authToken}" }`);
      }
      await fs.writeFile(path.join(runtimeHome, ".codex", "config.toml"), lines.join("\n") + "\n");
    }
  }

}
