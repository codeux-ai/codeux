import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { queryProjectExecutionSnapshot } from '../../../../src/repositories/execution/project-execution-snapshot-query.js';
import { DatabaseAdapter } from '../../../../src/repositories/db/database-adapter.js';
import { AppDbStorage } from '../../../../src/repositories/app-db-storage.js';
import { APP_DB_SCHEMA_TABLES } from '../../../../src/repositories/db/app-db-schema.js';
import { SqliteDatabaseAdapter } from '../../../../src/repositories/db/sqlite-database-adapter.js';

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
  queryExecutionInvocations: vi.fn(() => [])
}));
vi.mock('../../../../src/repositories/execution/execution-human-intervention-query.js', () => ({
  buildHumanInterventionSummaryBySprintRun: vi.fn(() => new Map()),
  listActiveAttentionRowsForProject: vi.fn(() => [])
}));
vi.mock('../../../../src/repositories/execution/execution-usage-query.js', () => ({
  withWallTime: vi.fn((usage, wallTime) => ({ ...usage, wallTime }))
}));
vi.mock('../../../../src/repositories/execution/execution-read-model-mappers.js', () => ({
  mapExecutionSprintRunSummaryRow: vi.fn((row) => row),
  mapExecutionTaskDispatchSummaryRow: vi.fn((row) => row),
  mapExecutionRuntimeEventSummaryRow: vi.fn((row) => row)
}));

const LIVE_SNAPSHOT_INDEX_COLUMNS = new Map<string, string[]>([
  ["idx_sprint_runs_project_sprint_status_created", ["project_id", "sprint_id", "status", "created_at"]],
  ["idx_sprint_runs_project_status_updated", ["project_id", "status", "updated_at", "created_at"]],
  ["idx_task_dispatches_project_sprint_run", ["project_id", "sprint_run_id"]],
  ["idx_task_dispatches_project_sprint", ["project_id", "sprint_id"]],
  ["idx_sprint_run_events_sprint_run_created_id", ["sprint_run_id", "created_at", "id"]],
]);

function indexColumns(db: DatabaseAdapter, indexName: string): string[] {
  const rows = db.prepare(`PRAGMA index_info(${indexName})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function indexSql(db: DatabaseAdapter, indexName: string): string | undefined {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName) as { sql?: string } | undefined;
  return row?.sql;
}

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

  it('creates live execution snapshot indexes in fresh databases', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-snapshot-schema-"));
    const adapter = new SqliteDatabaseAdapter(path.join(dir, "app.db"));

    try {
      adapter.exec(APP_DB_SCHEMA_TABLES);

      for (const [indexName, columns] of LIVE_SNAPSHOT_INDEX_COLUMNS) {
        expect(indexColumns(adapter, indexName)).toEqual(columns);
      }
      expect(indexSql(adapter, "idx_sprint_runs_project_sprint_status_created")).toContain("created_at DESC");
      expect(indexSql(adapter, "idx_sprint_runs_project_status_updated")).toContain("updated_at DESC");
      expect(indexSql(adapter, "idx_sprint_run_events_sprint_run_created_id")).toContain("id DESC");
    } finally {
      adapter.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
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
    const { queryExecutionInvocations } = await import('../../../../src/repositories/execution/execution-invocations-query.js');
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
    (queryExecutionInvocations as any).mockReturnValueOnce([invocation]);

    const snapshot = queryProjectExecutionSnapshot(mockDb as DatabaseAdapter, mockStorage, 'proj-1', mockDeps);

    expect(queryExecutionInvocations).toHaveBeenCalledWith(mockDb, { projectId: 'proj-1', limit: 24 });
    expect(snapshot.recentInvocations).toEqual([invocation]);
  });

  it('merges selected sprint and expanded run invocations into the live feed', async () => {
    const { queryExecutionSprintRuns } = await import('../../../../src/repositories/execution/execution-sprint-runs-query.js');
    const { queryExecutionInvocations } = await import('../../../../src/repositories/execution/execution-invocations-query.js');
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
    (queryExecutionInvocations as any)
      .mockReturnValueOnce([projectRecentInvocation])
      .mockReturnValueOnce([activeRunInvocation, projectRecentInvocation])
      .mockReturnValueOnce([selectedSprintInvocation]);

    const snapshot = queryProjectExecutionSnapshot(
      mockDb as DatabaseAdapter,
      mockStorage,
      'proj-1',
      mockDeps,
      { selectedSprintId: 'sprint-paused' },
    );

    expect(queryExecutionInvocations).toHaveBeenNthCalledWith(1, mockDb, { projectId: 'proj-1', limit: 24 });
    expect(queryExecutionInvocations).toHaveBeenNthCalledWith(2, mockDb, {
      projectId: 'proj-1',
      sprintRunIds: ['run-active', 'run-paused'],
      limit: null,
    });
    expect(queryExecutionInvocations).toHaveBeenNthCalledWith(3, mockDb, {
      projectId: 'proj-1',
      sprintId: 'sprint-paused',
      limit: null,
    });
    expect(snapshot.recentInvocations.map((invocation: any) => invocation.id)).toEqual([
      'xi-active-run',
      'xi-project-recent',
      'xi-selected-sprint',
    ]);
  });
});
