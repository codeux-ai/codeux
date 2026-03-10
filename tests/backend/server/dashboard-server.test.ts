import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { setupDashboardServer } from "../../../src/server/dashboard-server.js";

const serversToClose: Server[] = [];

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
});

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
});
