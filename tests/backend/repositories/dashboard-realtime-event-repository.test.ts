import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { DashboardRealtimeEventRepository } from "../../../src/repositories/dashboard-realtime-event-repository.js";

const tempDirs: string[] = [];

async function createRepository(): Promise<DashboardRealtimeEventRepository> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-realtime-events-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return new DashboardRealtimeEventRepository(storage);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("DashboardRealtimeEventRepository", () => {
  it("persists and replays scoped realtime events", async () => {
    const repository = await createRepository();

    const first = repository.appendEvent({
      scopeType: "project",
      scopeId: "project-1",
      eventType: "project.execution.updated",
      entityType: "project",
      entityId: "project-1",
      projectId: "project-1",
      payload: {
        projectId: "project-1",
        sprintRuns: [],
      },
    });
    const second = repository.appendEvent({
      scopeType: "projects",
      scopeId: "projects",
      eventType: "projects.updated",
      entityType: "project_collection",
      entityId: "projects",
      payload: {
        projects: [],
        selectedProjectId: null,
      },
    });
    const third = repository.appendEvent({
      scopeType: "overview",
      scopeId: "overview",
      eventType: "overview.telemetry.updated",
      entityType: "overview",
      entityId: "overview",
      payload: {
        activeProjects: [],
      },
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(third.sequence).toBe(3);
    expect(repository.getLatestSequence()).toBe(3);

    const replay = repository.listEventsSince(["project:project-1", "projects", "overview"], 1);
    expect(replay).toHaveLength(2);
    expect(replay[0]).toMatchObject({
      sequence: 2,
      scope: "projects",
      eventType: "projects.updated",
    });
    expect(replay[1]).toMatchObject({
      sequence: 3,
      scope: "overview",
      eventType: "overview.telemetry.updated",
    });
  });
});
