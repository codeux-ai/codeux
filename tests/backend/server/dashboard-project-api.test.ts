import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "http";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { setupDashboardServer } from "../../../src/server/dashboard-server.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ProjectRuntimeRepository } from "../../../src/repositories/project-runtime-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { SprintMarkdownService } from "../../../src/services/sprint-markdown-service.js";
import type { McpConnectionRecord } from "../../../src/contracts/connection-chat-types.js";

const serversToClose: Server[] = [];
const tempDirs: string[] = [];

const mapExecutionConnections = (connections: McpConnectionRecord[]) => (
  connections.map((connection) => ({
    id: connection.id,
    connectionKey: connection.connectionKey,
    displayName: connection.displayName,
    role: connection.role,
    transport: connection.transport,
    status: connection.status,
    model: typeof connection.capabilities.model === "string" ? connection.capabilities.model : null,
    instruction: typeof connection.capabilities.instruction === "string" ? connection.capabilities.instruction : null,
    labels: Array.isArray(connection.capabilities.labels)
      ? connection.capabilities.labels.map((label) => String(label || "").trim()).filter(Boolean)
      : [],
    listenMode: connection.capabilities.listenMode === true,
    lastHeartbeatAt: connection.lastHeartbeatAt,
    projectIds: connection.projectIds,
    activeProjectIds: connection.activeProjectIds,
    tasksRunCount: connection.tasksRunCount,
    threadCount: connection.threadCount,
    messageCount: connection.messageCount,
    pendingInboxCount: connection.pendingInboxCount,
    activeDispatchCount: connection.activeDispatchCount,
  }))
);

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

