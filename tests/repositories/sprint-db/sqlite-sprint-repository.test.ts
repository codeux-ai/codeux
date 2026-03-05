import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { SqliteSprintRepository } from "../../../src/repositories/sprint-db/sqlite-sprint-repository.js";
import { bootstrapDb } from "../../../src/repositories/sprint-db/migrations.js";
import { ProjectId, SprintId, SprintStatus } from "../../../src/contracts/app-types.js";

describe("SqliteSprintRepository", () => {
  let db: DatabaseSync;
  let repo: SqliteSprintRepository;
  const dbPath = "tests/repositories/sprint-db/test.db";
  const projectId = "proj-1" as ProjectId;

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(dbPath + "-wal")) fs.unlinkSync(dbPath + "-wal");
    if (fs.existsSync(dbPath + "-shm")) fs.unlinkSync(dbPath + "-shm");

    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(bootstrapDb);

    // Insert a dummy project to satisfy foreign key constraints
    const stmt = db.prepare("INSERT INTO pm_projects (id, source_id, normalized_base_dir, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(projectId, "src-test", "/test", "Test Project", "Desc", "ACTIVE", new Date().toISOString(), new Date().toISOString());

    repo = new SqliteSprintRepository(db);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(dbPath + "-wal")) fs.unlinkSync(dbPath + "-wal");
    if (fs.existsSync(dbPath + "-shm")) fs.unlinkSync(dbPath + "-shm");
  });

  it("creates a sprint", async () => {
    const sprint = await repo.create({
      projectId,
      name: "Sprint 1",
      goal: "First sprint",
      startDate: "2024-01-01",
      endDate: "2024-01-14",
    });

    expect(sprint).toBeDefined();
    expect(sprint.id).toBeDefined();
    expect(sprint.name).toBe("Sprint 1");
    expect(sprint.orderIndex).toBe(0);
  });

  it("lists sprints ordered by index", async () => {
    await repo.create({ projectId, name: "Sprint 1", goal: null, startDate: null, endDate: null });
    await repo.create({ projectId, name: "Sprint 2", goal: null, startDate: null, endDate: null });

    const sprints = await repo.listByProjectId(projectId);
    expect(sprints).toHaveLength(2);
    expect(sprints[0].name).toBe("Sprint 1");
    expect(sprints[0].orderIndex).toBe(0);
    expect(sprints[1].name).toBe("Sprint 2");
    expect(sprints[1].orderIndex).toBe(1);
  });

  it("reorders sprints", async () => {
    const s1 = await repo.create({ projectId, name: "Sprint 1", goal: null, startDate: null, endDate: null });
    const s2 = await repo.create({ projectId, name: "Sprint 2", goal: null, startDate: null, endDate: null });
    const s3 = await repo.create({ projectId, name: "Sprint 3", goal: null, startDate: null, endDate: null });

    await repo.reorder(projectId, [s3.id, s1.id, s2.id]);

    const sprints = await repo.listByProjectId(projectId);
    expect(sprints[0].id).toBe(s3.id);
    expect(sprints[0].orderIndex).toBe(0);
    expect(sprints[1].id).toBe(s1.id);
    expect(sprints[1].orderIndex).toBe(1);
    expect(sprints[2].id).toBe(s2.id);
    expect(sprints[2].orderIndex).toBe(2);
  });

  it("archives a sprint", async () => {
    const s1 = await repo.create({ projectId, name: "Sprint 1", goal: null, startDate: null, endDate: null });
    const s2 = await repo.create({ projectId, name: "Sprint 2", goal: null, startDate: null, endDate: null });

    await repo.archive(s1.id);

    const sprints = await repo.listByProjectId(projectId);
    expect(sprints).toHaveLength(1);
    expect(sprints[0].id).toBe(s2.id);
  });

  it("deletes a sprint", async () => {
    const s1 = await repo.create({ projectId, name: "Sprint 1", goal: null, startDate: null, endDate: null });

    await repo.delete(s1.id);

    const fetched = await repo.getById(s1.id);
    expect(fetched).toBeNull();
  });
});
