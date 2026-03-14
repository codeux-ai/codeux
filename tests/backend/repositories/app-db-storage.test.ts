import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage, resolveAppDbPath } from "../../../src/repositories/app-db-storage.js";

const tempDirs: string[] = [];

async function createTempDbPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-app-db-"));
  tempDirs.push(dir);
  return path.join(dir, "app.db");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("AppDbStorage", () => {
  it("creates the phase 1 foundation tables", async () => {
    const dbPath = await createTempDbPath();
    const storage = new AppDbStorage(dbPath);

    expect(storage.getPath()).toBe(dbPath);
    expect(storage.hasTable("schema_migrations")).toBe(true);
    expect(storage.hasTable("app_settings")).toBe(true);
    expect(storage.hasTable("projects")).toBe(true);
    expect(storage.hasTable("project_sources")).toBe(true);
    expect(storage.hasTable("sprints")).toBe(true);
    expect(storage.hasTable("tasks")).toBe(true);
    expect(storage.hasTable("task_dependencies")).toBe(true);
    expect(storage.hasTable("mcp_connections")).toBe(true);
    expect(storage.hasTable("worker_endpoints")).toBe(true);
    expect(storage.hasTable("project_worker_assignments")).toBe(true);
    expect(storage.hasTable("project_attention_items")).toBe(true);
    expect(storage.hasTable("connection_project_bindings")).toBe(true);
    expect(storage.hasTable("sprint_runs")).toBe(true);
    expect(storage.hasTable("task_dispatches")).toBe(true);
    expect(storage.hasTable("task_runs")).toBe(true);
    expect(storage.hasTable("task_run_events")).toBe(true);
    expect(storage.hasTable("execution_leases")).toBe(true);
    expect(storage.hasTable("dashboard_realtime_events")).toBe(true);
    expect(storage.hasTable("conversation_threads")).toBe(true);
    expect(storage.hasTable("conversation_messages")).toBe(true);
    expect(storage.hasTable("agent_presets")).toBe(true);
  });

  it("uses the explicit dbPath when provided", async () => {
    const dbPath = await createTempDbPath();

    expect(resolveAppDbPath(dbPath)).toBe(dbPath);
  });

  it("resets all application tables while preserving the schema", async () => {
    const dbPath = await createTempDbPath();
    const storage = new AppDbStorage(dbPath);
    const db = storage.getDatabase();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, slug, name, base_dir, repo_url, source_id, default_branch, feature_branch_prefix, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("project-1", "project-1", "Project 1", "/tmp/project-1", null, null, "main", "feature/", "idle", now, now);
    db.prepare(`
      INSERT INTO app_settings (key, payload, updated_at)
      VALUES (?, ?, ?)
    `).run("selected_project", JSON.stringify({ projectId: "project-1" }), now);

    storage.resetAllData();

    const projectCount = db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
    const appSettingsCount = db.prepare("SELECT COUNT(*) AS count FROM app_settings").get() as { count: number };

    expect(projectCount.count).toBe(0);
    expect(appSettingsCount.count).toBe(0);
    expect(storage.hasTable("projects")).toBe(true);
    expect(storage.hasTable("app_settings")).toBe(true);
  });
});
