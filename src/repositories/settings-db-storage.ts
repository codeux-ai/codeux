import * as fs from "fs";
import * as path from "path";
import { DatabaseAdapter } from "./db/database-adapter.js";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";
import { SqliteDatabaseAdapter } from "./db/sqlite-database-adapter.js";

interface PayloadRow {
  payload: string;
}

const SETTINGS_DB_PATH = getHomeCodeUxPath("settings.db");

const resolveSettingsDbPath = (dbPath?: string): string => {
  if (dbPath && dbPath.trim().length > 0) {
    return dbPath;
  }

  fs.mkdirSync(path.dirname(SETTINGS_DB_PATH), { recursive: true });
  return SETTINGS_DB_PATH;
};

export class SettingsDbStorage {
  private readonly db: DatabaseAdapter;

  constructor(dbPath?: string) {
    const resolvedDbPath = resolveSettingsDbPath(dbPath);
    fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
    this.db = new SqliteDatabaseAdapter(resolvedDbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_settings (
        project_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sprint_settings (
        sprint_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  readLegacyPayload(): string | null {
    const row = this.db.prepare("SELECT payload FROM app_settings WHERE id = 1").get() as PayloadRow | undefined;
    return row?.payload ?? null;
  }

  deleteLegacyPayload(): void {
    this.db.prepare("DELETE FROM app_settings WHERE id = 1").run();
  }

  readSystemPayload(): string | null {
    const row = this.db.prepare("SELECT payload FROM system_settings WHERE id = 1").get() as PayloadRow | undefined;
    return row?.payload ?? null;
  }

  writeSystemPayload(payload: string): void {
    this.db.prepare(`
      INSERT INTO system_settings (id, payload, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(payload, new Date().toISOString());
  }

  readProjectPayload(projectId: string): string | null {
    const row = this.db.prepare("SELECT payload FROM project_settings WHERE project_id = ?").get(projectId) as PayloadRow | undefined;
    return row?.payload ?? null;
  }

  getCachedStatement(sql: string) {
    return this.db.prepare(sql);
  }

  writeProjectPayload(projectId: string, payload: string): void {
    this.db.prepare(`
      INSERT INTO project_settings (project_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(projectId, payload, new Date().toISOString());
  }

  deleteProjectPayload(projectId: string): void {
    this.db.prepare("DELETE FROM project_settings WHERE project_id = ?").run(projectId);
  }

  readSprintPayload(sprintId: string): string | null {
    const row = this.db.prepare("SELECT payload FROM sprint_settings WHERE sprint_id = ?").get(sprintId) as PayloadRow | undefined;
    return row?.payload ?? null;
  }

  writeSprintPayload(sprintId: string, payload: string): void {
    this.db.prepare(`
      INSERT INTO sprint_settings (sprint_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(sprint_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(sprintId, payload, new Date().toISOString());
  }

  deleteSprintPayload(sprintId: string): void {
    this.db.prepare("DELETE FROM sprint_settings WHERE sprint_id = ?").run(sprintId);
  }

  resetAllData(): void {
    this.db.exec(`
      DELETE FROM app_settings;
      DELETE FROM system_settings;
      DELETE FROM project_settings;
      DELETE FROM sprint_settings;
    `);
  }
}
