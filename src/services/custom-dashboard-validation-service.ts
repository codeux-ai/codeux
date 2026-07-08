import * as fs from "fs/promises";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import type {
  CustomDashboardJsonObject,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationReport,
  CustomDashboardValidationSessionRecord,
  CustomDashboardValidationStatus,
} from "../contracts/custom-dashboard-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import { CustomDashboardRepository } from "../repositories/custom-dashboard-repository.js";
import { EntityNotFoundError } from "../repositories/repository-utils.js";
import type { Logger } from "../shared/logging/logger.js";
import { getDockerUserSpec, mapPathPrefix, resolveConfiguredPath } from "./cli-docker-utils.js";
import { runCommandStrict } from "./cli-process-runner.js";
import { CONTAINER_SETUP_SCRIPT } from "./cli-workflow-utils.js";
import {
  buildCustomDashboardValidationDockerCreateArgs,
  buildCustomDashboardValidationDockerRunArgs,
  CUSTOM_DASHBOARD_VALIDATION_CONTAINER_NPM_CACHE,
  CUSTOM_DASHBOARD_VALIDATION_CONTAINER_NPM_PREFIX,
  CUSTOM_DASHBOARD_VALIDATION_CONTAINER_PORT,
} from "./custom-dashboard-docker-plan.js";
import { normalizePreviewPath } from "./sprint-preview-utils.js";
import {
  appendValidationLog,
  buildBridgeConfig,
  CUSTOM_DASHBOARD_VALIDATION_LOG_TAIL_LINES,
  materializeCustomDashboardWorkspace,
  readValidationLog,
  tailLogLines,
} from "./custom-dashboard-validation-utils.js";
import { DockerSessionLifecycle, sanitizeContainerNameComponent } from "./docker-session-lifecycle.js";
import { DockerBootstrapBuilder } from "../infrastructure/providers/cli/docker-bootstrap-builder.js";

const BUNDLED_CONTAINER_SETUP_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.code-ux/container/setup.sh",
);
const VALIDATION_READINESS_TIMEOUT_MS = 300_000;
const VALIDATION_READINESS_POLL_MS = 1000;
const VALIDATION_URL_PREFIX = "/api/custom-dashboard-validations";
const INSTALL_AND_BUILD_COMMAND = "npm install --no-audit --no-fund && npm run build";
const START_COMMAND = `npm run start -- --host 0.0.0.0 --port ${CUSTOM_DASHBOARD_VALIDATION_CONTAINER_PORT}`;
const VIEWER_ARTIFACT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const VIEWER_ARTIFACT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export interface CustomDashboardValidationServiceDeps {
  customDashboardRepository: CustomDashboardRepository;
  projectManagementRepository: ProjectManagementRepository;
  settingsRepository: SettingsRepository;
  logger?: Logger;
  fetchImpl?: typeof fetch;
  readinessTimeoutMs?: number;
  readinessPollMs?: number;
}

type RuntimeMetadataPatch = CustomDashboardJsonObject;

interface ValidationContainerSummary {
  id: string;
  name: string | null;
  status: string | null;
  hostPort: number | null;
  labels: Record<string, string>;
}

interface ViewerArtifactFile {
  path: string;
  content: string;
  contentType: string;
}

export interface CustomDashboardValidationProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export class CustomDashboardValidationService {
  private readonly lifecycle: DockerSessionLifecycle;
  private readonly fetchImpl: typeof fetch;
  private readonly readinessTimeoutMs: number;
  private readonly readinessPollMs: number;

  constructor(private readonly deps: CustomDashboardValidationServiceDeps) {
    this.lifecycle = new DockerSessionLifecycle(this.deps.logger);
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.readinessTimeoutMs = deps.readinessTimeoutMs ?? VALIDATION_READINESS_TIMEOUT_MS;
    this.readinessPollMs = deps.readinessPollMs ?? VALIDATION_READINESS_POLL_MS;
  }

