import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectAttentionRepository } from "../../../src/repositories/project-attention-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { WorkerClarificationRepository } from "../../../src/repositories/worker-clarification-repository.js";
import {
  MAX_WORKER_CLARIFICATION_ANSWER_MARKDOWN_CHARS,
  MAX_WORKER_CLARIFICATION_QUESTION_MARKDOWN_CHARS,
  WorkerClarificationService,
} from "../../../src/services/worker-clarification-service.js";

describe("WorkerClarificationService", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function buildFixture() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-clarification-service-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projects = new ProjectManagementRepository(storage);
    const execution = new ExecutionRepository(storage);
    const attention = new ProjectAttentionRepository(storage);
    const repository = new WorkerClarificationRepository(attention);
    const service = new WorkerClarificationService(repository, projects, execution, () => "2026-07-11T10:00:00.000Z");

    const createScope = (suffix: string) => {
      const project = projects.createProject({
        name: `Project ${suffix}`,
        sourceType: "local" as const,
        sourceRef: `/repo/project-${suffix}`,
      });
      const sprint = projects.createSprint(project.id, { name: `Sprint ${suffix}`, number: 1, goal: "Test" });
      const task = projects.createTask(project.id, {
        sprintId: sprint.id,
        taskKey: "T1",
        title: `Task ${suffix}`,
        promptMarkdown: "Implement it",
        isIndependent: true,
      });
      const sprintRun = execution.createSprintRun({
        projectId: project.id,
        sprintId: sprint.id,
        triggerType: "mcp",
        executorMode: "mcp_worker",
        status: "running",
      });
      const dispatch = execution.createTaskDispatch({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task.id,
        sprintRunId: sprintRun.id,
        executorType: "mcp_worker",
      });
      const taskRun = execution.createTaskRun({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task.id,
        sprintRunId: sprintRun.id,
        dispatchId: dispatch.id,
        sessionId: `session-${suffix}`,
        state: "RUNNING",
      });
      return { project, sprint, task, sprintRun, dispatch, taskRun };
    };

    return { attention, execution, service, primary: createScope("one"), foreign: createScope("two") };
  }

  it("normalizes linked runtime scope, emits idempotent events, and exposes continuation data", async () => {
    const { attention, execution, service, primary } = await buildFixture();
    const created = service.create({
      projectId: primary.project.id,
      taskRunId: primary.taskRun.id,
      requesterAgentId: "coding-agent",
      deduplicationKey: "provider-request-42",
      questionMarkdown: "Should this migration preserve legacy rows?",
    });
    const duplicate = service.create({
      projectId: primary.project.id,
      taskRunId: primary.taskRun.id,
      requesterAgentId: "coding-agent",
      deduplicationKey: "provider-request-42",
      questionMarkdown: "Should this migration preserve legacy rows?",
    });

    expect(duplicate.id).toBe(created.id);
    expect(created).toMatchObject({
      projectId: primary.project.id,
      sprintId: primary.sprint.id,
      sprintRunId: primary.sprintRun.id,
      taskId: primary.task.id,
      dispatchId: primary.dispatch.id,
      taskRunId: primary.taskRun.id,
      sessionId: "session-one",
    });
    expect(attention.getAttentionItem(created.id)).toMatchObject({ ownerType: "human", status: "open" });
    expect(execution.listTaskRunEvents(primary.taskRun.id).filter((event) => event.eventType === "worker_clarification_requested"))
      .toHaveLength(1);

    const result = service.reply(primary.project.id, created.id, {
      answerMarkdown: "Yes, preserve them.",
      repliedByAgentId: "project-manager",
    });
    expect(result.clarification.status).toBe("replied");
    expect(result.continuation).toEqual(expect.objectContaining({
      kind: "worker_clarification_reply",
      clarificationId: created.id,
      taskRunId: primary.taskRun.id,
      sessionId: "session-one",
      answerMarkdown: "Yes, preserve them.",
    }));
    const replyEvent = execution.listTaskRunEvents(primary.taskRun.id)
      .find((event) => event.eventType === "worker_clarification_replied");
    expect(replyEvent?.payload).toEqual(expect.objectContaining({
      clarificationId: created.id,
      attentionItemId: created.id,
      status: "replied",
      dispatchId: primary.dispatch.id,
    }));
    expect(service.create({
      projectId: primary.project.id,
      taskRunId: primary.taskRun.id,
      requesterAgentId: "coding-agent",
      deduplicationKey: "provider-request-42",
      questionMarkdown: "Should this migration preserve legacy rows?",
    }).id).toBe(created.id);
    expect(execution.listTaskRunEvents(primary.taskRun.id).filter((event) => event.eventType === "worker_clarification_requested"))
      .toHaveLength(1);
  });

  it("rejects task, sprint, sprint-run, dispatch, and task-run references from another project", async () => {
    const { service, primary, foreign } = await buildFixture();
    const foreignReferences = [
      { taskId: foreign.task.id },
      { sprintId: foreign.sprint.id },
      { sprintRunId: foreign.sprintRun.id },
      { dispatchId: foreign.dispatch.id },
      { taskRunId: foreign.taskRun.id },
    ];

    for (const [index, reference] of foreignReferences.entries()) {
      expect(() => service.create({
        projectId: primary.project.id,
        requesterAgentId: "coding-agent",
        deduplicationKey: `foreign-${index}`,
        questionMarkdown: "Can I proceed?",
        ...reference,
      })).toThrow(/does not belong to project/i);
    }
  });

  it("rejects mismatched linked references and cross-project clarification access", async () => {
    const { service, primary, foreign } = await buildFixture();
    expect(() => service.create({
      projectId: primary.project.id,
      taskRunId: primary.taskRun.id,
      sessionId: "different-session",
      requesterAgentId: "coding-agent",
      deduplicationKey: "mismatched-session",
      questionMarkdown: "Can I proceed?",
    })).toThrow(/session reference does not match/i);

    const created = service.create({
      projectId: primary.project.id,
      requesterAgentId: "coding-agent",
      deduplicationKey: "private-to-project",
      questionMarkdown: "Can I proceed?",
    });
    expect(service.get(foreign.project.id, created.id)).toBeNull();
    expect(() => service.reply(foreign.project.id, created.id, {
      answerMarkdown: "No",
      repliedByAgentId: "project-manager",
    })).toThrow(/not found/i);
  });

  it("bounds question and answer markdown and keeps replies single-use", async () => {
    const { service, primary } = await buildFixture();
    expect(() => service.create({
      projectId: primary.project.id,
      requesterAgentId: "coding-agent",
      deduplicationKey: "oversized-question",
      questionMarkdown: "q".repeat(MAX_WORKER_CLARIFICATION_QUESTION_MARKDOWN_CHARS + 1),
    })).toThrow(/at most 16000 characters/i);

    const created = service.create({
      projectId: primary.project.id,
      requesterAgentId: "coding-agent",
      deduplicationKey: "single-reply",
      questionMarkdown: "What should I do?",
    });
    expect(() => service.reply(primary.project.id, created.id, {
      answerMarkdown: "a".repeat(MAX_WORKER_CLARIFICATION_ANSWER_MARKDOWN_CHARS + 1),
      repliedByAgentId: "project-manager",
    })).toThrow(/at most 32000 characters/i);
    service.reply(primary.project.id, created.id, {
      answerMarkdown: "Proceed conservatively.",
      repliedByAgentId: "project-manager",
    });
    expect(() => service.reply(primary.project.id, created.id, {
      answerMarkdown: "A second answer.",
      repliedByAgentId: "project-manager",
    })).toThrow(/already been resolved/i);
  });
});
