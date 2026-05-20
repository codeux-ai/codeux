import { describe, it, expect, vi, beforeEach } from "vitest";
import { ManagementToolHandler } from "../../../src/mcp/management-tool-handler.js";
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

describe("ManagementToolHandler", () => {
  let handler: ManagementToolHandler;
  let deps: any;

  beforeEach(() => {
    deps = {
      projectManagementRepository: {
        listProjects: vi.fn(),
        getProject: vi.fn(),
        createProject: vi.fn(),
        updateProject: vi.fn(),
        setSelectedProjectId: vi.fn(),
        deleteProject: vi.fn(),
      },
      sprintPreviewService: {
        listSessions: vi.fn(),
      },
      executionRepository: {
        listSprintRuns: vi.fn(),
      },
      getDashboardSettings: vi.fn(),
      executionControlService: {
        orchestrateSprint: vi.fn(),
      },
      taskRerunService: {
        rerunTask: vi.fn(),
      },
      settingsRepository: {
        getGlobalSettings: vi.fn(),
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
        message: "Simulated dependency error"
      }
    });
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
        message: "String error"
      }
    });
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

  it("should execute handleManageProjects delete action if approval is provided", async () => {
    deps.projectManagementRepository.deleteProject.mockReturnValue({ ok: true });
    const response = await handler.handleManageProjects({ action: "delete", projectId: "p1", approval: { confirmed: true } });
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed).toEqual({
      result: {
        status: "success",
        deletedProjectId: "p1"
      }
    });
    expect(deps.projectManagementRepository.deleteProject).toHaveBeenCalledWith("p1");
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
