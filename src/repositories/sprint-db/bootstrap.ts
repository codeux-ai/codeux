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
  }
}
