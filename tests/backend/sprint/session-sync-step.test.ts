import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { runSessionSyncStep } from "../../../src/sprint/steps/session-sync-step.js";
import type { Subtask } from "../../../src/contracts/app-types.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("runSessionSyncStep", () => {
  it("matches sessions by repo/sprint/task run key to avoid task-id collisions", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-1",
        title: "Task One",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
    ];

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "newer-other-sprint",
            name: "sessions/newer-other-sprint",
            title: "Sprint 7: [run:my-repo/s7/task-1] [task-1] Task One",
            state: "RUNNING",
            prompt: "",
          },
          {
            id: "correct-sprint",
            name: "sessions/correct-sprint",
            title: "Sprint 6: [run:my-repo/s6/task-1] [task-1] Task One",
            state: "COMPLETED",
            prompt: "",
          },
        ],
      }),
      resolveSessionName: (session: { name?: string }) => session.name,
      extractSessionId: (session: { id?: string }) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
      isActionRequiredState: vi.fn().mockReturnValue(false),
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      },
    };

    const result = await runSessionSyncStep(
      subtasks,
      deps,
      true,
      {
        repoPath: "/tmp/my-repo",
        sprintNumber: 6,
      }
    );

    expect(result.subtasks[0].session_id).toBe("correct-sprint");
    expect(result.subtasks[0].status).toBe("CODING_COMPLETED");
  });

  it("picks the most recent session when multiple sessions exist for the same task", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-1",
        title: "Task One",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
    ];

    const repoPath = "/tmp/my-repo";
    const sprintNumber = 1;

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "old-session",
            name: "sessions/old-session",
            title: "Sprint 1: [run:my-repo/s1/task-1] [task-1] Task One",
            state: "FAILED",
            createTime: "2023-01-01T00:00:00Z",
          },
          {
            id: "new-session",
            name: "sessions/new-session",
            title: "Sprint 1: [run:my-repo/s1/task-1] [task-1] Task One",
            state: "COMPLETED",
            createTime: "2023-01-02T00:00:00Z",
          },
        ],
      }),
      resolveSessionName: (session: any) => session.name,
      extractSessionId: (session: any) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
      isActionRequiredState: vi.fn().mockReturnValue(false),
    };

    const result = await runSessionSyncStep(
      subtasks,
      deps as any,
      false,
      { repoPath, sprintNumber }
    );

    expect(result.subtasks[0].session_id).toBe("new-session");
    expect(result.subtasks[0].status).toBe("CODING_COMPLETED");
  });

  it("deduplicates activity fetches when multiple tasks map to the same session", async () => {
    const subtasks: Subtask[] = [
      { id: "task-1", title: "Task One", prompt: "", depends_on: [], is_independent: true, status: "PENDING" },
      { id: "task-1", title: "Task One (Duplicate)", prompt: "", depends_on: [], is_independent: true, status: "PENDING" },
    ];

    const repoPath = "/tmp/my-repo";
    const sprintNumber = 2;

    const mockActivities = [{ name: "activity-1" }];
    const fetchRecentActivities = vi.fn().mockResolvedValue(mockActivities);

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "session-1",
            name: "sessions/session-1",
            title: "Sprint 2: [run:my-repo/s2/task-1] [task-1] Task One",
            state: "RUNNING",
          },
        ],
      }),
      resolveSessionName: (session: any) => session.name,
      extractSessionId: (session: any) => session.id,
      fetchRecentActivities,
      isActionRequiredState: vi.fn().mockReturnValue(false),
      logger: { warn: vi.fn() },
    };

    const result = await runSessionSyncStep(subtasks, deps as any, false, { repoPath, sprintNumber });

    expect(fetchRecentActivities).toHaveBeenCalledTimes(1);
    expect(fetchRecentActivities).toHaveBeenCalledWith("sessions/session-1", 5);
    expect(result.subtasks[0].activities).toBe(mockActivities);
    expect(result.subtasks[1].activities).toBe(mockActivities);
  });

  it("fetches activities using bounded parallelism for multiple unique sessions", async () => {
    const subtasks: Subtask[] = Array.from({ length: 6 }).map((_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      prompt: "",
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    }));

    const repoPath = "/tmp/my-repo";
    const sprintNumber = 3;

    const sessions = Array.from({ length: 6 }).map((_, i) => ({
      id: `session-${i}`,
      name: `sessions/session-${i}`,
      title: `Sprint 3: [run:my-repo/s3/task-${i}] [task-${i}] Task ${i}`,
      state: "RUNNING",
    }));

    let concurrentFetches = 0;
    let maxConcurrentFetches = 0;

    const fetchRecentActivities = vi.fn().mockImplementation(async () => {
      concurrentFetches++;
      maxConcurrentFetches = Math.max(maxConcurrentFetches, concurrentFetches);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrentFetches--;
      return [{ info: "activity" }];
    });

    const deps = {
      listSessions: vi.fn().mockResolvedValue({ sessions }),
      resolveSessionName: (session: any) => session.name,
      extractSessionId: (session: any) => session.id,
      fetchRecentActivities,
      isActionRequiredState: vi.fn().mockReturnValue(false),
      logger: { warn: vi.fn() },
    };

    await runSessionSyncStep(subtasks, deps as any, false, { repoPath, sprintNumber });

    expect(fetchRecentActivities).toHaveBeenCalledTimes(6);
    expect(maxConcurrentFetches).toBeLessThanOrEqual(5);
  });

  it("syncs provider session state and activities into task runs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-session-sync-"));
    tempDirs.push(dir);

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const project = projectRepository.createProject({
      name: "Session Sync Project",
      sourceType: "local",
      sourceRef: "/tmp/my-repo",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Session Sync Sprint",
      number: 6,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Sync provider runtime",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "running",
    });
    const run = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "codex",
      state: "RUNNING",
      startedAt: "2026-03-09T10:00:00.000Z",
    });

    const subtasks: Subtask[] = [
      {
        id: task.taskKey,
        record_id: task.id,
        title: task.title,
        prompt: task.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
      },
    ];

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "session-sync-1",
            name: "sessions/session-sync-1",
            title: "Sprint 6: [run:my-repo/s6/t01] [t01] Sync provider runtime",
            state: "COMPLETED",
            provider: "codex",
            outputs: [{ pullRequest: { url: "https://example.com/pr/1", workerBranch: "feature/sprint-6" } }],
          },
        ],
      }),
      resolveSessionName: (session: { name?: string }) => session.name,
      extractSessionId: (session: { id?: string }) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([
        {
          id: "activity-1",
          name: "sessions/session-sync-1/activities/activity-1",
          createTime: "2026-03-09T10:05:00.000Z",
          originator: "agent",
          progressUpdated: { title: "Runtime synced" },
        },
      ]),
      isActionRequiredState: vi.fn().mockReturnValue(false),
      executionRepository,
      sprintRunId: sprintRun.id,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      },
    };

    const result = await runSessionSyncStep(
      subtasks,
      deps,
      false,
      {
        repoPath: "/tmp/my-repo",
        sprintNumber: 6,
      }
    );

    expect(result.subtasks[0]?.status).toBe("CODING_COMPLETED");
    const syncedRun = executionRepository.getTaskRun(run.id);
    expect(syncedRun).toMatchObject({
      sessionId: "session-sync-1",
      sessionName: "sessions/session-sync-1",
      state: "COMPLETED",
      prUrl: "https://example.com/pr/1",
      workerBranch: "feature/sprint-6",
    });

    const syncedDispatch = executionRepository.getTaskDispatch(dispatch.id);
    expect(syncedDispatch).toMatchObject({
      status: "completed",
    });

    const events = executionRepository.listTaskRunEvents(run.id);
    expect(events.map((event) => event.eventType)).toEqual([
      "session_state_synced",
      "provider_activity",
    ]);
    expect(events[1]?.sourceEventKey).toBe("activity:activity-1");
  });
});
