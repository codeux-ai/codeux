import { Project } from "./project.js";
import { ProjectRepository, DuplicateProjectError } from "./project-repository.js";
import { ProjectId } from "../../contracts/app-types.js";

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectService {
  constructor(private readonly repository: ProjectRepository) {}

  public createProject(sourceId: string, normalizedBaseDir: string, name: string, description?: string): Project {
    const project = Project.create(sourceId, normalizedBaseDir, name, description);
    this.repository.save(project);
    return project;
  }

  public getProject(id: ProjectId): Project {
    const project = this.repository.findById(id);
    if (!project) {
      throw new ProjectNotFoundError(id);
    }
    return project;
  }

  public getProjectBySourceAndDir(sourceId: string, normalizedBaseDir: string): Project | null {
    return this.repository.findBySourceAndDir(sourceId, normalizedBaseDir);
  }

  public updateProject(id: ProjectId, name?: string, description?: string): Project {
    const project = this.getProject(id);
    project.update(name, description);
    this.repository.save(project);
    return project;
  }

  public archiveProject(id: ProjectId): Project {
    const project = this.getProject(id);
    project.archive();
    this.repository.save(project);
    return project;
  }

  public listProjects(): Project[] {
    return this.repository.listAll();
  }
}
