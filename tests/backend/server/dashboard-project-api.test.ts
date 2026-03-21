import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "http";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { setupDashboardServer } from "../../../src/server/dashboard-server.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ProjectRuntimeRepository } from "../../../src/repositories/project-runtime-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectAttentionRepository } from "../../../src/repositories/project-attention-repository.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import { WorkerEndpointRepository } from "../../../src/repositories/worker-endpoint-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../src/repositories/project-worker-assignment-repository.js";
import { SprintMarkdownService } from "../../../src/services/sprint-markdown-service.js";
import { AgentPresetSyncService } from "../../../src/services/agent-preset-sync-service.js";
import { ProjectAttentionService } from "../../../src/domain/workers/project-attention-service.js";
import { ProjectWorkerAssignmentService } from "../../../src/domain/workers/project-worker-assignment-service.js";
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

const mapAssignedWorkers = (projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository, projectId: string) => {
  const assignments = projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true })
    .map((assignment) => ({
      assignmentId: assignment.id,
      workerEndpointId: assignment.workerEndpointId,
      workerEndpointKey: assignment.workerEndpointKey,
      workerEndpointType: assignment.workerEndpointType,
      workerDisplayName: assignment.workerDisplayName,
      connectionId: assignment.connectionId,
      connectionKey: assignment.connectionKey,
      transport: assignment.transport,
      assignmentRole: assignment.assignmentRole,
      status: assignment.status,
      assignedAt: assignment.assignedAt,
      lastAffinityAt: assignment.lastAffinityAt,
      workerStatus: assignment.workerStatus,
      canSuperviseProjects: assignment.capabilities.canSuperviseProjects,
      canExecuteTasks: assignment.capabilities.canExecuteTasks,
    }));

  return {
    primaryAssignedWorker: assignments.find((assignment) => assignment.assignmentRole === "primary") || null,
    overflowAssignedWorkers: assignments.filter((assignment) => assignment.assignmentRole === "overflow"),
  };
};

