import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectAttentionRepository } from "../../../src/repositories/project-attention-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { WorkerClarificationRepository } from "../../../src/repositories/worker-clarification-repository.js";

describe("WorkerClarificationRepository", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function buildFixture() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-clarification-repo-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projects = new ProjectManagementRepository(storage);
    const attention = new ProjectAttentionRepository(storage);
    const clarifications = new WorkerClarificationRepository(attention);
    const project = projects.createProject({
      name: "Clarification Test Project",
      sourceType: "local",
      sourceRef: "/repo/clarification-test",
    });
    const sprint = projects.createSprint(project.id, { name: "Sprint", number: 1, goal: "Test" });
    const task = projects.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task",
      promptMarkdown: "Implement it",
      isIndependent: true,
    });
    return { attention, clarifications, project, sprint, task };
  }

  it("round-trips pending requests through human-owned project attention records", async () => {
    const { attention, clarifications, project, sprint, task } = await buildFixture();
    const created = clarifications.create({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      requesterAgentId: "worker-agent-1",
      deduplicationKey: "request-1",
      questionMarkdown: "Which API version should I target?",
      requestedAt: "2026-07-11T10:00:00.000Z",
    });

    expect(created).toMatchObject({
      status: "pending",
      questionMarkdown: "Which API version should I target?",
      answerMarkdown: null,
    });
    expect(clarifications.get(project.id, created.id)).toEqual(created);
    expect(clarifications.list(project.id, { statuses: ["pending"] })).toEqual([created]);
    expect(attention.getAttentionItem(created.id)).toMatchObject({
      id: created.id,
      projectId: project.id,
      taskId: task.id,
      ownerType: "human",
      status: "open",
      attentionType: "worker_clarification",
      assignedWorkerEndpointId: null,
      payload: expect.objectContaining({ type: "worker_clarification", status: "pending" }),
    });
  });

  it("deduplicates identical submissions but rejects reuse for a different request", async () => {
    const { clarifications, project, sprint, task } = await buildFixture();
    const input = {
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      requesterAgentId: "worker-agent-1",
      deduplicationKey: "stable-request-key",
      questionMarkdown: "Choose A or B?",
      requestedAt: "2026-07-11T10:00:00.000Z",
    };
    const first = clarifications.create(input);
    const duplicate = clarifications.create({ ...input, requestedAt: "2026-07-11T10:01:00.000Z" });

    expect(duplicate.id).toBe(first.id);
    expect(clarifications.list(project.id)).toHaveLength(1);
    expect(() => clarifications.create({ ...input, questionMarkdown: "A different question" }))
      .toThrow(/already used by a different request/i);
  });

  it("accepts one reply and preserves it when a second reply is attempted", async () => {
    const { clarifications, project } = await buildFixture();
    const created = clarifications.create({
      projectId: project.id,
      requesterAgentId: "worker-agent-1",
      deduplicationKey: "reply-once",
      questionMarkdown: "May I change the contract?",
      requestedAt: "2026-07-11T10:00:00.000Z",
    });
    const replied = clarifications.markReplied(project.id, created.id, {
      answerMarkdown: "Preserve backward compatibility.",
      repliedByAgentId: "project-manager",
      repliedAt: "2026-07-11T10:05:00.000Z",
    });

    expect(replied).toMatchObject({ status: "replied", answerMarkdown: "Preserve backward compatibility." });
    expect(() => clarifications.markReplied(project.id, created.id, {
      answerMarkdown: "Replace it entirely.",
      repliedByAgentId: "project-manager",
      repliedAt: "2026-07-11T10:06:00.000Z",
    })).toThrow(/already been resolved/i);
    expect(clarifications.get(project.id, created.id)?.answerMarkdown).toBe("Preserve backward compatibility.");
  });

  it("resolves pending requests idempotently as expired or cancelled", async () => {
    const { clarifications, project } = await buildFixture();
    const created = clarifications.create({
      projectId: project.id,
      requesterAgentId: "worker-agent-1",
      deduplicationKey: "expire-me",
      questionMarkdown: "Still needed?",
      requestedAt: "2026-07-11T10:00:00.000Z",
    });
    const expired = clarifications.resolve(project.id, created.id, {
      status: "expired",
      resolvedByAgentId: "runtime",
      reason: "deadline_elapsed",
      resolvedAt: "2026-07-11T11:00:00.000Z",
    });
    const repeated = clarifications.resolve(project.id, created.id, {
      status: "cancelled",
      resolvedByAgentId: "runtime",
      resolvedAt: "2026-07-11T11:01:00.000Z",
    });

    expect(expired).toMatchObject({ status: "expired", expiredAt: "2026-07-11T11:00:00.000Z" });
    expect(repeated).toEqual(expired);
  });
});
