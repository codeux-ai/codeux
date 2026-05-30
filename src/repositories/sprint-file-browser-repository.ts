import { randomUUID } from "crypto";
import type {
  FileBrowserSession,
  FileBrowserSessionStatus,
} from "../contracts/app-types.js";
import { AppDbStorage } from "./app-db-storage.js";
import { toNumber } from "./repository-utils.js";

interface SprintFileBrowserSessionRow {
  id: string;
  project_id: string;
  sprint_id: string;
  project_name: string;
  sprint_name: string;
  sprint_number: number | string | null;
  status: string;
  container_id: string | null;
  container_name: string | null;
  workspace_path: string | null;
  feature_branch: string | null;
  default_branch: string | null;
  last_completed_task_count: number | string;
  last_seen_sprint_status: string | null;
  last_error: string | null;
  last_build_at: string | null;
  last_started_at: string | null;
  last_stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateFileBrowserSessionInput {
  projectId: string;
  sprintId: string;
  status: FileBrowserSessionStatus;
  featureBranch?: string | null;
  defaultBranch?: string | null;
  workspacePath?: string | null;
  lastCompletedTaskCount?: number;
  lastSeenSprintStatus?: string | null;
}

export interface UpdateFileBrowserSessionInput {
  status?: FileBrowserSessionStatus;
  containerId?: string | null;
  containerName?: string | null;
  workspacePath?: string | null;
  featureBranch?: string | null;
  defaultBranch?: string | null;
  lastCompletedTaskCount?: number;
  lastSeenSprintStatus?: string | null;
  lastError?: string | null;
  lastBuildAt?: string | null;
  lastStartedAt?: string | null;
  lastStoppedAt?: string | null;
}

const SELECT_BASE = `
  SELECT
    fbs.*,
    p.name AS project_name,
    sp.name AS sprint_name,
    sp.number AS sprint_number
  FROM sprint_file_browser_sessions fbs
  INNER JOIN projects p ON p.id = fbs.project_id
  INNER JOIN sprints sp ON sp.id = fbs.sprint_id
`;

export class SprintFileBrowserRepository {
  constructor(private readonly storage: AppDbStorage) {}

  listSessions(projectId?: string): FileBrowserSession[] {
    const rows = (projectId
      ? this.storage.getDatabase().prepare(`
          ${SELECT_BASE}
          WHERE fbs.project_id = ?
          ORDER BY sp.updated_at DESC, fbs.updated_at DESC
        `).all(projectId)
      : this.storage.getDatabase().prepare(`
          ${SELECT_BASE}
          ORDER BY p.name ASC, sp.updated_at DESC, fbs.updated_at DESC
        `).all()) as unknown as SprintFileBrowserSessionRow[];

    return rows.map((row) => this.mapRow(row));
  }

  getSession(id: string): FileBrowserSession | null {
    const row = this.storage.getDatabase().prepare(`
      ${SELECT_BASE}
      WHERE fbs.id = ?
      LIMIT 1
    `).get(id) as SprintFileBrowserSessionRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  getSessionByProjectSprint(projectId: string, sprintId: string): FileBrowserSession | null {
    const row = this.storage.getDatabase().prepare(`
      ${SELECT_BASE}
      WHERE fbs.project_id = ? AND fbs.sprint_id = ?
      LIMIT 1
    `).get(projectId, sprintId) as SprintFileBrowserSessionRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  createSession(input: CreateFileBrowserSessionInput): FileBrowserSession {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.storage.getDatabase().prepare(`
      INSERT INTO sprint_file_browser_sessions (
        id, project_id, sprint_id, status, container_id, container_name,
        workspace_path, feature_branch, default_branch,
        last_completed_task_count, last_seen_sprint_status, last_error,
        last_build_at, last_started_at, last_stopped_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
    `).run(
      id,
      input.projectId,
      input.sprintId,
      input.status,
      input.workspacePath || null,
      input.featureBranch || null,
      input.defaultBranch || null,
      input.lastCompletedTaskCount || 0,
      input.lastSeenSprintStatus || null,
      now,
      now,
    );

    const created = this.getSession(id);
    if (!created) {
      throw new Error(`Failed to load created file browser session ${id}`);
    }
    return created;
  }

  updateSession(id: string, patch: UpdateFileBrowserSessionInput): FileBrowserSession {
    const current = this.getSession(id);
    if (!current) {
      throw new Error(`File browser session not found: ${id}`);
    }
    const now = new Date().toISOString();

    this.storage.getDatabase().prepare(`
      UPDATE sprint_file_browser_sessions
      SET status = ?,
          container_id = ?,
          container_name = ?,
          workspace_path = ?,
          feature_branch = ?,
          default_branch = ?,
          last_completed_task_count = ?,
          last_seen_sprint_status = ?,
          last_error = ?,
          last_build_at = ?,
          last_started_at = ?,
          last_stopped_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      patch.status ?? current.status,
      patch.containerId === undefined ? current.containerId : patch.containerId,
      patch.containerName === undefined ? current.containerName : patch.containerName,
      patch.workspacePath === undefined ? current.workspacePath : patch.workspacePath,
      patch.featureBranch === undefined ? current.featureBranch : patch.featureBranch,
      patch.defaultBranch === undefined ? current.defaultBranch : patch.defaultBranch,
      patch.lastCompletedTaskCount ?? current.lastCompletedTaskCount,
      patch.lastSeenSprintStatus === undefined ? current.lastSeenSprintStatus : patch.lastSeenSprintStatus,
      patch.lastError === undefined ? current.lastError : patch.lastError,
      patch.lastBuildAt === undefined ? current.lastBuildAt : patch.lastBuildAt,
      patch.lastStartedAt === undefined ? current.lastStartedAt : patch.lastStartedAt,
      patch.lastStoppedAt === undefined ? current.lastStoppedAt : patch.lastStoppedAt,
      now,
      id,
    );

    const updated = this.getSession(id);
    if (!updated) {
      throw new Error(`Failed to load updated file browser session ${id}`);
    }
    return updated;
  }

  deleteSession(id: string): void {
    this.storage.getDatabase().prepare(`
      DELETE FROM sprint_file_browser_sessions
      WHERE id = ?
    `).run(id);
  }

  private mapRow(row: SprintFileBrowserSessionRow): FileBrowserSession {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      projectName: row.project_name,
      sprintName: row.sprint_name,
      sprintNumber: toNumber(row.sprint_number) || null,
      status: row.status as FileBrowserSessionStatus,
      containerId: row.container_id,
      containerName: row.container_name,
      workspacePath: row.workspace_path,
      featureBranch: row.feature_branch,
      defaultBranch: row.default_branch,
      lastCompletedTaskCount: toNumber(row.last_completed_task_count) || 0,
      lastSeenSprintStatus: row.last_seen_sprint_status,
      lastError: row.last_error,
      lastBuildAt: row.last_build_at,
      lastStartedAt: row.last_started_at,
      lastStoppedAt: row.last_stopped_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
