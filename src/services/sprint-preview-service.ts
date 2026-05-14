import * as fs from "fs/promises";
import * as path from "path";
import * as net from "net";
import os from "os";
import { fileURLToPath } from "url";
import type {
  CliWorkflowSettings,
  SprintPreviewScript,
  SprintPreviewSession,
  SprintPreviewSettings,
} from "../contracts/app-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import { SprintPreviewRepository } from "../repositories/sprint-preview-repository.js";
import { DockerBootstrapBuilder } from "../infrastructure/providers/cli/docker-bootstrap-builder.js";
import { DockerCredentialMountBuilder } from "../infrastructure/providers/cli/docker-credential-mount-builder.js";
import { DockerSetupImageCache } from "../infrastructure/providers/cli/docker-setup-image-cache.js";
import { resolveDockerRuntimeRoot } from "../infrastructure/providers/cli/docker-runtime-paths.js";
import { formatSprintBranch } from "../git/sprint-branch-scheme.js";
import { runCommandStrict } from "./cli-process-runner.js";
import {
  getDockerUserSpec,
  mapPathPrefix,
  pickContainerEnv,
  resolveConfiguredPath,
  toDockerMountArg,
} from "./cli-docker-utils.js";
import { CONTAINER_SETUP_SCRIPT } from "./cli-workflow-utils.js";
import {
  buildGeneratedSprintPreviewScript,
  detectSprintPreviewCommands,
  normalizePreviewPath,
  readOptionalSprintPreviewScript,
} from "./sprint-preview-utils.js";
import type { Logger } from "../shared/logging/logger.js";
import { getHomeCodeUxPath, getRepoCodeUxPath } from "../shared/config/code-ux-paths.js";
import { fetchOriginIfAvailable } from "./git-branch-sync-service.js";

const BUNDLED_CONTAINER_SETUP_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.code-ux/container/setup.sh",
);
const CONTAINER_PREVIEW_PROXY_PORT = 39000;
const PREVIEW_READINESS_TIMEOUT_MS = 120_000;
const PREVIEW_LOG_TAIL_LINES = 200;
const PREVIEW_LOG_DRIVER = "local";
const ORPHANED_SETUP_CONTAINER_COMMAND = "bash /tmp/code-ux-setup.sh && rm -f /tmp/code-ux-setup.sh";

export interface SprintPreviewProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

interface SprintPreviewServiceDeps {
  sprintPreviewRepository: SprintPreviewRepository;
  projectManagementRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  settingsRepository: SettingsRepository;
  logger?: Logger;
}

interface PreparedStartupScript {
  mode: "auto" | "script";
  scriptPath: string;
  content: string;
  installCommand: string | null;
  buildCommand: string | null;
  runCommand: string | null;
}

interface DockerContainerSummary {
  id: string;
  name: string | null;
  status: string | null;
  labels: Record<string, string>;
}