async function createServerHandle(): Promise<{
  port: number;
  repository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  runtimeRepository: ProjectRuntimeRepository;
  connectionRepository: ConnectionChatRepository;
  markdownService: SprintMarkdownService;
  controlCalls: {
    orchestrate: Array<{ projectId: string; sprintId: string }>;
    pauseRuns: string[];
    cancelRuns: string[];
    cancelDispatches: string[];
    retryDispatches: string[];
  };
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-dashboard-api-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const repository = new ProjectManagementRepository(storage);
  const runtimeRepository = new ProjectRuntimeRepository(storage);
  const connectionRepository = new ConnectionChatRepository(storage);
  const agentPresetRepository = new AgentPresetRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const markdownService = new SprintMarkdownService(repository);
  const controlCalls = {
    orchestrate: [] as Array<{ projectId: string; sprintId: string }>,
    pauseRuns: [] as string[],
    cancelRuns: [] as string[],
    cancelDispatches: [] as string[],
    retryDispatches: [] as string[],
  };

  const app = express();
  const handle = await setupDashboardServer({
    app,
    dashboardDir: "dashboard",
    port: 39100,
    liveActivityCacheMs: 1000,
    getStatus: () => runtimeRepository.getSelectedProjectStatus(),
    getExecutionSnapshot: () => {
      const selectedProjectId = repository.getSelectedProjectId();
      return selectedProjectId
        ? {
          ...executionRepository.getProjectExecutionSnapshot(selectedProjectId),
          connections: mapExecutionConnections(connectionRepository.listConnections(selectedProjectId)),
        }
        : { projectId: null, projectName: null, sprintRuns: [], taskDispatches: [], connections: [], recentEvents: [], updatedAt: null };
    },
    getOverviewTelemetrySnapshot: () => executionRepository.getOverviewTelemetrySnapshot(),
    getProjectExecutionSnapshot: (projectId) => ({
      ...executionRepository.getProjectExecutionSnapshot(projectId),
      connections: mapExecutionConnections(connectionRepository.listConnections(projectId)),
    }),
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
    getSettings: () => DEFAULT_DASHBOARD_SETTINGS,
    listProjects: () => repository.listProjects(),
    createProject: (input) => repository.createProject(input),
    getProject: (projectId) => repository.getProject(projectId),
    updateProject: (projectId, input) => repository.updateProject(projectId, input),
    deleteProject: (projectId) => repository.deleteProject(projectId),
    selectProject: (projectId) => repository.setSelectedProjectId(projectId),
    listSprints: (projectId) => repository.listSprints(projectId),
    createSprint: (projectId, input) => repository.createSprint(projectId, input),
    updateSprint: (sprintId, input) => repository.updateSprint(sprintId, input),
    deleteSprint: (sprintId) => repository.deleteSprint(sprintId),
    importSprintFromMarkdown: (projectId, input) => markdownService.importSprint(projectId, input),
    exportSprintToMarkdown: (projectId, sprintId) => markdownService.exportSprint(projectId, sprintId),
    listTasks: (projectId, sprintId) => repository.listTasks(projectId, sprintId),
    createTask: (projectId, input) => repository.createTask(projectId, input),
    updateTask: (taskId, input) => repository.updateTask(taskId, input),
    deleteTask: (taskId) => repository.deleteTask(taskId),
    listConnections: (projectId) => connectionRepository.listConnections(projectId),
    updateConnection: (connectionId, input) => connectionRepository.updateConnection(connectionId, input),
    listAgentPresets: (projectId) => agentPresetRepository.listAgentPresets(projectId),
    createAgentPreset: (projectId, input) => agentPresetRepository.createAgentPreset(projectId, input),
    updateAgentPreset: (agentPresetId, input) => agentPresetRepository.updateAgentPreset(agentPresetId, input),
    deleteAgentPreset: (agentPresetId) => agentPresetRepository.deleteAgentPreset(agentPresetId),
    listConversationThreads: (projectId) => connectionRepository.listThreads(projectId),
    createConversationThread: (projectId, input) => connectionRepository.createThread(projectId, input),
    updateConversationThread: (threadId, input) => connectionRepository.updateThread(threadId, input),
    listConversationMessages: (threadId) => connectionRepository.listMessages(threadId),
    postConversationMessage: (projectId, input) => connectionRepository.postDashboardMessage(projectId, input),
    saveSettings: (settings) => settings,
    rerunTask: async () => ({ ok: true }),
    orchestrateSprint: async (projectId, sprintId) => {
      controlCalls.orchestrate.push({ projectId, sprintId });
      return { ok: true };
    },
    pauseSprintRun: async (sprintRunId) => {
      controlCalls.pauseRuns.push(sprintRunId);
      return { ok: true };
    },
    cancelSprintRun: async (sprintRunId) => {
      controlCalls.cancelRuns.push(sprintRunId);
      return { ok: true };
    },
    cancelTaskDispatch: async (dispatchId) => {
      controlCalls.cancelDispatches.push(dispatchId);
      return { ok: true };
    },
    retryTaskDispatch: async (dispatchId) => {
      controlCalls.retryDispatches.push(dispatchId);
      return { ok: true };
    },
  });
  serversToClose.push(handle.server);

  return {
    port: handle.port,
    repository,
    executionRepository,
    runtimeRepository,
    connectionRepository,
    markdownService,
    controlCalls,
  };
}

