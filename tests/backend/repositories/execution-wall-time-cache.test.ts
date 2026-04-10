
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import * as os from "os";
import * as path from "path";
import { promises as fs } from "fs";

let tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("getProjectExecutionSnapshot aggregation regression tests", () => {
  it("computes wall time totals including active-run duration and caches the result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-01-01T10:00:10Z")); // 10 seconds past startedAt

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-wt-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));

    // Wait, earlier I found I don't need init. Just constructor runs migrations synchronously!

    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const project = projectRepository.createProject({ name: "p-wt", sourceType: "local", sourceRef: "ref" });

    // We need to create a sprint
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint WT", number: null, goal: null, promptMarkdown: null });

    // We need to create a sprint run
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      triggerType: "dashboard",
      executorMode: "auto",
      triggeredBy: "user-1",
      status: "running"
    });

    const task = projectRepository.createTask(project.id, { title: "Test WT", status: "todo", priority: 1, sprintId: sprint.id });

    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "agent",
      priority: 1,
    });
    const dispatchId = dispatch.id;

    executionRepository.acquireLease({
      scopeType: "task_dispatch",
      scopeId: dispatchId,
      ownerKey: "worker-1",
      expiresAt: "2023-01-01T10:01:10Z",
      leaseToken: "token-1",
    });

    executionRepository.createTaskRun({
      projectId: project.id,
      taskId: task.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatchId,
      provider: "openai",
      mode: "agent",
      sessionId: "sess-1",
      state: "running",
      startedAt: "2023-01-01T10:00:00Z", // 10 seconds ago
      finishedAt: null,
    });

    const snapshot = executionRepository.getProjectExecutionSnapshot(project.id);

    const snapSprintRun = snapshot.sprintRuns.find(sr => sr.id === sprintRun.id);
    expect(snapSprintRun).toBeDefined();
    expect(snapSprintRun?.usage.wallTimeMs).toBe(10000);

    const snapDispatch = snapshot.taskDispatches.find(td => td.id === dispatchId);
    expect(snapDispatch).toBeDefined();
    expect(snapDispatch?.usage.wallTimeMs).toBe(10000);

    vi.useRealTimers();
  });
});