export class SprintPreviewService {
  private readonly sessionLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: SprintPreviewServiceDeps) {}

  async listSessions(projectId?: string): Promise<SprintPreviewSession[]> {
    const sessions = this.deps.sprintPreviewRepository.listSessions(projectId);
    return await Promise.all(sessions.map((session) => this.refreshRuntimeState(session)));
  }

  async getSession(sessionId: string): Promise<SprintPreviewSession | null> {
    const session = this.deps.sprintPreviewRepository.getSession(sessionId);
    return session ? await this.refreshRuntimeState(session) : null;
  }

  async startSession(projectId: string, sprintId: string, options?: { rebuild?: boolean }): Promise<SprintPreviewSession> {
    return await this.withSessionLock(this.buildSessionLockKey(projectId, sprintId), async () => {
      const project = this.requireProject(projectId);
      const sprint = this.requireSprint(projectId, sprintId);
      const effectiveSettings = this.resolveSettings(projectId, sprintId);
      const settings = effectiveSettings.sprintPreview;
      this.assertPreviewEnabled(settings);
      const preparedScript = await this.prepareStartupScript(project.baseDir, settings);
      const featureBranch = sprint.featureBranch?.trim() || this.resolveSprintFeatureBranch(projectId, sprintId);
      const defaultBranch = effectiveSettings.git.defaultBranch?.trim() || project.defaultBranch?.trim() || "main";
      const projectRuntimeRoot = resolveDockerRuntimeRoot(project.baseDir);
      const runtimeRoot = path.join(projectRuntimeRoot, "preview", sprintId);
      const workspacePath = path.join(runtimeRoot, "workspace");
      const runtimeHome = path.join(runtimeRoot, "home-preview");
      const runtimeNpmPrefix = path.join(projectRuntimeRoot, "npm-global");
      const runtimeNpmCache = path.join(projectRuntimeRoot, "npm-cache");
      const startupMountPath = "/opt/code-ux/preview-start.sh";
      const startupRuntimePath = path.join(runtimeRoot, "start-preview.sh");
      const containerName = this.buildContainerName(projectId, sprintId);
      const effectiveInstallCommand = preparedScript.installCommand;
      const completedTaskCount = this.countCompletedTasks(projectId, sprintId);

      await this.cleanupOrphanedSetupContainers(project.baseDir);

      const existing = this.deps.sprintPreviewRepository.getSessionByProjectSprint(projectId, sprintId);
      if (existing && !options?.rebuild) {
        const refreshedExisting = await this.refreshRuntimeState(existing);
        if (refreshedExisting.status === "running" || refreshedExisting.status === "starting") {
          return refreshedExisting;
        }
      }

      await this.enforceMaxConcurrentContainers(projectId, settings.maxConcurrentContainers, existing?.id || null);

      const session = existing || this.deps.sprintPreviewRepository.createSession({
        projectId,
        sprintId,
        status: "starting",
        containerAppPort: settings.containerAppPort,
        startupScriptPath: preparedScript.scriptPath,
        startupMode: preparedScript.mode,
        installCommand: effectiveInstallCommand,
        buildCommand: preparedScript.buildCommand,
        runCommand: preparedScript.runCommand,
        lastCompletedTaskCount: completedTaskCount,
        lastSeenSprintStatus: sprint.status,
        lastKnownPath: "/",
      });

      const sessionBasePatch = {
        status: "starting" as const,
        hostPort: null,
        containerAppPort: settings.containerAppPort,
        startupScriptPath: preparedScript.scriptPath,
        startupMode: preparedScript.mode,
        installCommand: effectiveInstallCommand,
        buildCommand: preparedScript.buildCommand,
        runCommand: preparedScript.runCommand,
        lastCompletedTaskCount: completedTaskCount,
        lastSeenSprintStatus: sprint.status,
        lastKnownPath: "/",
        featureBranch,
        worktreePath: workspacePath,
        healthStatus: "unknown" as const,
        lastError: null,
      };

      this.deps.sprintPreviewRepository.updateSession(session.id, {
        ...sessionBasePatch,
        containerId: null,
        containerName: null,
      });

      try {
        if (existing?.containerId || existing?.containerName || options?.rebuild) {
          await this.removeContainerIfPresent(existing?.containerId || existing?.containerName || containerName, project.baseDir);
        }
        await this.removeContainerIfPresent(containerName, project.baseDir);

        const hostPort = await this.findFreePort(settings);
        await fs.mkdir(runtimeHome, { recursive: true });
        await fs.mkdir(runtimeNpmPrefix, { recursive: true });
        await fs.mkdir(runtimeNpmCache, { recursive: true });
        await this.materializePreviewWorkspace(
          project.baseDir,
          workspacePath,
          featureBranch,
          defaultBranch,
          effectiveSettings.git.githubMode === "REMOTE",
          {
            githubToken: effectiveSettings.git.githubToken,
          },
        );
        await fs.mkdir(path.dirname(startupRuntimePath), { recursive: true });
        await fs.writeFile(startupRuntimePath, preparedScript.content, "utf8");
        await fs.chmod(startupRuntimePath, 0o755);

        const setupScriptPath = await this.resolveContainerSetupScriptPath(project.baseDir, effectiveSettings.cliWorkflow);
        const baseImage = effectiveSettings.cliWorkflow.containerImage.trim() || "node:24-bookworm";
        const resolvedImage = await new DockerSetupImageCache().resolveImage({
          baseImage,
          setupScriptPath,
          cacheEnabled: effectiveSettings.cliWorkflow.containerCacheSetupScriptImage,
          buildIfMissing: false,
          runtimeRoot: projectRuntimeRoot,
          repoPath: project.baseDir,
          onActivity: (message) => {
            this.deps.logger?.info("Sprint preview image resolution", {
              projectId,
              sprintId,
              message,
            });
          },
          mapSourcePathForDaemon: (sourcePath) => this.mapDockerSourcePathForDaemon(sourcePath, project.baseDir),
        });
        const shouldRunSetupScriptAtRuntime = false;

        const projectRuntimeSource = this.mapDockerSourcePathForDaemon(projectRuntimeRoot, project.baseDir);
        const startupScriptSource = this.mapDockerSourcePathForDaemon(startupRuntimePath, project.baseDir);
        const workflowSettings = effectiveSettings.cliWorkflow;
        const credentialMounts = await new DockerCredentialMountBuilder().build(workflowSettings, project.baseDir, () => undefined);
        const bootstrapScript = new DockerBootstrapBuilder().build({
          runtimeNpmPrefix,
          runtimeNpmCache,
          fallbackProviders: [],
          runSetupScript: shouldRunSetupScriptAtRuntime,
        });

        const dockerArgs = [
          "run",
          "-d",
          "--name", containerName,
          "--log-driver", PREVIEW_LOG_DRIVER,
          "-p", `127.0.0.1:${hostPort}:${CONTAINER_PREVIEW_PROXY_PORT}`,
          "--workdir", workspacePath,
          "--label", "code-ux.preview=true",
          "--label", `code-ux.project-id=${projectId}`,
          "--label", `code-ux.sprint-id=${sprintId}`,
          "--label", `code-ux.session-id=${session.id}`,
          "--label", `code-ux.host-port=${hostPort}`,
          "--mount", toDockerMountArg({ source: projectRuntimeSource, destination: projectRuntimeRoot, readonly: false }),
          "--mount", toDockerMountArg({ source: startupScriptSource, destination: startupMountPath, readonly: true }),
          "-e", `HOME=${runtimeHome}`,
          "-e", "HOST=0.0.0.0",
          "-e", `PORT=${settings.containerAppPort}`,
          "-e", "DASHBOARD_HOST=0.0.0.0",
          "-e", `DASHBOARD_PORT=${settings.containerAppPort}`,
          "-e", `SPRINT_PREVIEW_PORT=${settings.containerAppPort}`,
          "-e", `SPRINT_PREVIEW_PROXY_PORT=${CONTAINER_PREVIEW_PROXY_PORT}`,
          "-e", `SPRINT_PREVIEW_WORKSPACE=${workspacePath}`,
          "-e", `SPRINT_PREVIEW_WORKTREE=${workspacePath}`,
          "-e", `SPRINT_PREVIEW_INSTALL_COMMAND=${effectiveInstallCommand || ""}`,
          "-e", `SPRINT_PREVIEW_BUILD_COMMAND=${preparedScript.buildCommand || ""}`,
          "-e", `SPRINT_PREVIEW_RUN_COMMAND=${preparedScript.runCommand || ""}`,
        ];

        const userSpec = await this.resolveDockerUserSpec(workspacePath);
        if (userSpec) {
          dockerArgs.push("--user", userSpec);
        }

        if (setupScriptPath && shouldRunSetupScriptAtRuntime) {
          const setupScriptSource = this.mapDockerSourcePathForDaemon(setupScriptPath, project.baseDir);
          dockerArgs.push("--mount", toDockerMountArg({ source: setupScriptSource, destination: CONTAINER_SETUP_SCRIPT, readonly: true }));
        }

        for (const variable of pickContainerEnv(process.env)) {
          dockerArgs.push("-e", `${variable.key}=${variable.value}`);
        }

        for (const mount of credentialMounts) {
          dockerArgs.push("--mount", toDockerMountArg({
            ...mount,
            source: this.mapDockerSourcePathForDaemon(mount.source, project.baseDir),
          }));
        }

        dockerArgs.push(resolvedImage.image, "bash", "-c", bootstrapScript, "preview-runner", "bash", startupMountPath);

        const startResult = await runCommandStrict("docker", dockerArgs, project.baseDir);
        const containerId = startResult.stdout.trim();
        if (!containerId) {
          throw new Error("Docker preview container did not return a container id.");
        }

        const updated = this.deps.sprintPreviewRepository.updateSession(session.id, {
          ...sessionBasePatch,
          hostPort,
          containerId,
          containerName,
          lastBuildAt: new Date().toISOString(),
          lastStartedAt: new Date().toISOString(),
        });

        await this.waitForReadiness(updated, PREVIEW_READINESS_TIMEOUT_MS);
        return await this.refreshRuntimeState(updated);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.removeContainerIfPresent(containerName, project.baseDir);
        return this.deps.sprintPreviewRepository.updateSession(session.id, {
          ...sessionBasePatch,
          status: "error",
          hostPort: null,
          containerId: null,
          containerName: null,
          healthStatus: "unreachable",
          lastError: message,
        });
      }
    });
  }

  async cleanupStaleContainersOnStartup(): Promise<void> {
    const containerIds = await this.listPreviewContainerIds();
    for (const containerId of containerIds) {
      await runCommandStrict("docker", ["rm", "-f", containerId], process.cwd()).catch(() => undefined);
    }
    await this.cleanupOrphanedSetupContainers(process.cwd());

    const projects = this.deps.projectManagementRepository.listProjects().projects;
    for (const project of projects) {
      await this.cleanupLegacyPreviewWorkspaces(project.baseDir);
    }

    const sessions = this.deps.sprintPreviewRepository.listSessions();
    for (const session of sessions) {
      if (!session.containerId && !session.containerName && session.status === "stopped") {
        continue;
      }
      this.deps.sprintPreviewRepository.updateSession(session.id, {
        status: "stopped",
        containerId: null,
        containerName: null,
        healthStatus: "unknown",
        lastError: null,
        lastStoppedAt: new Date().toISOString(),
      });
    }

    if (containerIds.length > 0) {
      this.deps.logger?.info("Stopped stale sprint preview containers on startup", {
        stoppedCount: containerIds.length,
      });
    }
  }

  async rebuildSession(sessionId: string): Promise<SprintPreviewSession> {
    const session = await this.requireSession(sessionId);
    return await this.startSession(session.projectId, session.sprintId, { rebuild: true });
  }

  async stopSession(sessionId: string): Promise<SprintPreviewSession> {
    const session = await this.requireSession(sessionId);
    return await this.withSessionLock(this.buildSessionLockKey(session.projectId, session.sprintId), async () => {
      const containerRef = session.containerId || session.containerName || this.buildContainerName(session.projectId, session.sprintId);
      await this.removeContainerIfPresent(containerRef, session.worktreePath || process.cwd());
      return this.deps.sprintPreviewRepository.updateSession(sessionId, {
        status: "stopped",
        containerId: null,
        containerName: null,
        healthStatus: "unknown",
        lastError: null,
        lastStoppedAt: new Date().toISOString(),
      });
    });
  }

  async removeSession(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    await this.withSessionLock(this.buildSessionLockKey(session.projectId, session.sprintId), async () => {
      const containerRef = session.containerId || session.containerName || this.buildContainerName(session.projectId, session.sprintId);
      await this.removeContainerIfPresent(containerRef, session.worktreePath || process.cwd());
      this.deps.sprintPreviewRepository.deleteSession(sessionId);
    });
  }

  async getLogs(sessionId: string, tail = 200): Promise<{ logs: string }> {
    const session = await this.requireSession(sessionId);
    const refreshed = await this.refreshRuntimeState(session);
    if (!refreshed.containerId && !refreshed.containerName) {
      return { logs: "" };
    }
    try {
      return {
        logs: await this.readContainerLogs(
          refreshed.containerId || refreshed.containerName || refreshed.id,
          tail,
          refreshed.worktreePath || process.cwd(),
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { logs: message };
    }
  }

  async getScript(projectId: string, sprintId: string): Promise<SprintPreviewScript> {
    const project = this.requireProject(projectId);
    this.requireSprint(projectId, sprintId);
    const settings = this.resolveSettings(projectId, sprintId).sprintPreview;
    const scriptPath = resolveConfiguredPath(project.baseDir, settings.startupScriptPath);
    const script = await readOptionalSprintPreviewScript(scriptPath);
    const detected = await detectSprintPreviewCommands(project.baseDir);

    return {
      projectId,
      sprintId,
      path: scriptPath,
      exists: script.exists,
      mode: script.exists ? "script" : "auto",
      content: script.exists ? script.content : buildGeneratedSprintPreviewScript(),
      detectedInstallCommand: detected.installCommand,
      detectedBuildCommand: detected.buildCommand,
      detectedRunCommand: detected.runCommand,
    };
  }

  async saveScript(projectId: string, sprintId: string, content: string): Promise<SprintPreviewScript> {
    const project = this.requireProject(projectId);
    this.requireSprint(projectId, sprintId);
    const settings = this.resolveSettings(projectId, sprintId).sprintPreview;
    const scriptPath = resolveConfiguredPath(project.baseDir, settings.startupScriptPath);
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, content, "utf8");
    await fs.chmod(scriptPath, 0o755);
    return await this.getScript(projectId, sprintId);
  }

  async proxyRequest(args: {
    sessionId: string;
    method: string;
    path: string;
    headers?: Record<string, string | undefined>;
    body?: Buffer;
  }): Promise<SprintPreviewProxyResponse> {
    const session = await this.requireSession(args.sessionId);
    const refreshed = await this.refreshRuntimeState(session);
    if (!refreshed.hostPort) {
      throw new Error("Preview session does not have an active host port.");
    }

    const upstreamUrl = new URL(normalizePreviewPath(args.path), `http://127.0.0.1:${refreshed.hostPort}`);
    let response: Response;
    try {
      response = await fetch(upstreamUrl, {
        method: args.method,
        headers: this.buildProxyHeaders(args.headers),
        body: args.body && args.body.length > 0 ? new Uint8Array(args.body) : undefined,
        redirect: "manual",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.sprintPreviewRepository.updateSession(refreshed.id, {
        status: "error",
        healthStatus: "unreachable",
        lastError: message,
      });
      throw error;
    }

    const contentType = response.headers.get("content-type") || "";
    const rewritePrefix = `/api/browser/sessions/${refreshed.id}/proxy`;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        return;
      }
      if (key.toLowerCase() === "location") {
        responseHeaders[key] = this.rewriteLocationHeader(value, rewritePrefix, upstreamUrl.origin);
        return;
      }
      responseHeaders[key] = value;
    });

    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    const rewrittenBody = this.shouldRewriteBody(contentType)
      ? Buffer.from(this.rewriteProxyBody(bodyBuffer.toString("utf8"), rewritePrefix))
      : bodyBuffer;

    this.deps.sprintPreviewRepository.updateSession(refreshed.id, {
      lastKnownPath: normalizePreviewPath(args.path),
      healthStatus: "healthy",
      status: refreshed.status === "error" ? "running" : refreshed.status,
      lastError: null,
    });

    if (this.shouldRewriteBody(contentType)) {
      responseHeaders["content-length"] = String(rewrittenBody.byteLength);
    }

    return {
      status: response.status,
      headers: responseHeaders,
      body: rewrittenBody,
    };
  }

  async reconcileSessions(): Promise<void> {
    const sessions = this.deps.sprintPreviewRepository.listSessions();
    for (const session of sessions) {
      const sprint = this.deps.projectManagementRepository.getSprint(session.sprintId);
      if (!sprint) {
        continue;
      }
      const settings = this.resolveSettings(session.projectId, session.sprintId).sprintPreview;
      const refreshed = await this.refreshRuntimeState(session);
      const completedTaskCount = this.countCompletedTasks(session.projectId, session.sprintId);
      const activeRun = this.deps.executionRepository.getProjectExecutionSnapshot(session.projectId)
        .sprintRuns
        .some((run) => run.sprintId === session.sprintId && run.status === "running");

      if (settings.enabled === false) {
        if (refreshed.status === "running" || refreshed.status === "starting") {
          await this.stopSession(refreshed.id).catch(() => undefined);
        }
        continue;
      }

      if (settings.autoStartOnRunningSprint && activeRun && refreshed.status === "stopped") {
        await this.startSession(session.projectId, session.sprintId).catch((error) => {
          this.deps.logger?.warn("Failed to auto-start sprint preview session", {
            sessionId: session.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        continue;
      }

      if (settings.autoStopOnTerminalSprint && !activeRun && (sprint.status === "completed" || sprint.status === "failed" || sprint.status === "cancelled")) {
        if (refreshed.status !== "stopped") {
          await this.stopSession(refreshed.id).catch(() => undefined);
        }
        continue;
      }

      if (refreshed.status !== "running" && refreshed.status !== "starting") {
        continue;
      }

      if (settings.rebuildOnTaskCompletion && completedTaskCount > refreshed.lastCompletedTaskCount) {
        await this.rebuildSession(refreshed.id).catch((error) => {
          this.deps.logger?.warn("Failed to auto-rebuild sprint preview after task completion", {
            sessionId: refreshed.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        continue;
      }

      if (
        settings.rebuildOnSprintCompletion
        && sprint.status === "completed"
        && refreshed.lastSeenSprintStatus !== "completed"
      ) {
        await this.rebuildSession(refreshed.id).catch((error) => {
          this.deps.logger?.warn("Failed to auto-rebuild sprint preview after sprint completion", {
            sessionId: refreshed.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        continue;
      }

      this.deps.sprintPreviewRepository.updateSession(refreshed.id, {
        lastCompletedTaskCount: completedTaskCount,
        lastSeenSprintStatus: sprint.status,
      });
    }

    const projects = this.deps.projectManagementRepository.listProjects().projects;
    for (const project of projects) {
      const execution = this.deps.executionRepository.getProjectExecutionSnapshot(project.id);
      const activeSprintRunIds = new Set(
        execution.sprintRuns
          .filter((run) => run.status === "running")
          .map((run) => run.sprintId),
      );
      for (const sprint of this.deps.projectManagementRepository.listSprints(project.id).sprints) {
        if (!activeSprintRunIds.has(sprint.id)) {
          continue;
        }
        const existing = this.deps.sprintPreviewRepository.getSessionByProjectSprint(project.id, sprint.id);
        const settings = this.resolveSettings(project.id, sprint.id).sprintPreview;
        if (settings.enabled === false) {
          continue;
        }
        if (!existing && settings.autoStartOnRunningSprint) {
          await this.startSession(project.id, sprint.id).catch(() => undefined);
        }
      }
    }
  }

  private async refreshRuntimeState(session: SprintPreviewSession): Promise<SprintPreviewSession> {
    const container = await this.findManagedContainerForSession(session);
    if (!container) {
      if (!session.containerId && !session.containerName) {
        return session;
      }
      return this.deps.sprintPreviewRepository.updateSession(session.id, {
        status: "stopped",
        containerId: null,
        containerName: null,
        healthStatus: "unknown",
      });
    }

    const adoptedSession = session.containerId === container.id && session.containerName === container.name
      ? session
      : this.deps.sprintPreviewRepository.updateSession(session.id, {
        containerId: container.id,
        containerName: container.name,
      });

    if (container.status !== "running") {
      const logs = await this.readContainerLogs(container.id, PREVIEW_LOG_TAIL_LINES, adoptedSession.worktreePath || process.cwd()).catch(() => "");
      const lastError = this.extractPreviewError(logs) || adoptedSession.lastError || `Preview container is ${container.status}.`;
      return this.deps.sprintPreviewRepository.updateSession(adoptedSession.id, {
        status: "error",
        healthStatus: "unreachable",
        lastError,
      });
    }

    const healthStatus = adoptedSession.hostPort ? await this.fetchHealthStatus(adoptedSession.hostPort) : "unknown";
    return this.deps.sprintPreviewRepository.updateSession(adoptedSession.id, {
      status: healthStatus === "healthy" ? "running" : "starting",
      healthStatus,
      lastError: healthStatus === "healthy" ? null : adoptedSession.lastError,
    });
  }

  private buildProxyHeaders(headers: Record<string, string | undefined> = {}): Record<string, string> {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (!value) continue;
      const normalized = key.toLowerCase();
      if (normalized === "host" || normalized === "content-length" || normalized === "accept-encoding") {
        continue;
      }
      next[key] = value;
    }
    return next;
  }

  private shouldRewriteBody(contentType: string): boolean {
    const normalized = contentType.toLowerCase();
    return normalized.includes("text/html")
      || normalized.includes("text/css")
      || normalized.includes("javascript")
      || normalized.includes("application/xhtml+xml");
  }

  private rewriteLocationHeader(location: string, rewritePrefix: string, upstreamOrigin: string): string {
    if (!location) return location;
    if (location.startsWith("/")) {
      return `${rewritePrefix}${location}`;
    }
    if (location.startsWith(upstreamOrigin)) {
      return `${rewritePrefix}${location.slice(upstreamOrigin.length)}`;
    }
    return location;
  }

  private rewriteProxyBody(body: string, rewritePrefix: string): string {
    return body
      .replace(/(href|src|action)=("|')\/(?!\/)/g, `$1=$2${rewritePrefix}/`)
      .replace(/url\((['"]?)\/(?!\/)/g, `url($1${rewritePrefix}/`)
      .replace(/fetch\((['"])\/(?!\/)/g, `fetch($1${rewritePrefix}/`)
      .replace(/import\((['"])\/(?!\/)/g, `import($1${rewritePrefix}/`)
      .replace(/XMLHttpRequest\(\)\.open\((['"][A-Z]+['"]\s*,\s*['"])\/(?!\/)/g, `XMLHttpRequest().open($1${rewritePrefix}/`);
  }

  private async waitForReadiness(session: SprintPreviewSession, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const refreshed = await this.refreshRuntimeState(session);
      if (refreshed.status === "running") {
        return;
      }
      if (refreshed.status === "error") {
        throw new Error(refreshed.lastError || "Sprint preview container exited before becoming ready.");
      }
      if (!refreshed.hostPort) {
        throw new Error("Preview session does not have an assigned host port.");
      }
      const healthStatus = await this.fetchHealthStatus(refreshed.hostPort);
      if (healthStatus === "healthy") {
        this.deps.sprintPreviewRepository.updateSession(refreshed.id, {
          status: "running",
          healthStatus,
          lastError: null,
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const latest = await this.refreshRuntimeState(session);
    if (latest.status !== "running") {
      throw new Error(latest.lastError || `Sprint preview did not become reachable within ${Math.round(timeoutMs / 1000)} seconds.`);
    }
  }

  private async fetchHealthStatus(hostPort: number): Promise<"healthy" | "unreachable"> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        await fetch(`http://127.0.0.1:${hostPort}/`, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      return "healthy";
    } catch {
      return "unreachable";
    }
  }

  private async listPreviewContainerIds(): Promise<string[]> {
    try {
      const result = await runCommandStrict(
        "docker",
        ["ps", "-aq", "--filter", "label=code-ux.preview=true"],
        process.cwd(),
      );
      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private async listPreviewContainers(cwd: string): Promise<DockerContainerSummary[]> {
    try {
      const result = await runCommandStrict(
        "docker",
        [
          "ps",
          "-a",
          "--filter", "label=code-ux.preview=true",
          "--format",
          "{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Label \"code-ux.project-id\"}}\t{{.Label \"code-ux.sprint-id\"}}\t{{.Label \"code-ux.session-id\"}}",
        ],
        cwd,
      );
      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [id, name, rawStatus, projectId, sprintId, sessionId] = line.split("\t");
          return {
            id,
            name: name || null,
            status: this.normalizeDockerState(rawStatus),
            labels: {
              "code-ux.project-id": projectId || "",
              "code-ux.sprint-id": sprintId || "",
              "code-ux.session-id": sessionId || "",
            },
          } satisfies DockerContainerSummary;
        });
    } catch {
      return [];
    }
  }

  private async findManagedContainerForSession(session: SprintPreviewSession): Promise<DockerContainerSummary | null> {
    const containers = await this.listPreviewContainers(session.worktreePath || process.cwd());
    const bySession = containers.find((container) => container.labels["code-ux.session-id"] === session.id);
    if (bySession) {
      return bySession;
    }
    const byIdentity = containers.find((container) =>
      container.labels["code-ux.project-id"] === session.projectId
      && container.labels["code-ux.sprint-id"] === session.sprintId,
    );
    if (byIdentity) {
      return byIdentity;
    }
    if (!session.containerId && !session.containerName) {
      return null;
    }
    const matchingRef = containers.find((container) =>
      container.id === session.containerId
      || (session.containerName ? container.name === session.containerName : false),
    );
    return matchingRef || null;
  }

  private normalizeDockerState(rawStatus: string | null | undefined): string | null {
    const normalized = String(rawStatus || "").trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (normalized.startsWith("up ")) {
      return "running";
    }
    if (normalized.startsWith("exited ")) {
      return "exited";
    }
    if (normalized.startsWith("created")) {
      return "created";
    }
    if (normalized.startsWith("restarting")) {
      return "restarting";
    }
    return normalized;
  }

  private async removeContainerIfPresent(containerRef: string, cwd: string): Promise<void> {
    if (!containerRef.trim()) {
      return;
    }
    await runCommandStrict("docker", ["rm", "-f", containerRef], cwd).catch(() => undefined);
  }

  private async readContainerLogs(containerRef: string, tail: number, cwd: string): Promise<string> {
    const result = await runCommandStrict(
      "docker",
      ["logs", "--tail", String(Math.max(1, tail)), containerRef],
      cwd,
    );
    return result.stdout || result.stderr || "";
  }

  private extractPreviewError(logs: string): string | null {
    const lines = logs
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (/error|failed|fatal|eaddr|enoent|permission denied/i.test(line)) {
        return line;
      }
    }
    return lines.at(-1) || null;
  }

  private async cleanupOrphanedSetupContainers(cwd: string): Promise<void> {
    try {
      const result = await runCommandStrict(
        "docker",
        [
          "ps",
          "-aq",
          "--filter",
          `status=running`,
        ],
        cwd,
      );
      const containerIds = result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      for (const containerId of containerIds) {
        const inspect = await runCommandStrict(
          "docker",
          [
            "inspect",
            "--format",
            "{{json .Config.Labels}}\t{{json .Config.Cmd}}",
            containerId,
          ],
          cwd,
        ).catch(() => null);
        if (!inspect) {
          continue;
        }
        const [labelsJson = "{}", cmdJson = "[]"] = inspect.stdout.trim().split("\t");
        const labels = JSON.parse(labelsJson) as Record<string, string> | null;
        const command = JSON.parse(cmdJson) as string[];
        if (labels && Object.keys(labels).length > 0) {
          continue;
        }
        if (command.join(" ").includes(ORPHANED_SETUP_CONTAINER_COMMAND)) {
          await this.removeContainerIfPresent(containerId, cwd);
        }
      }
    } catch {
      // Best effort cleanup only.
    }
  }

  private buildSessionLockKey(projectId: string, sprintId: string): string {
    return `${projectId}:${sprintId}`;
  }

  private async withSessionLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionLocks.get(lockKey) || Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.finally(() => gate);
    this.sessionLocks.set(lockKey, queued);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release?.();
      if (this.sessionLocks.get(lockKey) === queued) {
        this.sessionLocks.delete(lockKey);
      }
    }
  }

  private async cleanupLegacyPreviewWorkspaces(repoPath: string): Promise<void> {
    const legacyRoot = path.join(repoPath, ".code-ux", "worktrees");
    let entries: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      entries = await fs.readdir(legacyRoot, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }

    const previewEntries = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("preview-"));
    for (const entry of previewEntries) {
      const legacyPath = path.join(legacyRoot, entry.name);
      await runCommandStrict("git", ["worktree", "remove", "--force", legacyPath], repoPath).catch(() => undefined);
      await fs.rm(legacyPath, { recursive: true, force: true }).catch(() => undefined);
    }

    if (previewEntries.length > 0) {
      await runCommandStrict("git", ["worktree", "prune"], repoPath).catch(() => undefined);
    }
  }

  private async prepareStartupScript(repoPath: string, settings: SprintPreviewSettings): Promise<PreparedStartupScript> {
    const scriptPath = resolveConfiguredPath(repoPath, settings.startupScriptPath);
    const script = await readOptionalSprintPreviewScript(scriptPath);
    const detected = await detectSprintPreviewCommands(repoPath);

    if (script.exists) {
      return {
        mode: "script",
        scriptPath,
        content: script.content,
        installCommand: detected.installCommand,
        buildCommand: detected.buildCommand,
        runCommand: detected.runCommand,
      };
    }

    return {
      mode: "auto",
      scriptPath,
      content: buildGeneratedSprintPreviewScript(),
      installCommand: detected.installCommand,
      buildCommand: detected.buildCommand,
      runCommand: detected.runCommand,
    };
  }

  private async materializePreviewWorkspace(
    repoPath: string,
    workspacePath: string,
    featureBranch: string,
    defaultBranch: string,
    syncLatestFromOrigin = true,
    gitAuthOptions?: { githubToken?: string; gitlabToken?: string },
  ): Promise<void> {
    if (syncLatestFromOrigin) {
      await fetchOriginIfAvailable(repoPath, gitAuthOptions);
    }
    await this.ensurePreviewBranchExists(repoPath, featureBranch, defaultBranch);
    const exportRef = await this.resolvePreviewExportRef(repoPath, featureBranch);
    const archivePath = `${workspacePath}.tar`;

    await fs.rm(workspacePath, { recursive: true, force: true });
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.rm(archivePath, { force: true }).catch(() => undefined);

    try {
      await runCommandStrict("git", ["archive", "--format=tar", "-o", archivePath, exportRef], repoPath);
      await runCommandStrict("tar", ["-xf", archivePath, "-C", workspacePath], repoPath);
    } finally {
      await fs.rm(archivePath, { force: true }).catch(() => undefined);
    }
  }

  private async ensurePreviewBranchExists(repoPath: string, featureBranch: string, defaultBranch: string): Promise<void> {
    if (await this.localBranchExists(repoPath, featureBranch)) {
      return;
    }
    if (await this.remoteBranchExists(repoPath, featureBranch)) {
      return;
    }

    const baseRef = await this.resolvePreviewBranchBaseRef(repoPath, defaultBranch);
    try {
      await runCommandStrict("git", ["branch", featureBranch, baseRef], repoPath);
    } catch (error) {
      if (!(await this.localBranchExists(repoPath, featureBranch))) {
        throw error;
      }
    }
  }

  private async resolvePreviewExportRef(repoPath: string, branch: string): Promise<string> {
    if (await this.remoteTrackingRefExists(repoPath, branch)) {
      return `origin/${branch}`;
    }
    if (await this.localBranchExists(repoPath, branch)) {
      return branch;
    }
    throw new Error(`Cannot export sprint preview workspace: branch ${branch} does not exist locally or on origin.`);
  }

  private async resolvePreviewBranchBaseRef(repoPath: string, defaultBranch: string): Promise<string> {
    if (await this.localBranchExists(repoPath, defaultBranch)) {
      return defaultBranch;
    }
    if (await this.remoteTrackingRefExists(repoPath, defaultBranch)) {
      return `origin/${defaultBranch}`;
    }
    return "HEAD";
  }

  private async localBranchExists(repoPath: string, branch: string): Promise<boolean> {
    try {
      await runCommandStrict("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repoPath);
      return true;
    } catch {
      return false;
    }
  }

  private async remoteTrackingRefExists(repoPath: string, branch: string): Promise<boolean> {
    try {
      await runCommandStrict("git", ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], repoPath);
      return true;
    } catch {
      return false;
    }
  }

  private async remoteBranchExists(repoPath: string, branch: string): Promise<boolean> {
    try {
      const result = await runCommandStrict("git", ["ls-remote", "--heads", "origin", branch], repoPath);
      return result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  private countCompletedTasks(projectId: string, sprintId: string): number {
    return this.deps.projectManagementRepository.listTasks(projectId, sprintId)
      .filter((task) => task.status === "completed")
      .length;
  }

  private assertPreviewEnabled(settings: SprintPreviewSettings): void {
    if (settings.enabled === false) {
      throw new Error("Browser Preview is disabled for this project or sprint.");
    }
  }

  private async enforceMaxConcurrentContainers(
    projectId: string,
    maxConcurrentContainers: number,
    excludeSessionId: string | null,
  ): Promise<void> {
    const maxConcurrent = Number.isFinite(maxConcurrentContainers)
      ? Math.max(1, Math.round(maxConcurrentContainers))
      : Number.MAX_SAFE_INTEGER;
    const sessions = await this.listSessions(projectId);
    const activeSessions = sessions
      .filter((session) =>
        session.id !== excludeSessionId
        && (session.status === "running" || session.status === "starting")
      )
      .sort((left, right) => this.getSessionAge(left) - this.getSessionAge(right));
    const overflowCount = activeSessions.length - maxConcurrent + 1;

    if (overflowCount <= 0) {
      return;
    }

    for (const session of activeSessions.slice(0, overflowCount)) {
      await this.stopSession(session.id);
    }
  }

  private getSessionAge(session: SprintPreviewSession): number {
    const timestamp = session.lastStartedAt || session.createdAt || session.updatedAt;
    const parsed = Date.parse(timestamp || "");
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }

  private requireProject(projectId: string) {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private requireSprint(projectId: string, sprintId: string) {
    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    if (!sprint || sprint.projectId !== projectId) {
      throw new Error(`Sprint not found in project: ${sprintId}`);
    }
    return sprint;
  }

  private async requireSession(sessionId: string): Promise<SprintPreviewSession> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Sprint preview session not found: ${sessionId}`);
    }
    return session;
  }

  private resolveSettings(projectId: string, sprintId: string) {
    return this.deps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId).settings;
  }

  private resolveSprintFeatureBranch(projectId: string, sprintId: string): string {
    const sprint = this.requireSprint(projectId, sprintId);
    if (sprint.featureBranch?.trim()) {
      return sprint.featureBranch.trim();
    }
    const settings = this.resolveSettings(projectId, sprintId);
    const sprintNumber = typeof sprint.number === "number" ? sprint.number : 0;
    return formatSprintBranch(settings.git.sprintBranchScheme, { number: sprintNumber, slug: sprint.slug || String(sprintNumber), name: sprint.name || "", createdAt: sprint.createdAt || new Date().toISOString(), tasksCount: sprint.tasksCount || 0 });
  }

  private async findFreePort(settings: SprintPreviewSettings): Promise<number> {
    const candidates: number[] = [];
    for (let port = settings.hostPortRangeStart; port <= settings.hostPortRangeEnd; port += 1) {
      candidates.push(port);
    }
    const randomized = candidates.sort(() => Math.random() - 0.5);
    for (const port of randomized) {
      const available = await this.checkPortAvailable(port);
      if (available) {
        return port;
      }
    }
    throw new Error(`No free preview ports available in range ${settings.hostPortRangeStart}-${settings.hostPortRangeEnd}.`);
  }

  private async checkPortAvailable(port: number): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
  }

  private mapDockerSourcePathForDaemon(sourcePath: string, repoPath: string): string {
    const normalizedSource = path.resolve(sourcePath);
    const workspaceMapping = (process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT || "").trim();
    const homeMapping = (process.env.JULES_DOCKER_HOST_HOME_ROOT || "").trim();
    let mapped = normalizedSource;
    if (workspaceMapping.length > 0) mapped = mapPathPrefix(mapped, repoPath, workspaceMapping);
    if (homeMapping.length > 0) mapped = mapPathPrefix(mapped, os.homedir(), homeMapping);
    return mapped;
  }

  private async resolveDockerUserSpec(workspacePath: string): Promise<string | undefined> {
    try {
      const stats = await fs.stat(workspacePath);
      if (typeof stats.uid === "number" && typeof stats.gid === "number") {
        return `${stats.uid}:${stats.gid}`;
      }
    } catch {
      return getDockerUserSpec();
    }
    return getDockerUserSpec();
  }

  private async resolveContainerSetupScriptPath(repoPath: string, workflowSettings: CliWorkflowSettings): Promise<string | undefined> {
    const configured = workflowSettings.containerSetupScriptPath.trim();
    if (configured) {
      const resolved = resolveConfiguredPath(repoPath, configured);
      try {
        await fs.access(resolved);
        return resolved;
      } catch {
        return undefined;
      }
    }
    const candidates = [
      getRepoCodeUxPath(repoPath, "container", "setup.sh"),
      getHomeCodeUxPath("container", "setup.sh"),
      BUNDLED_CONTAINER_SETUP_SCRIPT,
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private buildContainerName(projectId: string, sprintId: string): string {
    const sanitize = (value: string) => value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").slice(0, 24);
    return `code-ux-preview-${sanitize(projectId)}-${sanitize(sprintId)}`.slice(0, 63);
  }
}
