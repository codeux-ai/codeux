import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectService, ProjectNotFoundError } from "../../../../src/domain/project/project-service.js";
import { ProjectRepository, DuplicateProjectError } from "../../../../src/domain/project/project-repository.js";
import { Project } from "../../../../src/domain/project/project.js";

describe("ProjectService", () => {
  let repo: ProjectRepository;
  let service: ProjectService;

  beforeEach(() => {
    // We only mock methods of ProjectRepository that the service calls
    repo = {
      save: vi.fn(),
      findById: vi.fn(),
      findBySourceAndDir: vi.fn(),
      listAll: vi.fn(),
    } as unknown as ProjectRepository;

    service = new ProjectService(repo);
  });

  it("should create a new project and save to repo", () => {
    const project = service.createProject("src-1", "/dir", "My Proj", "Desc");
    expect(project.name).toBe("My Proj");
    expect(repo.save).toHaveBeenCalledWith(project);
  });

  it("should find an existing project by ID", () => {
    const p = Project.create("src-1", "/dir", "My Proj");
    (repo.findById as any).mockReturnValue(p);

    const found = service.getProject(p.id);
    expect(found.id).toBe(p.id);
  });

  it("should throw ProjectNotFoundError if project by ID is not found", () => {
    (repo.findById as any).mockReturnValue(null);

    expect(() => service.getProject("not-exist")).toThrowError(ProjectNotFoundError);
  });

  it("should update a project and save to repo", () => {
    const p = Project.create("src-1", "/dir", "My Proj");
    (repo.findById as any).mockReturnValue(p);

    const updated = service.updateProject(p.id, "New Name");
    expect(updated.name).toBe("New Name");
    expect(repo.save).toHaveBeenCalledWith(updated);
  });

  it("should archive a project and save to repo", () => {
    const p = Project.create("src-1", "/dir", "My Proj");
    (repo.findById as any).mockReturnValue(p);

    const archived = service.archiveProject(p.id);
    expect(archived.status).toBe("ARCHIVED");
    expect(repo.save).toHaveBeenCalledWith(archived);
  });

  it("should return null for getProjectBySourceAndDir if not found", () => {
    (repo.findBySourceAndDir as any).mockReturnValue(null);
    expect(service.getProjectBySourceAndDir("src", "dir")).toBeNull();
  });

  it("should list projects", () => {
    const p = Project.create("s", "d", "n");
    (repo.listAll as any).mockReturnValue([p]);
    expect(service.listProjects()).toEqual([p]);
  });
});
