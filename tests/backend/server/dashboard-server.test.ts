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
      saveSettings: (settings) => settings,
      rerunTask: async () => ({ ok: true }),
    });

    serversToClose.push(handle.server);
    expect(handle.port).toBe(blockedPort + 1);
  });
});