  async startValidation(
    projectId: string,
    dashboardId: string,
    revisionId: string,
  ): Promise<CustomDashboardValidationSessionRecord> {
    return await this.lifecycle.withSessionLock(this.buildRevisionLockKey(projectId, dashboardId, revisionId), async () => {
      const project = this.requireProject(projectId);
      const dashboard = this.deps.customDashboardRepository.getDashboardById(dashboardId);
      if (!dashboard || dashboard.projectId !== projectId) {
        throw new EntityNotFoundError(`Custom dashboard not found: ${dashboardId}`);
      }
      const revision = this.requireRevision(projectId, dashboardId, revisionId);
      const runtimeRoot = path.join(project.baseDir, ".code-ux", "runtime", "custom-dashboards", dashboardId, revisionId);
      const workspacePath = path.join(runtimeRoot, "workspace");
      const runtimeHomePath = path.join(runtimeRoot, "home-validation");
      const logPath = path.join(runtimeRoot, "validation.log");
      const session = this.deps.customDashboardRepository.createValidationSession(revision.id, {
        status: "queued",
        runtimeMetadata: this.buildRuntimeMetadata({
          workspacePath,
          runtimeHomePath,
          logPath,
          installCommand: INSTALL_AND_BUILD_COMMAND,
          startCommand: START_COMMAND,
        }),
      });
      const containerName = this.buildContainerName(projectId, dashboardId, revisionId, session.id);

      await fs.rm(logPath, { force: true }).catch(() => undefined);
      await appendValidationLog(logPath, "validation", `Created validation session ${session.id}.`);

      try {
        const settings = this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings;
        const cliWorkflow = settings.cliWorkflow;
        const resolvedImage = cliWorkflow.containerImage.trim() || "node:24-bookworm";
        const setupScriptPath = await this.resolveContainerSetupScriptPath(project.baseDir, cliWorkflow.containerSetupScriptPath);

        this.deps.customDashboardRepository.updateValidationSession(session.id, {
          status: "building",
          startedAt: new Date().toISOString(),
          runtimeMetadata: this.buildRuntimeMetadata({
            workspacePath,
            runtimeHomePath,
            logPath,
            containerName,
            image: resolvedImage,
            installCommand: INSTALL_AND_BUILD_COMMAND,
            startCommand: START_COMMAND,
          }),
        });

        await fs.mkdir(runtimeHomePath, { recursive: true });
        await materializeCustomDashboardWorkspace({
          revision,
          workspacePath,
          bridgeConfig: buildBridgeConfig(revision),
        });

        const bootstrapScript = new DockerBootstrapBuilder().build({
          runtimeNpmPrefix: CUSTOM_DASHBOARD_VALIDATION_CONTAINER_NPM_PREFIX,
          runtimeNpmCache: CUSTOM_DASHBOARD_VALIDATION_CONTAINER_NPM_CACHE,
          fallbackProviders: [],
          runSetupScript: Boolean(setupScriptPath),
        });
        const userSpec = cliWorkflow.containerRunAsRoot ? null : await this.resolveDockerUserSpec(workspacePath);
        const mappedWorkspacePath = this.mapDockerSourcePathForDaemon(workspacePath, project.baseDir);
        const mappedRuntimeHomePath = this.mapDockerSourcePathForDaemon(runtimeHomePath, project.baseDir);
        const mappedSetupScriptPath = setupScriptPath
          ? this.mapDockerSourcePathForDaemon(setupScriptPath, project.baseDir)
          : null;

        const buildResult = await runCommandStrict(
          "docker",
          buildCustomDashboardValidationDockerRunArgs({
            projectId,
            dashboardId,
            revisionId,
            sessionId: session.id,
            workspacePath: mappedWorkspacePath,
            runtimeHomePath: mappedRuntimeHomePath,
            userSpec,
            setupScriptSource: mappedSetupScriptPath,
            shouldRunSetupScriptAtRuntime: Boolean(setupScriptPath),
            resolvedImage,
            bootstrapScript,
            command: INSTALL_AND_BUILD_COMMAND,
          }),
          project.baseDir,
          process.env,
          { trimOutput: false, maxStdoutChars: 1024 * 1024 },
        );
        await appendValidationLog(logPath, "install-build stdout", buildResult.stdout);
        await appendValidationLog(logPath, "install-build stderr", buildResult.stderr);
        const viewerArtifact = await this.readViewerArtifact(workspacePath, revision);

        const hostPort = await this.findFreePort(
          settings.sprintPreview.hostPortRangeStart,
          settings.sprintPreview.hostPortRangeEnd,
        );
        const validationUrlPath = `${VALIDATION_URL_PREFIX}/${session.id}/proxy/`;
        const validationUrl = `http://127.0.0.1:${hostPort}/`;
        await this.lifecycle.removeContainerIfPresent(containerName, project.baseDir);
        const createResult = await runCommandStrict(
          "docker",
          buildCustomDashboardValidationDockerCreateArgs({
            projectId,
            dashboardId,
            revisionId,
            sessionId: session.id,
            workspacePath: mappedWorkspacePath,
            runtimeHomePath: mappedRuntimeHomePath,
            hostPort,
            containerName,
            userSpec,
            setupScriptSource: mappedSetupScriptPath,
            shouldRunSetupScriptAtRuntime: Boolean(setupScriptPath),
            resolvedImage,
            bootstrapScript,
            startCommand: START_COMMAND,
          }),
          project.baseDir,
        );
        const containerId = createResult.stdout.trim();
        if (!containerId) {
          throw new Error("Custom dashboard validation container did not return a container id.");
        }
        await appendValidationLog(logPath, "docker-create", containerId);
        await runCommandStrict("docker", ["start", containerName], project.baseDir);

        const runningSession = this.deps.customDashboardRepository.updateValidationSession(session.id, {
          status: "running",
          runtimeMetadata: this.buildRuntimeMetadata({
            workspacePath,
            runtimeHomePath,
            logPath,
            hostPort,
            containerId,
            containerName,
            validationUrl,
            validationUrlPath,
            image: resolvedImage,
            installCommand: INSTALL_AND_BUILD_COMMAND,
            startCommand: START_COMMAND,
          }),
        });

        await this.waitForReadiness(runningSession, project.baseDir);
        const logs = await this.getValidationLogs(session.id, CUSTOM_DASHBOARD_VALIDATION_LOG_TAIL_LINES);
        const report = this.buildPassedReport(hostPort, containerId, containerName, validationUrlPath, logs.logs);
        return this.deps.customDashboardRepository.updateValidationSession(session.id, {
          status: "passed",
          validationReport: report,
          finishedAt: new Date().toISOString(),
          runtimeMetadata: this.buildRuntimeMetadata({
            workspacePath,
            runtimeHomePath,
            logPath,
            hostPort,
            containerId,
            containerName,
            validationUrl,
            validationUrlPath,
            image: resolvedImage,
            installCommand: INSTALL_AND_BUILD_COMMAND,
            startCommand: START_COMMAND,
            viewerArtifact,
            logExcerpt: tailLogLines(logs.logs, CUSTOM_DASHBOARD_VALIDATION_LOG_TAIL_LINES),
          }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await appendValidationLog(logPath, "validation-error", message).catch(() => undefined);
        const current = this.deps.customDashboardRepository.getValidationSessionById(session.id);
        const runtimeMetadata = this.mergeRuntimeMetadata(current?.runtimeMetadata, {
          workspacePath,
          runtimeHomePath,
          logPath,
          containerName,
          lastError: message,
          logExcerpt: await readValidationLog(logPath, CUSTOM_DASHBOARD_VALIDATION_LOG_TAIL_LINES),
        });
        const failedValidationMetadata = this.getValidationMetadata({ runtimeMetadata });
        return this.deps.customDashboardRepository.updateValidationSession(session.id, {
          status: "failed",
          validationReport: this.buildFailedReport("validation_failed", message, failedValidationMetadata.logExcerpt),
          runtimeMetadata,
          finishedAt: new Date().toISOString(),
        });
      }
    });
  }

  async getValidationSession(sessionId: string): Promise<CustomDashboardValidationSessionRecord | null> {
    const session = this.deps.customDashboardRepository.getValidationSessionById(sessionId);
    return session ? await this.refreshRuntimeState(session) : null;
  }

  async listValidationSessions(
    projectId: string,
    dashboardId?: string,
  ): Promise<CustomDashboardValidationSessionRecord[]> {
    this.requireProject(projectId);
    const dashboards = dashboardId
      ? [this.requireDashboardForProject(projectId, dashboardId)]
      : this.deps.customDashboardRepository.listDashboardsByProject(projectId);
    const sessions = dashboards.flatMap((dashboard) =>
      this.deps.customDashboardRepository
        .listRevisions(dashboard.id)
        .flatMap((revision) => this.deps.customDashboardRepository.listValidationSessions(revision.id))
    );
    const refreshed = await Promise.all(sessions.map((session) => this.refreshRuntimeState(session)));
    return refreshed.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getValidationLogs(sessionId: string, tail = CUSTOM_DASHBOARD_VALIDATION_LOG_TAIL_LINES): Promise<{ logs: string }> {
    const session = this.deps.customDashboardRepository.getValidationSessionById(sessionId);
    if (!session) {
      throw new EntityNotFoundError("Custom dashboard validation session not found.");
    }
    const validationMetadata = this.getValidationMetadata(session);
    const fileLogs = await readValidationLog(this.getMetadataString(validationMetadata, "logPath"), tail);
    const containerRef = this.getContainerRef(session);
    if (!containerRef) {
      return { logs: fileLogs };
    }
    const project = this.deps.projectManagementRepository.getProject(session.projectId);
    const cwd = project?.baseDir ?? process.cwd();
    try {
      const result = await runCommandStrict("docker", ["logs", "--tail", String(Math.max(1, Math.round(tail))), containerRef], cwd);
      const dockerLogs = [result.stdout, result.stderr].filter((output) => output.trim().length > 0).join("\n");
      return { logs: [fileLogs, dockerLogs].filter((output) => output.trim().length > 0).join("\n") };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { logs: [fileLogs, message].filter((output) => output.trim().length > 0).join("\n") };
    }
  }

  async proxyValidationRequest(args: {
    sessionId: string;
    method: string;
    path: string;
    headers?: Record<string, string | undefined>;
    body?: Buffer;
    rewritePrefix?: string;
  }): Promise<CustomDashboardValidationProxyResponse> {
    if (args.body && args.body.length > 5 * 1024 * 1024) {
      throw new Error("Request body exceeds maximum allowed size for proxied custom dashboard validation");
    }
    const session = await this.requireValidationSession(args.sessionId);
    const refreshed = await this.refreshRuntimeState(session);
    const metadata = this.getValidationMetadata(refreshed);
    const hostPort = typeof metadata.hostPort === "number" ? metadata.hostPort : null;
    if (!hostPort) {
      throw new Error("Custom dashboard validation session does not have an active host port.");
    }

    const upstreamUrl = new URL(normalizePreviewPath(args.path), `http://127.0.0.1:${hostPort}`);
    const response = await this.fetchImpl(upstreamUrl, {
      method: args.method,
      headers: this.buildProxyHeaders(args.headers, upstreamUrl.origin),
      body: args.body && args.body.length > 0 ? new Uint8Array(args.body) : undefined,
      redirect: "manual",
    });
    const rewritePrefix = args.rewritePrefix || `${VALIDATION_URL_PREFIX}/${refreshed.id}/proxy`;
    const contentType = response.headers.get("content-type") || "";
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (this.shouldStripProxyResponseHeader(key)) {
        return;
      }
      responseHeaders[key] = key.toLowerCase() === "location"
        ? this.rewriteLocationHeader(value, rewritePrefix, upstreamUrl.origin)
        : value;
    });

    const chunks: Buffer[] = [];
    let totalSize = 0;
    if (response.body) {
      for await (const chunk of response.body as any) {
        totalSize += chunk.length;
        if (totalSize > 5 * 1024 * 1024) {
          throw new Error("Response body exceeds maximum allowed size for proxied custom dashboard validation");
        }
        chunks.push(Buffer.from(chunk));
      }
    } else {
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
        throw new Error("Response body exceeds maximum allowed size for proxied custom dashboard validation");
      }
      chunks.push(Buffer.from(arrayBuffer));
    }

    const bodyBuffer = Buffer.concat(chunks);
    const rewrittenBody = this.shouldRewriteBody(contentType)
      ? Buffer.from(this.rewriteProxyBody(bodyBuffer.toString("utf8"), rewritePrefix))
      : bodyBuffer;
    if (this.shouldRewriteBody(contentType)) {
      responseHeaders["content-length"] = String(rewrittenBody.byteLength);
    }
    return {
      status: response.status,
      headers: responseHeaders,
      body: rewrittenBody,
    };
  }

  async stopValidation(sessionId: string): Promise<CustomDashboardValidationSessionRecord> {
    const session = await this.requireValidationSession(sessionId);
    return await this.lifecycle.withSessionLock(
      this.buildRevisionLockKey(session.projectId, session.dashboardId, session.revisionId),
      async () => {
        const project = this.requireProject(session.projectId);
        const containerRef = this.getContainerRef(session) || this.buildContainerName(
          session.projectId,
          session.dashboardId,
          session.revisionId,
          session.id,
        );
        await this.lifecycle.removeContainerIfPresent(containerRef, project.baseDir);
        const status = this.shouldCancelOnStop(session.status) ? "cancelled" : session.status;
        const validationReport = status === "cancelled"
          ? this.buildFailedReport("validation_cancelled", "Custom dashboard validation was stopped.", null)
          : session.validationReport;
        return this.deps.customDashboardRepository.updateValidationSession(session.id, {
          status,
          validationReport,
          runtimeMetadata: this.mergeRuntimeMetadata(session.runtimeMetadata, {
            containerId: null,
            containerName: null,
            hostPort: null,
            lastStoppedAt: new Date().toISOString(),
          }),
          finishedAt: session.finishedAt ?? new Date().toISOString(),
        });
      },
    );
  }

  async removeValidation(sessionId: string): Promise<void> {
    const session = await this.requireValidationSession(sessionId);
    await this.lifecycle.withSessionLock(
      this.buildRevisionLockKey(session.projectId, session.dashboardId, session.revisionId),
      async () => {
        if (this.shouldCancelOnStop(session.status)) {
          this.deps.customDashboardRepository.updateValidationSession(session.id, {
            status: "cancelled",
            validationReport: this.buildFailedReport("validation_cancelled", "Custom dashboard validation was removed.", null),
            finishedAt: new Date().toISOString(),
          });
        }
        const project = this.requireProject(session.projectId);
        const containerRef = this.getContainerRef(session) || this.buildContainerName(
          session.projectId,
          session.dashboardId,
          session.revisionId,
          session.id,
        );
        await this.lifecycle.removeContainerIfPresent(containerRef, project.baseDir);
        this.deps.customDashboardRepository.deleteValidationSession(session.id);
      },
    );
  }

  private async waitForReadiness(session: CustomDashboardValidationSessionRecord, cwd: string): Promise<void> {
    const deadline = Date.now() + this.readinessTimeoutMs;
    while (Date.now() < deadline) {
      const refreshed = await this.refreshRuntimeState(session);
      if (refreshed.status === "passed" || refreshed.status === "running") {
        const hostPort = this.getValidationMetadata(refreshed).hostPort;
        if (typeof hostPort === "number" && await this.fetchHealthStatus(hostPort)) {
          return;
        }
      }
      const containerRef = this.getContainerRef(refreshed);
      if (containerRef) {
        const container = await this.findManagedContainerForSession(refreshed, cwd);
        if (container && container.status !== "running") {
          const logs = await this.readContainerLogs(container.id, cwd).catch(() => "");
          throw new Error(this.extractValidationError(logs) || `Validation container is ${container.status}.`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, this.readinessPollMs));
    }
    throw new Error(`Custom dashboard validation did not become reachable within ${Math.round(this.readinessTimeoutMs / 1000)} seconds.`);
  }

  private async refreshRuntimeState(
    session: CustomDashboardValidationSessionRecord,
  ): Promise<CustomDashboardValidationSessionRecord> {
    const project = this.deps.projectManagementRepository.getProject(session.projectId);
    if (!project) {
      return session;
    }
    const container = await this.findManagedContainerForSession(session, project.baseDir);
    if (!container) {
      if (!this.getContainerRef(session) || this.isTerminalStatus(session.status)) {
        return session;
      }
      const metadata = this.mergeRuntimeMetadata(session.runtimeMetadata, {
        containerId: null,
        containerName: null,
        hostPort: null,
        lastError: "Validation container is no longer present.",
      });
      return this.deps.customDashboardRepository.updateValidationSession(session.id, {
        status: "failed",
        validationReport: this.buildFailedReport("container_missing", "Validation container is no longer present.", null),
        runtimeMetadata: metadata,
        finishedAt: new Date().toISOString(),
      });
    }

    const metadata = this.mergeRuntimeMetadata(session.runtimeMetadata, {
      containerId: container.id,
      containerName: container.name,
      hostPort: container.hostPort,
    });
    if (container.status !== "running" && !this.isTerminalStatus(session.status)) {
      const logs = await this.readContainerLogs(container.id, project.baseDir).catch(() => "");
      const message = this.extractValidationError(logs) || `Validation container is ${container.status}.`;
      return this.deps.customDashboardRepository.updateValidationSession(session.id, {
        status: "failed",
        validationReport: this.buildFailedReport("container_exited", message, tailLogLines(logs, CUSTOM_DASHBOARD_VALIDATION_LOG_TAIL_LINES)),
        runtimeMetadata: this.mergeRuntimeMetadata(metadata, {
          lastError: message,
          logExcerpt: tailLogLines(logs, CUSTOM_DASHBOARD_VALIDATION_LOG_TAIL_LINES),
        }),
        finishedAt: new Date().toISOString(),
      });
    }

    const nextValidationMetadata = this.getValidationMetadata({ runtimeMetadata: metadata });
    const currentValidationMetadata = this.getValidationMetadata(session);
    if (
      container.status === "running"
      && (nextValidationMetadata.containerId !== currentValidationMetadata.containerId
        || nextValidationMetadata.hostPort !== currentValidationMetadata.hostPort)
    ) {
      return this.deps.customDashboardRepository.updateValidationSession(session.id, { runtimeMetadata: metadata });
    }
    return session;
  }

  private async findManagedContainerForSession(
    session: CustomDashboardValidationSessionRecord,
    cwd: string,
  ): Promise<ValidationContainerSummary | null> {
    const containers = await this.listValidationContainers(cwd);
    const metadata = this.getValidationMetadata(session);
    const containerId = typeof metadata.containerId === "string" ? metadata.containerId.trim() : "";
    const containerName = typeof metadata.containerName === "string" ? metadata.containerName.trim() : "";
    return containers.find((container) => container.labels["code-ux.session-id"] === session.id)
      ?? containers.find((container) => container.id === containerId)
      ?? containers.find((container) => containerName.length > 0 && container.name === containerName)
      ?? null;
  }

  private async listValidationContainers(cwd: string): Promise<ValidationContainerSummary[]> {
    try {
      const result = await runCommandStrict(
        "docker",
        [
          "ps",
          "-a",
          "--filter", "label=code-ux.custom-dashboard-validation=true",
          "--format",
          "{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Label \"code-ux.project-id\"}}\t{{.Label \"code-ux.dashboard-id\"}}\t{{.Label \"code-ux.revision-id\"}}\t{{.Label \"code-ux.session-id\"}}\t{{.Label \"code-ux.host-port\"}}",
        ],
        cwd,
      );
      return this.parseDockerPsOutput(result.stdout);
    } catch {
      return [];
    }
  }

  private parseDockerPsOutput(stdout: string): ValidationContainerSummary[] {
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, name, rawStatus, projectId, dashboardId, revisionId, sessionId, hostPortRaw] = line.split("\t");
        const parsedPort = hostPortRaw ? Number.parseInt(hostPortRaw, 10) : NaN;
        return {
          id,
          name: name || null,
          status: this.lifecycle.normalizeDockerState(rawStatus),
          hostPort: Number.isInteger(parsedPort) ? parsedPort : null,
          labels: {
            "code-ux.project-id": projectId || "",
            "code-ux.dashboard-id": dashboardId || "",
            "code-ux.revision-id": revisionId || "",
            "code-ux.session-id": sessionId || "",
          },
        };
      });
  }

  private async fetchHealthStatus(hostPort: number): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await this.fetchImpl(`http://127.0.0.1:${hostPort}/`, { signal: controller.signal });
        return response.status < 500;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }

  private async readContainerLogs(containerRef: string, cwd: string): Promise<string> {
    const result = await runCommandStrict(
      "docker",
      ["logs", "--tail", String(CUSTOM_DASHBOARD_VALIDATION_LOG_TAIL_LINES), containerRef],
      cwd,
    );
    return [result.stdout, result.stderr].filter((output) => output.trim().length > 0).join("\n");
  }

  private extractValidationError(logs: string): string | null {
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

  private async findFreePort(start: number, end: number): Promise<number> {
    const lower = Number.isInteger(start) ? Math.max(1, start) : 4445;
    const upper = Number.isInteger(end) ? Math.min(65535, end) : 4999;
    for (let port = lower; port <= upper; port += 1) {
      if (await this.checkPortAvailable(port)) {
        return port;
      }
    }
    throw new Error(`No free validation ports available in range ${lower}-${upper}.`);
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

  private async readViewerArtifact(
    workspacePath: string,
    revision: CustomDashboardRevisionRecord,
  ): Promise<CustomDashboardJsonObject> {
    const distPath = path.join(workspacePath, "dist");
    const files = await this.collectViewerArtifactFiles(distPath);
    if (!files.some((file) => file.path === "index.html")) {
      throw new Error("Custom dashboard build did not produce dist/index.html for the published viewer.");
    }
    return {
      kind: "vite-dist",
      entryFile: "index.html",
      sourceEntryFile: revision.manifest.entryFile,
      generatedAt: new Date().toISOString(),
      files: files.map((file) => ({ ...file })),
    };
  }

  private async collectViewerArtifactFiles(rootPath: string): Promise<ViewerArtifactFile[]> {
    let totalBytes = 0;
    const files: ViewerArtifactFile[] = [];
    const visit = async (currentPath: string): Promise<void> => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          await visit(absolutePath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        const stat = await fs.stat(absolutePath);
        if (stat.size > VIEWER_ARTIFACT_MAX_FILE_BYTES) {
          throw new Error(`Custom dashboard viewer artifact file is too large: ${path.relative(rootPath, absolutePath)}`);
        }
        totalBytes += stat.size;
        if (totalBytes > VIEWER_ARTIFACT_MAX_TOTAL_BYTES) {
          throw new Error("Custom dashboard viewer artifact exceeds the maximum persisted size.");
        }
        const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join("/");
        files.push({
          path: relativePath,
          content: await fs.readFile(absolutePath, "utf8"),
          contentType: this.inferViewerArtifactContentType(relativePath),
        });
      }
    };
    await visit(rootPath);
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  private inferViewerArtifactContentType(filePath: string): string {
    if (filePath.endsWith(".html")) return "text/html";
    if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript";
    if (filePath.endsWith(".css")) return "text/css";
    if (filePath.endsWith(".json")) return "application/json";
    if (filePath.endsWith(".svg")) return "image/svg+xml";
    return "text/plain";
  }

  private requireProject(projectId: string) {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new EntityNotFoundError(`Project not found: ${projectId}`);
    }
    return project;
  }

  private requireDashboardForProject(projectId: string, dashboardId: string) {
    const dashboard = this.deps.customDashboardRepository.getDashboardById(dashboardId);
    if (!dashboard || dashboard.projectId !== projectId) {
      throw new EntityNotFoundError(`Custom dashboard not found: ${dashboardId}`);
    }
    return dashboard;
  }

  private requireRevision(
    projectId: string,
    dashboardId: string,
    revisionId: string,
  ): CustomDashboardRevisionRecord {
    const revision = this.deps.customDashboardRepository.getRevisionById(revisionId);
    if (!revision || revision.projectId !== projectId || revision.dashboardId !== dashboardId) {
      throw new EntityNotFoundError(`Custom dashboard revision not found: ${revisionId}`);
    }
    return revision;
  }

  private async requireValidationSession(sessionId: string): Promise<CustomDashboardValidationSessionRecord> {
    const session = await this.getValidationSession(sessionId);
    if (!session) {
      throw new EntityNotFoundError("Custom dashboard validation session not found.");
    }
    return session;
  }

  private buildRuntimeMetadata(values: Record<string, unknown>): RuntimeMetadataPatch {
    return { validation: this.pruneJsonObject(values) };
  }

  private mergeRuntimeMetadata(
    current: CustomDashboardJsonObject | null | undefined,
    values: Record<string, unknown>,
  ): RuntimeMetadataPatch {
    const existing = this.getValidationMetadata({ runtimeMetadata: current ?? {} });
    return {
      validation: {
        ...existing,
        ...this.pruneJsonObject(values),
      },
    };
  }

  private pruneJsonObject(values: Record<string, unknown>): CustomDashboardJsonObject {
    const result: CustomDashboardJsonObject = {};
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        continue;
      }
      result[key] = value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? value
        : JSON.parse(JSON.stringify(value)) as CustomDashboardJsonObject[string];
    }
    return result;
  }

  private getValidationMetadata(
    session: Pick<CustomDashboardValidationSessionRecord, "runtimeMetadata">,
  ): Record<string, CustomDashboardJsonObject[keyof CustomDashboardJsonObject]> {
    const value = session.runtimeMetadata.validation;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, CustomDashboardJsonObject[keyof CustomDashboardJsonObject]>
      : {};
  }

  private getMetadataString(
    metadata: Record<string, CustomDashboardJsonObject[keyof CustomDashboardJsonObject]>,
    key: string,
  ): string | null {
    const value = metadata[key];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  }

  private getContainerRef(session: CustomDashboardValidationSessionRecord): string | null {
    const metadata = this.getValidationMetadata(session);
    const containerId = typeof metadata.containerId === "string" ? metadata.containerId.trim() : "";
    if (containerId) {
      return containerId;
    }
    const containerName = typeof metadata.containerName === "string" ? metadata.containerName.trim() : "";
    return containerName || null;
  }

  private buildProxyHeaders(headers: Record<string, string | undefined> = {}, upstreamOrigin: string): Record<string, string> {
    const next: Record<string, string> = {};
    const stripList = ["authorization", "cookie", "set-cookie", "connection", "upgrade", "transfer-encoding", "host", "content-length", "accept-encoding"];
    for (const [key, value] of Object.entries(headers)) {
      if (!value) continue;
      const normalized = key.toLowerCase();
      if (stripList.includes(normalized) || normalized.startsWith("proxy-") || normalized.startsWith("x-code-ux-")) {
        continue;
      }
      if (normalized === "origin") {
        next[key] = upstreamOrigin;
        continue;
      }
      if (normalized === "referer") {
        next[key] = this.normalizeProxyRefererHeader(value, upstreamOrigin);
        continue;
      }
      if (normalized === "sec-fetch-site") {
        next[key] = "same-origin";
        continue;
      }
      next[key] = value;
    }
    return next;
  }

  private normalizeProxyRefererHeader(value: string, upstreamOrigin: string): string {
    try {
      const refererUrl = new URL(value);
      return `${upstreamOrigin}${refererUrl.pathname}${refererUrl.search}${refererUrl.hash}`;
    } catch {
      return upstreamOrigin;
    }
  }

  private shouldStripProxyResponseHeader(headerName: string): boolean {
    return [
      "set-cookie",
      "content-security-policy",
      "content-security-policy-report-only",
      "x-frame-options",
    ].includes(headerName.toLowerCase());
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

  private buildPassedReport(
    hostPort: number,
    containerId: string,
    containerName: string,
    validationUrlPath: string,
    logs: string,
  ): CustomDashboardValidationReport {
    return {
      valid: true,
      summary: "Custom dashboard revision built, started, and passed health checks.",
      issues: [],
      metadata: {
        hostPort,
        containerId,
        containerName,
        validationUrlPath,
        logExcerpt: tailLogLines(logs, CUSTOM_DASHBOARD_VALIDATION_LOG_TAIL_LINES),
      },
    };
  }

  private buildFailedReport(
    code: string,
    message: string,
    logExcerpt: unknown,
  ): CustomDashboardValidationReport {
    return {
      valid: false,
      summary: message,
      issues: [{ field: "runtime", code, message }],
      metadata: typeof logExcerpt === "string" && logExcerpt.trim().length > 0 ? { logExcerpt } : {},
    };
  }

  private shouldCancelOnStop(status: CustomDashboardValidationStatus): boolean {
    return status === "queued" || status === "building" || status === "running";
  }

  private isTerminalStatus(status: CustomDashboardValidationStatus): boolean {
    return status === "passed" || status === "failed" || status === "cancelled";
  }

  private buildRevisionLockKey(projectId: string, dashboardId: string, revisionId: string): string {
    return `${projectId}:${dashboardId}:${revisionId}`;
  }

  private buildContainerName(projectId: string, dashboardId: string, revisionId: string, sessionId: string): string {
    return [
      "code-ux-cdash",
      sanitizeContainerNameComponent(projectId, 12),
      sanitizeContainerNameComponent(dashboardId, 12),
      sanitizeContainerNameComponent(revisionId, 12),
      sanitizeContainerNameComponent(sessionId, 12),
    ].join("-").slice(0, 63);
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

  private async resolveDockerUserSpec(workspacePath: string): Promise<string> {
    try {
      const stats = await fs.stat(workspacePath);
      if (typeof stats.uid === "number" && typeof stats.gid === "number" && stats.uid !== 0) {
        return `${stats.uid}:${stats.gid}`;
      }
    } catch {
      // fall through to getDockerUserSpec
    }
    return getDockerUserSpec();
  }

  private async resolveContainerSetupScriptPath(
    repoPath: string,
    configuredSetupScriptPath: string,
  ): Promise<string | null> {
    const configured = configuredSetupScriptPath.trim();
    const candidates = configured
      ? [resolveConfiguredPath(repoPath, configured)]
      : [path.join(repoPath, ".code-ux", "container", "setup.sh"), BUNDLED_CONTAINER_SETUP_SCRIPT];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
    return null;
  }
}