describe("dashboard project management API", () => {
  it("creates and queries DB-backed projects, sprints, tasks, and markdown export", async () => {
    const { port, runtimeRepository, controlCalls, connectionRepository, executionRepository, repository } = await createServerHandle();
    const baseUrl = `http://127.0.0.1:${port}`;

    const projectResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Dashboard API Project",
        sourceType: "local",
        sourceRef: "/workspace/dashboard-api-project",
      }),
    });
    const project = await projectResponse.json() as { id: string };
    expect(projectResponse.status).toBe(201);

    const sprintResponse = await fetch(`${baseUrl}/api/projects/${project.id}/sprints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "API Sprint",
        goal: "Verify the dashboard CRUD surface",
        startDate: "2026-03-09",
        endDate: "2026-03-16",
        status: "running",
      }),
    });
    const sprint = await sprintResponse.json() as { id: string };
    expect(sprintResponse.status).toBe(201);

    const taskResponse = await fetch(`${baseUrl}/api/projects/${project.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sprintId: sprint.id,
        title: "Wire selected project state",
        promptMarkdown: "Connect the top nav to the DB-backed project selector.",
        priority: "high",
        executorType: "mcp_worker",
        status: "in_progress",
      }),
    });
    expect(taskResponse.status).toBe(201);

    const projects = await fetch(`${baseUrl}/api/projects`).then(async (response) => response.json()) as {
      projects: Array<{ name: string; sprintsCount: number; openTasks: number }>;
      selectedProjectId: string | null;
    };
    expect(projects.selectedProjectId).toBe(project.id);
    expect(projects.projects[0]).toMatchObject({
      name: "Dashboard API Project",
      sprintsCount: 1,
      openTasks: 1,
    });

    const taskRecords = await fetch(`${baseUrl}/api/projects/${project.id}/tasks`)
      .then(async (response) => response.json()) as Array<{ executorType: string }>;
    expect(taskRecords[0]?.executorType).toBe("mcp_worker");

    const agentPresetCreateResponse = await fetch(`${baseUrl}/api/projects/${project.id}/agent-presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Project Manager",
        instructionMarkdown: "Coordinate the sprint and answer dashboard chat.",
        labels: ["planning", "communication"],
      }),
    });
    expect(agentPresetCreateResponse.status).toBe(201);
    const agentPreset = await agentPresetCreateResponse.json() as { id: string; name: string };
    expect(agentPreset.name).toBe("Project Manager");

    const agentPresetUpdateResponse = await fetch(`${baseUrl}/api/agent-presets/${agentPreset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Worker",
        labels: ["execution"],
      }),
    });
    expect(agentPresetUpdateResponse.status).toBe(200);
    const updatedAgentPreset = await agentPresetUpdateResponse.json() as { name: string; labels: string[] };
    expect(updatedAgentPreset).toMatchObject({
      name: "Worker",
      labels: ["execution"],
    });

    const listedAgentPresets = await fetch(`${baseUrl}/api/projects/${project.id}/agent-presets`)
      .then(async (response) => response.json()) as Array<{ id: string; name: string }>;
    expect(listedAgentPresets).toHaveLength(1);
    expect(listedAgentPresets[0]?.id).toBe(agentPreset.id);

    runtimeRepository.syncDashboardStatus({
      sprint_number: 1,
      repo_path: "/workspace/dashboard-api-project",
      feature_branch: "feature/api-sprint",
      subtasks: [
        {
          id: "T01",
          title: "Wire selected project state",
          prompt: "Connect the top nav to the DB-backed project selector.",
          depends_on: [],
          is_independent: true,
          status: "RUNNING",
          session_id: "session-api",
          session_name: "sessions/session-api",
          provider: "codex",
        },
      ],
      timestamp: "2026-03-09T18:00:00.000Z",
    });

    const runtimeStatus = await fetch(`${baseUrl}/api/status`).then(async (response) => response.json()) as {
      repo_path?: string;
      feature_branch?: string;
      timestamp: string | null;
      subtasks: Array<{ id: string; record_id?: string; status?: string; session_id?: string }>;
    };
    expect(runtimeStatus).toMatchObject({
      repo_path: "/workspace/dashboard-api-project",
      feature_branch: "feature/api-sprint",
      timestamp: "2026-03-09T18:00:00.000Z",
    });
    expect(runtimeStatus.subtasks[0]).toMatchObject({
      id: "T01",
      status: "RUNNING",
      session_id: "session-api",
    });

    const executionSnapshot = await fetch(`${baseUrl}/api/execution`).then(async (response) => response.json()) as {
      projectId: string | null;
      sprintRuns: Array<{ sprintId: string; status: string }>;
      taskDispatches: Array<{ taskId: string; executorType: string }>;
      connections: Array<{ id: string; displayName: string; status: string; listenMode: boolean }>;
      recentEvents: Array<unknown>;
    };
    expect(executionSnapshot.projectId).toBe(project.id);
    expect(executionSnapshot.sprintRuns).toEqual([]);
    expect(executionSnapshot.taskDispatches).toEqual([]);
    expect(executionSnapshot.connections).toEqual([]);
    expect(executionSnapshot.recentEvents[0]).toMatchObject({
      eventType: "status_sync",
      taskKey: "T01",
      taskTitle: "Wire selected project state",
      sessionId: "session-api",
    });

    const telemetryRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const firstTask = repository.listTasks(project.id, sprint.id)[0];
    executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: firstTask.id,
      sprintRunId: telemetryRun.id,
      executorType: "mcp_worker",
      status: "running",
    });

    const overviewTelemetry = await fetch(`${baseUrl}/api/telemetry/overview`)
      .then(async (response) => response.json()) as {
        activeProjects: Array<{ projectId: string; sprintRunId: string; runningDispatchCount: number }>;
      };
    expect(overviewTelemetry.activeProjects[0]).toMatchObject({
      projectId: project.id,
      sprintRunId: telemetryRun.id,
      runningDispatchCount: 1,
    });

    const startListenResponse = await fetch(`${baseUrl}/api/projects/${project.id}/conversations/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Inbox Thread",
      }),
    });
    const thread = await startListenResponse.json() as { id: string };
    expect(startListenResponse.status).toBe(201);

    const messageResponse = await fetch(`${baseUrl}/api/projects/${project.id}/conversations/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: thread.id,
        bodyMarkdown: "Route this to the active listener.",
      }),
    });
    expect(messageResponse.status).toBe(201);

    const threads = await fetch(`${baseUrl}/api/projects/${project.id}/conversations/threads`)
      .then(async (response) => response.json()) as Array<{ id: string; pendingMessageCount: number; messageCount: number }>;
    expect(threads[0]).toMatchObject({
      id: thread.id,
      pendingMessageCount: 1,
      messageCount: 1,
    });

    const listener = connectionRepository.startListen({
      connectionKey: "listener-api",
      displayName: "Listener API",
      role: "listener",
      projectId: project.id,
    });
    const assignThreadResponse = await fetch(`${baseUrl}/api/conversations/threads/${thread.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionId: listener.connection.id,
      }),
    });
    expect(assignThreadResponse.status).toBe(200);
    const updatedThread = await assignThreadResponse.json() as { connectionId: string | null };
    expect(updatedThread.connectionId).toBe(listener.connection.id);

    const executionSnapshotWithConnection = await fetch(`${baseUrl}/api/execution`)
      .then(async (response) => response.json()) as {
        connections: Array<{ id: string; displayName: string; status: string; listenMode: boolean; pendingInboxCount: number }>;
      };
    expect(executionSnapshotWithConnection.connections[0]).toMatchObject({
      id: listener.connection.id,
      displayName: "Listener API",
      status: "listening",
      listenMode: true,
      pendingInboxCount: 0,
    });

    const messages = await fetch(`${baseUrl}/api/conversations/threads/${thread.id}/messages`)
      .then(async (response) => response.json()) as Array<{ bodyMarkdown: string }>;
    expect(messages[0]?.bodyMarkdown).toContain("Route this to the active listener");

    const agentPresetDeleteResponse = await fetch(`${baseUrl}/api/agent-presets/${agentPreset.id}`, {
      method: "DELETE",
    });
    expect(agentPresetDeleteResponse.status).toBe(200);

    const exported = await fetch(`${baseUrl}/api/projects/${project.id}/sprints/${sprint.id}/export`)
      .then(async (response) => response.json()) as {
        sprint: { markdown: string };
        tasks: Array<{ markdown: string }>;
      };

    expect(exported.sprint.markdown).toContain("name: API Sprint");
    expect(exported.tasks[0].markdown).toContain("title: Wire selected project state");

    const orchestrateResponse = await fetch(`${baseUrl}/api/projects/${project.id}/sprints/${sprint.id}/orchestrate`, {
      method: "POST",
    });
    expect(orchestrateResponse.status).toBe(202);
    expect(controlCalls.orchestrate).toEqual([{ projectId: project.id, sprintId: sprint.id }]);
  });
});
