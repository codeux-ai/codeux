import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { GithubIntakeRepository } from "../../../src/repositories/github-intake-repository.js";

const storages: AppDbStorage[] = [];
const tempDirs: string[] = [];
afterEach(async () => {
  for (const storage of storages.splice(0)) storage.close();
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function setup(): { storage: AppDbStorage; repo: GithubIntakeRepository; projectId: string } {
  const storage = new AppDbStorage(":memory:"); storages.push(storage);
  const projectId = "project-intake-test";
  storage.getDatabase().prepare(`INSERT INTO projects (id, slug, name, base_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(projectId, "intake-test", "Intake Test", ".", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  return { storage, repo: new GithubIntakeRepository(storage), projectId };
}

function candidate(projectId: string) {
  return { projectId, hostDomain: "github.com", repository: "org/repo", externalKind: "issue" as const,
    externalNumber: 7, observedVersion: "2026-09-14T00:00:00Z", actionClass: "implement" as const,
    policyVersion: "intake-v1", title: "Do the thing", url: "https://github.com/org/repo/issues/7" };
}

describe("GithubIntakeRepository", () => {
  it("upserts an unchanged observation under one readable idempotency key", () => {
    const { repo, projectId } = setup();
    const first = repo.upsertSeen(candidate(projectId));
    const second = repo.upsertSeen({ ...candidate(projectId), title: "Updated title" });
    expect(second.id).toBe(first.id);
    expect(second.idempotencyKey).toBe(`${projectId}|github|github.com|org/repo|issue|7|2026-09-14T00:00:00Z|implement|intake-v1`);
    expect(second.title).toBe("Updated title");
  });

  it("keeps identical issue observations in separate projects independent", () => {
    const { storage, repo, projectId } = setup();
    const secondProjectId = "project-intake-second";
    storage.getDatabase().prepare(`INSERT INTO projects (id, slug, name, base_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(secondProjectId, "intake-second", "Intake Second", ".", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    const first = repo.upsertSeen(candidate(projectId));
    const second = repo.upsertSeen(candidate(secondProjectId));
    expect(second.id).not.toBe(first.id);
    expect(second.projectId).toBe(secondProjectId);
  });

  it("claims exactly once and refuses a replay after dispatch", () => {
    const { repo, projectId } = setup();
    const item = repo.upsertSeen(candidate(projectId));
    expect(repo.claim(item.id, "2026-09-14T00:01:00Z")?.status).toBe("claimed");
    expect(repo.claim(item.id, "2026-09-14T00:02:00Z")).toBeNull();
    expect(repo.attachDispatch(item.id, {}).status).toBe("dispatched");
    expect(repo.claim(item.id, "2026-09-14T00:03:00Z")).toBeNull();
  });

  it("rolls back a sprint write when its intake claim cannot be linked", () => {
    const { storage, repo, projectId } = setup();
    expect(() => repo.withTransaction(() => {
      storage.getDatabase().prepare(`INSERT INTO sprints (id, project_id, number, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run("sprint-rollback", projectId, 1, "rollback", "Rollback", "idle", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
      repo.attachDispatch("missing-claim", { sprintId: "sprint-rollback" });
    })).toThrow(/no longer attachable/);
    expect(storage.getDatabase().prepare("SELECT id FROM sprints WHERE id=?").get("sprint-rollback")).toBeUndefined();
  });

  it("enforces repository capacity atomically across distinct candidates", () => {
    const { repo, projectId } = setup();
    const first = repo.upsertSeen(candidate(projectId));
    const second = repo.upsertSeen({ ...candidate(projectId), externalNumber: 8, url: "https://github.com/org/repo/issues/8" });
    const firstClaim = repo.claimWithinCapacity(first.id, projectId, "org/repo", 1, "2026-09-14T00:01:00Z");
    const secondClaim = repo.claimWithinCapacity(second.id, projectId, "org/repo", 1, "2026-09-14T00:01:01Z");
    expect(firstClaim.status).toBe("claimed");
    expect(secondClaim).toEqual({ status: "capacity" });
  });

  it("persists held and terminal dispositions", () => {
    const { repo, projectId } = setup();
    const item = repo.upsertSeen(candidate(projectId));
    const held = repo.setStatus(item.id, "held", "protected fixture", "collision");
    expect(held.status).toBe("held");
    expect(held.disposition).toBe("protected fixture");
    expect(held.terminalAt).toBeTruthy();
  });

  it("refuses the same claim after reopening the durable database", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codeux-github-intake-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "app.db");
    const firstStorage = new AppDbStorage(dbPath);
    const projectId = "project-restart-test";
    firstStorage.getDatabase().prepare(`INSERT INTO projects (id, slug, name, base_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(projectId, "restart-test", "Restart Test", ".", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    const firstRepo = new GithubIntakeRepository(firstStorage);
    const item = firstRepo.upsertSeen(candidate(projectId));
    expect(firstRepo.claim(item.id)).not.toBeNull();
    firstStorage.close();

    const reopenedStorage = new AppDbStorage(dbPath);
    storages.push(reopenedStorage);
    const reopenedRepo = new GithubIntakeRepository(reopenedStorage);
    expect(reopenedRepo.claim(item.id)).toBeNull();
  });

  it("reconciles terminal sprints and releases repository capacity", () => {
    const { storage, repo, projectId } = setup();
    const sprintId = "sprint-terminal";
    storage.getDatabase().prepare(`INSERT INTO sprints (id, project_id, number, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(sprintId, projectId, 1, "terminal", "Terminal", "completed", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    const item = repo.upsertSeen(candidate(projectId));
    expect(repo.claim(item.id)).not.toBeNull();
    repo.attachDispatch(item.id, { sprintId });
    expect(repo.countActive(projectId, "org/repo")).toBe(1);
    expect(repo.reconcileProjectState(projectId, "org/repo", "2026-01-01T00:00:00.000Z")).toEqual({ completed: 1, failed: 0, held: 0 });
    expect(repo.countActive(projectId, "org/repo")).toBe(0);
    expect(repo.getByKey(item.idempotencyKey)?.status).toBe("completed");
  });

  it("holds an orphaned claim after the recovery window without replaying it", () => {
    const { repo, projectId } = setup();
    const item = repo.upsertSeen(candidate(projectId));
    expect(repo.claim(item.id, "2026-09-14T00:00:00.000Z")).not.toBeNull();
    expect(repo.reconcileProjectState(projectId, "org/repo", "2026-09-14T00:15:00.000Z", "2026-09-14T00:16:00.000Z")).toEqual({ completed: 0, failed: 0, held: 1 });
    expect(repo.claim(item.id)).toBeNull();
    expect(repo.countActive(projectId, "org/repo")).toBe(0);
  });

  it("cancels and holds a stale dispatched sprint that never left idle", () => {
    const { storage, repo, projectId } = setup();
    const sprintId = "sprint-orphaned-dispatch";
    storage.getDatabase().prepare(`INSERT INTO sprints (id, project_id, number, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(sprintId, projectId, 1, "orphaned", "Orphaned", "idle", "2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z");
    const item = repo.upsertSeen(candidate(projectId));
    expect(repo.claim(item.id, "2026-09-14T00:01:00Z")).not.toBeNull();
    repo.attachDispatch(item.id, { sprintId }, "2026-09-14T00:02:00Z");
    // A normal poll sees the same observation again and refreshes last-seen metadata.
    // Recovery must use the immutable claim boundary, not the replay-refreshed updatedAt.
    repo.upsertSeen({ ...candidate(projectId), title: "Still the same observation" });

    expect(repo.reconcileProjectState(projectId, "org/repo", "2026-09-14T00:15:00Z", "2026-09-14T00:16:00Z"))
      .toEqual({ completed: 0, failed: 0, held: 1 });
    expect(repo.getByKey(item.idempotencyKey)).toMatchObject({ status: "held", disposition: "orphaned_dispatch" });
    expect(storage.getDatabase().prepare("SELECT status FROM sprints WHERE id = ?").get(sprintId)).toEqual({ status: "cancelled" });
    expect(repo.countActive(projectId, "org/repo")).toBe(0);
    expect(repo.claim(item.id)).toBeNull();
  });

  it("does not cancel an orphan sprint that a person has resumed", () => {
    const { storage, repo, projectId } = setup();
    const sprintId = "sprint-resumed-orphan";
    storage.getDatabase().prepare(`INSERT INTO sprints (id, project_id, number, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(sprintId, projectId, 1, "resumed", "Resumed", "idle", "2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z");
    const item = repo.upsertSeen(candidate(projectId));
    repo.claim(item.id, "2026-09-14T00:01:00Z");
    repo.attachDispatch(item.id, { sprintId }, "2026-09-14T00:02:00Z");
    storage.getDatabase().prepare("UPDATE sprints SET status='running' WHERE id=?").run(sprintId);
    repo.reconcileProjectState(projectId, "org/repo", "2026-09-14T00:15:00Z", "2026-09-14T00:16:00Z");
    expect(storage.getDatabase().prepare("SELECT status FROM sprints WHERE id=?").get(sprintId)).toEqual({ status: "running" });
  });
});
