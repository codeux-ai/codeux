import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "http";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { setupDashboardServer } from "../../../src/server/dashboard-server.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ChatThreadRuntimeService } from "../../../src/services/chat-thread-runtime-service.js";
import { ProjectWorkerAssignmentRepository } from "../../../src/repositories/project-worker-assignment-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { vi } from "vitest";

// Mock dependencies minimally
const serversToClose: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const server of serversToClose) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  serversToClose.length = 0;
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("Dashboard Chat API", () => {
  it("supports updating thread route and compacting thread session", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-chat-api-"));
    tempDirs.push(dir);

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectManagementRepository = new ProjectManagementRepository(storage);
    const connectionChatRepository = new ConnectionChatRepository(storage);
    const projectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const chatThreadRuntimeService = new ChatThreadRuntimeService({
      connectionChatRepository,
      projectWorkerAssignmentRepository,
      executionRepository,
      taskService: {
        resolveInvocationProvider: () => ({
          provider: "codex",
          providers: {
            codex: { model: "gpt-4", apiKey: "key", thinkingMode: "HIGH" },
          },
        }),
      } as any,
      getDashboardSettings: () => ({ cliWorkflow: {} } as any),
      getGithubToken: () => undefined,
      agentPresetSyncService: {
        getWorkerAgent: async () => ({ instructionMarkdown: "" }),
      } as any,
      projectManagementRepository,
      providerRunner: {
        runProviderForText: vi.fn().mockResolvedValue({ text: "## Current Objective\nCompact thread" }),
      } as any,
      chatManagementActionService: {
        processManagementAction: vi.fn(),
        executeApprovedAction: vi.fn(),
      } as any,
    });

    const project = projectManagementRepository.createProject({
      name: "Chat Routing Test",
      sourceType: "local",
      sourceRef: path.join(dir, "workspace"),
    });

    const thread = connectionChatRepository.createThread(project.id, {
      title: "Test Thread",
    });
    connectionChatRepository.postDashboardMessage(project.id, {
      threadId: thread.id,
      bodyMarkdown: "Please keep the important context.",
    });

    const app = express();
    const handle = await setupDashboardServer({
      app,
      dashboardDir: "dashboard",
      port: 0,
      liveActivityCacheMs: 1000,
      getStatus: () => ({}),
      getExecutionSnapshot: () => ({} as any),
      getProjectExecutionSnapshot: () => ({} as any),
      getProjectStatsSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      getSystemSettings: () => ({} as any),
      saveSystemSettings: () => ({} as any),
      resetDatabase: () => {},
      getProjectSettings: () => ({} as any),
      saveProjectSettings: () => ({} as any),
      resetProjectSettings: () => {},
      getProjectEffectiveSettings: () => ({} as any),
      getSprintSettings: () => ({} as any),
      saveSprintSettings: () => ({} as any),
      resetSprintSettings: () => {},
      getSprintEffectiveSettings: () => ({} as any),
      listProjects: () => ({ projects: [], selectedProjectId: null }),
      createProject: () => ({} as any),
      getProject: () => ({} as any),
      updateProject: () => ({} as any),
      deleteProject: () => {},
      selectProject: () => null,
      selectSprint: () => null,
      listSprints: () => ({ sprints: [], selectedSprintId: null }),
      createSprint: () => ({} as any),
      updateSprint: () => ({} as any),
      deleteSprint: () => {},
      importSprintFromMarkdown: () => ({} as any),
      exportSprintToMarkdown: () => ({} as any),
      listTasks: () => [],
      createTask: () => ({} as any),
      updateTask: () => ({} as any),
      deleteTask: () => {},
      listConnections: () => [],
      updateConnection: () => ({} as any),
      listAgentPresets: () => [],
      createAgentPreset: () => ({} as any),
      updateAgentPreset: () => ({} as any),
      deleteAgentPreset: () => {},
      listConversationThreads: () => [],
      createConversationThread: () => ({} as any),
      updateConversationThread: () => ({} as any),
      deleteConversationThread: () => {},
      listConversationMessages: () => [],
      postConversationMessage: () => ({} as any),
      listProjectInvocations: () => [],
      listInvocationMessages: () => [],
      rerunTask: async () => ({}),
      orchestrateSprint: async () => ({}),
      pauseSprintRun: async () => ({}),
      cancelSprintRun: async () => ({}),
      forceCancelSprintRun: async () => ({}),
      cancelTaskDispatch: async () => ({}),
      forceCancelTaskDispatch: async () => ({}),
      retryTaskDispatch: async () => ({}),
      updateThreadRoute: (threadId, input) => chatThreadRuntimeService.updateThreadRoute(threadId, input),
      compactThreadSession: (threadId) => chatThreadRuntimeService.compactThreadSession(threadId),
      improveSprintPrompt: async () => ({ ok: true }),
      planSprint: async () => ({ ok: true }),
    });
    serversToClose.push(handle.server);
    const baseUrl = `http://127.0.0.1:${handle.port}`;

    const routeResponse = await fetch(`${baseUrl}/api/conversations/threads/${thread.id}/route`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeKind: "virtual",
        virtualProvider: "codex",
        virtualModel: "gpt-4",
      }),
    });
    expect(routeResponse.status).toBe(200);
    const routedThread = await routeResponse.json() as any;
    expect(routedThread.runtimeState).toMatchObject({
      routeKind: "virtual",
      virtualProvider: "codex",
      modelLabel: "gpt-4",
      replayRequired: true,
    });

    const compactResponse = await fetch(`${baseUrl}/api/conversations/threads/${thread.id}/compact`, {
      method: "POST",
    });
    expect(compactResponse.status).toBe(200);
    const compactedThread = await compactResponse.json() as any;
    expect(compactedThread.runtimeState).toMatchObject({
      replayRequired: true,
      sessionIds: [],
      compactionSummary: {
        markdown: "## Current Objective\nCompact thread",
        provider: "codex",
        model: "gpt-4",
      },
    });
  });

  it("validates worker availability and virtual provider configuration", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-chat-api-"));
    tempDirs.push(dir);

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectManagementRepository = new ProjectManagementRepository(storage);
    const connectionChatRepository = new ConnectionChatRepository(storage);
    const projectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const chatThreadRuntimeService = new ChatThreadRuntimeService({
      connectionChatRepository,
      projectWorkerAssignmentRepository,
      executionRepository,
      taskService: {} as any,
      getDashboardSettings: () => ({ cliWorkflow: {} } as any),
      getGithubToken: () => undefined,
      agentPresetSyncService: {} as any,
      projectManagementRepository,
      providerRunner: {} as any,
      chatManagementActionService: {} as any,
    });

    const project = projectManagementRepository.createProject({
      name: "Chat Routing Validation Test",
      sourceType: "local",
      sourceRef: path.join(dir, "workspace"),
    });

    const thread = connectionChatRepository.createThread(project.id, {
      title: "Test Thread",
    });

    const app = express();
    const handle = await setupDashboardServer({
      app,
      dashboardDir: "dashboard",
      port: 0,
      liveActivityCacheMs: 1000,
      getStatus: () => ({}),
      getExecutionSnapshot: () => ({} as any),
      getProjectExecutionSnapshot: () => ({} as any),
      getProjectStatsSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      getSystemSettings: () => ({} as any),
      saveSystemSettings: () => ({} as any),
      resetDatabase: () => {},
      getProjectSettings: () => ({} as any),
      saveProjectSettings: () => ({} as any),
      resetProjectSettings: () => {},
      getProjectEffectiveSettings: () => ({} as any),
      getSprintSettings: () => ({} as any),
      saveSprintSettings: () => ({} as any),
      resetSprintSettings: () => {},
      getSprintEffectiveSettings: () => ({} as any),
      listProjects: () => ({ projects: [], selectedProjectId: null }),
      createProject: () => ({} as any),
      getProject: () => ({} as any),
      updateProject: () => ({} as any),
      deleteProject: () => {},
      selectProject: () => null,
      selectSprint: () => null,
      listSprints: () => ({ sprints: [], selectedSprintId: null }),
      createSprint: () => ({} as any),
      updateSprint: () => ({} as any),
      deleteSprint: () => {},
      importSprintFromMarkdown: () => ({} as any),
      exportSprintToMarkdown: () => ({} as any),
      listTasks: () => [],
      createTask: () => ({} as any),
      updateTask: () => ({} as any),
      deleteTask: () => {},
      listConnections: () => [],
      updateConnection: () => ({} as any),
      listAgentPresets: () => [],
      createAgentPreset: () => ({} as any),
      updateAgentPreset: () => ({} as any),
      deleteAgentPreset: () => {},
      listConversationThreads: () => [],
      createConversationThread: () => ({} as any),
      updateConversationThread: () => ({} as any),
      deleteConversationThread: () => {},
      listConversationMessages: () => [],
      postConversationMessage: () => ({} as any),
      listProjectInvocations: () => [],
      listInvocationMessages: () => [],
      rerunTask: async () => ({}),
      orchestrateSprint: async () => ({}),
      pauseSprintRun: async () => ({}),
      cancelSprintRun: async () => ({}),
      forceCancelSprintRun: async () => ({}),
      cancelTaskDispatch: async () => ({}),
      forceCancelTaskDispatch: async () => ({}),
      retryTaskDispatch: async () => ({}),
      updateThreadRoute: (threadId, input) => chatThreadRuntimeService.updateThreadRoute(threadId, input),
      compactThreadSession: (threadId) => chatThreadRuntimeService.compactThreadSession(threadId),
      improveSprintPrompt: async () => ({ ok: true }),
      planSprint: async () => ({ ok: true }),
    });
    serversToClose.push(handle.server);
    const baseUrl = `http://127.0.0.1:${handle.port}`;

    // Test unavailable virtual provider
    const invalidVirtualResponse = await fetch(`${baseUrl}/api/conversations/threads/${thread.id}/route`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeKind: "virtual",
        virtualProvider: "not-a-real-provider",
      }),
    });
    expect(invalidVirtualResponse.status).toBe(400);
    const result1 = await invalidVirtualResponse.json() as any;
    expect(result1.error).toContain("Virtual provider is not configured or unavailable");

    // Test unavailable worker
    const invalidWorkerResponse = await fetch(`${baseUrl}/api/conversations/threads/${thread.id}/route`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeKind: "worker",
        workerEndpointId: "missing-worker-id",
      }),
    });
    expect(invalidWorkerResponse.status).toBe(400);
    const result2 = await invalidWorkerResponse.json() as any;
    expect(result2.error).toContain("Connected MCP worker routes are no longer supported");

  });

  it("returns 400 on invalid route mapping inputs", async () => {
    const app = express();
    const handle = await setupDashboardServer({
      app,
      dashboardDir: "dashboard",
      port: 0,
      liveActivityCacheMs: 1000,
      getStatus: () => ({}),
      getExecutionSnapshot: () => ({} as any),
      getProjectExecutionSnapshot: () => ({} as any),
      getProjectStatsSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
      getLiveActivities: async () => ({}),
      getGitStatus: async () => ({} as any),
      getExternalSettingsHints: () => ({} as any),
      getSystemSettings: () => ({} as any),
      saveSystemSettings: () => ({} as any),
      resetDatabase: () => {},
      getProjectSettings: () => ({} as any),
      saveProjectSettings: () => ({} as any),
      resetProjectSettings: () => {},
      getProjectEffectiveSettings: () => ({} as any),
      getSprintSettings: () => ({} as any),
      saveSprintSettings: () => ({} as any),
      resetSprintSettings: () => {},
      getSprintEffectiveSettings: () => ({} as any),
      listProjects: () => ({ projects: [], selectedProjectId: null }),
      createProject: () => ({} as any),
      getProject: () => ({} as any),
      updateProject: () => ({} as any),
      deleteProject: () => {},
      selectProject: () => null,
      selectSprint: () => null,
      listSprints: () => ({ sprints: [], selectedSprintId: null }),
      createSprint: () => ({} as any),
      updateSprint: () => ({} as any),
      deleteSprint: () => {},
      importSprintFromMarkdown: () => ({} as any),
      exportSprintToMarkdown: () => ({} as any),
      listTasks: () => [],
      createTask: () => ({} as any),
      updateTask: () => ({} as any),
      deleteTask: () => {},
      listConnections: () => [],
      updateConnection: () => ({} as any),
      listAgentPresets: () => [],
      createAgentPreset: () => ({} as any),
      updateAgentPreset: () => ({} as any),
      deleteAgentPreset: () => {},
      listConversationThreads: () => [],
      createConversationThread: () => ({} as any),
      updateConversationThread: () => ({} as any),
      deleteConversationThread: () => {},
      listConversationMessages: () => [],
      postConversationMessage: () => ({} as any),
      listProjectInvocations: () => [],
      listInvocationMessages: () => [],
      rerunTask: async () => ({}),
      orchestrateSprint: async () => ({}),
      pauseSprintRun: async () => ({}),
      cancelSprintRun: async () => ({}),
      forceCancelSprintRun: async () => ({}),
      cancelTaskDispatch: async () => ({}),
      forceCancelTaskDispatch: async () => ({}),
      retryTaskDispatch: async () => ({}),
      updateThreadRoute: () => { throw new Error("Should not be called"); },
      compactThreadSession: () => ({} as any),
      improveSprintPrompt: async () => ({ ok: true }),
      planSprint: async () => ({ ok: true }),
    });
    serversToClose.push(handle.server);
    const baseUrl = `http://127.0.0.1:${handle.port}`;

    const routeResponse = await fetch(`${baseUrl}/api/conversations/threads/t1/route`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeKind: "invalid-route",
      }),
    });
    expect(routeResponse.status).toBe(400);
    const result = await routeResponse.json() as any;
    expect(result.error).toContain("Invalid routeKind");
  });
});
