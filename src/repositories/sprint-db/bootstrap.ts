import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { bootstrapDb } from "./migrations.js";

export class SprintDatabase {
  public readonly db: DatabaseSync;

  constructor(dbPath: string) {
    const resolvedPath = path.resolve(dbPath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(resolvedPath);
    this.bootstrap();
  }

  private bootstrap() {
    // Enable foreign key constraints globally on connection
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(bootstrapDb);

    // Auto-migrate sort_index column to existing databases if it's missing
    try {
      const tableInfo = this.db.prepare("PRAGMA table_info(pm_tasks);").all() as Array<{ name: string }>;
      const hasSortIndex = tableInfo.some(col => col.name === "sort_index");
      if (!hasSortIndex) {
        this.db.exec("ALTER TABLE pm_tasks ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;");
      }
      const hasIsMerged = tableInfo.some(col => col.name === "is_merged");
      if (!hasIsMerged) {
        this.db.exec("ALTER TABLE pm_tasks ADD COLUMN is_merged INTEGER NOT NULL DEFAULT 0;");
      }
    } catch (err) {
      // Ignore migration errors if table doesn't exist yet (handled by bootstrapDb above anyway)
    }
  }
}
