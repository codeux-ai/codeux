import * as fs from "fs";
import os from "os";
import * as path from "path";
import { DatabaseSync } from "node:sqlite";

interface RowResult {
  payload: string;
}

const SETTINGS_DIR = path.join(os.homedir(), ".jules-subagents");
const SETTINGS_DB_PATH = path.join(SETTINGS_DIR, "settings.db");
const LEGACY_SETTINGS_DB_PATH = path.join(os.homedir(), "jules-subagents", "settings.db");

const resolveSettingsDbPath = (dbPath?: string): string => {
  if (dbPath && dbPath.trim().length > 0) {
    return dbPath;
  }

  fs.mkdirSync(SETTINGS_DIR, { recursive: true });

  if (!fs.existsSync(SETTINGS_DB_PATH) && fs.existsSync(LEGACY_SETTINGS_DB_PATH)) {
    try {
      fs.copyFileSync(LEGACY_SETTINGS_DB_PATH, SETTINGS_DB_PATH);
    } catch {
      // Continue with clean db if migration copy fails.
    }
  }

  return SETTINGS_DB_PATH;
};

export class SettingsDbStorage {
  private readonly db: DatabaseSync;

  constructor(dbPath?: string) {
    const resolvedDbPath = resolveSettingsDbPath(dbPath);
    fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
    this.db = new DatabaseSync(resolvedDbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  readPayload(): string | null {
    const row = this.db.prepare("SELECT payload FROM app_settings WHERE id = 1").get() as RowResult | undefined;
    return row?.payload ?? null;
  }

  writePayload(payload: string): void {
    this.db.prepare(`
      INSERT INTO app_settings (id, payload, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(payload, new Date().toISOString());
  }
}
