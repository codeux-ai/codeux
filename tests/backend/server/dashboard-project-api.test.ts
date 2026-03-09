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
import { SprintMarkdownService } from "../../../src/services/sprint-markdown-service.js";

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

async function createServerHandle(): Promise<{
  port: number;
  repository: ProjectManagementRepository;
  runtimeRepository: ProjectRuntimeRepository;
  markdownService: SprintMarkdownService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-dashboard-api-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const repository = new ProjectManagementRepository(storage);
  const runtimeRepository = new ProjectRuntimeRepository(storage);
  const connectionRepository = new ConnectionChatRepository(storage);
  const markdownService = new SprintMarkdownService(repository);

  const app = express();
  const handle = await setupDashboardServer({
    app,
    dashboardDir: "dashboard",
    port: 39100,
    liveActivityCacheMs: 1000,
    getStatus: () => runtimeRepository.getSelectedProjectStatus(),
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
    listConversationThreads: (projectId) => connectionRepository.listThreads(projectId),
    createConversationThread: (projectId, input) => connectionRepository.createThread(projectId, input),
    listConversationMessages: (threadId) => connectionRepository.listMessages(threadId),
    postConversationMessage: (projectId, input) => connectionRepository.postDashboardMessage(projectId, input),
    saveSettings: (settings) => settings,
    rerunTask: async () => ({ ok: true }),
  });
  serversToClose.push(handle.server);

  return {
    port: handle.port,
    repository,
    runtimeRepository,
    markdownService,
  };
}

describe("dashboard project management API", () => {
  it("creates and queries DB-backed projects, sprints, tasks, and markdown export", async () => {
    const { port, runtimeRepository } = await createServerHandle();
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

    const messages = await fetch(`${baseUrl}/api/conversations/threads/${thread.id}/messages`)
      .then(async (response) => response.json()) as Array<{ bodyMarkdown: string }>;
    expect(messages[0]?.bodyMarkdown).toContain("Route this to the active listener");

    const exported = await fetch(`${baseUrl}/api/projects/${project.id}/sprints/${sprint.id}/export`)
      .then(async (response) => response.json()) as {
        sprint: { markdown: string };
        tasks: Array<{ markdown: string }>;
      };

    expect(exported.sprint.markdown).toContain("name: API Sprint");
    expect(exported.tasks[0].markdown).toContain("title: Wire selected project state");
  });
});
