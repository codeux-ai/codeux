import { ProjectState } from "./project-types.js";
import { ProjectId, ProjectStatus } from "../../contracts/app-types.js";
import crypto from "node:crypto";

export class Project {
  private constructor(private state: ProjectState) {}

  public get id(): ProjectId { return this.state.id; }
  public get sourceId(): string { return this.state.source_id; }
  public get normalizedBaseDir(): string { return this.state.normalized_base_dir; }
  public get name(): string { return this.state.name; }
  public get description(): string | null { return this.state.description; }
  public get status(): ProjectStatus { return this.state.status; }
  public get createdAt(): string { return this.state.created_at; }
  public get updatedAt(): string { return this.state.updated_at; }

  public getState(): ProjectState {
    return { ...this.state };
  }

  public update(name?: string, description?: string): void {
    let updated = false;
    if (name !== undefined && name !== this.state.name) {
      this.state.name = name;
      updated = true;
    }
    if (description !== undefined && description !== this.state.description) {
      this.state.description = description;
      updated = true;
    }

    if (updated) {
      this.state.updated_at = new Date().toISOString();
    }
  }

  public archive(): void {
    if (this.state.status !== ProjectStatus.ARCHIVED) {
      this.state.status = ProjectStatus.ARCHIVED;
      this.state.updated_at = new Date().toISOString();
    }
  }

  public static create(sourceId: string, normalizedBaseDir: string, name: string, description?: string): Project {
    const now = new Date().toISOString();
    return new Project({
      id: crypto.randomUUID(),
      source_id: sourceId,
      normalized_base_dir: normalizedBaseDir,
      name,
      description: description ?? null,
      status: ProjectStatus.ACTIVE,
      created_at: now,
      updated_at: now,
    });
  }

  public static reconstitute(state: ProjectState): Project {
    return new Project({ ...state });
  }
}
