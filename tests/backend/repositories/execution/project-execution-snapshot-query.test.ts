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

  it('should pass empty array when no sprintRuns or taskDispatches to dependencies, or handle properly if dependencies are empty calls', async () => {
    queryProjectExecutionSnapshot(mockDb as DatabaseAdapter, mockStorage, 'proj-1', mockDeps);

    expect(mockDeps.getUsageTotalsBySprintRunIds).toHaveBeenCalledWith('proj-1', []);
    expect(mockDeps.getUsageTotalsByTaskIds).toHaveBeenCalledWith('proj-1', []);
    expect(mockDeps.getWallTimeTotalsBySprintRunIds).toHaveBeenCalledWith(
      'proj-1',
      [],
      expect.any(String)
    );
    expect(mockDeps.getWallTimeTotalsByTaskIds).toHaveBeenCalledWith(
      'proj-1',
      [],
      expect.any(String)
    );
  });
});
