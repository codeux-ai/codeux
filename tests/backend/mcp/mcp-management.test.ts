import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/services/project-git-clone-service.js", () => ({
  prepareGitProjectCreateInput: vi.fn(async (input: unknown) => input),
}));

import { ManagementToolHandler } from "../../../src/mcp/management-tool-handler.js";
import { prepareGitProjectCreateInput } from "../../../src/services/project-git-clone-service.js";
import { TOOL_DEFINITIONS } from "../../../src/contracts/mcp-tool-definitions.js";
import type { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import type { SprintPreviewService } from "../../../src/services/sprint-preview-service.js";
import type { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import type { ExecutionControlService } from "../../../src/services/execution-control-service.js";
import type { TaskRerunService } from "../../../src/services/task-rerun-service.js";
import type { SettingsRepository } from "../../../src/repositories/settings-repository.js";
import type { AgentPresetSyncService } from "../../../src/services/agent-preset-sync-service.js";
import type { MemoryService } from "../../../src/services/memory-service.js";
import type { MemoryPromotionService } from "../../../src/services/memory-promotion-service.js";
import type { EmbeddingModelManager } from "../../../src/services/embedding-model-manager.js";
import type { PlanningAgentService } from "../../../src/services/planning-agent-service.js";
import type { SprintIssueService } from "../../../src/services/sprint-issue-service.js";

interface JsonSchemaProperty {
  type?: unknown;
  enum?: readonly unknown[];
  items?: JsonSchemaProperty;
}

describe("ManagementToolHandler", () => {
  let handler: ManagementToolHandler;
  let deps: any;

  beforeEach(() => {
    vi.mocked(prepareGitProjectCreateInput).mockImplementation(async (input) => input);
    deps = {
      projectManagementRepository: {
        listProjects: vi.fn(),
        getProject: vi.fn(),
        createProject: vi.fn(),
        updateProject: vi.fn(),
        setSelectedProjectId: vi.fn(),
        deleteProject: vi.fn(),
        listSprints: vi.fn(),
        createTask: vi.fn(),
      },
      sprintPreviewService: {
        listSessions: vi.fn(),
      },
      executionRepository: {
        listSprintRuns: vi.fn(),
      },
      getDashboardSettings: vi.fn(() => ({
        git: {
          githubToken: "",
          gitlabToken: "",
        },
        integrations: {
          githubToken: "",
          gitlabToken: "",
        },
      })),
      executionControlService: {
        orchestrateSprint: vi.fn(),
      },
      taskRerunService: {
        rerunTask: vi.fn(),
      },
      settingsRepository: {
        getGlobalSettings: vi.fn(),
        getSystemSettings: vi.fn(() => ({ defaults: { automationLevel: "FULL" } })),
        getProjectSettings: vi.fn(() => ({ automationLevel: "SEMI_AUTO" })),
        getSprintSettings: vi.fn(() => ({ automationLevel: "MANUAL" })),
        saveSystemSettings: vi.fn((settings: unknown) => settings),
        saveProjectSettings: vi.fn((projectId: string, settings: unknown) => settings),
        saveSprintSettings: vi.fn((sprintId: string, base: unknown, settings: unknown) => settings),
        getProjectResolvedSettings: vi.fn(() => ({})),
      },
      agentPresetSyncService: {
        syncPresets: vi.fn(),
      },
      memoryService: {
        searchMemory: vi.fn(),
      },
      memoryPromotionService: {
        promoteMemory: vi.fn(),
      },
      embeddingModelManager: {
        getModelStatus: vi.fn(),
      },
      planningAgentService: {
        planSprint: vi.fn(),
      },
      sprintIssueService: {
        searchIssues: vi.fn(),
      },
      quicksprintService: {
        listTemplates: vi.fn(),
        executeQuicksprint: vi.fn(),
      },
      schedulerService: {
        listProjectSchedule: vi.fn(),
      },
      workerTaskDispatchService: {
        registerExternalWorkerEndpoint: vi.fn(),
        pullNextDispatch: vi.fn(),
        updateDispatch: vi.fn(),
      },
    };
    handler = new ManagementToolHandler(deps);
  });

  it("should format errors correctly using unified formatError", async () => {
    deps.projectManagementRepository.listProjects.mockImplementation(() => {
      throw new Error("Simulated dependency error");
    });

    const response = await handler.handleManageProjects({ action: "list" });
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed).toEqual({
      result: {
        status: "error",
        domain: "projects",
        action: "list",
        message: "Simulated dependency error",
        errorType: "runtime",
      }
    });
    expect(response.isError).toBe(true);
  });

  it("should format string errors correctly", async () => {
    deps.projectManagementRepository.listProjects.mockImplementation(() => {
      throw "String error";
    });

    const response = await handler.handleManageProjects({ action: "list" });
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed).toEqual({
      result: {
        status: "error",
        domain: "projects",
        action: "list",
        message: "String error",
        errorType: "runtime",
      }
    });
    expect(response.isError).toBe(true);
  });

  it("returns standardized validation envelopes for blank required strings", async () => {
    const response = await handler.handleManageSprints({ action: "list", projectId: "   " });
    const parsed = JSON.parse(response.content[0].text);

    expect(response.isError).toBe(true);
    expect(parsed).toEqual({
      result: {
        status: "error",
        domain: "sprints",
        action: "list",
        message: "projectId is required",
        errorType: "validation",
        field: "projectId",
      },
    });
    expect(deps.projectManagementRepository.listSprints).not.toHaveBeenCalled();
  });

  it("returns standardized validation envelopes for invalid enums", async () => {
    const response = await handler.handleManageTasks({
      action: "create",
      projectId: "p1",
      sprintId: "s1",
      title: "Task",
      priority: "urgent",
    });
    const parsed = JSON.parse(response.content[0].text);

    expect(response.isError).toBe(true);
    expect(parsed.result).toMatchObject({
      status: "error",
      domain: "tasks",
      action: "create",
      message: "Invalid value for priority. Must be one of: critical, high, medium, low",
      errorType: "validation",
      field: "priority",
    });
    expect(deps.projectManagementRepository.createTask).not.toHaveBeenCalled();
  });

  it("returns standardized validation envelopes for invalid numeric strings", async () => {
    const response = await handler.handleManageQuicksprints({
      action: "execute",
      projectId: "p1",
      templateId: "template-1",
      taskCount: "many",
    });
    const parsed = JSON.parse(response.content[0].text);

    expect(response.isError).toBe(true);
    expect(parsed.result).toMatchObject({
      status: "error",
      domain: "quicksprints",
      action: "execute",
      message: "Invalid value for taskCount. Must be a valid integer.",
      errorType: "validation",
      field: "taskCount",
    });
    expect(deps.quicksprintService.executeQuicksprint).not.toHaveBeenCalled();
  });

  it("returns standardized validation envelopes for settings confirmation input errors", async () => {
    const response = await handler.handleManageSettings({
      action: "patch_system_setting",
      path: "defaults.automationLevel",
      approval: { confirmed: true },
    });
    const parsed = JSON.parse(response.content[0].text);

    expect(response.isError).toBe(true);
    expect(parsed.result).toMatchObject({
      status: "error",
      domain: "settings",
      action: "patch_system_setting",
      message: "value is required",
      errorType: "validation",
      field: "value",
    });
  });

  it("does not let a destructive settings approval be reused", async () => {
    const payload = { path: "defaults.automationLevel", value: "SEMI_AUTO" };

    let response = await handler.handleManageSettings({
      action: "patch_system_setting",
      ...payload,
    });
    let parsed = JSON.parse(response.content[0].text);
    expect(parsed.approvalRequired).toBe(true);

    response = await handler.handleManageSettings({
      action: "patch_system_setting",
      ...payload,
      approval: { confirmed: true },
    });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.result.settings.defaults.automationLevel).toBe("SEMI_AUTO");

    response = await handler.handleManageSettings({
      action: "patch_system_setting",
      ...payload,
      approval: { confirmed: true },
    });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.approvalRequired).toBe(true);
    expect(deps.settingsRepository.saveSystemSettings).toHaveBeenCalledTimes(1);
  });

  it("does not let a destructive settings approval execute a mismatched payload", async () => {
    await handler.handleManageSettings({
      action: "patch_system_setting",
      path: "defaults.automationLevel",
      value: "SEMI_AUTO",
    });

    const response = await handler.handleManageSettings({
      action: "patch_system_setting",
      path: "defaults.automationLevel",
      value: "MANUAL",
      approval: { confirmed: true },
    });
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.approvalRequired).toBe(true);
    expect(deps.settingsRepository.saveSystemSettings).not.toHaveBeenCalled();
  });

  it("registers worker endpoints through the MCP worker control-plane tool", async () => {
    deps.workerTaskDispatchService.registerExternalWorkerEndpoint.mockReturnValue({
      id: "endpoint-1",
      endpointKey: "mcp:worker-1",
      connectionId: "conn-1",
    });

    const response = await handler.handleRegisterWorkerEndpoint({
      connectionKey: "worker-1",
      displayName: "Worker 1",
      transport: "streamable-http",
      projectIds: ["project-A", "project-B"],
      activeProjectIds: ["project-B"],
      capabilities: { canExecuteTasks: true, canSuperviseProjects: true },
    });
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.endpoint.id).toBe("endpoint-1");
    expect(deps.workerTaskDispatchService.registerExternalWorkerEndpoint).toHaveBeenCalledWith(expect.objectContaining({
      connectionKey: "worker-1",
      projectIds: ["project-A", "project-B"],
      activeProjectIds: ["project-B"],
    }));
  });

  it("claims and updates worker dispatches through the MCP worker control-plane tools", async () => {
    deps.workerTaskDispatchService.pullNextDispatch.mockReturnValue({
      dispatch: { id: "dispatch-1" },
      leaseToken: "lease-1",
    });
    deps.workerTaskDispatchService.updateDispatch.mockReturnValue({
      dispatch: { id: "dispatch-1", status: "running" },
      controlAction: "cancel",
    });

    const claimResponse = await handler.handlePullTaskDispatch({
      connectionKey: "worker-1",
      projectId: "project-B",
    });
    const updateResponse = await handler.handleUpdateTaskDispatch({
      connectionKey: "worker-1",
      dispatchId: "dispatch-1",
      leaseToken: "lease-1",
      state: "RUNNING",
      sessionId: "session-1",
    });

    expect(JSON.parse(claimResponse.content[0].text)).toMatchObject({
      dispatch: { id: "dispatch-1" },
      leaseToken: "lease-1",
    });
    expect(JSON.parse(updateResponse.content[0].text)).toMatchObject({
      dispatch: { id: "dispatch-1" },
      controlAction: "cancel",
    });
    expect(deps.workerTaskDispatchService.pullNextDispatch).toHaveBeenCalledWith(expect.objectContaining({
      connectionKey: "worker-1",
      projectId: "project-B",
    }));
    expect(deps.workerTaskDispatchService.updateDispatch).toHaveBeenCalledWith(expect.objectContaining({
      connectionKey: "worker-1",
      dispatchId: "dispatch-1",
      leaseToken: "lease-1",
      state: "RUNNING",
      sessionId: "session-1",
    }));
  });

  it("should return approvalRequired for destructive actions without approval in handleManageCodeUx", async () => {
    const response = await handler.handleManageCodeUx({ domain: "unknown", action: "delete_something", payload: {} });
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed).toEqual({
      approvalRequired: true,
      approvalMessage: "The action 'delete_something' is destructive and requires explicit approval. Please review the changes and call this tool again with approval.confirmed set to true."
    });
  });

  it("should succeed for non-destructive actions in unknown domain in handleManageCodeUx", async () => {
    const response = await handler.handleManageCodeUx({ domain: "unknown", action: "get_something", payload: {} });
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed).toEqual({
      result: {
        status: "success",
        domain: "unknown",
        action: "get_something",
        message: "Domain unknown is not implemented yet."
      }
    });
  });

  it("should require approval for handleManageProjects delete action", async () => {
    const response = await handler.handleManageProjects({ action: "delete", projectId: "p1" });
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed).toEqual({
      approvalRequired: true,
      approvalMessage: "The action 'delete' is destructive and requires explicit approval. Please review the changes and call this tool again with approval.confirmed set to true."
    });
    expect(deps.projectManagementRepository.deleteProject).not.toHaveBeenCalled();
  });

  it("routes manage_quicksprints through the quicksprint action handler", async () => {
    deps.quicksprintService.listTemplates.mockResolvedValue([{ id: "t1" }]);

    const response = await handler.handleManageQuicksprints({ action: "list_templates", projectId: "p1" });
    const parsed = JSON.parse(response.content[0].text);

    expect(deps.quicksprintService.listTemplates).toHaveBeenCalledWith("p1");
    expect(parsed.result).toEqual({ templates: [{ id: "t1" }] });
  });

  it("routes manage_scheduler through the scheduler action handler", async () => {
    deps.schedulerService.listProjectSchedule.mockReturnValue({ entries: [], occurrences: [], from: "from", to: "to" });

    const response = await handler.handleManageScheduler({ action: "list", projectId: "p1", from: "from", to: "to" });
    const parsed = JSON.parse(response.content[0].text);

    expect(deps.schedulerService.listProjectSchedule).toHaveBeenCalledWith("p1", "from", "to");
    expect(parsed.result).toEqual({ entries: [], occurrences: [], from: "from", to: "to" });
  });

  it("exposes the expanded import_issues MCP schema on manage_sprints", () => {
    const tool = TOOL_DEFINITIONS.find((definition) => definition.name === "manage_sprints");
    expect(tool).toBeDefined();

    const schema = tool?.inputSchema as { properties: Record<string, JsonSchemaProperty> } | undefined;
    const properties = schema?.properties ?? {};

    expect(properties.action?.enum).toContain("import_issues");
    expect(properties.provider?.enum).toEqual(["github", "gitlab", "jira"]);
    expect(properties.state?.enum).toEqual(["open", "closed", "all"]);
    expect(properties.labels).toMatchObject({ type: "array", items: { type: "string" } });
    expect(properties.issueKeys).toMatchObject({ type: "array", items: { type: "string" } });
    expect(properties.issueNumbers).toMatchObject({ type: "array", items: { type: "number" } });
    expect(properties.issueRefs).toMatchObject({ type: "array", items: { type: "string" } });

    for (const field of [
      "repository",
      "hostDomain",
      "projectKey",
      "status",
      "assignee",
      "assigneeText",
      "includeConversation",
      "attachToSprint",
      "planAfterImport",
      "autoStart",
      "search",
      "limit",
      "sprintId",
      "planningAgentPresetId",
      "replan",
      "overrides",
    ]) {
      expect(properties[field], field).toBeDefined();
    }
  });

  it("exposes settings bundle actions and fields on manage_settings", () => {
    const tool = TOOL_DEFINITIONS.find((definition) => definition.name === "manage_settings");
    expect(tool).toBeDefined();

    const schema = tool?.inputSchema as { properties: Record<string, JsonSchemaProperty> } | undefined;
    const properties = schema?.properties ?? {};

    expect(properties.action?.enum).toContain("export_settings_bundle");
    expect(properties.action?.enum).toContain("apply_settings_bundle");
    expect(properties.bundle).toMatchObject({ type: "object" });
    expect(properties.includeSecrets).toMatchObject({ type: "boolean" });
    expect(properties.scopes).toMatchObject({ type: "array" });
    expect(properties.projectIds).toMatchObject({ type: "array", items: { type: "string" } });
    expect(properties.sprintIds).toMatchObject({ type: "array", items: { type: "string" } });
  });

  it("routes settings bundle apply through the one-use approval flow", async () => {
    const bundle = {
      metadata: {
        schemaVersion: 1,
        exportedAt: "2026-07-07T00:00:00.000Z",
        includedScopes: ["system"],
        fingerprint: "fp",
        containsSecrets: true,
      },
      system: {
        integrations: {
          providers: { codex: { provider: "codex", name: "Codex", apiKey: "sk-imported" } },
          githubToken: "",
          jira: { apiToken: "" },
        },
      },
    };

    let response = await handler.handleManageSettings({ action: "apply_settings_bundle", bundle });
    let parsed = JSON.parse(response.content[0].text);
    expect(parsed.approvalRequired).toBe(true);
    expect(deps.settingsRepository.saveSystemSettings).not.toHaveBeenCalled();

    response = await handler.handleManageSettings({ action: "apply_settings_bundle", bundle, approval: { confirmed: true } });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.result.applied).toEqual({ system: 1, projects: 0, sprints: 0 });
    expect(deps.settingsRepository.saveSystemSettings).toHaveBeenCalledWith(bundle.system);
  });

  it("redacts secret-bearing settings validation errors in management envelopes", async () => {
    const secret = "ghp-never-print-this";
    const response = await handler.handleManageSettings({
      action: "apply_settings_bundle",
      bundle: {
        metadata: { schemaVersion: 1, includedScopes: ["projects"], fingerprint: "fp", containsSecrets: true },
        projects: [{ projectId: "proj-1", settings: "bad", githubToken: secret }],
      },
    });

    const text = response.content[0].text;
    expect(response.isError).toBe(true);
    expect(text).not.toContain(secret);
    expect(JSON.parse(text).result.message).toContain("bundle.projects[0]");
  });

  it("should execute handleManageProjects delete action only after exact approval is pending", async () => {
    deps.projectManagementRepository.deleteProject.mockReturnValue({ ok: true });

    let response = await handler.handleManageProjects({ action: "delete", projectId: "p1", approval: { confirmed: true } });
    let parsed = JSON.parse(response.content[0].text);
    expect(parsed.approvalRequired).toBe(true);
    expect(deps.projectManagementRepository.deleteProject).not.toHaveBeenCalled();

    response = await handler.handleManageProjects({ action: "delete", projectId: "p1" });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.approvalRequired).toBe(true);

    response = await handler.handleManageProjects({ action: "delete", projectId: "p1", approval: { confirmed: true } });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed).toEqual({
      result: {
        status: "success",
        deletedProjectId: "p1"
      }
    });
    expect(deps.projectManagementRepository.deleteProject).toHaveBeenCalledWith("p1");
  });

  it("rejects destructive handleManageProjects payload substitution without consuming the original approval", async () => {
    deps.projectManagementRepository.deleteProject.mockReturnValue({ ok: true });

    await handler.handleManageProjects({ action: "delete", projectId: "p1" });

    let response = await handler.handleManageProjects({ action: "delete", projectId: "p2", approval: { confirmed: true } });
    let parsed = JSON.parse(response.content[0].text);
    expect(parsed.approvalRequired).toBe(true);
    expect(deps.projectManagementRepository.deleteProject).not.toHaveBeenCalled();

    response = await handler.handleManageProjects({ action: "delete", projectId: "p1", approval: { confirmed: true } });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.result).toEqual({ status: "success", deletedProjectId: "p1" });
    expect(deps.projectManagementRepository.deleteProject).toHaveBeenCalledTimes(1);
  });

  it("does not replay a consumed destructive handleManageProjects approval", async () => {
    deps.projectManagementRepository.deleteProject.mockReturnValue({ ok: true });

    await handler.handleManageProjects({ action: "delete", projectId: "p1" });
    await handler.handleManageProjects({ action: "delete", projectId: "p1", approval: { confirmed: true } });
    const response = await handler.handleManageProjects({ action: "delete", projectId: "p1", approval: { confirmed: true } });
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.approvalRequired).toBe(true);
    expect(deps.projectManagementRepository.deleteProject).toHaveBeenCalledTimes(1);
  });

  it("should cover the full lifecycle of project management", async () => {
    deps.projectManagementRepository.createProject.mockReturnValue({ id: "p1", name: "test-project" });
    let response = await handler.handleManageProjects({ action: "create", name: "test-project" });
    let parsed = JSON.parse(response.content[0].text);
    expect(parsed.result).toEqual({ id: "p1", name: "test-project" });

    deps.projectManagementRepository.listProjects.mockReturnValue({ projects: [{ id: "p1", name: "test-project" }] });
    response = await handler.handleManageProjects({ action: "list" });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.result).toEqual({ projects: [{ id: "p1", name: "test-project" }] });

    deps.projectManagementRepository.updateProject.mockReturnValue({ id: "p1", name: "updated-project" });
    response = await handler.handleManageProjects({ action: "update", projectId: "p1", name: "updated-project" });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.result).toEqual({ id: "p1", name: "updated-project" });
  });

  it("prepares Git projects before creating them through manage_projects", async () => {
    const preparedInput = {
      action: "create",
      name: "Remote Project",
      sourceType: "git",
      sourceRef: "https://github.com/codeux-ai/example-project.git",
      cloneDir: "/home/test/.code-ux/projects",
    };
    vi.mocked(prepareGitProjectCreateInput).mockResolvedValue(preparedInput as any);
    deps.getDashboardSettings.mockReturnValue({
      git: {
        githubToken: "git-token",
        gitlabToken: "lab-token",
      },
      integrations: {
        githubToken: "",
        gitlabToken: "",
      },
    });
    deps.projectManagementRepository.createProject.mockReturnValue({
      id: "p1",
      name: "Remote Project",
      baseDir: "/home/test/.code-ux/projects/example-project",
    });

    const response = await handler.handleManageProjects({
      action: "create",
      name: "Remote Project",
      sourceType: "git",
      sourceRef: "https://github.com/codeux-ai/example-project.git",
    });
    const parsed = JSON.parse(response.content[0].text);

    expect(prepareGitProjectCreateInput).toHaveBeenCalledWith(expect.objectContaining({
      action: "create",
      name: "Remote Project",
      sourceType: "git",
      sourceRef: "https://github.com/codeux-ai/example-project.git",
    }), {
      githubToken: "git-token",
      gitlabToken: "lab-token",
    });
    expect(deps.projectManagementRepository.createProject).toHaveBeenCalledWith(preparedInput);
    expect(parsed.result).toEqual({
      id: "p1",
      name: "Remote Project",
      baseDir: "/home/test/.code-ux/projects/example-project",
    });
  });

  it("should cover the full lifecycle of sprint management and require approval for delete", async () => {
    deps.projectManagementRepository.createSprint = vi.fn().mockReturnValue({ id: "s1", name: "test-sprint" });
    let response = await handler.handleManageSprints({ action: "create", projectId: "p1", title: "test-sprint" });
    let parsed = JSON.parse(response.content[0].text);
    expect(parsed.result).toEqual({ id: "s1", name: "test-sprint" });

    deps.projectManagementRepository.listSprints = vi.fn().mockReturnValue({ sprints: [{ id: "s1", name: "test-sprint" }] });
    response = await handler.handleManageSprints({ action: "list", projectId: "p1" });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.result).toEqual({ sprints: [{ id: "s1", name: "test-sprint" }] });

    deps.projectManagementRepository.updateSprint = vi.fn().mockReturnValue({ id: "s1", name: "updated-sprint" });
    response = await handler.handleManageSprints({ action: "update", sprintId: "s1", title: "updated-sprint" });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.result).toEqual({ id: "s1", name: "updated-sprint" });

    response = await handler.handleManageSprints({ action: "delete", sprintId: "s1" });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.approvalRequired).toBe(true);

    deps.projectManagementRepository.deleteSprint = vi.fn().mockReturnValue({ ok: true });
    response = await handler.handleManageSprints({ action: "delete", sprintId: "s1", approval: { confirmed: true } });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.result).toEqual({ status: "success", deletedSprintId: "s1" });
  });

  it("should cover the full lifecycle of task management and require approval for delete", async () => {
    deps.projectManagementRepository.createTask = vi.fn().mockReturnValue({ id: "t1", title: "test-task" });
    let response = await handler.handleManageTasks({ action: "create", projectId: "p1", sprintId: "s1", title: "test-task" });
    let parsed = JSON.parse(response.content[0].text);
    expect(parsed.result).toEqual({ task: { id: "t1", title: "test-task" } });

    deps.projectManagementRepository.listTasks = vi.fn().mockReturnValue([{ id: "t1", title: "test-task" }]);
    response = await handler.handleManageTasks({ action: "list", projectId: "p1", sprintId: "s1" });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.result).toEqual({ tasks: [{ id: "t1", title: "test-task" }] });

    deps.projectManagementRepository.updateTask = vi.fn().mockReturnValue({ id: "t1", title: "updated-task" });
    response = await handler.handleManageTasks({ action: "update", taskId: "t1", title: "updated-task" });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.result).toEqual({ task: { id: "t1", title: "updated-task" } });

    response = await handler.handleManageTasks({ action: "delete", taskId: "t1" });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.approvalRequired).toBe(true);

    deps.projectManagementRepository.deleteTask = vi.fn().mockReturnValue({ ok: true });
    response = await handler.handleManageTasks({ action: "delete", taskId: "t1", approval: { confirmed: true } });
    parsed = JSON.parse(response.content[0].text);
    expect(parsed.result).toEqual({ success: true });
  });
});
