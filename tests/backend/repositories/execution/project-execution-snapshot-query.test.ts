import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('merges selected sprint and expanded run invocations into the live feed', async () => {
    const { queryExecutionSprintRuns } = await import('../../../../src/repositories/execution/execution-sprint-runs-query.js');
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
    expect(snapshot.recentInvocations.map((invocation: any) => invocation.id)).toEqual([
      'xi-active-run',
      'xi-project-recent',
      'xi-selected-sprint',
    ]);
  });
});
