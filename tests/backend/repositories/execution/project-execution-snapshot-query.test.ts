import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { queryProjectExecutionSnapshot } from '../../../../src/repositories/execution/project-execution-snapshot-query.js';
import { DatabaseAdapter } from '../../../../src/repositories/db/database-adapter.js';
import { AppDbStorage } from '../../../../src/repositories/app-db-storage.js';

vi.mock('../../../../src/repositories/execution/execution-sprint-runs-query.js', () => ({
  queryExecutionSprintRuns: vi.fn(() => ({ sprintRuns: [], expandedSprintRunIds: [] }))
}));
vi.mock('../../../../src/repositories/execution/execution-task-dispatches-query.js', () => ({
  queryExecutionTaskDispatches: vi.fn(() => [])
}));
vi.mock('../../../../src/repositories/execution/execution-runtime-events-query.js', () => ({
  queryExecutionRuntimeEvents: vi.fn(() => [])
}));
vi.mock('../../../../src/repositories/execution/execution-invocations-query.js', () => ({
  queryProjectExecutionSnapshotInvocations: vi.fn(() => [])
}));
vi.mock('../../../../src/repositories/execution/execution-human-intervention-query.js', () => ({
  buildHumanInterventionSummaryBySprintRun: vi.fn(() => new Map()),
  listActiveAttentionRowsForProject: vi.fn(() => [])
}));
vi.mock('../../../../src/repositories/execution/execution-sprint-workflow-projection-query.js', () => ({
  queryExecutionSprintWorkflowProjections: vi.fn(() => [])
}));
vi.mock('../../../../src/repositories/execution/execution-usage-query.js', () => ({
  withWallTime: vi.fn((usage, wallTime) => ({ ...usage, wallTime }))
}));
vi.mock('../../../../src/repositories/execution/execution-read-model-mappers.js', () => ({
  mapExecutionSprintRunSummaryRow: vi.fn((row) => row),
  mapExecutionTaskDispatchSummaryRow: vi.fn((row) => row),
  mapExecutionRuntimeEventSummaryRow: vi.fn((row) => row)
}));

