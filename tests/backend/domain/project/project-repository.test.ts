import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { ProjectRepository, DuplicateProjectError } from "../../../../src/domain/project/project-repository.js";
import { Project } from "../../../../src/domain/project/project.js";
import { bootstrapDb } from "../../../../src/repositories/sprint-db/migrations.js";

describe("ProjectRepository", () => {
  const testDbPath = path.join(__dirname, "test-project-repo.db");
  let db: DatabaseSync;
  let repo: ProjectRepository;

  beforeEach(() => {
    [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`].forEach((f) => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });

    db = new DatabaseSync(testDbPath);
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(bootstrapDb);
    repo = new ProjectRepository(db);
  });

  afterEach(() => {
    db.close();
    [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`].forEach((f) => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
  });

  it("should insert and find a project by ID", () => {
    const project = Project.create("src-1", "/dir", "Proj 1");
    repo.save(project);

    const retrieved = repo.findById(project.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe("Proj 1");
    expect(retrieved?.sourceId).toBe("src-1");
  });

  it("should update a project", () => {
    const project = Project.create("src-1", "/dir", "Proj 1");
    repo.save(project);

    project.update("New Name", "Desc");
    repo.save(project);

    const retrieved = repo.findById(project.id);
    expect(retrieved?.name).toBe("New Name");
    expect(retrieved?.description).toBe("Desc");
  });

  it("should enforce unique constraint on (source_id, normalized_base_dir)", () => {
    const project1 = Project.create("src-1", "/dir", "Proj 1");
    repo.save(project1);

    const project2 = Project.create("src-1", "/dir", "Proj 2");
    expect(() => repo.save(project2)).toThrow(DuplicateProjectError);
  });

  it("should retrieve by source and base dir", () => {
    const project = Project.create("src-1", "/dir", "Proj 1");
    repo.save(project);

    const retrieved = repo.findBySourceAndDir("src-1", "/dir");
    expect(retrieved?.id).toBe(project.id);

    const nonExistent = repo.findBySourceAndDir("src-2", "/dir");
    expect(nonExistent).toBeNull();
  });

  it("should list all projects", () => {
    const project1 = Project.create("src-1", "/dir1", "Proj 1");
    const project2 = Project.create("src-2", "/dir2", "Proj 2");
    repo.save(project1);
    repo.save(project2);

    const all = repo.listAll();
    expect(all.length).toBe(2);
    expect(all.map(p => p.id)).toContain(project1.id);
    expect(all.map(p => p.id)).toContain(project2.id);
  });
});
