import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { DashboardRealtimeEventRepository } from "../../../src/repositories/dashboard-realtime-event-repository.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<AppDbStorage> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-realtime-events-"));
  tempDirs.push(dir);
  return new AppDbStorage(path.join(dir, "app.db"));
}

async function createRepository(): Promise<DashboardRealtimeEventRepository> {
  const storage = await createStorage();
  return new DashboardRealtimeEventRepository(storage);
}

function countPersistedRows(storage: AppDbStorage): number {
  const row = storage
    .getDatabase()
    .prepare("SELECT COUNT(*) AS c FROM dashboard_realtime_events")
    .get() as { c: number };
  return row.c;
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
        attentionProjects: [],
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

  it("routes one persisted conversation event through project and thread subscriptions", async () => {
    const storage = await createStorage();
    const repository = new DashboardRealtimeEventRepository(storage);

    const event = repository.appendEvent({
      scopeType: "project",
      scopeId: "project-1",
      eventType: "conversation.message.created",
      entityType: "conversation_message",
      entityId: "message-1",
      projectId: "project-1",
      threadId: "thread-1",
      payload: {
        id: "message-1",
        threadId: "thread-1",
      },
    });

    expect(event.scope).toBe("project:project-1");
    expect(countPersistedRows(storage)).toBe(1);
    expect(repository.getLatestSequenceForScopes(["project:project-1"])).toBe(1);
    expect(repository.getLatestSequenceForScopes(["thread:thread-1"])).toBe(1);

    expect(repository.listEventsSince(["project:project-1"], 0)).toEqual([
      expect.objectContaining({
        sequence: 1,
        scope: "project:project-1",
        entityId: "message-1",
      }),
    ]);
    expect(repository.listEventsSince(["thread:thread-1"], 0)).toEqual([
      expect.objectContaining({
        sequence: 1,
        scopeType: "thread",
        scopeId: "thread-1",
        scope: "thread:thread-1",
        entityId: "message-1",
      }),
    ]);
    expect(repository.listEventsSince(["project:project-1", "thread:thread-1"], 0)).toHaveLength(1);
  });

  it("deduplicates legacy adjacent project and thread copies during replay", async () => {
    const storage = await createStorage();
    const repository = new DashboardRealtimeEventRepository(storage);
    const payload = {
      id: "message-1",
      threadId: "thread-1",
      bodyMarkdown: "One logical reply",
    };

    repository.appendEvent({
      scopeType: "project",
      scopeId: "project-1",
      eventType: "conversation.message.created",
      entityType: "conversation_message",
      entityId: "message-1",
      projectId: "project-1",
      threadId: "thread-1",
      payload,
      emittedAt: "2026-03-10T12:00:00.000Z",
    });
    repository.appendEvent({
      scopeType: "thread",
      scopeId: "thread-1",
      eventType: "conversation.message.created",
      entityType: "conversation_message",
      entityId: "message-1",
      projectId: "project-1",
      threadId: "thread-1",
      payload,
      emittedAt: "2026-03-10T12:00:00.000Z",
    });

    expect(countPersistedRows(storage)).toBe(2);
    expect(repository.listEventsSince(["thread:thread-1"], 0)).toEqual([
      expect.objectContaining({
        sequence: 2,
        scope: "thread:thread-1",
        entityId: "message-1",
      }),
    ]);
    expect(repository.listEventsSince(["project:project-1", "thread:thread-1"], 0)).toHaveLength(1);
  });

  it("tracks non-replayable snapshot events without including them in replay payloads", async () => {
    const repository = await createRepository();

    const first = repository.appendEvent({
      scopeType: "project",
      scopeId: "project-1",
      eventType: "project.execution.updated",
      entityType: "project",
      entityId: "project-1",
      projectId: "project-1",
      replayable: false,
      payload: {
        projectId: "project-1",
        sprintRuns: [{ id: "run-1" }],
      },
    });
    const second = repository.appendEvent({
      scopeType: "project",
      scopeId: "project-1",
      eventType: "project.runtime_status.updated",
      entityType: "project_status",
      entityId: "project-1",
      projectId: "project-1",
      payload: {
        project_id: "project-1",
        subtasks: [],
      },
    });

    expect(first.sequence).toBe(1);
    expect(first.payload).toMatchObject({
      projectId: "project-1",
    });
    expect(second.sequence).toBe(2);
    expect(repository.getLatestSequence()).toBe(2);
    expect(repository.getLatestSequenceForScopes(["project:project-1"])).toBe(2);
    expect(repository.hasNonReplayableEventsSince(["project:project-1"], 0)).toBe(true);

    const replay = repository.listEventsSince(["project:project-1"], 0);
    expect(replay).toHaveLength(1);
    expect(replay[0]).toMatchObject({
      sequence: 2,
      eventType: "project.runtime_status.updated",
    });
  });

  it("does not persist non-replayable snapshot events to the table", async () => {
    const storage = await createStorage();
    const repository = new DashboardRealtimeEventRepository(storage);

    for (let i = 0; i < 50; i++) {
      repository.appendEvent({
        scopeType: "project",
        scopeId: "project-1",
        eventType: "project.live.updated",
        entityType: "project_live",
        entityId: "project-1",
        projectId: "project-1",
        replayable: false,
        payload: { tick: i },
      });
    }
    // One replayable event should be the only thing written to disk.
    repository.appendEvent({
      scopeType: "project",
      scopeId: "project-1",
      eventType: "conversation.message.created",
      entityType: "conversation_message",
      entityId: "m1",
      projectId: "project-1",
      payload: { id: "m1" },
    });

    expect(countPersistedRows(storage)).toBe(1);
    expect(repository.getLatestSequence()).toBe(51);
    expect(repository.hasNonReplayableEventsSince(["project:project-1"], 0)).toBe(true);
    expect(repository.hasNonReplayableEventsSince(["project:project-1"], 60)).toBe(false);
  });

  it("replays only replayable events within the requested bounded window", async () => {
    const storage = await createStorage();
    const repository = new DashboardRealtimeEventRepository(storage);

    for (let index = 0; index < 10; index += 1) {
      repository.appendEvent({
        scopeType: "project",
        scopeId: "project-1",
        eventType: "project.live.updated",
        entityType: "project_live",
        entityId: "project-1",
        projectId: "project-1",
        replayable: false,
        payload: { tick: index },
      });
      repository.appendEvent({
        scopeType: "project",
        scopeId: "project-1",
        eventType: "conversation.message.created",
        entityType: "conversation_message",
        entityId: `message-${index}`,
        projectId: "project-1",
        payload: { id: `message-${index}` },
      });
    }

    const replay = repository.listEventsSince(["project:project-1"], 0, 3);

    expect(countPersistedRows(storage)).toBe(10);
    expect(replay).toHaveLength(3);
    expect(replay.map((event) => event.sequence)).toEqual([2, 4, 6]);
    expect(replay.every((event) => event.eventType === "conversation.message.created")).toBe(true);
  });

  it("ignores invalid replay scopes instead of scanning all history", async () => {
    const repository = await createRepository();

    repository.appendEvent({
      scopeType: "project",
      scopeId: "project-1",
      eventType: "conversation.message.created",
      entityType: "conversation_message",
      entityId: "message-1",
      projectId: "project-1",
      payload: { id: "message-1" },
    });

    expect(repository.listEventsSince(["", "invalid", "project:"], 0, 200)).toEqual([]);
    expect(repository.getLatestSequenceForScopes(["", "invalid", "project:"])).toBeNull();
    expect(repository.hasNonReplayableEventsSince(["", "invalid", "project:"], 0)).toBe(false);
  });

  it("reseeds the sequence from persisted rows after a restart", async () => {
    const storage = await createStorage();
    const first = new DashboardRealtimeEventRepository(storage);

    // Two replayable events (persisted) interleaved with a non-replayable one (in-memory only).
    first.appendEvent({
      scopeType: "project",
      scopeId: "p1",
      eventType: "conversation.message.created",
      entityType: "conversation_message",
      entityId: "m1",
      projectId: "p1",
      payload: { id: "m1" },
    });
    first.appendEvent({
      scopeType: "project",
      scopeId: "p1",
      eventType: "project.live.updated",
      entityType: "project_live",
      entityId: "p1",
      projectId: "p1",
      replayable: false,
      payload: { tick: 1 },
    });
    first.appendEvent({
      scopeType: "project",
      scopeId: "p1",
      eventType: "conversation.message.created",
      entityType: "conversation_message",
      entityId: "m2",
      projectId: "p1",
      payload: { id: "m2" },
    });
    expect(first.getLatestSequence()).toBe(3);

    // Simulate a process restart: a fresh repository on the same database. The in-memory
    // non-replayable watermark is gone, and the sequence reseeds from the max persisted row (3).
    const second = new DashboardRealtimeEventRepository(storage);
    expect(second.getLatestSequence()).toBe(3);
    expect(second.hasNonReplayableEventsSince(["project:p1"], 0)).toBe(false);

    const next = second.appendEvent({
      scopeType: "project",
      scopeId: "p1",
      eventType: "conversation.message.created",
      entityType: "conversation_message",
      entityId: "m3",
      projectId: "p1",
      payload: { id: "m3" },
    });
    expect(next.sequence).toBe(4);
  });
});
