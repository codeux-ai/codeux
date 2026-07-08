import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleProjectAction } from "../../../src/mcp/management/project-actions.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";

describe("handleProjectAction", () => {
  let repository: ProjectManagementRepository;

  beforeEach(() => {
    repository = {
      listProjects: vi.fn(),
      getProject: vi.fn(),
      createProject: vi.fn(),
      updateProject: vi.fn(),
      setSelectedProjectId: vi.fn(),
      deleteProject: vi.fn(),
    } as unknown as ProjectManagementRepository;
  });

  it("lists projects", () => {
    const mockResult = { projects: [], selectedProjectId: null };
    vi.mocked(repository.listProjects).mockReturnValue(mockResult);

    const result = handleProjectAction("list", {}, repository, "projects");
    expect(repository.listProjects).toHaveBeenCalled();
    expect(result.result).toEqual(mockResult);
  });

  it("gets project", () => {
    const mockProject = { id: "p1" };
    vi.mocked(repository.getProject).mockReturnValue(mockProject as any);

    const result = handleProjectAction("get", { projectId: "p1" }, repository, "projects");
    expect(repository.getProject).toHaveBeenCalledWith("p1");
    expect(result.result).toEqual(mockProject);
  });

  it("creates project", () => {
    const mockProject = { id: "p1" };
    vi.mocked(repository.createProject).mockReturnValue(mockProject as any);

    const input = { name: "test", sourceType: "local", sourceRef: "." };
    const result = handleProjectAction("create", input, repository, "projects");
    expect(repository.createProject).toHaveBeenCalledWith(input);
    expect(result.result).toEqual(mockProject);
  });

  it("updates project", () => {
    const mockProject = { id: "p1" };
    vi.mocked(repository.updateProject).mockReturnValue(mockProject as any);

    const input = { projectId: "p1", name: "test-update" };
    const result = handleProjectAction("update", input, repository, "projects");
    expect(repository.updateProject).toHaveBeenCalledWith("p1", input);
    expect(result.result).toEqual(mockProject);
  });

  it("selects project", () => {
    vi.mocked(repository.setSelectedProjectId).mockReturnValue("p1");

    const result = handleProjectAction("select", { projectId: "p1" }, repository, "projects");
    expect(repository.setSelectedProjectId).toHaveBeenCalledWith("p1");
    expect(result.result).toEqual({ selectedProjectId: "p1" });
  });

  it("requires approval for delete", () => {
    const result = handleProjectAction("delete", { projectId: "p1" }, repository, "projects");
    expect(result.approvalRequired).toBe(true);
    expect(repository.deleteProject).not.toHaveBeenCalled();
  });

  it("deletes project with approval", () => {
    const result = handleProjectAction("delete", { projectId: "p1" }, repository, "projects", { confirmed: true });
    expect(repository.deleteProject).toHaveBeenCalledWith("p1");
    expect(result.result).toEqual({ status: "success", deletedProjectId: "p1" });
  });

  it("passes top-level setup options through to project setup", async () => {
    const projectSetupService = {
      setupProject: vi.fn(async () => ({ ok: true, embeddedDocumentIds: ["doc-1"], embeddedDocumentErrors: [] })),
    };

    await handleProjectAction(
      "setup",
      {
        projectId: "p1",
        options: { docs: true },
        clientRequestId: "setup-top-level",
      },
      repository,
      "projects",
      undefined,
      projectSetupService as any,
    );

    expect(projectSetupService.setupProject).toHaveBeenCalledWith("p1", {
      clientRequestId: "setup-top-level",
      options: { docs: true },
    });
  });

  it("passes nested setup options through to project setup", async () => {
    const projectSetupService = {
      setupProject: vi.fn(async () => ({ ok: true, embeddedDocumentIds: ["doc-1"], embeddedDocumentErrors: [] })),
    };

    await handleProjectAction(
      "setup",
      {
        projectId: "p1",
        setup: {
          enabled: true,
          clientRequestId: "setup-nested",
          options: { docs: true },
        },
      },
      repository,
      "projects",
      undefined,
      projectSetupService as any,
    );

    expect(projectSetupService.setupProject).toHaveBeenCalledWith("p1", {
      enabled: true,
      clientRequestId: "setup-nested",
      options: { docs: true },
    });
  });
});
