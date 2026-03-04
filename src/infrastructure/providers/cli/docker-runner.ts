import * as fs from "fs/promises";
import * as path from "path";
import os from "os";
import { createHash } from "crypto";
import { CliWorkflowSettings, ProviderId } from "../../../contracts/app-types.js";
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
    onActivity: (desc: string, originator?: string) => void;
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
    onActivity: (desc: string, originator?: string) => void;
  }): Promise<CommandResult> {
    const { command, args, cwd, providerEnv, sessionId, providerLabel, workflowSettings, repoPath, onActivity } = input;

    await this.maybeLogDockerPathMappingHint(sessionId, repoPath, onActivity);
    const runtimeRoot = this.resolveDockerRuntimeRoot(repoPath);
    const runtimeHome = providerLabel === "codex"
      ? path.join(runtimeRoot, `home-codex-${sessionId}`)
      : path.join(runtimeRoot, "home");
    const runtimeNpmPrefix = path.join(runtimeRoot, "npm-global");
    const runtimeNpmCache = path.join(runtimeRoot, "npm-cache");

    await fs.mkdir(path.join(runtimeHome, ".config"), { recursive: true });
    await fs.mkdir(path.join(runtimeHome, ".codex"), { recursive: true });
    await fs.mkdir(runtimeNpmPrefix, { recursive: true });
    await fs.mkdir(runtimeNpmCache, { recursive: true });

    const repoSource = this.mapDockerSourcePathForDaemon(repoPath, repoPath, sessionId, "workspace", onActivity);
    const runtimeSource = this.mapDockerSourcePathForDaemon(runtimeRoot, repoPath, sessionId, "runtime", onActivity);

    const dockerArgs = [
      "run", "--rm", "-i", "--network", "host", "--workdir", cwd,
      "--mount", toDockerMountArg({ source: repoSource, destination: repoPath, readonly: false }),
      "--mount", toDockerMountArg({ source: runtimeSource, destination: runtimeRoot, readonly: false }),
      "-e", `HOME=${runtimeHome}`
    ];

    const userSpec = await this.resolveDockerUserSpec(cwd);
    if (userSpec) dockerArgs.push("--user", userSpec);

    const passthroughEnv = pickContainerEnv(providerEnv);
    for (const variable of passthroughEnv) {
      dockerArgs.push("-e", `${variable.key}=${variable.value}`);
    }

    const setupScriptPath = await this.resolveContainerSetupScriptPath(workflowSettings, repoPath, sessionId, onActivity);
    if (setupScriptPath) {
      const setupScriptSource = this.mapDockerSourcePathForDaemon(setupScriptPath, repoPath, sessionId, "setup script", onActivity);
      dockerArgs.push("--mount", toDockerMountArg({ source: setupScriptSource, destination: CONTAINER_SETUP_SCRIPT, readonly: true }));
    }

    const credentialMounts = await new DockerCredentialMountBuilder().build(workflowSettings, repoPath, onActivity);
    for (const mount of credentialMounts) {
      const source = this.mapDockerSourcePathForDaemon(mount.source, repoPath, sessionId, "credentials", onActivity);
      dockerArgs.push("--mount", toDockerMountArg({ ...mount, source }));
    }

    const image = workflowSettings.containerImage.trim() || "node:18"; // Default fallback
    const bootstrapScript = new DockerBootstrapBuilder().build({
      runtimeNpmPrefix,
      runtimeNpmCache,
    });

    dockerArgs.push(image, "bash", "-c", bootstrapScript, "provider-runner", command, ...args);

    onActivity(`Running ${providerLabel} in Docker image ${image} (credentials mounted: ${credentialMounts.length > 0 ? "yes" : "no"}).`);

    return await runStreamingCommand("docker", dockerArgs, cwd, process.env, {
      onStdoutLine: (line) => onActivity(line, "agent"),
      onStderrLine: (line) => onActivity(`[${providerLabel}] ${line}`, "provider"),
    });
  }

  private resolveDockerRuntimeRoot(repoPath: string): string {
    const configured = (process.env.JULES_DOCKER_RUNTIME_ROOT || "").trim();
    if (configured.length > 0) return resolveConfiguredPath(repoPath, configured);
    const repoHash = createHash("sha1").update(path.resolve(repoPath)).digest("hex").slice(0, 12);
    return path.join(os.homedir(), ".jules-subagents", "runtime", "docker", repoHash);
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
      try { await fs.access(p); return p; } catch { onActivity(`Configured container setup script not found: ${p}`); return undefined; }
    }
    const candidates = [path.join(repoPath, ".jules-subagents", "container", "setup.sh"), path.join(os.homedir(), ".jules-subagents", "container", "setup.sh")];
    for (const c of candidates) { try { await fs.access(c); return c; } catch { /* next */ } }
    return undefined;
  }

}