describe('queryProjectExecutionSnapshot', () => {
  let mockDb: any;
  let mockStorage: any;
  let mockDeps: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      prepare: vi.fn(() => ({
        get: vi.fn(() => ({ id: 'proj-1', name: 'Project 1' }))
      }))
    };
    mockStorage = {} as AppDbStorage;
    mockDeps = {
      getWallTimeTotalsByTaskIds: vi.fn(() => new Map()),
      getWallTimeTotalsBySprintRunIds: vi.fn(() => new Map()),
      getUsageTotalsByTaskIds: vi.fn(() => new Map()),
      getUsageTotalsBySprintRunIds: vi.fn(() => new Map())
    };
  });

  it('should call deps with deduplicated sprintRunIds and taskIds', async () => {
    const sprintRuns = [{ id: 'sprint-1' }, { id: 'sprint-1' }, { id: 'sprint-2' }];
    const taskDispatches = [{ task_id: 'task-1' }, { task_id: 'task-2' }, { task_id: 'task-1' }];

    const { queryExecutionSprintRuns } = await import('../../../../src/repositories/execution/execution-sprint-runs-query.js');
    const { queryExecutionTaskDispatches } = await import('../../../../src/repositories/execution/execution-task-dispatches-query.js');

    (queryExecutionSprintRuns as any).mockReturnValueOnce({ sprintRuns, expandedSprintRunIds: [] });
    (queryExecutionTaskDispatches as any).mockReturnValueOnce(taskDispatches);

    queryProjectExecutionSnapshot(mockDb as DatabaseAdapter, mockStorage, 'proj-1', mockDeps);

    expect(mockDeps.getUsageTotalsBySprintRunIds).toHaveBeenCalledWith('proj-1', ['sprint-1', 'sprint-2']);
    expect(mockDeps.getUsageTotalsByTaskIds).toHaveBeenCalledWith('proj-1', ['task-1', 'task-2']);
    expect(mockDeps.getWallTimeTotalsBySprintRunIds).toHaveBeenCalledWith(
      'proj-1',
      ['sprint-1', 'sprint-2'],
      expect.any(String)
    );
    expect(mockDeps.getWallTimeTotalsByTaskIds).toHaveBeenCalledWith(
      'proj-1',
      ['task-1', 'task-2'],
      expect.any(String)
    );
  });

  it('should not call dependencies if sprintRuns or taskDispatches are empty', async () => {
    queryProjectExecutionSnapshot(mockDb as DatabaseAdapter, mockStorage, 'proj-1', mockDeps);

    expect(mockDeps.getUsageTotalsBySprintRunIds).not.toHaveBeenCalled();
    expect(mockDeps.getUsageTotalsByTaskIds).not.toHaveBeenCalled();
    expect(mockDeps.getWallTimeTotalsBySprintRunIds).not.toHaveBeenCalled();
    expect(mockDeps.getWallTimeTotalsByTaskIds).not.toHaveBeenCalled();
  });

  it('should include bounded recent invocations in the execution snapshot', async () => {
    const { queryProjectExecutionSnapshotInvocations } = await import('../../../../src/repositories/execution/execution-invocations-query.js');
    const invocation = {
      id: 'xi-live',
      projectId: 'proj-1',
      type: 'cli_task_coding',
      status: 'running',
      messageCount: 2,
      startedAt: '2024-01-01T10:00:00.000Z',
      createdAt: '2024-01-01T10:00:00.000Z',
      updatedAt: '2024-01-01T10:01:00.000Z',
    };
    (queryProjectExecutionSnapshotInvocations as any).mockReturnValueOnce([invocation]);

    const snapshot = queryProjectExecutionSnapshot(mockDb as DatabaseAdapter, mockStorage, 'proj-1', mockDeps);

    expect(queryProjectExecutionSnapshotInvocations).toHaveBeenCalledWith(mockDb, {
      projectId: 'proj-1',
      sprintRunIds: [],
      selectedSprintId: undefined,
    });
    expect(snapshot.recentInvocations).toEqual([invocation]);
  });

  it('includes durable sprint workflow projections independently of bounded feeds', async () => {
    const { queryExecutionSprintWorkflowProjections } = await import(
      '../../../../src/repositories/execution/execution-sprint-workflow-projection-query.js'
    );
    const projection = {
      sprintId: 'sprint-1',
      planningStatus: 'running',
      humanIntervention: null,
    };
    (queryExecutionSprintWorkflowProjections as any).mockReturnValueOnce([projection]);

    const snapshot = queryProjectExecutionSnapshot(mockDb as DatabaseAdapter, mockStorage, 'proj-1', mockDeps);

    expect(queryExecutionSprintWorkflowProjections).toHaveBeenCalledWith(mockDb, 'proj-1');
    expect(snapshot.sprintWorkflowProjections).toEqual([projection]);
  });

  it('merges selected sprint and expanded run invocations into the live feed', async () => {
    const { queryExecutionSprintRuns } = await import('../../../../src/repositories/execution/execution-sprint-runs-query.js');
    const { queryExecutionRuntimeEvents } = await import('../../../../src/repositories/execution/execution-runtime-events-query.js');
    const { queryProjectExecutionSnapshotInvocations } = await import('../../../../src/repositories/execution/execution-invocations-query.js');
    const sprintRuns = [{ id: 'run-active' }, { id: 'run-paused' }];

    const makeInvocation = (id: string, startedAt: string) => ({
      id,
      projectId: 'proj-1',
      type: 'cli_task_coding',
      status: 'completed',
      messageCount: 1,
      startedAt,
      createdAt: startedAt,
      updatedAt: startedAt,
    });

    const activeRunInvocation = makeInvocation('xi-active-run', '2024-01-01T10:02:00.000Z');
    const projectRecentInvocation = makeInvocation('xi-project-recent', '2024-01-01T10:01:00.000Z');
    const selectedSprintInvocation = makeInvocation('xi-selected-sprint', '2024-01-01T09:00:00.000Z');

    (queryExecutionSprintRuns as any).mockReturnValueOnce({
      sprintRuns,
      expandedSprintRunIds: ['run-active', 'run-paused'],
    });
    (queryProjectExecutionSnapshotInvocations as any)
      .mockReturnValueOnce([activeRunInvocation, projectRecentInvocation, selectedSprintInvocation]);

    const snapshot = queryProjectExecutionSnapshot(
      mockDb as DatabaseAdapter,
      mockStorage,
      'proj-1',
      mockDeps,
      { selectedSprintId: 'sprint-paused' },
    );

    expect(queryProjectExecutionSnapshotInvocations).toHaveBeenCalledWith(mockDb, {
      projectId: 'proj-1',
      sprintRunIds: ['run-active', 'run-paused'],
      selectedSprintId: 'sprint-paused',
    });
    expect(queryExecutionRuntimeEvents).toHaveBeenCalledWith(
      mockDb,
      mockStorage,
      'proj-1',
      ['run-active', 'run-paused'],
      'sprint-paused',
    );
    expect(snapshot.recentInvocations.map((invocation: any) => invocation.id)).toEqual([
      'xi-active-run',
      'xi-project-recent',
      'xi-selected-sprint',
    ]);
  });
});

