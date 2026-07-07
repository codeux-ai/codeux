import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { RunEventWrites } from "../../../src/repositories/project-runtime/run-event-writes.js";
import { ProjectRuntimeRepository } from "../../../src/repositories/project-runtime-repository.js";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  storage: AppDbStorage;
  executionRepository: ExecutionRepository;
  projectRepository: ProjectManagementRepository;
  runtimeRepository: ProjectRuntimeRepository;
  realtimeNotifier: {
    scheduleProjectLiveRefresh: ReturnType<typeof vi.fn>;
    scheduleProjectRuntimeStatusRefresh: ReturnType<typeof vi.fn>;
  };
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-runtime-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const realtimeNotifier = {
    scheduleProjectLiveRefresh: vi.fn(),
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
  it("rolls back transaction on error", async () => {
    const { projectRepository, runtimeRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Transaction Test Project",
      sourceType: "local",
      sourceRef: "/workspace/tx-project",
    });

    const sprint = projectRepository.createSprint(project.id, {
      name: "TX Sprint",
      number: 1,
    });

    // Trigger rollback via throw inside runInTransaction
    const db = (runtimeRepository as any).db;
    const originalExec = db.exec.bind(db);
    db.exec = (sql: string) => {
      if (sql === "COMMIT") throw new Error("Mock rollback");
      originalExec(sql);
    };

    try {
      expect(() => {
        runtimeRepository.syncDashboardStatus({
          project_id: project.id,
          sprint_id: sprint.id,
          subtasks: [],
          status: "AWAITING_PLAN_APPROVAL",
        });
      }).toThrow("Mock rollback");
    } finally {
      db.exec = originalExec;
    }
  });

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

    const db = storage.getDatabase().getRawDatabase();
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
    const eventRows = db.prepare(`
      SELECT tre.project_id, tre.event_type, tre.originator
      FROM task_run_events tre
      INNER JOIN task_runs tr ON tr.id = tre.task_run_id
      WHERE tr.task_id = ?
      ORDER BY tre.created_at ASC
    `).all(taskA.id) as Array<{ project_id: string | null; event_type: string; originator: string | null }>;
    expect(eventRows).toEqual([
      {
        project_id: project.id,
        event_type: "status_sync",
        originator: "system",
      },
    ]);

    const storedProject = projectRepository.getProject(project.id);
    expect(storedProject?.status).toBe("running");
    expect(realtimeNotifier.scheduleProjectRuntimeStatusRefresh).toHaveBeenCalledWith(project.id);
  });

  it("does not churn status sync events for code-complete tasks persisted as completed runs", async () => {
    const { storage, projectRepository, runtimeRepository } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Runtime Stable Project",
      sourceType: "local",
      sourceRef: "/workspace/runtime-stable",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Stable Sprint",
      number: 9,
      status: "running",
    });
    projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T01",
      title: "Merge pending worker",
      promptMarkdown: "Produce branch work.",
      status: "coding_completed",
    });

    const payload = {
      project_id: project.id,
      sprint_id: sprint.id,
      sprint_number: 9,
      repo_path: "/workspace/runtime-stable",
      feature_branch: "feature/stable",
      subtasks: [
        {
          id: "T01",
          title: "Merge pending worker",
          prompt: "Produce branch work.",
          depends_on: [],
          is_independent: true,
          status: "CODING_COMPLETED" as const,
          session_id: "cli-mockup-terminal",
          session_name: "sessions/cli-mockup-terminal",
          session_state: "COMPLETED",
          provider: "mockup-cli" as const,
          worker_branch: "task/feature/stable-t01",
          is_merged: false,
        },
      ],
    };

    runtimeRepository.syncDashboardStatus(payload);
    runtimeRepository.syncDashboardStatus(payload);

    const db = storage.getDatabase().getRawDatabase();
    const runRows = db.prepare(`
      SELECT state, worker_branch
      FROM task_runs
    `).all() as Array<{ state: string; worker_branch: string | null }>;
    expect(runRows).toEqual([
      {
        state: "COMPLETED",
        worker_branch: "task/feature/stable-t01",
      },
    ]);

    const eventCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM task_run_events
      WHERE event_type = 'status_sync'
    `).get() as { count: number };
    expect(eventCount.count).toBe(1);
  });

  it("deduplicates run events by source event key for the same task run", async () => {
    const { executionRepository, projectRepository, storage } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Runtime Event Project",
      sourceType: "local",
      sourceRef: "/workspace/runtime-events",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Runtime Event Sprint",
      number: 8,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "E01",
      title: "Write provider events",
      promptMarkdown: "Persist source-keyed events.",
      status: "in_progress",
    });
    const run = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      provider: "codex",
      state: "RUNNING",
      startedAt: "2026-07-06T10:00:00.000Z",
    });

    const writer = new RunEventWrites(storage.getDatabase());
    const firstInserted = writer.insertRunEvent({
      taskRunId: run.id,
      eventType: "provider_activity",
      originator: "agent",
      payload: { activityId: "activity-1", preview: "First copy" },
      sourceEventKey: "activity:activity-1",
      createdAt: "2026-07-06T10:01:00.000Z",
    });
    const duplicateInserted = writer.insertRunEvent({
      taskRunId: run.id,
      eventType: "provider_activity",
      originator: "agent",
      payload: { activityId: "activity-1", preview: "Duplicate copy" },
      sourceEventKey: "activity:activity-1",
      createdAt: "2026-07-06T10:02:00.000Z",
    });

    expect(firstInserted).toBe(true);
    expect(duplicateInserted).toBe(false);
    const eventRows = storage.getDatabase().getRawDatabase().prepare(`
      SELECT project_id, source_event_key, payload_json
      FROM task_run_events
      WHERE task_run_id = ?
    `).all(run.id) as Array<{ project_id: string | null; source_event_key: string | null; payload_json: string | null }>;

    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]).toMatchObject({
      project_id: project.id,
      source_event_key: "activity:activity-1",
    });
    expect(JSON.parse(eventRows[0].payload_json || "{}")).toMatchObject({
      preview: "First copy",
    });
  });

  it("does not create task runs for status-only dependency blockers", async () => {
    const { storage, projectRepository, runtimeRepository } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Blocked DAG Project",
      sourceType: "local",
      sourceRef: "/workspace/blocked-dag",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Blocked DAG Sprint",
      number: 12,
    });
    const rootTask = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T01",
      title: "Root task",
      promptMarkdown: "Complete first.",
      status: "completed",
      isIndependent: true,
    });
    const dependentTask = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T02",
      title: "Dependent task",
      promptMarkdown: "Wait for root.",
      status: "pending",
      dependsOnTaskIds: [rootTask.id],
    });

    runtimeRepository.syncDashboardStatus({
      project_id: project.id,
      sprint_id: sprint.id,
      sprint_number: 12,
      subtasks: [
        {
          id: "T02",
          record_id: dependentTask.id,
          title: "Dependent task",
          prompt: "Wait for root.",
          depends_on: ["T01"],
          is_independent: false,
          status: "BLOCKED",
        },
      ],
      reportText: "T02 is waiting for dependencies.",
    });

    const runRows = storage.getDatabase().getRawDatabase().prepare(`
      SELECT task_id, state
      FROM task_runs
      WHERE task_id = ?
    `).all(dependentTask.id) as Array<{ task_id: string; state: string }>;

    expect(runRows).toEqual([]);
  });

  it("does not reopen a completed provider run when stale dashboard status is running with completed session evidence", async () => {
    const { storage, projectRepository, runtimeRepository, executionRepository } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Completed CI Project",
      sourceType: "local",
      sourceRef: "/workspace/completed-ci",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Completed CI Sprint",
      number: 24,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T10",
      title: "Remove React type leakage",
      promptMarkdown: "Remove React type leakage.",
      status: "coding_completed",
      isIndependent: true,
      mergeIndicator: "CI",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      provider: "jules",
      state: "COMPLETED",
      sessionId: "completed-session",
      sessionName: "sessions/completed-session",
      workerBranch: "fix/preact-type-consistency-completed-session",
      prUrl: "https://github.com/numnx/codeuxweb/pull/256",
      startedAt: "2026-06-28T07:51:10.011Z",
      finishedAt: "2026-06-28T08:27:38.000Z",
    });

    runtimeRepository.syncDashboardStatus({
      project_id: project.id,
      sprint_id: sprint.id,
      sprint_number: 24,
      subtasks: [
        {
          id: "T10",
          record_id: task.id,
          title: task.title,
          prompt: task.promptMarkdown,
          depends_on: [],
          is_independent: true,
          status: "RUNNING",
          session_state: "COMPLETED",
          session_id: "completed-session",
          session_name: "sessions/completed-session",
          provider: "jules",
          worker_branch: "fix/preact-type-consistency-completed-session",
          pr_url: "https://github.com/numnx/codeuxweb/pull/256",
          merge_indicator: "CI",
        },
      ],
      reportText: "Task is waiting on CI.",
    });

    expect(projectRepository.getTask(task.id)?.status).toBe("coding_completed");
    const runRows = storage.getDatabase().getRawDatabase().prepare(`
      SELECT state, session_id, pr_url, finished_at
      FROM task_runs
      WHERE task_id = ?
      ORDER BY rowid DESC
    `).all(task.id) as Array<{ state: string; session_id: string | null; pr_url: string | null; finished_at: string | null }>;
    expect(runRows).toHaveLength(1);
    expect(runRows[0]).toMatchObject({
      state: "COMPLETED",
      session_id: "completed-session",
      pr_url: "https://github.com/numnx/codeuxweb/pull/256",
      finished_at: "2026-06-28T08:27:38.000Z",
    });
  });

  it("preserves active sprint-run status when dashboard snapshots have no running subtasks", async () => {
    const { executionRepository, projectRepository, runtimeRepository } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Active Runtime Project",
      sourceType: "local",
      sourceRef: "/workspace/active-runtime",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Active Runtime Sprint",
      number: 27,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T01",
      title: "Wait for merge gate",
      promptMarkdown: "Complete the task and wait for the merge gate.",
      status: "coding_completed",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      startedAt: "2026-07-06T08:00:00.000Z",
      lastHeartbeatAt: "2026-07-06T08:05:00.000Z",
    });

    runtimeRepository.syncDashboardStatus({
      project_id: project.id,
      sprint_id: sprint.id,
      sprint_number: 27,
      subtasks: [
        {
          id: "T01",
          record_id: task.id,
          title: task.title,
          prompt: task.promptMarkdown,
          depends_on: [],
          is_independent: true,
          status: "CODING_COMPLETED",
          merge_indicator: "CI",
        },
      ],
      reportText: "Task is waiting on merge gates.",
    });

    expect(projectRepository.getSprint(sprint.id)?.status).toBe("running");
    expect(projectRepository.getProject(project.id)?.status).toBe("running");

    executionRepository.updateSprintRun(sprintRun.id, {
      status: "paused",
      lastHeartbeatAt: "2026-07-06T08:06:00.000Z",
    });

    runtimeRepository.syncDashboardStatus({
      project_id: project.id,
      sprint_id: sprint.id,
      sprint_number: 27,
      subtasks: [
        {
          id: "T01",
          record_id: task.id,
          title: task.title,
          prompt: task.promptMarkdown,
          depends_on: [],
          is_independent: true,
          status: "CODING_COMPLETED",
          merge_indicator: "CI",
        },
      ],
      reportText: "Sprint is paused while the task waits on merge gates.",
    });

    expect(projectRepository.getSprint(sprint.id)?.status).toBe("paused");
  });

  it("preserves an existing task run PR URL when same-session status sync omits PR metadata", async () => {
    const { executionRepository, projectRepository, runtimeRepository, storage } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Runtime PR Project",
      sourceType: "local",
      sourceRef: "/workspace/runtime-pr",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Runtime PR Sprint",
      number: 25,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T02",
      title: "Keep PR URL",
      promptMarkdown: "Create a PR.",
      status: "coding_completed",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      provider: "opencode",
      state: "COMPLETED",
      sessionId: "cli-opencode-existing",
      sessionName: "sessions/cli-opencode-existing",
      workerBranch: "task/runtime-pr-t02",
      prUrl: "https://github.com/example/repo/pull/42",
      startedAt: "2026-07-03T10:00:00.000Z",
      finishedAt: "2026-07-03T10:01:00.000Z",
    });

    runtimeRepository.syncDashboardStatus({
      project_id: project.id,
      sprint_id: sprint.id,
      sprint_number: 25,
      subtasks: [
        {
          id: "T02",
          record_id: task.id,
          title: task.title,
          prompt: task.promptMarkdown,
          depends_on: [],
          is_independent: true,
          status: "CODING_COMPLETED",
          session_id: "cli-opencode-existing",
          session_name: "sessions/cli-opencode-existing",
          provider: "opencode",
          worker_branch: "task/runtime-pr-t02",
        },
      ],
      reportText: "Task is waiting on QA.",
    });

    const runRows = storage.getDatabase().getRawDatabase().prepare(`
      SELECT state, session_id, worker_branch, pr_url
      FROM task_runs
      WHERE task_id = ?
      ORDER BY rowid DESC
    `).all(task.id) as Array<{ state: string; session_id: string | null; worker_branch: string | null; pr_url: string | null }>;
    expect(runRows).toHaveLength(1);
    expect(runRows[0]).toMatchObject({
      state: "COMPLETED",
      session_id: "cli-opencode-existing",
      worker_branch: "task/runtime-pr-t02",
      pr_url: "https://github.com/example/repo/pull/42",
    });
  });

  it("does not create a new task_run every cycle for a guardrail-blocked task (idempotent terminal sync)", async () => {
    const { projectRepository, runtimeRepository, storage } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Spin",
      sourceType: "local",
      sourceRef: "/workspace/spin",
    });
    const sprint = projectRepository.createSprint(project.id, { name: "Spin Sprint", number: 1 });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T01",
      title: "Capped task",
      promptMarkdown: "Do work.",
      status: "pending",
      isIndependent: true,
    });

    // A guardrail-capped task syncs as BLOCKED with a provider but no session id.
    // BLOCKED is terminal, so its run has finished_at set; without idempotent
    // matching this would INSERT a fresh run on every watch-loop cycle.
    const subtask = {
      id: "T01",
      record_id: task.id,
      title: "Capped task",
      prompt: "Do work.",
      depends_on: [] as string[],
      is_independent: true,
      status: "BLOCKED" as const,
      provider: "claude-code" as const,
    };
    for (let cycle = 0; cycle < 5; cycle++) {
      runtimeRepository.syncDashboardStatus({
        project_id: project.id,
        sprint_id: sprint.id,
        sprint_number: 1,
        subtasks: [subtask],
        reportText: "blocked",
      });
    }

    const runRows = storage.getDatabase().getRawDatabase().prepare(`
      SELECT state FROM task_runs WHERE task_id = ?
    `).all(task.id) as Array<{ state: string }>;

    expect(runRows).toHaveLength(1);
    expect(runRows[0].state).toBe("BLOCKED");
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

  it("rejects provider session and PR artifacts already owned by another project task", async () => {
    const { executionRepository, projectRepository, runtimeRepository, storage } = await createRepositories();

    const sourceProject = projectRepository.createProject({
      name: "Code UX Fork",
      sourceType: "local",
      sourceRef: "/workspace/codeux-fork",
    });
    const sourceSprint = projectRepository.createSprint(sourceProject.id, {
      name: "Source Sprint",
      number: 4,
    });
    const sourceTask = projectRepository.createTask(sourceProject.id, {
      sprintId: sourceSprint.id,
      taskKey: "T02",
      title: "Foreign task",
      status: "completed",
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
      sourceRef: "/workspace/codeux-cc",
    });
    const currentSprint = projectRepository.createSprint(currentProject.id, {
      name: "Improve Projects Page",
      number: 4,
    });
    const currentTask = projectRepository.createTask(currentProject.id, {
      sprintId: currentSprint.id,
      taskKey: "T02",
      title: "Fix local new-project creation",
      status: "pending",
    });

    runtimeRepository.syncDashboardStatus({
      project_id: currentProject.id,
      sprint_id: currentSprint.id,
      sprint_number: 4,
      feature_branch: "feature/CODUXC-4-improve-projects-page",
      subtasks: [
        {
          id: "T02",
          record_id: currentTask.id,
          project_id: currentProject.id,
          sprint_id: currentSprint.id,
          title: "Fix local new-project creation",
          prompt: "Do the current sprint work.",
          depends_on: [],
          is_independent: true,
          status: "CODING_COMPLETED",
          provider: "jules",
          session_id: "foreign-session",
          session_name: "sessions/foreign-session",
          pr_url: "https://github.com/numnx/codeux/pull/106",
        },
      ],
    });

    const persistedTask = projectRepository.getTask(currentTask.id);
    expect(persistedTask?.status).toBe("pending");

    const leakedRuns = storage.getDatabase().getRawDatabase().prepare(`
      SELECT id
      FROM task_runs
      WHERE project_id = ? AND sprint_id = ? AND task_id = ?
    `).all(currentProject.id, currentSprint.id, currentTask.id);
    expect(leakedRuns).toEqual([]);

    const status = runtimeRepository.getProjectStatus(currentProject.id, currentSprint.id);
    expect(status.subtasks[0]).toMatchObject({
      id: "T02",
      status: "PENDING",
    });
    expect(status.subtasks[0].provider).toBeUndefined();
    expect(status.subtasks[0].session_id).toBeUndefined();
    expect(status.subtasks[0].pr_url).toBeUndefined();
  });

  it("resolves live project status from the most recent active sprint instead of a stale selected sprint", async () => {
    const { executionRepository, projectRepository, runtimeRepository } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Parallel Live Project",
      sourceType: "local",
      sourceRef: "/workspace/parallel-live",
    });

    const olderSprint = projectRepository.createSprint(project.id, { name: "Older Sprint", number: 26 });
    const currentSprint = projectRepository.createSprint(project.id, { name: "Current Sprint", number: 64 });
    const olderTask = projectRepository.createTask(project.id, {
      sprintId: olderSprint.id,
      taskKey: "OLD",
      title: "Older live task",
      status: "in_progress",
    });
    const currentTask = projectRepository.createTask(project.id, {
      sprintId: currentSprint.id,
      taskKey: "CUR",
      title: "Current live task",
      status: "in_progress",
    });

    runtimeRepository.syncDashboardStatus({
      project_id: project.id,
      sprint_id: olderSprint.id,
      sprint_number: 26,
      feature_branch: "feature/sprint-26",
      subtasks: [
        { id: "OLD", title: "Older live task", status: "RUNNING", record_id: olderTask.id, depends_on: [] },
      ],
      reportText: "Older sprint still active",
      timestamp: "2026-03-30T05:40:00.000Z",
    });
    runtimeRepository.syncDashboardStatus({
      project_id: project.id,
      sprint_id: currentSprint.id,
      sprint_number: 64,
      feature_branch: "feature/sprint-64",
      subtasks: [
        { id: "CUR", title: "Current live task", status: "RUNNING", record_id: currentTask.id, depends_on: [] },
      ],
      reportText: "Current sprint should drive live status",
      timestamp: "2026-03-30T05:56:00.000Z",
    });

    const olderRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: olderSprint.id,
      status: "running",
    });
    executionRepository.updateSprintRun(olderRun.id, {
      status: "running",
      startedAt: "2026-03-30T05:40:00.000Z",
      lastHeartbeatAt: "2026-03-30T05:48:00.000Z",
    });
    const currentRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: currentSprint.id,
      status: "running",
    });
    executionRepository.updateSprintRun(currentRun.id, {
      status: "running",
      startedAt: "2026-03-30T05:50:00.000Z",
      lastHeartbeatAt: "2026-03-30T05:56:00.000Z",
    });

    projectRepository.setSelectedProjectId(project.id);
    projectRepository.setSelectedSprintId(project.id, olderSprint.id);

    const selectedStatus = runtimeRepository.getSelectedProjectStatus();
    expect(selectedStatus.sprint_id).toBe(olderSprint.id);
    expect(selectedStatus.reportText).toBe("Older sprint still active");

    const liveStatus = runtimeRepository.getSelectedProjectLiveStatus();
    expect(liveStatus.sprint_id).toBe(currentSprint.id);
    expect(liveStatus.sprint_number).toBe(64);
    expect(liveStatus.feature_branch).toBe("feature/sprint-64");
    expect(liveStatus.reportText).toBe("Current sprint should drive live status");
    expect(liveStatus.subtasks).toHaveLength(1);
    expect(liveStatus.subtasks[0].id).toBe("CUR");
  });

  it("does not reuse legacy project-level runtime context for an explicit sprint", async () => {
    const { storage, projectRepository, runtimeRepository } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Scoped Runtime Project",
      sourceType: "local",
      sourceRef: "/workspace/scoped-runtime",
    });
    const olderSprint = projectRepository.createSprint(project.id, { name: "Older Sprint", number: 26 });
    const currentSprint = projectRepository.createSprint(project.id, { name: "Current Sprint", number: 89 });
    projectRepository.createTask(project.id, {
      sprintId: currentSprint.id,
      taskKey: "CUR",
      title: "Current task",
      status: "pending",
    });

    storage.getDatabase().prepare(`
      INSERT INTO app_settings (key, payload, updated_at)
      VALUES (?, ?, ?)
    `).run(
      `runtime_context:${project.id}`,
      JSON.stringify({
        projectId: project.id,
        sprintId: olderSprint.id,
        sprintNumber: 26,
        sourceId: null,
        repoPath: "/workspace/scoped-runtime",
        featureBranch: "feature/sprint-26",
        reportText: "stale",
        statusTable: "",
        instructions: "",
        timestamp: "2026-03-30T05:40:00.000Z",
      }),
      "2026-03-30T05:40:00.000Z",
    );

    const status = runtimeRepository.getProjectStatus(project.id, currentSprint.id);
    expect(status.sprint_id).toBe(currentSprint.id);
    expect(status.feature_branch).toBeUndefined();
    expect(status.sprint_number).toBeUndefined();
    expect(status.reportText).toBeUndefined();
    expect(status.subtasks).toHaveLength(1);
    expect(status.subtasks[0].id).toBe("CUR");
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

  it("does not resurrect a worker-resolved merge conflict from a stale sprint snapshot", async () => {
    const { projectRepository, runtimeRepository, storage } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Resolved Conflict Project",
      sourceType: "local",
      sourceRef: "/workspace/resolved-conflict",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Resolved Conflict Sprint",
      number: 31,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T01",
      title: "Merge once",
      promptMarkdown: "Resolve a conflict.",
      status: "coding_completed",
      mergeIndicator: "MERGE_CONFLICT",
    });

    const now = "2026-07-07T12:00:00.000Z";
    storage.getDatabase().getRawDatabase().prepare(`
      INSERT INTO project_attention_items (
        id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id,
        attention_type, severity, owner_type, status, assigned_worker_endpoint_id,
        title, summary_markdown, payload_json, opened_at, claimed_at, resolved_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      "resolved-conflict-attention",
      project.id,
      sprint.id,
      task.id,
      "merge_conflict",
      "high",
      "worker",
      "resolved",
      "Merge conflict for T01",
      "Virtual worker resolved this conflict.",
      JSON.stringify({
        resolutionReason: "virtual_worker_merge_conflict_already_resolved",
        conflictingBranches: {
          source: "task/resolved-conflict-t01",
          target: "feature/resolved-conflict",
        },
      }),
      now,
      now,
      now,
    );

    runtimeRepository.syncDashboardStatus({
      project_id: project.id,
      sprint_id: sprint.id,
      sprint_number: 31,
      feature_branch: "feature/resolved-conflict",
      subtasks: [
        {
          id: "T01",
          record_id: task.id,
          title: "Merge once",
          prompt: "Resolve a conflict.",
          depends_on: [],
          status: "CODING_COMPLETED",
          worker_branch: "task/resolved-conflict-t01",
          merge_indicator: "MERGE_CONFLICT",
        },
      ],
      reportText: "Stale cycle still had the old conflict marker.",
    });

    expect(projectRepository.getTask(task.id)?.mergeIndicator).toBeNull();
  });
});
