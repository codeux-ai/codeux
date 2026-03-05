import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SprintDatabase } from "../../../../src/repositories/sprint-db/bootstrap.js";
import fs from "node:fs";
import path from "node:path";

describe("SprintDatabase Bootstrap", () => {
  const testDbPath = path.join(__dirname, "test-sprint.db");

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(testDbPath + "-wal")) {
      fs.unlinkSync(testDbPath + "-wal");
    }
    if (fs.existsSync(testDbPath + "-shm")) {
      fs.unlinkSync(testDbPath + "-shm");
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(testDbPath + "-wal")) {
      fs.unlinkSync(testDbPath + "-wal");
    }
    if (fs.existsSync(testDbPath + "-shm")) {
      fs.unlinkSync(testDbPath + "-shm");
    }
  });

  it("should create database and tables idempotently", () => {
    // First boot
    const db1 = new SprintDatabase(testDbPath);

    // Check if tables exist
    const tables = db1.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name: string}[];
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain("pm_projects");
    expect(tableNames).toContain("pm_sprints");
    expect(tableNames).toContain("pm_tasks");
    expect(tableNames).toContain("pm_dependencies");
    expect(tableNames).toContain("pm_runs");
    expect(tableNames).toContain("pm_events");
    expect(tableNames).toContain("pm_usage_samples");

    db1.db.close();

    // Second boot (idempotency check)
    expect(() => {
      const db2 = new SprintDatabase(testDbPath);
      db2.db.close();
    }).not.toThrow();
  });
});