const mapAttentionItems = (projectAttentionRepository: ProjectAttentionRepository, projectId: string) => (
  projectAttentionRepository.listProjectAttentionItems(projectId, {
    statuses: ["open", "claimed"],
    limit: 50,
  }).map((item) => ({
    id: item.id,
    sprintId: item.sprintId,
    taskId: item.taskId,
    sprintRunId: item.sprintRunId,
    dispatchId: item.dispatchId,
    attentionType: item.attentionType,
    severity: item.severity,
    ownerType: item.ownerType,
    status: item.status,
    assignedWorkerEndpointId: item.assignedWorkerEndpointId,
    title: item.title,
    summaryMarkdown: item.summaryMarkdown,
    payload: item.payload,
    openedAt: item.openedAt,
    claimedAt: item.claimedAt,
    resolvedAt: item.resolvedAt,
    updatedAt: item.updatedAt,
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
  dir: string;
  port: number;
  repository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  runtimeRepository: ProjectRuntimeRepository;
  connectionRepository: ConnectionChatRepository;
  workerEndpointRepository: WorkerEndpointRepository;
  projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository;
  projectWorkerAssignmentService: ProjectWorkerAssignmentService;
  projectAttentionRepository: ProjectAttentionRepository;
  projectAttentionService: ProjectAttentionService;
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
  const workerEndpointRepository = new WorkerEndpointRepository(storage);
  const projectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(storage);
  const projectWorkerAssignmentService = new ProjectWorkerAssignmentService(
    projectWorkerAssignmentRepository,
    workerEndpointRepository,
  );
  const projectAttentionRepository = new ProjectAttentionRepository(storage);
  const projectAttentionService = new ProjectAttentionService(
    projectAttentionRepository,
    projectWorkerAssignmentRepository,
  );
  const connectionRepository = new ConnectionChatRepository(storage, undefined, workerEndpointRepository);
  const agentPresetRepository = new AgentPresetRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const settingsRepository = new SettingsRepository(path.join(dir, "settings.db"));
  const agentPresetSyncService = new AgentPresetSyncService({
    projectManagementRepository: repository,
    agentPresetRepository,
    settingsRepository,
    projectRoot: dir,
  });
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
          ...mapAssignedWorkers(projectWorkerAssignmentRepository, selectedProjectId),
          attentionItems: mapAttentionItems(projectAttentionRepository, selectedProjectId),
        }
        : {
          projectId: null,
          projectName: null,
          sprintRuns: [],
          taskDispatches: [],
          connections: [],
          primaryAssignedWorker: null,
          overflowAssignedWorkers: [],
          attentionItems: [],
          recentEvents: [],
          updatedAt: null,
        };
    },
    getOverviewTelemetrySnapshot: () => executionRepository.getOverviewTelemetrySnapshot(),
    getProjectExecutionSnapshot: (projectId) => ({
      ...executionRepository.getProjectExecutionSnapshot(projectId),
      connections: mapExecutionConnections(connectionRepository.listConnections(projectId)),
      ...mapAssignedWorkers(projectWorkerAssignmentRepository, projectId),
      attentionItems: mapAttentionItems(projectAttentionRepository, projectId),
    }),
    getProjectStatsSnapshot: (projectId, window) => executionRepository.getProjectStatsSnapshot(projectId, window),
    claimAttentionItem: (projectId, attentionItemId, input) => {
      const current = projectAttentionRepository.getAttentionItem(attentionItemId);
      if (!current || current.projectId !== projectId) {
        throw new Error(`Project attention item not found: ${attentionItemId}`);
      }
      const workerEndpointId = input?.workerEndpointId
        || current.assignedWorkerEndpointId
        || mapAssignedWorkers(projectWorkerAssignmentRepository, projectId).primaryAssignedWorker?.workerEndpointId
        || mapAssignedWorkers(projectWorkerAssignmentRepository, projectId).overflowAssignedWorkers[0]?.workerEndpointId;
      if (!workerEndpointId) {
        throw new Error(`No worker endpoint available to claim ${attentionItemId}`);
      }
      const item = projectAttentionService.claimItem(attentionItemId, workerEndpointId, input?.claimReason);
      return {
        id: item.id,
        sprintId: item.sprintId,
        taskId: item.taskId,
        sprintRunId: item.sprintRunId,
        dispatchId: item.dispatchId,
        attentionType: item.attentionType,
        severity: item.severity,
        ownerType: item.ownerType,
        status: item.status,
        assignedWorkerEndpointId: item.assignedWorkerEndpointId,
        title: item.title,
        summaryMarkdown: item.summaryMarkdown,
        payload: item.payload,
        openedAt: item.openedAt,
        claimedAt: item.claimedAt,
        resolvedAt: item.resolvedAt,
        updatedAt: item.updatedAt,
      };
    },
    resolveAttentionItem: (projectId, attentionItemId, input) => {
      const current = projectAttentionRepository.getAttentionItem(attentionItemId);
      if (!current || current.projectId !== projectId) {
        throw new Error(`Project attention item not found: ${attentionItemId}`);
      }
      const item = projectAttentionService.resolveItem(attentionItemId, {
        status: input?.status || "resolved",
        reason: input?.reason,
        resolutionSummaryMarkdown: input?.resolutionSummaryMarkdown,
      });
      return {
        id: item.id,
        sprintId: item.sprintId,
        taskId: item.taskId,
        sprintRunId: item.sprintRunId,
        dispatchId: item.dispatchId,
        attentionType: item.attentionType,
        severity: item.severity,
        ownerType: item.ownerType,
        status: item.status,
        assignedWorkerEndpointId: item.assignedWorkerEndpointId,
        title: item.title,
        summaryMarkdown: item.summaryMarkdown,
        payload: item.payload,
        openedAt: item.openedAt,
        claimedAt: item.claimedAt,
        resolvedAt: item.resolvedAt,
        updatedAt: item.updatedAt,
      };
    },
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
    getSystemSettings: () => settingsRepository.getSystemSettings(),
    saveSystemSettings: (settings) => settingsRepository.saveSystemSettings(settings),
    getProjectSettings: (projectId) => settingsRepository.getProjectSettings(projectId),
    saveProjectSettings: (projectId, settings) => settingsRepository.saveProjectSettings(projectId, settings),
    resetProjectSettings: (projectId) => settingsRepository.resetProjectSettings(projectId),
    getProjectEffectiveSettings: (projectId) => settingsRepository.resolveProjectDashboardSettings(projectId),
    getSprintSettings: (sprintId) => settingsRepository.getSprintSettings(sprintId),
    saveSprintSettings: (projectId, sprintId, settings) => settingsRepository.saveSprintSettings(sprintId, settingsRepository.getProjectResolvedSettings(projectId), settings),
    resetSprintSettings: (sprintId) => settingsRepository.resetSprintSettings(sprintId),
    getSprintEffectiveSettings: (projectId, sprintId) => settingsRepository.resolveSprintDashboardSettings(projectId, sprintId),
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
    listAgentPresets: async (projectId) => await agentPresetSyncService.listAgentPresets(projectId),
    createAgentPreset: async (projectId, input) => await agentPresetSyncService.createAgentPreset(projectId, input),
    updateAgentPreset: async (agentPresetId, input) => await agentPresetSyncService.updateAgentPreset(agentPresetId, input),
    deleteAgentPreset: async (agentPresetId) => await agentPresetSyncService.deleteAgentPreset(agentPresetId),
    importAgentPresetFromMarkdown: async (agentPresetId) => await agentPresetSyncService.importAgentPresetFromMarkdown(agentPresetId),
    syncAllAgentPresetsFromMarkdown: async (projectId) => await agentPresetSyncService.syncAllAgentPresetsFromMarkdown(projectId),
    listConversationThreads: (projectId) => connectionRepository.listThreads(projectId),
    createConversationThread: (projectId, input) => connectionRepository.createThread(projectId, input),
    updateConversationThread: (threadId, input) => connectionRepository.updateThread(threadId, input),
    deleteConversationThread: (threadId) => connectionRepository.deleteThread(threadId),
    listConversationMessages: (threadId) => connectionRepository.listMessages(threadId),
    postConversationMessage: (projectId, input) => connectionRepository.postDashboardMessage(projectId, input),
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
    dir,
    port: handle.port,
    repository,
    executionRepository,
    runtimeRepository,
    connectionRepository,
    workerEndpointRepository,
    projectWorkerAssignmentRepository,
    projectWorkerAssignmentService,
    projectAttentionRepository,
    projectAttentionService,
    markdownService,
    controlCalls,
  };
}

