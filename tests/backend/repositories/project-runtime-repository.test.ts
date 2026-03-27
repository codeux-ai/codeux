import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ProjectRuntimeRepository } from "../../../src/repositories/project-runtime-repository.js";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  storage: AppDbStorage;
  executionRepository: ExecutionRepository;
  projectRepository: ProjectManagementRepository;
  runtimeRepository: ProjectRuntimeRepository;
  realtimeNotifier: {
    scheduleProjectRuntimeStatusRefresh: ReturnType<typeof vi.fn>;
  };
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-runtime-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const realtimeNotifier = {
    scheduleProjectRuntimeStatusRefresh: vi.fn(),
  };
  return {
    storage,
    executionRepository: new ExecutionRepository(storage),
    projectRepository: new ProjectManagementRepository(storage),
    runtimeRepository: new ProjectRuntimeRepository(storage, realtimeNotifier as any),
    realtimeNotifier,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ProjectRuntimeRepository", () => {
  it("persists orchestration context and task runs for the selected project", async () => {
    const { storage, projectRepository, runtimeRepository, realtimeNotifier } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Runtime Project",
      sourceType: "local",
      sourceRef: "/workspace/runtime-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Execution Sprint",
      number: 7,
      featureBranch: "feature/sprint7-implementation",
      status: "running",
    });
    const taskA = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T01",
      title: "Start worker",
      promptMarkdown: "Launch the first worker session.",
      status: "pending",
    });
    projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T02",
      title: "Handle blocker",
      promptMarkdown: "Track the failed execution path.",
      status: "pending",
      dependsOnTaskIds: [taskA.id],
    });

    runtimeRepository.syncDashboardStatus({
      sprint_number: 7,
      source_id: "source-001",
      repo_path: "/workspace/runtime-project",
      feature_branch: "feature/sprint7-implementation",
      subtasks: [
        {
          id: "T01",
          title: "Start worker",
          prompt: "Launch the first worker session.",
          depends_on: [],
          is_independent: true,
          status: "RUNNING",
          session_id: "session-1",
          session_name: "sessions/session-1",
          provider: "codex",
          worker_branch: "worker/T01",
        },
        {
          id: "T02",
          title: "Handle blocker",
          prompt: "Track the failed execution path.",
          depends_on: ["T01"],
          is_independent: false,
          status: "FAILED",
        },
      ],
      reportText: "Runtime report",
      statusTable: "Status table",
      instructions: "Next actions",
      timestamp: "2026-03-09T12:00:00.000Z",
    });

    const runtimeStatus = runtimeRepository.getSelectedProjectStatus();
    expect(runtimeStatus).toMatchObject({
      sprint_number: 7,
      source_id: "source-001",
      repo_path: "/workspace/runtime-project",
      feature_branch: "feature/sprint7-implementation",
      reportText: "Runtime report",
      statusTable: "Status table",
      instructions: "Next actions",
      timestamp: "2026-03-09T12:00:00.000Z",
    });
    expect(runtimeStatus.subtasks).toHaveLength(2);
    expect(runtimeStatus.subtasks[0]).toMatchObject({
      record_id: taskA.id,
      id: "T01",
      status: "RUNNING",
      session_id: "session-1",
      session_name: "sessions/session-1",
      provider: "codex",
      worker_branch: "worker/T01",
    });
    expect(runtimeStatus.subtasks[1]).toMatchObject({
      id: "T02",
      status: "FAILED",
      depends_on: ["T01"],
    });

    const db = storage.getDatabase();
    const runRows = db.prepare(`
      SELECT task_id, state, session_id, session_name
      FROM task_runs
      ORDER BY task_id ASC
    `).all() as Array<{ task_id: string; state: string; session_id: string | null; session_name: string | null }>;
    expect(runRows).toHaveLength(2);
    const runningRow = runRows.find((row) => row.task_id === taskA.id);
    expect(runningRow).toMatchObject({
      task_id: taskA.id,
      state: "RUNNING",
      session_id: "session-1",
      session_name: "sessions/session-1",
    });

    const storedProject = projectRepository.getProject(project.id);
    expect(storedProject?.status).toBe("running");
    expect(realtimeNotifier.scheduleProjectRuntimeStatusRefresh).toHaveBeenCalledWith(project.id);
  });

  it("returns the selected project's planned tasks even without runtime context", async () => {
    const { projectRepository, runtimeRepository } = await createRepositories();

    const projectA = projectRepository.createProject({
      name: "Alpha",
      sourceType: "local",
      sourceRef: "/workspace/alpha",
    });
    const projectB = projectRepository.createProject({
      name: "Beta",
      sourceType: "local",
      sourceRef: "/workspace/beta",
    });
    const sprintB = projectRepository.createSprint(projectB.id, {
      name: "Beta Sprint",
      number: 3,
    });
    projectRepository.createTask(projectB.id, {
      sprintId: sprintB.id,
      taskKey: "B01",
      title: "Plan the work",
      promptMarkdown: "Stay pending until orchestration starts.",
      status: "pending",
    });

    projectRepository.setSelectedProjectId(projectB.id);
    const status = runtimeRepository.getSelectedProjectStatus();

    expect(projectA.id).not.toBe(projectB.id);
    expect(status.subtasks).toHaveLength(1);
    expect(status.subtasks[0]).toMatchObject({
      id: "B01",
      status: "PENDING",
      project_id: projectB.id,
      sprint_id: sprintB.id,
    });
    expect(status.repo_path).toBeUndefined();
    expect(status.timestamp).toBeNull();
  });

  it("treats AUTOMERGE indicators as merged in projected runtime status", async () => {
    const { projectRepository, runtimeRepository } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Gamma",
      sourceType: "local",
      sourceRef: "/workspace/gamma",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Gamma Sprint",
      number: 5,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "G01",
      title: "Auto-merged task",
      promptMarkdown: "Already merged by automation.",
      status: "completed",
    });

    projectRepository.setSelectedProjectId(project.id);
    projectRepository.updateTask(task.id, {
      isMerged: false,
      mergeIndicator: "AUTOMERGE",
      status: "completed",
    });

    const status = runtimeRepository.getSelectedProjectStatus();

    expect(status.subtasks).toHaveLength(1);
    expect(status.subtasks[0]).toMatchObject({
      id: "G01",
      status: "COMPLETED",
      is_merged: true,
      merge_indicator: "AUTOMERGE",
    });
  });

  it("maintains separate runtime context per sprint for the same project and returns the explicitly selected sprint", async () => {
    const { projectRepository, runtimeRepository } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Multi-sprint Project",
      sourceType: "local",
      sourceRef: "/workspace/multi",
    });

    const sprint1 = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const sprint2 = projectRepository.createSprint(project.id, { name: "Sprint 2", number: 2 });

    const task1 = projectRepository.createTask(project.id, { sprintId: sprint1.id, taskKey: "S1T1", title: "Task 1 in Sprint 1", status: "in_progress" });
    const task2 = projectRepository.createTask(project.id, { sprintId: sprint2.id, taskKey: "S2T1", title: "Task 1 in Sprint 2", status: "pending" });

    // Sync status for sprint 1
    runtimeRepository.syncDashboardStatus({
      project_id: project.id,
      sprint_id: sprint1.id,
      subtasks: [
        { id: "S1T1", title: "Task 1 in Sprint 1", status: "RUNNING", record_id: task1.id, depends_on: [] }
      ],
      reportText: "Sprint 1 running"
    });

    // Sync status for sprint 2
    runtimeRepository.syncDashboardStatus({
      project_id: project.id,
      sprint_id: sprint2.id,
      subtasks: [
        { id: "S2T1", title: "Task 1 in Sprint 2", status: "PENDING", record_id: task2.id, depends_on: [] }
      ],
      reportText: "Sprint 2 pending"
    });

    // Select Sprint 1
    projectRepository.setSelectedProjectId(project.id);
    projectRepository.setSelectedSprintId(project.id, sprint1.id);

    const status1 = runtimeRepository.getSelectedProjectStatus();
    expect(status1.sprint_id).toBe(sprint1.id);
    expect(status1.reportText).toBe("Sprint 1 running");
    expect(status1.subtasks).toHaveLength(1);
    expect(status1.subtasks[0].id).toBe("S1T1");
    expect(status1.subtasks[0].status).toBe("RUNNING");

    // Select Sprint 2
    projectRepository.setSelectedSprintId(project.id, sprint2.id);

    const status2 = runtimeRepository.getSelectedProjectStatus();
    expect(status2.sprint_id).toBe(sprint2.id);
    expect(status2.reportText).toBe("Sprint 2 pending");
    expect(status2.subtasks).toHaveLength(1);
    expect(status2.subtasks[0].id).toBe("S2T1");
    expect(status2.subtasks[0].status).toBe("PENDING");
  });

  it("projects recent provider activity into task activities without a secondary fetch path", async () => {
    const { executionRepository, projectRepository, runtimeRepository } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Activity Projection",
      sourceType: "local",
      sourceRef: "/workspace/activity-projection",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 9",
      number: 9,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "A01",
      title: "Hydrate runtime feed",
      promptMarkdown: "Show the latest provider messages.",
      status: "in_progress",
    });

    projectRepository.setSelectedProjectId(project.id);

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
    });
    const run = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "jules",
      sessionId: "session-activity-1",
      sessionName: "sessions/session-activity-1",
      state: "RUNNING",
      startedAt: "2026-03-27T10:00:00.000Z",
    });

    executionRepository.appendTaskRunEvent(run.id, "provider_activity", "agent", {
      activityId: "activity-1",
      activityName: "sessions/session-activity-1/activities/activity-1",
      preview: "Need the repo root clarified.",
      description: "Need the repo root clarified.",
      agentMessaged: {
        agentMessage: "Need the repo root clarified.",
      },
    }, {
      createdAt: "2026-03-27T10:05:00.000Z",
      sourceEventKey: "activity:activity-1",
    });
    executionRepository.appendTaskRunEvent(run.id, "provider_activity", "user", {
      activityId: "activity-2",
      activityName: "sessions/session-activity-1/activities/activity-2",
      preview: "Repo root is /workspace/activity-projection.",
      userMessaged: {
        userMessage: "Repo root is /workspace/activity-projection.",
      },
    }, {
      createdAt: "2026-03-27T10:06:00.000Z",
      sourceEventKey: "activity:activity-2",
    });

    const status = runtimeRepository.getSelectedProjectStatus();

    expect(status.subtasks).toHaveLength(1);
    expect(status.subtasks[0]?.activities).toEqual([
      expect.objectContaining({
        id: "activity-1",
        originator: "agent",
        agentMessaged: {
          agentMessage: "Need the repo root clarified.",
        },
      }),
      expect.objectContaining({
        id: "activity-2",
        originator: "user",
        userMessaged: {
          userMessage: "Repo root is /workspace/activity-projection.",
        },
      }),
    ]);
  });
});