const tempDirs: string[] = [];

async function createStorage(): Promise<AppDbStorage> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-project-execution-snapshot-"));
  tempDirs.push(dir);
  return new AppDbStorage(path.join(dir, "app.db"));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function timestamp(minute: number): string {
  return `2026-01-01T10:${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}.000Z`;
}

async function importRealSnapshotQuery(): Promise<typeof import("../../../../src/repositories/execution/project-execution-snapshot-query.js")> {
  vi.resetModules();
  vi.doUnmock("../../../../src/repositories/execution/execution-sprint-runs-query.js");
  vi.doUnmock("../../../../src/repositories/execution/execution-task-dispatches-query.js");
  vi.doUnmock("../../../../src/repositories/execution/execution-runtime-events-query.js");
  vi.doUnmock("../../../../src/repositories/execution/execution-invocations-query.js");
  vi.doUnmock("../../../../src/repositories/execution/execution-human-intervention-query.js");
  vi.doUnmock("../../../../src/repositories/execution/execution-sprint-workflow-projection-query.js");
  vi.doUnmock("../../../../src/repositories/execution/execution-usage-query.js");
  vi.doUnmock("../../../../src/repositories/execution/execution-read-model-mappers.js");
  return import("../../../../src/repositories/execution/project-execution-snapshot-query.js");
}

function seedSnapshotProject(storage: AppDbStorage): void {
  const db = storage.getDatabase();
  db.prepare(`
    INSERT INTO projects (id, slug, name, base_dir, created_at, updated_at)
    VALUES
      ('project-1', 'project-1', 'Project 1', '/tmp/project-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('project-2', 'project-2', 'Project 2', '/tmp/project-2', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO sprints (id, project_id, number, slug, name, status, created_at, updated_at)
    VALUES
      ('sprint-active', 'project-1', 1, 'active', 'Active sprint', 'running', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('sprint-selected', 'project-1', 2, 'selected', 'Selected sprint', 'paused', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('sprint-old', 'project-1', 3, 'old', 'Old sprint', 'completed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('sprint-foreign', 'project-2', 1, 'foreign', 'Foreign sprint', 'running', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `).run();
  const insertRun = db.prepare(`
    INSERT INTO sprint_runs (
      id, project_id, sprint_id, status, trigger_type, executor_mode,
      started_at, last_heartbeat_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'dashboard', 'mixed', ?, ?, ?, ?)
  `);
  for (let i = 0; i < 14; i += 1) {
    const at = timestamp(120 - i);
    insertRun.run(`run-active-${String(i).padStart(2, "0")}`, "project-1", "sprint-active", "running", at, at, at, at);
  }
  insertRun.run("run-selected-old", "project-1", "sprint-selected", "completed", timestamp(1), timestamp(1), timestamp(1), timestamp(1));
  insertRun.run("run-old", "project-1", "sprint-old", "completed", timestamp(0), timestamp(0), timestamp(0), timestamp(0));
  insertRun.run("run-foreign", "project-2", "sprint-foreign", "running", timestamp(130), timestamp(130), timestamp(130), timestamp(130));
}

