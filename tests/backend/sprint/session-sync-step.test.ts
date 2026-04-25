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

  it("fetches full transcript and syncs usage and git metrics on terminal session state without duplication", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-session-sync-metrics-"));
    tempDirs.push(dir);

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const project = projectRepository.createProject({
      name: "Session Sync Metrics",
      sourceType: "local",
      sourceRef: "/tmp/my-repo",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 7",
      number: 7,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Sync metrics",
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
      executorType: "jules",
      status: "running",
      startedAt: "2026-03-09T10:00:00.000Z",
    });
    const run = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "jules",
      state: "RUNNING",
      startedAt: "2026-03-09T10:00:00.000Z",
    });

    const subtasks: Subtask[] = [
      {
        id: task.taskKey,
        record_id: task.id,
        project_id: project.id,
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
            id: "sync-metrics-session",
            name: "sessions/sync-metrics-session",
            title: "Sprint 7: [run:my-repo/s7/t01] [t01] Sync metrics",
            state: "COMPLETED",
            provider: "jules",
            outputs: [{ pullRequest: { url: "https://example.com/pr/1", workerBranch: "feature/metrics", filesChanged: 3, insertions: 10, deletions: 2 } }],
          },
        ],
      }),
      resolveSessionName: (session: any) => session.name,
      extractSessionId: (session: any) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
      getSession: vi.fn().mockResolvedValue({
        id: "sync-metrics-session",
        prompt: "Fix the bug", // 11 chars -> 3 tokens
      }),
      listAllActivities: vi.fn().mockResolvedValue([
        { userMessaged: { userMessage: "Here is the error" } }, // 17 chars -> 4 tokens + 3 = 7
        { agentMessaged: { agentMessage: "I fixed it" } } // 10 chars -> 3 output tokens
      ]),
      isActionRequiredState: vi.fn().mockReturnValue(false),
      executionRepository,
      projectManagementRepository: projectRepository,
      sprintRunId: sprintRun.id,
      logger: { warn: vi.fn() },
    };

    await runSessionSyncStep(
      subtasks,
      deps as any,
      false,
      { repoPath: "/tmp/my-repo", sprintNumber: 7 }
    );

    const usage = executionRepository.getLatestProviderInvocationUsageBySession("sync-metrics-session");
    expect(usage).toBeDefined();
    expect(usage?.provider).toBe("jules");
    expect(usage?.purpose).toBe("task_coding");
    expect(usage?.inputTokens).toBe(7); // 28 chars / 4
    expect(usage?.outputTokens).toBe(3); // 10 chars / 4
    expect(usage?.usageSource).toBe("estimated");

    const events = executionRepository.listTaskRunEvents(run.id);
    const gitMetricsEvents = events.filter(e => e.eventType === "git_metrics");
    expect(gitMetricsEvents).toHaveLength(1);
    expect(gitMetricsEvents[0].payload?.filesChanged).toBe(3);

    // Run again to ensure deduplication
    await runSessionSyncStep(
      subtasks,
      deps as any,
      false,
      { repoPath: "/tmp/my-repo", sprintNumber: 7 }
    );

    const eventsAfterSecondRun = executionRepository.listTaskRunEvents(run.id);
    const gitMetricsEventsAfterSecondRun = eventsAfterSecondRun.filter(e => e.eventType === "git_metrics");
    expect(gitMetricsEventsAfterSecondRun).toHaveLength(1); // Still 1

    // Usage is not duplicated
    const usages = [usage];
    // listProviderInvocationUsages is not directly on executionRepository, but we can verify it by session
    expect(executionRepository.getLatestProviderInvocationUsageBySession("sync-metrics-session", "task_coding")?.id).toBe(usage?.id);
  });

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

  it("fully clears stale runtime state before retrying a failed session", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-1",
        record_id: "task-record-1",
        title: "Task One",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
        status: "FAILED",
        session_id: "failed-session",
        session_name: "sessions/failed-session",
        session_state: "FAILED",
        provider: "jules",
        worker_branch: "worker/task-1",
        pr_url: "https://example.com/pr/1",
        is_merged: true,
        merge_indicator: "MERGED",
        activities: [{ id: "activity-1", name: "activity-1", createTime: "2026-03-09T10:00:00.000Z" }],
      },
    ];

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "failed-session",
            name: "sessions/failed-session",
            title: "Sprint 1: [run:my-repo/s1/task-1] [task-1] Task One",
            state: "FAILED",
            provider: "jules",
            outputs: [{ pullRequest: { url: "https://example.com/pr/1", workerBranch: "worker/task-1" } }],
          },
        ],
      }),
      resolveSessionName: (session: { name?: string }) => session.name,
      extractSessionId: (session: { id?: string }) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
      isActionRequiredState: vi.fn().mockReturnValue(false),
      logger: { warn: vi.fn() },
    };

    const result = await runSessionSyncStep(
      subtasks.map((task) => ({ ...task })),
      deps as any,
      true,
      { repoPath: "/tmp/my-repo", sprintNumber: 1 },
    );

    expect(result.subtasks[0]).toMatchObject({
      status: "PENDING",
      session_id: undefined,
      session_name: undefined,
      session_state: undefined,
      provider: "jules",
      worker_branch: undefined,
      pr_url: undefined,
      is_merged: false,
      merge_indicator: undefined,
    });
    expect(result.subtasks[0]?.activities).toEqual([]);
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
    expect(events[1]?.payload).toMatchObject({
      activityId: "activity-1",
      kind: "progress_updated",
      preview: "Runtime synced",
      progressUpdated: {
        title: "Runtime synced",
      },
    });
  });

  it("preserves the first terminal finishedAt during later completed-session syncs", async () => {
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
      title: "Keep first completion timestamp",
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
      status: "completed",
      startedAt: "2026-03-09T10:00:00.000Z",
      finishedAt: "2026-03-09T10:05:00.000Z",
    });
    const run = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "codex",
      state: "COMPLETED",
      startedAt: "2026-03-09T10:00:00.000Z",
      finishedAt: "2026-03-09T10:05:00.000Z",
      durationMs: 300_000,
    });

    const subtasks: Subtask[] = [
      {
        id: task.taskKey,
        record_id: task.id,
        title: task.title,
        prompt: task.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
      },
    ];

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "session-sync-2",
            name: "sessions/session-sync-2",
            title: "Sprint 6: [run:my-repo/s6/t01] [t01] Keep first completion timestamp",
            state: "COMPLETED",
            provider: "codex",
            outputs: [{ pullRequest: { url: "https://example.com/pr/2", workerBranch: "feature/sprint-6" } }],
          },
        ],
      }),
      resolveSessionName: (session: { name?: string }) => session.name,
      extractSessionId: (session: { id?: string }) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
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

    await runSessionSyncStep(
      subtasks,
      deps,
      false,
      {
        repoPath: "/tmp/my-repo",
        sprintNumber: 6,
      }
    );

    expect(executionRepository.getTaskRun(run.id)?.finishedAt).toBe("2026-03-09T10:05:00.000Z");
    expect(executionRepository.getTaskDispatch(dispatch.id)?.finishedAt).toBe("2026-03-09T10:05:00.000Z");
  });

  it("does not downgrade a COMPLETED task to CODING_COMPLETED", async () => {
    const subtasks: Subtask[] = [
      { id: "task-completed", title: "Task C", prompt: "", depends_on: [], is_independent: true, status: "COMPLETED", record_id: "rec-c" },
      { id: "task-coding-completed", title: "Task CC", prompt: "", depends_on: [], is_independent: true, status: "CODING_COMPLETED", record_id: "rec-cc" },
      { id: "task-running", title: "Task R", prompt: "", depends_on: [], is_independent: true, status: "RUNNING", record_id: "rec-r" },
    ];

    const updateTaskMock = vi.fn();
    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "s-completed",
            name: "sessions/s-completed",
            title: "Sprint 1: [run:my-repo/s1/task-completed] [task-completed] Task C",
            state: "COMPLETED",
          },
          {
            id: "s-coding-completed",
            name: "sessions/s-coding-completed",
            title: "Sprint 1: [run:my-repo/s1/task-coding-completed] [task-coding-completed] Task CC",
            state: "COMPLETED",
          },
          {
            id: "s-running",
            name: "sessions/s-running",
            title: "Sprint 1: [run:my-repo/s1/task-running] [task-running] Task R",
            state: "COMPLETED",
          },
        ],
      }),
      resolveSessionName: (session: any) => session.name,
      extractSessionId: (session: any) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
      isActionRequiredState: vi.fn().mockReturnValue(false),
      logger: { warn: vi.fn() },
      executionRepository: {
        getLatestTaskRun: vi.fn().mockReturnValue({ id: "run-id", startedAt: "2026-03-09T10:00:00.000Z" }),
        updateTaskRun: vi.fn(),
        getTaskDispatch: vi.fn(),
        updateTaskDispatch: vi.fn(),
        appendTaskRunEvent: vi.fn(),
      },
      sprintRunId: "sprint-run-1",
      projectManagementRepository: {
        updateTask: updateTaskMock,
      },
    };

    const result = await runSessionSyncStep(
      subtasks,
      deps as any,
      false,
      { repoPath: "/tmp/my-repo", sprintNumber: 1 }
    );

    expect(result.subtasks.find(t => t.id === "task-completed")?.status).toBe("COMPLETED");
    expect(result.subtasks.find(t => t.id === "task-coding-completed")?.status).toBe("CODING_COMPLETED");
    expect(result.subtasks.find(t => t.id === "task-running")?.status).toBe("CODING_COMPLETED");

    expect(updateTaskMock).not.toHaveBeenCalledWith("rec-c", { status: "coding_completed" });
    expect(updateTaskMock).toHaveBeenCalledWith("rec-cc", { status: "coding_completed" });
    expect(updateTaskMock).toHaveBeenCalledWith("rec-r", { status: "coding_completed" });
  });

  it("holds a rate-limited task in QUOTA until the retry delay expires, then requeues it", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-rate-limit",
        record_id: "task-rec-1",
        project_id: "project-1",
        title: "Rate limited task",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
      },
    ];

    const dispatches = [
      {
        errorMessage: "Gemini rate-limited. Retry after a short wait. [ERROR_CATEGORY:RATE_LIMITED] [RETRY_AFTER:2999-01-01T00:00:00.000Z]",
      },
    ];

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "rate-limited-session",
            name: "sessions/rate-limited-session",
            title: "Sprint 1: [run:my-repo/s1/task-rate-limit] [task-rate-limit] Rate limited task",
            state: "RATE_LIMITED",
          },
        ],
      }),
      resolveSessionName: (session: { name?: string }) => session.name,
      extractSessionId: (session: { id?: string }) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
      isActionRequiredState: vi.fn().mockReturnValue(false),
      executionRepository: {
        listTaskDispatches: vi.fn().mockReturnValue(dispatches),
      },
      logger: { warn: vi.fn() },
    };

    const waiting = await runSessionSyncStep(
      subtasks.map((task) => ({ ...task })),
      deps as any,
      true,
      { repoPath: "/tmp/my-repo", sprintNumber: 1, retryOnRateLimit: true },
    );
    expect(waiting.subtasks[0]?.status).toBe("QUOTA");

    dispatches[0] = {
      errorMessage: "Gemini rate-limited. Retry after a short wait. [ERROR_CATEGORY:RATE_LIMITED] [RETRY_AFTER:2000-01-01T00:00:00.000Z]",
    };

    const requeued = await runSessionSyncStep(
      subtasks.map((task) => ({ ...task })),
      deps as any,
      true,
      { repoPath: "/tmp/my-repo", sprintNumber: 1, retryOnRateLimit: true },
    );
    expect(requeued.subtasks[0]?.status).toBe("PENDING");
  });

  it("requeues quota sessions without an active cooldown instead of leaving them stuck", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-session-sync-quota-"));
    tempDirs.push(dir);

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const project = projectRepository.createProject({
      name: "Session Sync Quota",
      sourceType: "local",
      sourceRef: "/tmp/my-repo",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      number: 1,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Quota retry",
      status: "in_progress",
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
      status: "quota",
      startedAt: "2026-03-09T10:00:00.000Z",
      finishedAt: "2026-03-09T10:02:00.000Z",
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "gemini",
      sessionId: "quota-session",
      sessionName: "sessions/quota-session",
      state: "QUOTA",
      startedAt: "2026-03-09T10:00:00.000Z",
    });

    const subtasks: Subtask[] = [
      {
        id: task.taskKey,
        record_id: task.id,
        project_id: project.id,
        title: task.title,
        prompt: task.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "QUOTA",
      },
    ];

    const result = await runSessionSyncStep(
      subtasks,
      {
        listSessions: vi.fn().mockResolvedValue({
          sessions: [
            {
              id: "quota-session",
              name: "sessions/quota-session",
              title: "Sprint 1: [run:my-repo/s1/t01] [T01] Quota retry",
              state: "QUOTA",
              provider: "gemini",
            },
          ],
        }),
        resolveSessionName: (session: { name?: string }) => session.name,
        extractSessionId: (session: { id?: string }) => session.id,
        fetchRecentActivities: vi.fn().mockResolvedValue([]),
        isActionRequiredState: vi.fn().mockReturnValue(false),
        projectManagementRepository: projectRepository,
        executionRepository,
        sprintRunId: sprintRun.id,
        logger: { warn: vi.fn() },
      } as any,
      true,
      { repoPath: "/tmp/my-repo", sprintNumber: 1 },
    );

    expect(result.subtasks[0]?.status).toBe("PENDING");
    expect(result.subtasks[0]?.session_state).toBeUndefined();
    expect(executionRepository.getTaskDispatch(dispatch.id)?.errorMessage).toBe("Provider session QUOTA");
  });

  it("keeps quota sessions in QUOTA while a retry-after cooldown is active", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-quota",
        record_id: "task-rec-1",
        project_id: "project-1",
        title: "Quota task",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
      },
    ];

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "quota-session",
            name: "sessions/quota-session",
            title: "Sprint 1: [run:my-repo/s1/task-quota] [task-quota] Quota task",
            state: "QUOTA",
          },
        ],
      }),
      resolveSessionName: (session: { name?: string }) => session.name,
      extractSessionId: (session: { id?: string }) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
      isActionRequiredState: vi.fn().mockReturnValue(false),
      executionRepository: {
        listTaskDispatches: vi.fn().mockReturnValue([
          {
            errorMessage: "Gemini quota exhausted. [ERROR_CATEGORY:QUOTA_EXHAUSTED] [RETRY_AFTER:2999-01-01T00:00:00.000Z]",
          },
        ]),
      },
      logger: { warn: vi.fn() },
    };

    const result = await runSessionSyncStep(
      subtasks.map((task) => ({ ...task })),
      deps as any,
      true,
      { repoPath: "/tmp/my-repo", sprintNumber: 1 },
    );

    expect(result.subtasks[0]?.status).toBe("QUOTA");
  });

  it("fails a rate-limited task after the configured max retry count is exceeded", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-rate-limit",
        record_id: "task-rate-limit-record",
        project_id: "project-1",
        title: "Rate limited task",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
      },
    ];

    const expiredRateLimitError = "Gemini rate-limited. Retry after a short wait. [ERROR_CATEGORY:RATE_LIMITED] [RETRY_AFTER:2000-01-01T00:00:00.000Z]";
    const dispatches = Array.from({ length: 6 }, () => ({ errorMessage: expiredRateLimitError }));

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "rate-limited-session",
            name: "sessions/rate-limited-session",
            title: "Sprint 1: [run:my-repo/s1/task-rate-limit] [task-rate-limit] Rate limited task",
            state: "RATE_LIMITED",
          },
        ],
      }),
      resolveSessionName: (session: { name?: string }) => session.name,
      extractSessionId: (session: { id?: string }) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
      isActionRequiredState: vi.fn().mockReturnValue(false),
      executionRepository: {
        listTaskDispatches: vi.fn().mockReturnValue(dispatches),
      },
      logger: { warn: vi.fn() },
    };

    const result = await runSessionSyncStep(
      subtasks.map((task) => ({ ...task })),
      deps as any,
      true,
      { repoPath: "/tmp/my-repo", sprintNumber: 1, retryOnRateLimit: true, maxRateLimitRetries: 5 },
    );

    expect(result.subtasks[0]?.status).toBe("FAILED");
  });
});
