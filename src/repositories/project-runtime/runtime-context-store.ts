import { DatabaseAdapter } from "../db/database-adapter.js";

export const RUNTIME_CONTEXT_PREFIX = "runtime_context:";

export interface RuntimeContextPayload {
  projectId: string;
  sprintId: string | null;
  sprintNumber: number | null;
  sourceId: string | null;
  repoPath: string | null;
  featureBranch: string | null;
  reportText: string;
  statusTable: string;
  instructions: string;
  timestamp: string | null;
}

export function runtimeContextKey(projectId: string, sprintId?: string | null): string {
  if (!sprintId) {
    throw new Error("Sprint runtime context requires a sprint id.");
  }
  return `${RUNTIME_CONTEXT_PREFIX}${projectId}:${sprintId}`;
}

export class RuntimeContextStore {
  constructor(private readonly db: DatabaseAdapter) {}

  getRuntimeContext(projectId: string, sprintId?: string | null): RuntimeContextPayload | null {
    if (!sprintId) {
      return null;
    }
    const primaryKey = runtimeContextKey(projectId, sprintId);
    const row = this.db.prepare(`
      SELECT payload
      FROM app_settings
      WHERE key = ?
    `).get(primaryKey) as { payload: string } | undefined;

    if (!row) {
      return null;
    }

    try {
      return JSON.parse(row.payload) as RuntimeContextPayload;
    } catch {
      return null;
    }
  }

  saveRuntimeContext(context: RuntimeContextPayload): void {
    if (!context.sprintId) {
      return;
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO app_settings (key, payload, updated_at)
      VALUES (?, ?, ?)
      ${this.db.dialect.upsert(["key"], ["payload", "updated_at"])}
    `).run(
      runtimeContextKey(context.projectId, context.sprintId),
      JSON.stringify(context),
      now
    );
  }

  clearLegacyProjectRuntimeContext(projectId: string): void {
    this.db.prepare(`
      DELETE FROM app_settings
      WHERE key = ?
    `).run(`${RUNTIME_CONTEXT_PREFIX}${projectId}`);
  }
}
