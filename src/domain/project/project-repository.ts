import { DatabaseSync } from "node:sqlite";
import { Project } from "./project.js";
import { ProjectState } from "./project-types.js";
import { ProjectId } from "../../contracts/app-types.js";

export class DuplicateProjectError extends Error {
  constructor(sourceId: string, normalizedBaseDir: string) {
    super(`Project already exists for source_id '${sourceId}' and base_dir '${normalizedBaseDir}'`);
    this.name = "DuplicateProjectError";
  }
}

export class ProjectRepository {
  constructor(private readonly db: DatabaseSync) {}

  public save(project: Project): void {
    const state = project.getState();
    const existing = this.findById(state.id);

    try {
      if (existing) {
        const stmt = this.db.prepare(
          `UPDATE pm_projects SET
           source_id = ?, normalized_base_dir = ?, name = ?, description = ?, status = ?, updated_at = ?
           WHERE id = ?`
        );
        stmt.run(
          state.source_id,
          state.normalized_base_dir,
          state.name,
          state.description,
          state.status,
          state.updated_at,
          state.id
        );
      } else {
        const stmt = this.db.prepare(
          `INSERT INTO pm_projects
           (id, source_id, normalized_base_dir, name, description, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        stmt.run(
          state.id,
          state.source_id,
          state.normalized_base_dir,
          state.name,
          state.description,
          state.status,
          state.created_at,
          state.updated_at
        );
      }
    } catch (err: any) {
      if (err.message && err.message.includes("UNIQUE constraint failed: pm_projects.source_id, pm_projects.normalized_base_dir")) {
        throw new DuplicateProjectError(state.source_id, state.normalized_base_dir);
      }
      throw err;
    }
  }

  public findById(id: ProjectId): Project | null {
    const stmt = this.db.prepare(`SELECT * FROM pm_projects WHERE id = ?`);
    const row = stmt.get(id) as ProjectState | undefined;
    return row ? Project.reconstitute(row) : null;
  }

  public findBySourceAndDir(sourceId: string, normalizedBaseDir: string): Project | null {
    const stmt = this.db.prepare(`SELECT * FROM pm_projects WHERE source_id = ? AND normalized_base_dir = ?`);
    const row = stmt.get(sourceId, normalizedBaseDir) as ProjectState | undefined;
    return row ? Project.reconstitute(row) : null;
  }

  public listAll(): Project[] {
    const stmt = this.db.prepare(`SELECT * FROM pm_projects`);
    const rows = stmt.all() as unknown as ProjectState[];
    return rows.map(r => Project.reconstitute(r));
  }
}
