import { DatabaseAdapter } from "../../repositories/db/database-adapter.js";

export function getSelectedProjectIdFromSettings(db: DatabaseAdapter): string | null {
  const row = db.prepare(`
    SELECT payload
    FROM app_settings
    WHERE key = 'selected_project_id'
  `).get() as { payload: string } | undefined;

  if (!row) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.payload) as { projectId?: string | null };
    return parsed.projectId ?? null;
  } catch {
    return null;
  }
}

export function getSelectedSprintIdFromSettings(db: DatabaseAdapter, projectId: string): string | null {
  const row = db.prepare(`
    SELECT payload
    FROM app_settings
    WHERE key = ?
  `).get(`selected_sprint_id_${projectId}`) as { payload: string } | undefined;

  if (!row) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.payload) as { sprintId?: string | null };
    return parsed.sprintId ?? null;
  } catch {
    return null;
  }
}
