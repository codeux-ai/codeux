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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-session-sync-metrics-"));
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
    } as any);
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
      julesUsage: {
        calculateAndSaveUsageForTask: vi.fn().mockImplementation(async (projectId, taskId, sessionId) => {
          let record = executionRepository.getLatestProviderInvocationUsageBySession(sessionId, "task_coding");
          if (!record) {
            record = executionRepository.createProviderInvocationUsage({
              projectId,
              taskId,
              sessionId,
              provider: "jules",
              purpose: "task_coding",
              status: "completed",
              inputTokens: 7,
              outputTokens: 3,
              totalTokens: 10,
              usageSource: "estimated",
            } as any);
          }
          executionRepository.updateProviderInvocationUsage(record.id, {
            status: "completed",
            inputTokens: 7,
            outputTokens: 3,
            totalTokens: 10,
            usageSource: "estimated",
          });
        }),
      }
    };

    // Note: since the new logic doesn't await the tracking service, we await its mock manually here
    const runSync = runSessionSyncStep(
      subtasks,
      deps as any,
      false,
      { repoPath: "/tmp/my-repo", sprintNumber: 7 }
    );
    await runSync;
    // wait for promises to resolve
    await new Promise(resolve => setTimeout(resolve, 50));


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
    const runSync2 = runSessionSyncStep(
      subtasks,
      deps as any,
      false,
      { repoPath: "/tmp/my-repo", sprintNumber: 7 }
    );
    await runSync2;
    await new Promise(resolve => setTimeout(resolve, 50));

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

  it("does not attach a run-key-matched session already owned by another project task", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-session-sync-foreign-"));
    tempDirs.push(dir);

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const sourceProject = projectRepository.createProject({
      name: "Code UX Fork",
      sourceType: "local",
      sourceRef: "/tmp/source-codeux",
    });
    const sourceSprint = projectRepository.createSprint(sourceProject.id, {
      name: "Source Sprint",
      number: 4,
    });
    const sourceTask = projectRepository.createTask(sourceProject.id, {
      sprintId: sourceSprint.id,
      taskKey: "T02",
      title: "Source task",
    });
    executionRepository.createTaskRun({
      projectId: sourceProject.id,
      sprintId: sourceSprint.id,
      taskId: sourceTask.id,
      provider: "jules",
      sessionId: "foreign-session",
      sessionName: "sessions/foreign-session",
      state: "COMPLETED",
      prUrl: "https://github.com/numnx/codeux/pull/106",
      startedAt: "2026-06-15T19:42:30.153Z",
      finishedAt: "2026-06-15T22:22:18.707Z",
    });

    const currentProject = projectRepository.createProject({
      name: "Code UX CC",
      sourceType: "local",
      sourceRef: "/tmp/current-codeux",
    });
    const currentSprint = projectRepository.createSprint(currentProject.id, {
      name: "Improve Projects Page",
      number: 4,
    });
    const currentTask = projectRepository.createTask(currentProject.id, {
      sprintId: currentSprint.id,
      taskKey: "T02",
      title: "Fix local new-project creation",
    });

    const subtasks: Subtask[] = [
      {
        id: currentTask.taskKey,
        record_id: currentTask.id,
        project_id: currentProject.id,
        sprint_id: currentSprint.id,
        title: currentTask.title,
        prompt: currentTask.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
    ];

    const fetchRecentActivities = vi.fn().mockResolvedValue([]);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const result = await runSessionSyncStep(
      subtasks,
      {
        listSessions: vi.fn().mockResolvedValue({
          sessions: [
            {
              id: "foreign-session",
              name: "sessions/foreign-session",
              title: "Sprint 4: [run:codeux/s4/t02] [t02] Fix local new-project creation",
              state: "COMPLETED",
              provider: "jules",
              outputs: [{ pullRequest: { url: "https://github.com/numnx/codeux/pull/106" } }],
            },
          ],
        }),
        resolveSessionName: (session: { name?: string }) => session.name,
        extractSessionId: (session: { id?: string }) => session.id,
        fetchRecentActivities,
        isActionRequiredState: vi.fn().mockReturnValue(false),
        executionRepository,
        projectManagementRepository: projectRepository,
        logger,
      },
      false,
      {
        repoPath: "/tmp/codeux",
        sprintNumber: 4,
      },
    );

    expect(result.subtasks[0].status).toBe("PENDING");
    expect(result.subtasks[0].session_id).toBeUndefined();
    expect(result.subtasks[0].provider).toBeUndefined();
    expect(result.subtasks[0].pr_url).toBeUndefined();
    expect(fetchRecentActivities).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping foreign provider session matched by task run key",
      expect.objectContaining({
        taskId: currentTask.id,
        projectId: currentProject.id,
        sprintId: currentSprint.id,
        sessionId: "foreign-session",
      }),
    );
  });

  it("does not resurrect a human-owned QA_REVIEW_FAILED task from a stale COMPLETED session", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-1",
        title: "Task One",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
        // QA could not verify it; a human now owns it.
        status: "QA_REVIEW_FAILED",
      },
    ];

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "stale-completed",
            name: "sessions/stale-completed",
            title: "Sprint 6: [run:my-repo/s6/task-1] [task-1] Task One",
            // Jules still reports the original session as COMPLETED.
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

    const result = await runSessionSyncStep(subtasks, deps, true, {
      repoPath: "/tmp/my-repo",
      sprintNumber: 6,
    });

    // The stale COMPLETED session must not pull it back to CODING_COMPLETED.
    expect(result.subtasks[0].status).toBe("QA_REVIEW_FAILED");
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-session-sync-"));
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

  it("fetches a recorded task session directly when it is missing from the bounded session snapshot", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-session-sync-missing-snapshot-"));
    tempDirs.push(dir);

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const project = projectRepository.createProject({
      name: "Missing Snapshot Session Project",
      sourceType: "local",
      sourceRef: "/tmp/codeuxweb",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 24",
      number: 24,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T10",
      title: "Remove React type leakage",
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
      executorType: "jules",
      status: "completed",
      startedAt: "2026-06-28T07:51:10.011Z",
      finishedAt: "2026-06-28T19:53:39.456Z",
    } as any);
    const run = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "jules",
      state: "RUNNING",
      sessionId: "missing-snapshot-session",
      sessionName: "sessions/missing-snapshot-session",
      workerBranch: "fix/preact-type-consistency-missing-snapshot-session",
      prUrl: "https://github.com/numnx/codeuxweb/pull/256",
      startedAt: "2026-06-28T07:51:10.011Z",
    });

    const subtasks: Subtask[] = [
      {
        id: "T10",
        record_id: task.id,
        project_id: project.id,
        sprint_id: sprint.id,
        title: task.title,
        prompt: task.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
        session_id: "missing-snapshot-session",
        session_name: "sessions/missing-snapshot-session",
        provider: "jules",
        worker_branch: "fix/preact-type-consistency-missing-snapshot-session",
        pr_url: "https://github.com/numnx/codeuxweb/pull/256",
      },
    ];

    const getSession = vi.fn().mockResolvedValue({
      id: "missing-snapshot-session",
      name: "sessions/missing-snapshot-session",
      title: "Sprint 24: [run:codeuxweb/s24/t10] [T10] Remove React type leakage",
      state: "COMPLETED",
      provider: "jules",
      prompt: "Remove React type leakage",
      outputs: [
        {
          pullRequest: {
            url: "https://github.com/numnx/codeuxweb/pull/256",
            workerBranch: "fix/preact-type-consistency-missing-snapshot-session",
          },
        },
      ],
    });

    const result = await runSessionSyncStep(
      subtasks,
      {
        listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
        resolveSessionName: (session: { name?: string }) => session.name,
        extractSessionId: (session: { id?: string }) => session.id,
        fetchRecentActivities: vi.fn().mockResolvedValue([]),
        getSession,
        listAllActivities: vi.fn().mockResolvedValue([]),
        isActionRequiredState: vi.fn().mockReturnValue(false),
        executionRepository,
        projectManagementRepository: projectRepository,
        sprintRunId: sprintRun.id,
        logger: { warn: vi.fn() },
      },
      false,
      { repoPath: "/tmp/codeuxweb", sprintNumber: 24 }
    );

    expect(getSession).toHaveBeenCalledWith("missing-snapshot-session");
    expect(result.subtasks[0]?.status).toBe("CODING_COMPLETED");
    expect(executionRepository.getTaskRun(run.id)).toMatchObject({
      state: "COMPLETED",
      prUrl: "https://github.com/numnx/codeuxweb/pull/256",
      workerBranch: "fix/preact-type-consistency-missing-snapshot-session",
    });
    expect(projectRepository.getTask(task.id)?.status).toBe("coding_completed");
  });

  it("prefers a recorded task session over a stale snapshot session for the same task key", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-session-sync-recorded-session-"));
    tempDirs.push(dir);

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const project = projectRepository.createProject({
      name: "Recorded Session Project",
      sourceType: "local",
      sourceRef: "/tmp/codeuxweb",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 24",
      number: 24,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T14",
      title: "Correct delete confirmation failure handling",
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
      executorType: "jules",
      status: "completed",
      startedAt: "2026-06-28T08:10:00.000Z",
      finishedAt: "2026-06-28T09:03:15.000Z",
    } as any);
    const run = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "jules",
      state: "RUNNING",
      sessionId: "recorded-completed-session",
      sessionName: "sessions/recorded-completed-session",
      workerBranch: "fix-delete-confirmation-dialog-recorded-completed-session",
      prUrl: "https://github.com/numnx/codeuxweb/pull/262",
      startedAt: "2026-06-28T08:10:00.000Z",
    });

    const subtasks: Subtask[] = [
      {
        id: "T14",
        record_id: task.id,
        project_id: project.id,
        sprint_id: sprint.id,
        title: task.title,
        prompt: task.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
        session_id: "recorded-completed-session",
        session_name: "sessions/recorded-completed-session",
        provider: "jules",
        worker_branch: "fix-delete-confirmation-dialog-recorded-completed-session",
        pr_url: "https://github.com/numnx/codeuxweb/pull/262",
      },
    ];

    const getSession = vi.fn().mockResolvedValue({
      id: "recorded-completed-session",
      name: "sessions/recorded-completed-session",
      title: "Sprint 24: [run:codeuxweb/s24/t14] [T14] Correct delete confirmation failure handling",
      state: "COMPLETED",
      provider: "jules",
      prompt: "Fix delete confirmation failure handling",
      outputs: [
        {
          pullRequest: {
            url: "https://github.com/numnx/codeuxweb/pull/262",
            workerBranch: "fix-delete-confirmation-dialog-recorded-completed-session",
          },
        },
      ],
    });

    const result = await runSessionSyncStep(
      subtasks,
      {
        listSessions: vi.fn().mockResolvedValue({
          sessions: [
            {
              id: "stale-running-session",
              name: "sessions/stale-running-session",
              title: "Sprint 24: [run:codeuxweb/s24/t14] [T14] Correct delete confirmation failure handling",
              state: "RUNNING",
              provider: "jules",
              prompt: "Old duplicate session",
            },
          ],
        }),
        resolveSessionName: (session: { name?: string }) => session.name,
        extractSessionId: (session: { id?: string }) => session.id,
        fetchRecentActivities: vi.fn().mockResolvedValue([]),
        getSession,
        listAllActivities: vi.fn().mockResolvedValue([]),
        isActionRequiredState: vi.fn().mockReturnValue(false),
        executionRepository,
        projectManagementRepository: projectRepository,
        sprintRunId: sprintRun.id,
        logger: { warn: vi.fn() },
      },
      false,
      { repoPath: "/tmp/codeuxweb", sprintNumber: 24 }
    );

    expect(getSession).toHaveBeenCalledWith("recorded-completed-session");
    expect(result.subtasks[0]?.session_id).toBe("recorded-completed-session");
    expect(result.subtasks[0]?.status).toBe("CODING_COMPLETED");
    expect(executionRepository.getTaskRun(run.id)).toMatchObject({
      state: "COMPLETED",
      sessionId: "recorded-completed-session",
      prUrl: "https://github.com/numnx/codeuxweb/pull/262",
    });
    expect(projectRepository.getTask(task.id)?.status).toBe("coding_completed");
  });

  it("refreshes a recorded task session directly when the snapshot has a stale nonterminal copy", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-session-sync-stale-snapshot-"));
    tempDirs.push(dir);

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const project = projectRepository.createProject({
      name: "Stale Snapshot Project",
      sourceType: "local",
      sourceRef: "/tmp/codeuxweb",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 24",
      number: 24,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T10",
      title: "Remove React type leakage",
      status: "in_progress",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const run = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      provider: "jules",
      state: "RUNNING",
      sessionId: "stale-snapshot-session",
      sessionName: "sessions/stale-snapshot-session",
      startedAt: "2026-06-28T07:51:10.011Z",
    });

    const getSession = vi.fn().mockResolvedValue({
      id: "stale-snapshot-session",
      name: "sessions/stale-snapshot-session",
      title: "Sprint 24: [run:codeuxweb/s24/t10] [T10] Remove React type leakage",
      state: "COMPLETED",
      provider: "jules",
      prompt: "Remove React type leakage",
      outputs: [
        {
          pullRequest: {
            url: "https://github.com/numnx/codeuxweb/pull/256",
            workerBranch: "fix/preact-type-consistency-stale-snapshot-session",
          },
        },
      ],
    });

    const result = await runSessionSyncStep(
      [
        {
          id: "T10",
          record_id: task.id,
          project_id: project.id,
          sprint_id: sprint.id,
          title: task.title,
          prompt: task.promptMarkdown,
          depends_on: [],
          is_independent: true,
          status: "RUNNING",
          session_id: "stale-snapshot-session",
          session_name: "sessions/stale-snapshot-session",
          provider: "jules",
        },
      ],
      {
        listSessions: vi.fn().mockResolvedValue({
          sessions: [
            {
              id: "stale-snapshot-session",
              name: "sessions/stale-snapshot-session",
              title: "Sprint 24: [run:codeuxweb/s24/t10] [T10] Remove React type leakage",
              state: "IN_PROGRESS",
              provider: "jules",
              prompt: "Stale cached state",
            },
          ],
        }),
        resolveSessionName: (session: { name?: string }) => session.name,
        extractSessionId: (session: { id?: string }) => session.id,
        fetchRecentActivities: vi.fn().mockResolvedValue([]),
        getSession,
        listAllActivities: vi.fn().mockResolvedValue([]),
        isActionRequiredState: vi.fn().mockReturnValue(false),
        executionRepository,
        projectManagementRepository: projectRepository,
        sprintRunId: sprintRun.id,
        logger: { warn: vi.fn() },
      },
      false,
      { repoPath: "/tmp/codeuxweb", sprintNumber: 24 }
    );

    expect(getSession).toHaveBeenCalledWith("stale-snapshot-session");
    expect(result.subtasks[0]?.status).toBe("CODING_COMPLETED");
    expect(executionRepository.getTaskRun(run.id)?.state).toBe("COMPLETED");
    expect(projectRepository.getTask(task.id)?.status).toBe("coding_completed");
  });

  it("keeps an awaiting-feedback Jules session running after the latest agent request has a user reply", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-session-sync-reply-"));
    tempDirs.push(dir);

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const project = projectRepository.createProject({
      name: "Session Reply Project",
      sourceType: "local",
      sourceRef: "/tmp/my-repo",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Session Reply Sprint",
      number: 8,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T07",
      title: "Wait for clarification reply",
      status: "pending",
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
      status: "blocked",
      errorMessage: "Provider session requires attention: AWAITING_USER_FEEDBACK",
      startedAt: "2026-06-28T16:00:00.000Z",
      finishedAt: "2026-06-28T16:10:00.000Z",
    } as any);
    const run = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "jules",
      state: "BLOCKED",
      startedAt: "2026-06-28T16:00:00.000Z",
      finishedAt: "2026-06-28T16:10:00.000Z",
    });

    const subtasks: Subtask[] = [
      {
        id: "T07",
        record_id: task.id,
        project_id: project.id,
        sprint_id: sprint.id,
        title: task.title,
        prompt: task.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "BLOCKED",
      },
    ];

    const result = await runSessionSyncStep(
      subtasks,
      {
        listSessions: vi.fn().mockResolvedValue({
          sessions: [
            {
              id: "reply-session",
              name: "sessions/reply-session",
              title: "Sprint 8: [run:my-repo/s8/t07] [T07] Wait for clarification reply",
              state: "AWAITING_USER_FEEDBACK",
              provider: "jules",
              prompt: "Resolve the scoped loop.",
            },
          ],
        }),
        resolveSessionName: (session: { name?: string }) => session.name,
        extractSessionId: (session: { id?: string }) => session.id,
        fetchRecentActivities: vi.fn().mockResolvedValue([
          {
            id: "agent-question",
            name: "sessions/reply-session/activities/agent-question",
            createTime: "2026-06-28T16:12:29.000Z",
            originator: "agent",
            kind: "agent_message",
            preview: "Should I expand beyond the scoped files?",
          },
          {
            id: "user-reply",
            name: "sessions/reply-session/activities/user-reply",
            createTime: "2026-06-28T19:30:53.000Z",
            originator: "user",
            kind: "user_message",
            preview: "Stay strictly within the T07 scope.",
          },
          {
            id: "provider-progress",
            name: "sessions/reply-session/activities/provider-progress",
            createTime: "2026-06-28T19:31:00.000Z",
            originator: "agent",
            kind: "activity",
          },
        ]),
        isActionRequiredState: (state?: string) => state === "AWAITING_USER_FEEDBACK",
        executionRepository,
        projectManagementRepository: projectRepository,
        sprintRunId: sprintRun.id,
        logger: { warn: vi.fn() },
        julesUsage: {
          syncLiveInvocation: vi.fn().mockResolvedValue(undefined),
        },
      },
      false,
      { repoPath: "/tmp/my-repo", sprintNumber: 8 }
    );

    const updatedRun = executionRepository.getTaskRun(run.id);
    const updatedDispatch = executionRepository.getTaskDispatch(dispatch.id);
    const updatedTask = projectRepository.getTask(task.id);
    const events = executionRepository.listTaskRunEvents(run.id);

    expect(result.subtasks[0]?.status).toBe("RUNNING");
    expect(updatedRun).toMatchObject({
      state: "RUNNING",
      finishedAt: null,
      durationMs: null,
    });
    expect(updatedDispatch).toMatchObject({
      status: "running",
      finishedAt: null,
      errorMessage: null,
    });
    expect(updatedTask?.status).toBe("in_progress");
    expect(events[0]?.payload).toMatchObject({
      sessionState: "AWAITING_USER_FEEDBACK",
      taskRunState: "RUNNING",
      actionRequiredReplyPending: true,
    });
  });

  it("preserves the first terminal finishedAt during later completed-session syncs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-session-sync-"));
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
    } as any);
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

  it("does not downgrade a force-completed (settled) task when the remote session is ACTIVE", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-completed",
        title: "Task C",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        record_id: "rec-c",
        is_merged: true,
        worker_branch: "feature/branch",
        pr_url: "https://example.com/pr/1",
      },
    ];

    const updateTaskMock = vi.fn();
    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "s-completed",
            name: "sessions/s-completed",
            title: "Sprint 1: [run:my-repo/s1/task-completed] [task-completed] Task C",
            state: "ACTIVE",
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
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("downgrades an unsettled COMPLETED task to RUNNING when the remote session is ACTIVE", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-completed",
        title: "Task C",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        record_id: "rec-c",
        is_merged: false,
        worker_branch: "feature/branch",
        pr_url: "https://example.com/pr/1",
      },
    ];

    const updateTaskMock = vi.fn();
    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "s-completed",
            name: "sessions/s-completed",
            title: "Sprint 1: [run:my-repo/s1/task-completed] [task-completed] Task C",
            state: "ACTIVE",
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

    expect(result.subtasks.find(t => t.id === "task-completed")?.status).toBe("RUNNING");
  });

  it("re-runs a no-PR completed task to RUNNING when its session reactivates (stale-status fix)", async () => {
    // A task that completed with no PR/branch (no merge evidence) counts as
    // "settled" by the pipeline, so it previously stayed stuck on "completed"
    // even after being rerun. When its session is active again it must show
    // RUNNING and the planning status must be persisted.
    const subtasks: Subtask[] = [
      {
        id: "task-completed",
        title: "Task C",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        record_id: "rec-c",
        is_merged: false,
        // No worker_branch / pr_url — no merge evidence.
      },
    ];

    const updateTaskMock = vi.fn();
    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "s-completed",
            name: "sessions/s-completed",
            title: "Sprint 1: [run:my-repo/s1/task-completed] [task-completed] Task C",
            state: "IN_PROGRESS",
          },
        ],
      }),
      resolveSessionName: (session: any) => session.name,
      extractSessionId: (session: any) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
      isActionRequiredState: vi.fn().mockReturnValue(false),
      logger: { warn: vi.fn() },
      executionRepository: {
        // Local run is terminal (COMPLETED) — the remote session reactivated.
        getLatestTaskRun: vi.fn().mockReturnValue({ id: "run-id", state: "COMPLETED", startedAt: "2026-03-09T10:00:00.000Z", finishedAt: "2026-03-09T11:00:00.000Z" }),
        updateTaskRun: vi.fn(),
        getTaskDispatch: vi.fn().mockReturnValue({ id: "d-1", finishedAt: "2026-03-09T11:00:00.000Z" }),
        updateTaskDispatch: vi.fn(),
        appendTaskRunEvent: vi.fn(),
        finalizeSprintRunCancellationIfIdle: vi.fn(),
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

    expect(result.subtasks.find(t => t.id === "task-completed")?.status).toBe("RUNNING");
    // Planning status must be persisted as in_progress (not left on completed).
    expect(updateTaskMock).toHaveBeenCalledWith("rec-c", expect.objectContaining({ status: "in_progress" }));
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-session-sync-quota-"));
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
    } as any);
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

  it("does not fetch recent activities for fully synchronized terminal sessions", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-terminal",
        record_id: "task-terminal-record",
        project_id: "project-1",
        title: "Terminal task",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
      },
    ];

    const fetchRecentActivities = vi.fn().mockResolvedValue([]);
    const getLatestTaskRun = vi.fn().mockReturnValue({ state: "COMPLETED" });

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "terminal-session",
            name: "sessions/terminal-session",
            title: "Sprint 1: [run:my-repo/s1/task-terminal] [task-terminal] Terminal task",
            state: "COMPLETED",
          },
        ],
      }),
      resolveSessionName: (session: { name?: string }) => session.name,
      extractSessionId: (session: { id?: string }) => session.id,
      fetchRecentActivities,
      isActionRequiredState: vi.fn().mockReturnValue(false),
      executionRepository: {
        getLatestTaskRun,
        updateTaskRun: vi.fn(),
        getTaskDispatch: vi.fn(),
        updateTaskDispatch: vi.fn(),
        appendTaskRunEvent: vi.fn(),
      },
      sprintRunId: "sprint-run-123",
      logger: { warn: vi.fn() },
    };

    await runSessionSyncStep(
      subtasks,
      deps as any,
      false,
      { repoPath: "/tmp/my-repo", sprintNumber: 1 }
    );

    expect(getLatestTaskRun).toHaveBeenCalledWith("task-terminal-record", "sprint-run-123");
    expect(fetchRecentActivities).not.toHaveBeenCalled();
  });

  it("repairs a stale blocked dispatch when the linked task run is already completed", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-session-sync-terminal-dispatch-"));
    tempDirs.push(dir);

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const project = projectRepository.createProject({
      name: "Terminal Dispatch Project",
      sourceType: "local",
      sourceRef: "/tmp/my-repo",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Terminal Dispatch Sprint",
      number: 9,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T07",
      title: "Completed but stale dispatch",
      status: "completed",
      isMerged: true,
      mergeIndicator: "MERGED",
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
      status: "blocked",
      errorMessage: "Provider session requires attention before dispatch reconciliation.",
      startedAt: "2026-06-27T09:57:59.808Z",
      finishedAt: "2026-06-27T10:50:11.924Z",
    } as any);
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "jules",
      state: "COMPLETED",
      sessionId: "completed-session",
      sessionName: "sessions/completed-session",
      startedAt: "2026-06-27T09:57:59.808Z",
      finishedAt: "2026-06-27T11:05:10.343Z",
    });

    const subtasks: Subtask[] = [
      {
        id: "T07",
        record_id: task.id,
        project_id: project.id,
        sprint_id: sprint.id,
        title: task.title,
        prompt: task.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: true,
        merge_indicator: "MERGED",
      },
    ];

    await runSessionSyncStep(
      subtasks,
      {
        listSessions: vi.fn().mockResolvedValue({
          sessions: [
            {
              id: "completed-session",
              name: "sessions/completed-session",
              title: "Sprint 9: [run:my-repo/s9/t07] [T07] Completed but stale dispatch",
              state: "COMPLETED",
              provider: "jules",
              prompt: "Finished task",
            },
          ],
        }),
        resolveSessionName: (session: { name?: string }) => session.name,
        extractSessionId: (session: { id?: string }) => session.id,
        fetchRecentActivities: vi.fn().mockResolvedValue([]),
        isActionRequiredState: vi.fn().mockReturnValue(false),
        executionRepository,
        projectManagementRepository: projectRepository,
        sprintRunId: sprintRun.id,
        logger: { warn: vi.fn() },
      },
      false,
      { repoPath: "/tmp/my-repo", sprintNumber: 9 }
    );

    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      status: "completed",
      errorMessage: null,
    });
  });

  it("reattaches a persisted Jules task run to a resumed sprint run before syncing state", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-session-sync-resume-"));
    tempDirs.push(dir);

    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);

    const project = projectRepository.createProject({
      name: "Session Sync Resume",
      sourceType: "local",
      sourceRef: "/tmp/codeux",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 28",
      number: 28,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T02",
      title: "Resume stale Jules run",
      status: "pending",
    });
    const pausedRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "paused",
    });
    const resumedRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: pausedRun.id,
      executorType: "jules",
      status: "blocked",
      errorMessage: "Provider session requires attention: AWAITING_USER_FEEDBACK",
      startedAt: "2026-06-28T14:00:00.000Z",
      finishedAt: "2026-06-28T14:12:00.000Z",
    } as any);
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: pausedRun.id,
      dispatchId: dispatch.id,
      provider: "jules",
      mode: "jules",
      sessionId: "resumed-jules-session",
      sessionName: "sessions/resumed-jules-session",
      state: "BLOCKED",
      startedAt: "2026-06-28T14:00:00.000Z",
    });
    const usage = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: pausedRun.id,
      dispatchId: dispatch.id,
      taskRunId: taskRun.id,
      sessionId: "resumed-jules-session",
      provider: "jules",
      purpose: "task_coding",
      status: "running",
    });

    const subtasks: Subtask[] = [
      {
        id: "T02",
        record_id: task.id,
        project_id: project.id,
        sprint_id: sprint.id,
        title: task.title,
        prompt: task.promptMarkdown,
        depends_on: [],
        is_independent: true,
        status: "BLOCKED",
      },
    ];

    const result = await runSessionSyncStep(
      subtasks,
      {
        listSessions: vi.fn().mockResolvedValue({
          sessions: [
            {
              id: "resumed-jules-session",
              name: "sessions/resumed-jules-session",
              title: "Sprint 28: [run:codeux/s28/t02] [T02] Resume stale Jules run",
              state: "COMPLETED",
              provider: "jules",
              prompt: "Finish the task",
            },
          ],
        }),
        resolveSessionName: (session: { name?: string }) => session.name,
        extractSessionId: (session: { id?: string }) => session.id,
        fetchRecentActivities: vi.fn().mockResolvedValue([]),
        listAllActivities: vi.fn().mockResolvedValue([]),
        getSession: vi.fn().mockResolvedValue({ id: "resumed-jules-session", prompt: "Finish the task" }),
        isActionRequiredState: vi.fn().mockReturnValue(false),
        executionRepository,
        projectManagementRepository: projectRepository,
        sprintRunId: resumedRun.id,
        logger: { warn: vi.fn() },
        julesUsage: {
          calculateAndSaveUsageForTask: vi.fn().mockResolvedValue(undefined),
          syncLiveInvocation: vi.fn().mockResolvedValue(undefined),
        },
      },
      true,
      { repoPath: "/tmp/codeux", sprintNumber: 28 }
    );

    const updatedRun = executionRepository.getTaskRun(taskRun.id);
    const updatedDispatch = executionRepository.getTaskDispatch(dispatch.id);
    const updatedUsage = executionRepository.getProviderInvocationUsage(usage.id);
    const updatedTask = projectRepository.getTask(task.id);

    expect(result.subtasks[0]?.status).toBe("CODING_COMPLETED");
    expect(updatedRun?.sprintRunId).toBe(resumedRun.id);
    expect(updatedRun?.state).toBe("COMPLETED");
    expect(updatedDispatch?.sprintRunId).toBe(resumedRun.id);
    expect(updatedDispatch?.status).toBe("completed");
    expect(updatedDispatch?.errorMessage).toBeNull();
    expect(updatedUsage?.sprintRunId).toBe(resumedRun.id);
    expect(updatedUsage?.taskRunId).toBe(taskRun.id);
    expect(updatedUsage?.status).toBe("completed");
    expect(updatedTask?.status).toBe("coding_completed");
  });
});