describe("dashboard project management API", () => {
  it("creates and queries DB-backed projects, sprints, tasks, and markdown export", async () => {
    const {
      dir,
      port,
      runtimeRepository,
      controlCalls,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentService,
      projectAttentionService,
      executionRepository,
      repository,
    } = await createServerHandle();
    const baseUrl = `http://127.0.0.1:${port}`;
    const projectSourceRef = path.join(dir, "workspace", "dashboard-api-project");

    const projectResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Dashboard API Project",
        sourceType: "local",
        sourceRef: projectSourceRef,
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

    const systemSettingsResponse = await fetch(`${baseUrl}/api/system-settings`);
    expect(systemSettingsResponse.status).toBe(200);
    const initialSystemSettings = await systemSettingsResponse.json() as {
      runtime: { dashboardPort: number; enableDebugLogFile: boolean };
      integrations: { githubToken: string };
      defaults: { git: { defaultBranch: string } };
    };
    expect(initialSystemSettings.runtime.dashboardPort).toBeGreaterThan(0);

    const saveSystemSettingsResponse = await fetch(`${baseUrl}/api/system-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...initialSystemSettings,
        runtime: {
          ...initialSystemSettings.runtime,
          dashboardPort: 4555,
          enableDebugLogFile: true,
        },
        integrations: {
          ...initialSystemSettings.integrations,
          githubToken: "gh-test-token",
        },
        defaults: {
          ...initialSystemSettings.defaults,
          git: {
            ...initialSystemSettings.defaults.git,
            defaultBranch: "mainline",
          },
        },
      }),
    });
    expect(saveSystemSettingsResponse.status).toBe(200);

    const savedProjectSettingsResponse = await fetch(`${baseUrl}/api/projects/${project.id}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        automationLevel: "SEMI_AUTO",
        git: {
          defaultBranch: "develop",
        },
      }),
    });
    expect(savedProjectSettingsResponse.status).toBe(200);
    expect(await savedProjectSettingsResponse.json()).toEqual({
      git: {
        defaultBranch: "develop",
      },
    });

    const effectiveProjectSettingsResponse = await fetch(`${baseUrl}/api/projects/${project.id}/settings/effective`);
    expect(effectiveProjectSettingsResponse.status).toBe(200);
    const effectiveProjectSettings = await effectiveProjectSettingsResponse.json() as {
      settings: {
        dashboardPort: number;
        enableDebugLogFile: boolean;
        automationLevel: string;
        git: { defaultBranch: string; githubToken: string };
      };
      sources: Record<string, string>;
    };
    expect(effectiveProjectSettings.settings).toMatchObject({
      dashboardPort: 4555,
      enableDebugLogFile: true,
      automationLevel: "SEMI_AUTO",
      git: {
        defaultBranch: "develop",
        githubToken: "gh-test-token",
      },
    });
    expect(effectiveProjectSettings.sources["git.defaultBranch"]).toBe("project");
    expect(effectiveProjectSettings.sources["automationLevel"]).toBe("system");

    const sprintSettingsResponse = await fetch(`${baseUrl}/api/sprints/${sprint.id}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        automationLevel: "ALWAYS_ASK",
      }),
    });
    expect(sprintSettingsResponse.status).toBe(200);
    expect(await sprintSettingsResponse.json()).toEqual({
      automationLevel: "ALWAYS_ASK",
    });

    const effectiveSprintSettingsResponse = await fetch(`${baseUrl}/api/projects/${project.id}/sprints/${sprint.id}/settings/effective`);
    expect(effectiveSprintSettingsResponse.status).toBe(200);
    const effectiveSprintSettings = await effectiveSprintSettingsResponse.json() as {
      settings: { automationLevel: string; git: { defaultBranch: string } };
      sources: Record<string, string>;
    };
    expect(effectiveSprintSettings.settings).toMatchObject({
      automationLevel: "ALWAYS_ASK",
      git: {
        defaultBranch: "develop",
      },
    });
    expect(effectiveSprintSettings.sources["automationLevel"]).toBe("sprint");
    expect(effectiveSprintSettings.sources["git.defaultBranch"]).toBe("project");

    const resetSprintSettingsResponse = await fetch(`${baseUrl}/api/sprints/${sprint.id}/settings`, {
      method: "DELETE",
    });
    expect(resetSprintSettingsResponse.status).toBe(200);

    const resetProjectSettingsResponse = await fetch(`${baseUrl}/api/projects/${project.id}/settings`, {
      method: "DELETE",
    });
    expect(resetProjectSettingsResponse.status).toBe(200);

    const resetEffectiveProjectSettingsResponse = await fetch(`${baseUrl}/api/projects/${project.id}/settings/effective`);
    expect(resetEffectiveProjectSettingsResponse.status).toBe(200);
    const resetEffectiveProjectSettings = await resetEffectiveProjectSettingsResponse.json() as {
      settings: { automationLevel: string; git: { defaultBranch: string } };
      sources: Record<string, string>;
    };
    expect(resetEffectiveProjectSettings.settings).toMatchObject({
      git: {
        defaultBranch: "mainline",
      },
    });
    expect(resetEffectiveProjectSettings.sources["git.defaultBranch"]).toBe("system");

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
    const agentPreset = await agentPresetCreateResponse.json() as {
      id: string;
      name: string;
      sourceScope: string | null;
      sourcePath: string | null;
    };
    expect(agentPreset.name).toBe("Project Manager");
    expect(agentPreset.sourceScope).toBe("project");
    expect(agentPreset.sourcePath).toBe(path.join(project.baseDir, ".sprint-os", "agents", "project_manager.md"));
    expect(await fs.readFile(agentPreset.sourcePath!, "utf8")).toContain("Coordinate the sprint");

    const agentPresetUpdateResponse = await fetch(`${baseUrl}/api/agent-presets/${agentPreset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Worker",
        instructionMarkdown: "Updated worker markdown from the dashboard.",
        labels: ["execution"],
      }),
    });
    expect(agentPresetUpdateResponse.status).toBe(200);
    const updatedAgentPreset = await agentPresetUpdateResponse.json() as {
      name: string;
      labels: string[];
      sourceScope: string | null;
      sourcePath: string | null;
    };
    expect(updatedAgentPreset).toMatchObject({
      name: "Worker",
      labels: ["execution"],
      sourceScope: "project",
    });
    expect(updatedAgentPreset.sourcePath).toBe(path.join(project.baseDir, ".sprint-os", "agents", "worker.md"));
    expect(await fs.readFile(updatedAgentPreset.sourcePath!, "utf8")).toContain("Updated worker markdown");

    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(updatedAgentPreset.sourcePath!, "Locally edited worker markdown.\n", "utf8");

    const syncAllAgentPresetsResponse = await fetch(`${baseUrl}/api/projects/${project.id}/agent-presets/sync-markdown`, {
      method: "POST",
    });
    expect(syncAllAgentPresetsResponse.status).toBe(200);
    const syncedAgentPresets = await syncAllAgentPresetsResponse.json() as Array<{
      id: string;
      instructionMarkdown: string;
      syncStatus: string;
    }>;
    expect(syncedAgentPresets.find((entry) => entry.id === agentPreset.id)).toMatchObject({
      instructionMarkdown: "Locally edited worker markdown.",
      syncStatus: "synced",
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

    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: firstTask.id,
      sprintRunId: telemetryRun.id,
      dispatchId: executionRepository.listTaskDispatches({ projectId: project.id, sprintRunId: telemetryRun.id })[0]!.id,
      provider: "codex",
      state: "completed",
      sessionId: "stats-session-1",
      startedAt: new Date(Date.now() - 120_000).toISOString(),
      finishedAt: new Date(Date.now() - 30_000).toISOString(),
      durationMs: 90_000,
    });
    const invocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: firstTask.id,
      sprintRunId: telemetryRun.id,
      dispatchId: taskRun.dispatchId,
      taskRunId: taskRun.id,
      sessionId: "stats-session-1",
      provider: "codex",
      purpose: "task_coding",
      model: "gpt-5.3-codex",
      startedAt: new Date(Date.now() - 120_000).toISOString(),
      promptChars: 128,
    });
    executionRepository.updateProviderInvocationUsage(invocation.id, {
      status: "completed",
      finishedAt: new Date(Date.now() - 30_000).toISOString(),
      durationMs: 90_000,
      transcriptChars: 84,
      inputTokens: 320,
      cachedInputTokens: 40,
      outputTokens: 110,
      reasoningOutputTokens: 20,
      totalTokens: 490,
      usageSource: "reported",
      rawUsageJson: { provider: "codex" },
    });

    const statsSnapshot = await fetch(`${baseUrl}/api/projects/${project.id}/stats?window=24h`)
      .then(async (response) => response.json()) as {
        projectId: string;
        window: string;
        usage: { totalTokens: number; activeTimeMs: number; wallTimeMs: number };
        tasks: Array<{ label: string; usage: { totalTokens: number } }>;
        providers: Array<{ id: string; usage: { totalTokens: number } }>;
      };
    expect(statsSnapshot).toMatchObject({
      projectId: project.id,
      window: "24h",
      usage: {
        totalTokens: 490,
        activeTimeMs: 90_000,
        wallTimeMs: 90_000,
      },
    });
    expect(statsSnapshot.tasks[0]).toMatchObject({
      label: "T01 Wire selected project state",
      usage: {
        totalTokens: 490,
      },
    });
    expect(statsSnapshot.providers[0]).toMatchObject({
      id: "codex",
      usage: {
        totalTokens: 490,
      },
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
        primaryAssignedWorker: null | { workerDisplayName: string; assignmentRole: string };
      };
    expect(executionSnapshotWithConnection.connections[0]).toMatchObject({
      id: listener.connection.id,
      displayName: "Listener API",
      status: "listening",
      listenMode: true,
      pendingInboxCount: 0,
    });

    const worker = connectionRepository.upsertConnection({
      connectionKey: "worker-api",
      displayName: "Worker API",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(worker.id);
    expect(workerEndpoint).not.toBeNull();
    projectWorkerAssignmentService.noteWorkerActivity(project.id, workerEndpoint!.id);

    const executionSnapshotWithAssignment = await fetch(`${baseUrl}/api/execution`)
      .then(async (response) => response.json()) as {
        primaryAssignedWorker: null | { workerDisplayName: string; assignmentRole: string };
      };
    expect(executionSnapshotWithAssignment.primaryAssignedWorker).toMatchObject({
      workerDisplayName: "Worker API",
      assignmentRole: "primary",
    });

    const attentionItem = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: firstTask.id,
      attentionType: "merge_required",
      severity: "high",
      ownerType: "worker",
      title: "Merge required for Wire selected project state",
      summaryMarkdown: "Waiting for merge handling before the sprint can finish.",
      payload: {
        repoPath: "/workspace/dashboard-api-project",
      },
    });

    const claimAttentionResponse = await fetch(`${baseUrl}/api/projects/${project.id}/attention-items/${attentionItem.id}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimReason: "dashboard_claimed",
      }),
    });
    expect(claimAttentionResponse.status).toBe(200);
    const claimedAttention = await claimAttentionResponse.json() as {
      status: string;
      assignedWorkerEndpointId: string | null;
      claimedAt: string | null;
    };
    expect(claimedAttention).toMatchObject({
      status: "claimed",
      assignedWorkerEndpointId: workerEndpoint!.id,
    });
    expect(claimedAttention.claimedAt).toBeTruthy();

    const executionSnapshotWithAttention = await fetch(`${baseUrl}/api/execution`)
      .then(async (response) => response.json()) as {
        attentionItems: Array<{ id: string; status: string; assignedWorkerEndpointId: string | null }>;
      };
    expect(executionSnapshotWithAttention.attentionItems[0]).toMatchObject({
      id: attentionItem.id,
      status: "claimed",
      assignedWorkerEndpointId: workerEndpoint!.id,
    });

    const resolveAttentionResponse = await fetch(`${baseUrl}/api/projects/${project.id}/attention-items/${attentionItem.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "dismissed",
        reason: "dashboard_dismissed",
      }),
    });
    expect(resolveAttentionResponse.status).toBe(200);
    const resolvedAttention = await resolveAttentionResponse.json() as {
      status: string;
      resolvedAt: string | null;
    };
    expect(resolvedAttention.status).toBe("dismissed");
    expect(resolvedAttention.resolvedAt).toBeTruthy();

    const executionSnapshotAfterAttentionResolution = await fetch(`${baseUrl}/api/execution`)
      .then(async (response) => response.json()) as {
        attentionItems: Array<{ id: string }>;
      };
    expect(executionSnapshotAfterAttentionResolution.attentionItems).toEqual([]);

    const messages = await fetch(`${baseUrl}/api/conversations/threads/${thread.id}/messages`)
      .then(async (response) => response.json()) as Array<{ bodyMarkdown: string }>;
    expect(messages[0]?.bodyMarkdown).toContain("Route this to the active listener");

    const deleteThreadResponse = await fetch(`${baseUrl}/api/conversations/threads/${thread.id}`, {
      method: "DELETE",
    });
    expect(deleteThreadResponse.status).toBe(200);
    expect(await deleteThreadResponse.json()).toEqual({ ok: true });

    const threadsAfterDelete = await fetch(`${baseUrl}/api/projects/${project.id}/conversations/threads`)
      .then(async (response) => response.json()) as Array<{ id: string }>;
    expect(threadsAfterDelete.some((entry) => entry.id === thread.id)).toBe(false);

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
