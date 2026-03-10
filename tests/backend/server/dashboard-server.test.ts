import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { setupDashboardServer } from "../../../src/server/dashboard-server.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
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
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], recentEvents: [], updatedAt: null }),
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
      getSettings: () => ({
        dashboardPort: 4444,
        automationLevel: "SEMI_AUTO",
        automationInterventions: {
          autoApprovePlan: true,
          autoAnswerClarification: false,
          autoResumePaused: false,
          clarificationAnswerTemplate: "",
        },
        aiProvider: {
          provider: "jules",
          strategy: "MANUAL",
          providers: {
            jules: { enabled: true, model: "default", weight: 60, thinkingMode: "MEDIUM", apiKey: "" },
            gemini: { enabled: true, model: "default", weight: 20, thinkingMode: "MEDIUM", apiKey: "" },
            codex: { enabled: true, model: "default", weight: 20, thinkingMode: "HIGH", apiKey: "" },
            "claude-code": { enabled: false, model: "default", weight: 0, thinkingMode: "HIGH", apiKey: "" },
          },
          julesApiKey: "",
        },
        git: {
          githubMode: "LOCAL",
          githubToken: "",
          defaultBranch: "main",
          autoCreatePr: true,
          featureBranchPrefix: "feature/",
          sprintBranchScheme: "feature/sprint{sprint}-implementation",
        },
        ciIntelligence: {
          enabled: false,
          enableLivePrMonitoring: false,
          waitForCiBeforeMainMerge: false,
          resolveAllCommentsBeforeMainMerge: false,
          waitForCiBeforeFeatureMerge: false,
          resolveAllCommentsBeforeFeatureMerge: false,
          waitForJulesCiAutofix: false,
          julesCiAutofixMaxRetries: 0,
          featurePrAutoMergeMode: "OFF",
        },
        sprintLoopSteps: {
          branchPreflight: true,
          planningPreflight: true,
          loadSubtasks: true,
          sessionSync: true,
          statusDerivation: true,
          startReadyTasks: true,
          mergeProtocol: true,
          actionRequiredProtocol: true,
          statusTable: true,
          watchLoop: false,
          watchLoopIntervalSeconds: 120,
          watchLoopOutputIntervalSeconds: 300,
        },
        cliWorkflow: {
          cleanupWorktreeOnSuccess: true,
          cleanupWorktreeOnFailure: false,
          retryOnReadFileNotFound: true,
          resumeFailedTaskInSameWorkspace: true,
          executionMode: "HOST",
          containerImage: "node:24-bookworm",
          containerSetupScriptPath: "",
          containerMountCredentials: false,
          containerMountGitConfig: true,
          containerMountGithubAuth: true,
          containerMountGeminiAuth: true,
          containerMountCodexAuth: true,
          containerMountClaudeCodeAuth: true,
          containerGithubAuthPath: "~/.config/gh",
          containerGeminiAuthPath: "~/.gemini",
          containerCodexAuthPath: "~/.codex",
          containerClaudeCodeAuthPath: "~/.claude",
        },
        skills: [],
        mcpTools: [],
      }),
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      saveSettings: (settings) => settings,
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
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], recentEvents: [], updatedAt: null }),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      getSettings: () => ({} as any),
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      saveSettings: (settings) => settings,
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
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], recentEvents: [], updatedAt: null }),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      getSettings: () => ({} as any),
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      saveSettings: (settings) => settings,
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

  it("streams and replays realtime events over /api/realtime", async () => {
    const app = express();
    const realtimeService = await createRealtimeService();
    const port = await getAvailablePort();
    realtimeService.setSnapshotLoaders({
      getProjectsSnapshot: () => ({
        projects: [],
        selectedProjectId: null,
      }),
      getProjectExecutionSnapshot: () => ({
        projectId: "project-1",
        projectName: "Project 1",
        sprintRuns: [],
        taskDispatches: [],
        connections: [],
        recentEvents: [],
        updatedAt: "2026-03-10T00:00:00.000Z",
      }),
      getOverviewTelemetrySnapshot: () => ({
        activeProjects: [],
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
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], recentEvents: [], updatedAt: null }),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      getSettings: () => ({} as any),
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      saveSettings: (settings) => settings,
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
      getProjectExecutionSnapshot: () => ({
        projectId: "project-1",
        projectName: "Project 1",
        sprintRuns: [],
        taskDispatches: [],
        connections: [],
        recentEvents: [],
        updatedAt: "2026-03-10T00:00:00.000Z",
      }),
      getOverviewTelemetrySnapshot: () => ({
        activeProjects: [],
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
      getExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], recentEvents: [], updatedAt: null }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], recentEvents: [], updatedAt: null }),
      getProjectExecutionSnapshot: () => ({ projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], recentEvents: [], updatedAt: null }),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      getSettings: () => ({} as any),
      listAgentPresets: () => [],
      createAgentPreset: () => ({ id: "agent-1" } as any),
      updateAgentPreset: () => ({ id: "agent-1" } as any),
      deleteAgentPreset: () => {},
      saveSettings: (settings) => settings,
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
});