function seedDispatchesAndEvents(storage: AppDbStorage): void {
  const db = storage.getDatabase();
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, project_id, sprint_id, task_key, title, prompt_markdown, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'Do work', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `);
  const insertDispatch = db.prepare(`
    INSERT INTO task_dispatches (
      id, project_id, sprint_id, task_id, sprint_run_id, executor_type, status,
      priority, queued_at, claimed_at, started_at, last_heartbeat_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'docker_cli', 'running', ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTaskRun = db.prepare(`
    INSERT INTO task_runs (id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id, provider, state, started_at)
    VALUES (?, ?, ?, ?, ?, ?, 'codex', 'running', ?)
  `);
  const insertEvent = db.prepare(`
    INSERT INTO task_run_events (id, task_run_id, project_id, event_type, originator, created_at)
    VALUES (?, ?, ?, 'provider_activity', 'system', ?)
  `);

  for (let i = 0; i < 130; i += 1) {
    const suffix = String(i).padStart(3, "0");
    const at = timestamp(200 - i);
    insertTask.run(`task-active-${suffix}`, "project-1", "sprint-active", `T-${suffix}`, `Task ${suffix}`);
    insertDispatch.run(
      `dispatch-active-${suffix}`,
      "project-1",
      "sprint-active",
      `task-active-${suffix}`,
      "run-active-00",
      200 - i,
      at,
      at,
      at,
      at,
      at,
      at,
    );
    insertTaskRun.run(
      `task-run-active-${suffix}`,
      "project-1",
      "sprint-active",
      `task-active-${suffix}`,
      "run-active-00",
      `dispatch-active-${suffix}`,
      at,
    );
    insertEvent.run(`event-active-${suffix}`, `task-run-active-${suffix}`, "project-1", at);
  }

  insertTask.run("task-selected", "project-1", "sprint-selected", "T-selected", "Selected task");
  insertTaskRun.run(
    "task-run-selected",
    "project-1",
    "sprint-selected",
    "task-selected",
    "run-selected-old",
    null,
    timestamp(2),
  );
  insertEvent.run("event-selected-old", "task-run-selected", "project-1", timestamp(2));

  insertTask.run("task-foreign", "project-2", "sprint-foreign", "T-foreign", "Foreign task");
  insertDispatch.run(
    "dispatch-foreign",
    "project-2",
    "sprint-foreign",
    "task-foreign",
    "run-foreign",
    500,
    timestamp(250),
    timestamp(250),
    timestamp(250),
    timestamp(250),
    timestamp(250),
    timestamp(250),
  );
  insertTaskRun.run("task-run-foreign", "project-2", "sprint-foreign", "task-foreign", "run-foreign", "dispatch-foreign", timestamp(250));
  insertEvent.run("event-foreign", "task-run-foreign", "project-2", timestamp(250));
}

function seedInvocationsAndAttention(storage: AppDbStorage): void {
  const db = storage.getDatabase();
  const insertInvocation = db.prepare(`
    INSERT INTO execution_invocations (
      id, project_id, sprint_id, sprint_run_id, type, status, provider,
      started_at, message_count, invocation_source, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'cli_task_coding', 'completed', 'codex', ?, 1, 'internal', ?, ?)
  `);
  for (let i = 0; i < 30; i += 1) {
    const at = timestamp(300 - i);
    insertInvocation.run(`inv-active-${String(i).padStart(2, "0")}`, "project-1", "sprint-active", "run-active-00", at, at, at);
  }
  insertInvocation.run("inv-selected-old", "project-1", "sprint-selected", "run-selected-old", timestamp(3), timestamp(3), timestamp(3));
  insertInvocation.run("inv-foreign", "project-2", "sprint-foreign", "run-foreign", timestamp(400), timestamp(400), timestamp(400));

  const insertAttention = db.prepare(`
    INSERT INTO project_attention_items (
      id, project_id, sprint_id, sprint_run_id, attention_type, severity, owner_type, status,
      title, summary_markdown, opened_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'merge_required', 'medium', 'human', 'open', ?, ?, ?, ?)
  `);
  for (let i = 0; i < 130; i += 1) {
    const at = timestamp(500 - i);
    insertAttention.run(`attention-active-${String(i).padStart(3, "0")}`, "project-1", "sprint-active", "run-active-00", `Attention ${i}`, `Attention ${i}`, at, at);
  }
  insertAttention.run("attention-foreign", "project-2", "sprint-foreign", "run-foreign", "Foreign attention", "Foreign attention", timestamp(600), timestamp(600));
}

describe("queryProjectExecutionSnapshot SQL contract", () => {
  it("keeps live snapshot slices scoped, deduplicated, and capped with older unrelated rows present", async () => {
    const storage = await createStorage();
    try {
      seedSnapshotProject(storage);
      seedDispatchesAndEvents(storage);
      seedInvocationsAndAttention(storage);
      const { queryProjectExecutionSnapshot: realQueryProjectExecutionSnapshot } = await importRealSnapshotQuery();

      const deps = {
        getWallTimeTotalsByTaskIds: vi.fn(() => new Map<string, number>()),
        getWallTimeTotalsBySprintRunIds: vi.fn(() => new Map<string, number>()),
        getUsageTotalsByTaskIds: vi.fn(() => new Map()),
        getUsageTotalsBySprintRunIds: vi.fn(() => new Map()),
      };

      const snapshot = realQueryProjectExecutionSnapshot(
        storage.getDatabase(),
        storage,
        "project-1",
        deps,
        { selectedSprintId: "sprint-selected" },
      );

      expect(snapshot.projectId).toBe("project-1");
      expect(snapshot.sprintRuns).toHaveLength(12);
      expect(snapshot.sprintRuns.map((run) => run.id)).toEqual(
        Array.from({ length: 12 }, (_, i) => `run-active-${String(i).padStart(2, "0")}`),
      );
      expect(snapshot.sprintRuns.map((run) => run.id)).not.toContain("run-foreign");

      const taskDispatchIds = snapshot.taskDispatches.map((dispatch) => dispatch.id);
      expect(snapshot.taskDispatches).toHaveLength(120);
      expect(taskDispatchIds).toContain("dispatch-active-000");
      expect(taskDispatchIds).toContain("dispatch-active-119");
      expect(taskDispatchIds).not.toContain("dispatch-active-120");
      expect(taskDispatchIds).not.toContain("dispatch-foreign");
      expect(new Set(taskDispatchIds).size).toBe(taskDispatchIds.length);

      const eventIds = snapshot.recentEvents.map((event) => event.id);
      expect(eventIds).toContain("event-selected-old");
      expect(eventIds.filter((id) => id.startsWith("event-active-"))).toHaveLength(120);
      expect(eventIds).not.toContain("event-active-120");
      expect(eventIds).not.toContain("event-foreign");
      expect(new Set(eventIds).size).toBe(eventIds.length);

      const invocationIds = snapshot.recentInvocations.map((invocation) => invocation.id);
      expect(invocationIds).toHaveLength(25);
      expect(invocationIds).toContain("inv-selected-old");
      expect(invocationIds.filter((id) => id.startsWith("inv-active-"))).toHaveLength(24);
      expect(invocationIds).not.toContain("inv-active-24");
      expect(invocationIds).not.toContain("inv-foreign");
      expect(new Set(invocationIds).size).toBe(invocationIds.length);

      expect(deps.getUsageTotalsBySprintRunIds).toHaveBeenCalledWith(
        "project-1",
        Array.from({ length: 12 }, (_, i) => `run-active-${String(i).padStart(2, "0")}`),
      );
      expect(deps.getUsageTotalsByTaskIds.mock.calls[0]?.[1]).toHaveLength(120);
    } finally {
      storage.close();
    }
  });
});
