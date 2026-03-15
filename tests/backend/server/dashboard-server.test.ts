import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { setupDashboardServer } from "../../../src/server/dashboard-server.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { DashboardRealtimeEventRepository } from "../../../src/repositories/dashboard-realtime-event-repository.js";
import { DashboardRealtimeService } from "../../../src/services/dashboard-realtime-service.js";
import { createLogger } from "../../../src/shared/logging/logger.js";
import type { DashboardRealtimeEventMessage, DashboardRealtimeServerMessage } from "../../../src/contracts/app-types.js";

const serversToClose: Server[] = [];
const tempDirs: string[] = [];

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error && error.message !== "Server is not running.") reject(error);
      else resolve();
    });
  });
};

afterEach(async () => {
  while (serversToClose.length > 0) {
    const server = serversToClose.pop();
    if (server) {
      await closeServer(server);
    }
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createRealtimeService(): Promise<DashboardRealtimeService> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-dashboard-realtime-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return new DashboardRealtimeService(
    new DashboardRealtimeEventRepository(storage),
    createLogger({ bindings: { component: "dashboard-realtime-test" } }),
  );
}

async function openRealtimeSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/realtime`);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket failed to open")), { once: true });
  });
  return socket;
}

async function getAvailablePort(): Promise<number> {
  const blocker = await new Promise<Server>((resolve) => {
    const server = express().listen(0, "127.0.0.1", () => resolve(server));
  });
  const port = (blocker.address() as AddressInfo).port;
  await closeServer(blocker);
  return port;
}

function buildSettingsServerOptions() {
  return {
    getSystemSettings: () => ({
      runtime: {
        dashboardPort: DEFAULT_DASHBOARD_SETTINGS.dashboardPort,
        enableDebugLogFile: DEFAULT_DASHBOARD_SETTINGS.enableDebugLogFile,
      },
      integrations: {
        julesApiKey: "",
        geminiApiKey: "",
        codexApiKey: "",
        claudeCodeApiKey: "",
        githubToken: "",
      },
      defaults: {
        automationLevel: DEFAULT_DASHBOARD_SETTINGS.automationLevel,
        automationInterventions: { ...DEFAULT_DASHBOARD_SETTINGS.automationInterventions },
        aiProvider: {
          provider: DEFAULT_DASHBOARD_SETTINGS.aiProvider.provider,
          strategy: DEFAULT_DASHBOARD_SETTINGS.aiProvider.strategy,
          providers: {
            jules: {
              enabled: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules.enabled,
              model: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules.model,
              weight: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules.weight,
              thinkingMode: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules.thinkingMode,
            },
            gemini: {
              enabled: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini.enabled,
              model: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini.model,
              weight: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini.weight,
              thinkingMode: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini.thinkingMode,
            },
            codex: {
              enabled: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex.enabled,
              model: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex.model,
              weight: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex.weight,
              thinkingMode: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex.thinkingMode,
            },
            "claude-code": {
              enabled: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["claude-code"].enabled,
              model: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["claude-code"].model,
              weight: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["claude-code"].weight,
              thinkingMode: DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["claude-code"].thinkingMode,
            },
          },
        },
        git: {
          githubMode: DEFAULT_DASHBOARD_SETTINGS.git.githubMode,
          defaultBranch: DEFAULT_DASHBOARD_SETTINGS.git.defaultBranch,
          autoCreatePr: DEFAULT_DASHBOARD_SETTINGS.git.autoCreatePr,
          featureBranchPrefix: DEFAULT_DASHBOARD_SETTINGS.git.featureBranchPrefix,
          sprintBranchScheme: DEFAULT_DASHBOARD_SETTINGS.git.sprintBranchScheme,
        },
        ciIntelligence: { ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence },
        sprintLoopSteps: { ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps },
        cliWorkflow: { ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow },
        agents: { ...DEFAULT_DASHBOARD_SETTINGS.agents },
        skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
      },
      mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) => ({ ...tool })),
    }),
    saveSystemSettings: (settings: unknown) => settings,
    resetDatabase: async () => {},
    getProjectSettings: () => ({}),
    saveProjectSettings: (_projectId: string, settings: unknown) => settings,
    resetProjectSettings: () => {},
    getProjectEffectiveSettings: () => ({ settings: DEFAULT_DASHBOARD_SETTINGS, sources: {} }),
    getSprintSettings: () => ({}),
    saveSprintSettings: (_projectId: string, _sprintId: string, settings: unknown) => settings,
    resetSprintSettings: () => {},
    getSprintEffectiveSettings: () => ({ settings: DEFAULT_DASHBOARD_SETTINGS, sources: {} }),
  };
}

async function waitForRealtimeMessage(
  socket: WebSocket,
  predicate: (message: DashboardRealtimeServerMessage) => boolean,
): Promise<DashboardRealtimeServerMessage> {
  return await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for realtime message"));
    }, 2000);

    const onMessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(String(event.data || "")) as DashboardRealtimeServerMessage;
      if (!predicate(message)) {
        return;
      }
      clearTimeout(timeoutId);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    };

    socket.addEventListener("message", onMessage);
  });
}

describe("setupDashboardServer", () => {
  it("tries next port when requested port is in use", async () => {
    const blocker = await new Promise<Server>((resolve) => {
      const server = express().listen(0, "127.0.0.1", () => resolve(server));
    });
    serversToClose.push(blocker);
    const blockedPort = (blocker.address() as AddressInfo).port;

    const app = express();
    const handle = await setupDashboardServer({
      app,
      dashboardDir: "dashboard",
      port: blockedPort,
      liveActivityCacheMs: 1000,
      getStatus: () => ({ ok: true }),
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], attentionProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({
        mode: "LOCAL",
        available: true,
        repositoryRoot: null,
        branch: null,
        hasRemote: false,
        dirty: false,
        openPullRequests: [],
        ciRuns: [],
        mergedPullRequests: [],
        tracking: { scope: "REPOSITORY", label: "Repository", branch: null },
        warnings: [],
        lastUpdated: new Date().toISOString(),
      }),
      getExternalSettingsHints: () => ({
        env: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
        settingsJson: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
        resolved: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
      }),
      ...buildSettingsServerOptions(),
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      rerunTask: async () => ({ ok: true }),
      orchestrateSprint: async () => ({ ok: true }),
      pauseSprintRun: async () => ({ ok: true }),
      cancelSprintRun: async () => ({ ok: true }),
      cancelTaskDispatch: async () => ({ ok: true }),
      retryTaskDispatch: async () => ({ ok: true }),
    });

    serversToClose.push(handle.server);
    expect(handle.port).toBe(blockedPort + 1);
  });

  it("serves /health and /ready endpoints with detailed probe payload", async () => {
    const app = express();
    const probeResponse = {
      status: "READY" as const,
      components: {
        settingsDb: "UP" as const,
        dashboardBind: "UP" as const,
        mcpService: "UP" as const,
      }
    };
    const healthResponseData = {
      status: "UP" as const,
      components: {
        settingsDb: "UP" as const,
        dashboardBind: "UP" as const,
        mcpService: "UP" as const,
      }
    };

    const handle = await setupDashboardServer({
      app,
      dashboardDir: "dashboard",
      port: 3001,
      liveActivityCacheMs: 1000,
      getStatus: () => ({ ok: true }),
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], attentionProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      ...buildSettingsServerOptions(),
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      rerunTask: async () => ({ ok: true }),
      orchestrateSprint: async () => ({ ok: true }),
      pauseSprintRun: async () => ({ ok: true }),
      cancelSprintRun: async () => ({ ok: true }),
      cancelTaskDispatch: async () => ({ ok: true }),
      retryTaskDispatch: async () => ({ ok: true }),
      isReady: () => probeResponse,
      isHealthy: () => healthResponseData,
    });
    serversToClose.push(handle.server);

    const healthResponse = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toEqual(healthResponseData);

    const readyResponse = await fetch(`http://127.0.0.1:${handle.port}/ready`);
    expect(readyResponse.status).toBe(200);
    expect(await readyResponse.json()).toEqual(probeResponse);
  });

  it("returns 503 for /ready when server is not ready", async () => {
    const app = express();
    const probeResponse = {
      status: "NOT_READY" as const,
      components: {
        settingsDb: "UP" as const,
        dashboardBind: "UP" as const,
        mcpService: "DOWN" as const,
      }
    };

    const handle = await setupDashboardServer({
      app,
      dashboardDir: "dashboard",
      port: 4000,
      liveActivityCacheMs: 1000,
      getStatus: () => ({ ok: true }),
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], attentionProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      ...buildSettingsServerOptions(),
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      rerunTask: async () => ({ ok: true }),
      orchestrateSprint: async () => ({ ok: true }),
      pauseSprintRun: async () => ({ ok: true }),
      cancelSprintRun: async () => ({ ok: true }),
      cancelTaskDispatch: async () => ({ ok: true }),
      retryTaskDispatch: async () => ({ ok: true }),
      isReady: () => probeResponse,
    });
    serversToClose.push(handle.server);

    const readyResponse = await fetch(`http://127.0.0.1:${handle.port}/ready`);
    expect(readyResponse.status).toBe(503);
    expect(await readyResponse.json()).toEqual(probeResponse);
  });

  it("resets the database through the system reset endpoint", async () => {
    const app = express();
    let resetCalls = 0;

    const handle = await setupDashboardServer({
      app,
      dashboardDir: "dashboard",
      port: await getAvailablePort(),
      liveActivityCacheMs: 1000,
      getStatus: () => ({ ok: true }),
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], attentionProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      ...buildSettingsServerOptions(),
      resetDatabase: async () => {
        resetCalls += 1;
      },
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      rerunTask: async () => ({ ok: true }),
      orchestrateSprint: async () => ({ ok: true }),
      pauseSprintRun: async () => ({ ok: true }),
      cancelSprintRun: async () => ({ ok: true }),
      cancelTaskDispatch: async () => ({ ok: true }),
      retryTaskDispatch: async () => ({ ok: true }),
    });
    serversToClose.push(handle.server);

    const response = await fetch(`http://127.0.0.1:${handle.port}/api/system/reset-database`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(resetCalls).toBe(1);
  });

  it("routes attention item claim and resolve actions", async () => {
    const app = express();
    const claimedItem = {
      id: "attention-1",
      sprintId: "sprint-1",
      taskId: "task-1",
      sprintRunId: null,
      dispatchId: "dispatch-1",
      attentionType: "merge_required",
      severity: "high",
      ownerType: "worker",
      status: "claimed",
      assignedWorkerEndpointId: "worker-endpoint-1",
      title: "Merge required",
      summaryMarkdown: "Needs merge handling",
      payload: { repoPath: "/repo" },
      openedAt: "2026-03-13T00:00:00.000Z",
      claimedAt: "2026-03-13T00:05:00.000Z",
      resolvedAt: null,
      updatedAt: "2026-03-13T00:05:00.000Z",
    };
    const resolvedItem = {
      ...claimedItem,
      status: "dismissed",
      resolvedAt: "2026-03-13T00:10:00.000Z",
      updatedAt: "2026-03-13T00:10:00.000Z",
    };
    let claimArgs: unknown;
    let resolveArgs: unknown;

    const handle = await setupDashboardServer({
      app,
      dashboardDir: "dashboard",
      port: await getAvailablePort(),
      liveActivityCacheMs: 1000,
      getStatus: () => ({ ok: true }),
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], attentionProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      claimAttentionItem: (projectId, attentionItemId, input) => {
        claimArgs = { projectId, attentionItemId, input };
        return claimedItem as any;
      },
      resolveAttentionItem: (projectId, attentionItemId, input) => {
        resolveArgs = { projectId, attentionItemId, input };
        return resolvedItem as any;
      },
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      ...buildSettingsServerOptions(),
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      rerunTask: async () => ({ ok: true }),
      orchestrateSprint: async () => ({ ok: true }),
      pauseSprintRun: async () => ({ ok: true }),
      cancelSprintRun: async () => ({ ok: true }),
      cancelTaskDispatch: async () => ({ ok: true }),
      retryTaskDispatch: async () => ({ ok: true }),
    });
    serversToClose.push(handle.server);

    const claimResponse = await fetch(`http://127.0.0.1:${handle.port}/api/projects/project-1/attention-items/attention-1/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workerEndpointId: "worker-endpoint-1",
        claimReason: "dashboard_claimed",
      }),
    });
    expect(claimResponse.status).toBe(200);
    expect(await claimResponse.json()).toMatchObject({
      id: "attention-1",
      status: "claimed",
      assignedWorkerEndpointId: "worker-endpoint-1",
    });
    expect(claimArgs).toEqual({
      projectId: "project-1",
      attentionItemId: "attention-1",
      input: {
        workerEndpointId: "worker-endpoint-1",
        claimReason: "dashboard_claimed",
      },
    });

    const resolveResponse = await fetch(`http://127.0.0.1:${handle.port}/api/projects/project-1/attention-items/attention-1/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "dismissed",
        reason: "dashboard_dismissed",
        resolutionSummaryMarkdown: "Handled manually in the dashboard.",
      }),
    });
    expect(resolveResponse.status).toBe(200);
    expect(await resolveResponse.json()).toMatchObject({
      id: "attention-1",
      status: "dismissed",
      resolvedAt: "2026-03-13T00:10:00.000Z",
    });
    expect(resolveArgs).toEqual({
      projectId: "project-1",
      attentionItemId: "attention-1",
      input: {
        status: "dismissed",
        reason: "dashboard_dismissed",
        resolutionSummaryMarkdown: "Handled manually in the dashboard.",
      },
    });
  });

  it("streams and replays realtime events over /api/realtime", async () => {
    const app = express();
    const realtimeService = await createRealtimeService();
    const port = await getAvailablePort();
    realtimeService.setSnapshotLoaders({
      getProjectsSnapshot: () => ({
        projects: [],
        selectedProjectId: null,
      }),
      getProjectStatusSnapshot: () => ({
        project_id: "project-1",
        subtasks: [],
        timestamp: "2026-03-10T00:00:00.000Z",
      }),
      getProjectExecutionSnapshot: () => ({
        projectId: "project-1",
        projectName: "Project 1",
        sprintRuns: [],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: "2026-03-10T00:00:00.000Z",
      }),
      getOverviewTelemetrySnapshot: () => ({
        activeProjects: [],
        attentionProjects: [],
        recentEvents: [],
        updatedAt: "2026-03-10T00:00:00.000Z",
      }),
    });

    const handle = await setupDashboardServer({
      app,
      dashboardDir: "dashboard",
      port,
      liveActivityCacheMs: 1000,
      getStatus: () => ({ ok: true }),
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], attentionProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      ...buildSettingsServerOptions(),
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      rerunTask: async () => ({ ok: true }),
      orchestrateSprint: async () => ({ ok: true }),
      pauseSprintRun: async () => ({ ok: true }),
      cancelSprintRun: async () => ({ ok: true }),
      forceCancelSprintRun: async () => ({ ok: true }),
      cancelTaskDispatch: async () => ({ ok: true }),
      forceCancelTaskDispatch: async () => ({ ok: true }),
      retryTaskDispatch: async () => ({ ok: true }),
      realtimeService,
    });
    serversToClose.push(handle.server);

    realtimeService.publishRawEvent({
      scopeType: "project",
      scopeId: "project-1",
      eventType: "project.execution.updated",
      entityType: "project",
      entityId: "project-1",
      projectId: "project-1",
      payload: { projectId: "project-1", sprintRuns: [] },
    });

    const socket = await openRealtimeSocket(handle.port);
    try {
      socket.send(JSON.stringify({
        type: "set_subscriptions",
        scopes: ["project:project-1"],
        lastSequence: 0,
      }));
      await waitForRealtimeMessage(socket, (message) => message.type === "subscribed");

      realtimeService.publishRawEvent({
        scopeType: "project",
        scopeId: "project-1",
        eventType: "project.execution.updated",
        entityType: "project",
        entityId: "project-1",
        projectId: "project-1",
        payload: { projectId: "project-1", sprintRuns: [{ id: "run-2" }] },
      });

      const pushed = await waitForRealtimeMessage(socket, (message) => (
        message.type === "event" && message.event.sequence === 2
      )) as DashboardRealtimeEventMessage;
      expect(pushed.event).toMatchObject({
        scope: "project:project-1",
        eventType: "project.execution.updated",
      });

      socket.send(JSON.stringify({
        type: "set_subscriptions",
        scopes: ["project:project-1"],
        lastSequence: 1,
      }));
      const replayed = await waitForRealtimeMessage(socket, (message) => (
        message.type === "event" && message.event.sequence === 2
      )) as DashboardRealtimeEventMessage;
      expect(replayed.event.sequence).toBe(2);
    } finally {
      socket.close();
    }
  });

  it("requires a snapshot when websocket replay would truncate missed events", async () => {
    const app = express();
    const realtimeService = await createRealtimeService();
    const port = await getAvailablePort();
    realtimeService.setSnapshotLoaders({
      getProjectsSnapshot: () => ({
        projects: [],
        selectedProjectId: null,
      }),
      getProjectStatusSnapshot: () => ({
        project_id: "project-1",
        subtasks: [],
        timestamp: "2026-03-10T00:00:00.000Z",
      }),
      getProjectExecutionSnapshot: () => ({
        projectId: "project-1",
        projectName: "Project 1",
        sprintRuns: [],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: "2026-03-10T00:00:00.000Z",
      }),
      getOverviewTelemetrySnapshot: () => ({
        activeProjects: [],
        attentionProjects: [],
        recentEvents: [],
        updatedAt: "2026-03-10T00:00:00.000Z",
      }),
    });

    const handle = await setupDashboardServer({
      app,
      dashboardDir: "dashboard",
      port,
      liveActivityCacheMs: 1000,
      getStatus: () => ({ ok: true }),
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], attentionProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      ...buildSettingsServerOptions(),
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      rerunTask: async () => ({ ok: true }),
      orchestrateSprint: async () => ({ ok: true }),
      pauseSprintRun: async () => ({ ok: true }),
      cancelSprintRun: async () => ({ ok: true }),
      forceCancelSprintRun: async () => ({ ok: true }),
      cancelTaskDispatch: async () => ({ ok: true }),
      forceCancelTaskDispatch: async () => ({ ok: true }),
      retryTaskDispatch: async () => ({ ok: true }),
      realtimeService,
    });
    serversToClose.push(handle.server);

    for (let index = 0; index < 205; index += 1) {
      realtimeService.publishRawEvent({
        scopeType: "project",
        scopeId: "project-1",
        eventType: "project.execution.updated",
        entityType: "project",
        entityId: "project-1",
        projectId: "project-1",
        payload: { sequence: index + 1 },
      });
    }

    const socket = await openRealtimeSocket(handle.port);
    try {
      socket.send(JSON.stringify({
        type: "set_subscriptions",
        scopes: ["project:project-1"],
        lastSequence: 1,
      }));

      const snapshotRequired = await waitForRealtimeMessage(socket, (message) => (
        message.type === "snapshot_required"
      ));
      expect(snapshotRequired).toMatchObject({
        type: "snapshot_required",
        reason: "replay_window_exceeded",
      });
    } finally {
      socket.close();
    }
  });

  it("requires a snapshot when a client misses a live-only project snapshot event", async () => {
    const app = express();
    const realtimeService = await createRealtimeService();
    const port = await getAvailablePort();
    realtimeService.setSnapshotLoaders({
      getProjectsSnapshot: () => ({
        projects: [],
        selectedProjectId: null,
      }),
      getProjectStatusSnapshot: () => ({
        project_id: "project-1",
        subtasks: [],
        timestamp: "2026-03-10T00:00:00.000Z",
      }),
      getProjectExecutionSnapshot: () => ({
        projectId: "project-1",
        projectName: "Project 1",
        sprintRuns: [],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: "2026-03-10T00:00:00.000Z",
      }),
      getOverviewTelemetrySnapshot: () => ({
        activeProjects: [],
        attentionProjects: [],
        recentEvents: [],
        updatedAt: "2026-03-10T00:00:00.000Z",
      }),
    });

    const handle = await setupDashboardServer({
      app,
      dashboardDir: "dashboard",
      port,
      liveActivityCacheMs: 1000,
      getStatus: () => ({ ok: true }),
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], attentionProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], primaryAssignedWorker: null, overflowAssignedWorkers: [], attentionItems: [], recentEvents: [], updatedAt: null }),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      ...buildSettingsServerOptions(),
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      rerunTask: async () => ({ ok: true }),
      orchestrateSprint: async () => ({ ok: true }),
      pauseSprintRun: async () => ({ ok: true }),
      cancelSprintRun: async () => ({ ok: true }),
      forceCancelSprintRun: async () => ({ ok: true }),
      cancelTaskDispatch: async () => ({ ok: true }),
      forceCancelTaskDispatch: async () => ({ ok: true }),
      retryTaskDispatch: async () => ({ ok: true }),
      realtimeService,
    });
    serversToClose.push(handle.server);

    realtimeService.publishRawEvent({
      scopeType: "project",
      scopeId: "project-1",
      eventType: "project.runtime_status.updated",
      entityType: "project_status",
      entityId: "project-1",
      projectId: "project-1",
      payload: { project_id: "project-1", subtasks: [] },
    });
    realtimeService.scheduleProjectExecutionRefresh("project-1");
    await new Promise((resolve) => setTimeout(resolve, 200));

    const socket = await openRealtimeSocket(handle.port);
    try {
      socket.send(JSON.stringify({
        type: "set_subscriptions",
        scopes: ["project:project-1"],
        lastSequence: 1,
      }));

      const snapshotRequired = await waitForRealtimeMessage(socket, (message) => (
        message.type === "snapshot_required"
      ));
      expect(snapshotRequired).toMatchObject({
        type: "snapshot_required",
        reason: "non_replayable_event_missed",
      });
    } finally {
      socket.close();
    }
  });
});
