import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { RuntimeContextStore } from "../../../../src/repositories/project-runtime/runtime-context-store.js";

const tempDirs: string[] = [];

async function createStore(): Promise<{ storage: AppDbStorage; store: RuntimeContextStore }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-context-store-test-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const store = new RuntimeContextStore(storage.getDatabase());
  return { storage, store };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("RuntimeContextStore", () => {
  it("returns null if sprintId is not provided", async () => {
    const { store } = await createStore();
    expect(store.getRuntimeContext("proj-1")).toBeNull();
  });

  it("saves and retrieves runtime context", async () => {
    const { store } = await createStore();
    const payload = {
      projectId: "proj-1",
      sprintId: "sprint-1",
      sprintNumber: 1,
      sourceId: "source-1",
      repoPath: "/path/to/repo",
      featureBranch: "feature/branch",
      reportText: "All good",
      statusTable: "Table data",
      instructions: "Do this",
      timestamp: new Date().toISOString(),
    };

    store.saveRuntimeContext(payload);
    const retrieved = store.getRuntimeContext("proj-1", "sprint-1");
    expect(retrieved).toEqual(payload);
  });

  it("clears legacy project runtime context", async () => {
    const { storage, store } = await createStore();
    const db = storage.getDatabase();

    db.prepare(`
      INSERT INTO app_settings (key, payload, updated_at)
      VALUES (?, ?, ?)
    `).run("runtime_context:proj-1", "{}", new Date().toISOString());

    store.clearLegacyProjectRuntimeContext("proj-1");

    const row = db.prepare(`SELECT * FROM app_settings WHERE key = ?`).get("runtime_context:proj-1");
    expect(row).toBeUndefined();
  });
});
