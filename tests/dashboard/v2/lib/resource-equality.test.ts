
import { describe, expect, it } from 'vitest';
import type {
  ExecutionUsageTotals,
  ProjectExecutionStatsSnapshot,
} from '../../../../dashboard/src/types.js';
import {
  isEqualProjectStatsSnapshot,
  isEqualUsageTotals,
  stabilizeProjectsResponse,
  stabilizeProjectStatsSnapshot,
  isDeepEqual
} from '../../../../dashboard/src/v2/lib/resource-equality.js';

type StatsEntity = ProjectExecutionStatsSnapshot['tasks'][number];

function createUsage(overrides: Partial<ExecutionUsageTotals> = {}): ExecutionUsageTotals {
  return {
    invocationCount: 4,
    activeTimeMs: 4_000,
    wallTimeMs: 5_000,
    inputTokens: 1_000,
    cachedInputTokens: 200,
    outputTokens: 500,
    reasoningOutputTokens: 100,
    totalTokens: 1_500,
    inputCostUsd: 0.01,
    outputCostUsd: 0.02,
    cachedInputCostUsd: 0.001,
    totalCostUsd: 0.031,
    toolCallCount: 2,
    reportedInvocationCount: 4,
    estimatedInvocationCount: 0,
    unavailableInvocationCount: 0,
    unsupportedInvocationCount: 0,
    costCoverage: {
      configuredPricingInvocationCount: 3,
      providerReportedCostInvocationCount: 1,
      unpricedInvocationCount: 0,
      providerReportedCostUsd: 0.004,
    },
    ...overrides,
  };
}

function createEntity(id: string, totalCostUsd: number): StatsEntity {
  return {
    id,
    label: `Entity ${id}`,
    secondaryLabel: null,
    status: 'completed',
    purpose: 'coding',
    provider: 'codex',
    lastActivityAt: '2026-07-14T10:00:00.000Z',
    usage: createUsage({ totalCostUsd }),
  };
}

function createSnapshot(): ProjectExecutionStatsSnapshot {
  return {
    projectId: 'project-1',
    projectName: 'Test project',
    window: '7d',
    query: { window: '7d' },
    range: {
      window: '7d',
      label: 'Last 7 days',
      resolution: 'day',
      resolutionLabel: 'Daily',
      from: '2026-07-08T00:00:00.000Z',
      to: '2026-07-14T23:59:59.999Z',
      bucketCount: 7,
      isCustom: false,
    },
    generatedAt: '2026-07-14T10:00:00.000Z',
    usage: createUsage(),
    costAnalytics: { sprints: [createEntity('canonical-sprint-1', 0.031)] },
    git: {
      totals: { insertions: 3, deletions: 1, filesChanged: 1, prCount: 1, mergedCount: 1, mergeConflictCount: 0 },
      buckets: [],
      tasks: [],
      sprints: [],
    },
    mergeConflictCount: 0,
    activeSprint: { sprintId: 'sprint-1', sprintName: 'Sprint 1', sprintNumber: 1 },
    buckets: [{
      bucketStart: '2026-07-14T00:00:00.000Z',
      bucketEnd: '2026-07-15T00:00:00.000Z',
      label: 'Jul 14',
      usage: createUsage(),
    }],
    sprints: [createEntity('sprint-run-1', 0.031)],
    tasks: [createEntity('task-1', 0.02), createEntity('task-2', 0.011)],
    providers: [createEntity('codex', 0.031)],
    purposes: [createEntity('coding', 0.031)],
    models: [{
      id: 'codex\u0000gpt-5',
      provider: 'codex',
      model: 'gpt-5',
      label: 'Codex / GPT-5',
      usage: createUsage(),
      statusCounts: { completed: 4, failed: 0, cancelled: 0, running: 0, paused: 0 },
      successRate: 1,
      duration: { sampleCount: 4, avgMs: 1_000, p50Ms: 900, p95Ms: 1_400, maxMs: 1_500 },
      lastActivityAt: '2026-07-14T10:00:00.000Z',
    }],
    statusCounts: { completed: 4, failed: 0, cancelled: 0, running: 0, paused: 0 },
    duration: { sampleCount: 4, avgMs: 1_000, p50Ms: 900, p95Ms: 1_400, maxMs: 1_500 },
    tokenSources: [{ source: 'reported', count: 4 }],
    chartSeries: [
      { id: 'cost', label: 'Cost', grouping: 'cost', defaultEnabled: true, data: [0.031], formatter: 'number' },
      { id: 'tokens', label: 'Tokens', grouping: 'tokens', defaultEnabled: true, data: [1_500], formatter: 'tokens' },
    ],
  };
}

describe('Resource Equality Stabilization', () => {
  describe('stabilizeProjectsResponse', () => {
    it('returns new structure if project array order changes but preserves references', () => {
      const p1 = { id: 'p1', slug: 'p1', name: 'Project 1', status: 'active', openTasks: 1, completedTasks: 0, isRunning: true, updatedAt: '2023-01-01', sprintsCount: 1, agentBindings: {}, settingsOverrides: {} };
      const p2 = { id: 'p2', slug: 'p2', name: 'Project 2', status: 'idle', openTasks: 0, completedTasks: 0, isRunning: false, updatedAt: '2023-01-01', sprintsCount: 0, agentBindings: {}, settingsOverrides: {} };

      const prev = {
        selectedProjectId: 'p1',
        projects: [p1, p2]
      };

      const next = {
        selectedProjectId: 'p1',
        projects: [{...p2}, {...p1}]
      };

      const stabilized = stabilizeProjectsResponse(prev as any, next as any);

      expect(stabilized).toBe(prev);
    });

    it('returns new structure if order changes and an item changes', () => {
      const p1 = { id: 'p1', slug: 'p1', name: 'Project 1', status: 'active', openTasks: 1, completedTasks: 0, isRunning: true, updatedAt: '2023-01-01', sprintsCount: 1, agentBindings: {}, settingsOverrides: {} };
      const p2 = { id: 'p2', slug: 'p2', name: 'Project 2', status: 'idle', openTasks: 0, completedTasks: 0, isRunning: false, updatedAt: '2023-01-01', sprintsCount: 0, agentBindings: {}, settingsOverrides: {} };

      const prev = {
        selectedProjectId: 'p1',
        projects: [p1, p2]
      };

      const p2Changed = { ...p2, openTasks: 5 };
      const next = {
        selectedProjectId: 'p1',
        projects: [p2Changed, {...p1}]
      };

      const stabilized = stabilizeProjectsResponse(prev as any, next as any);

      expect(stabilized).not.toBe(prev);
      expect(stabilized.projects[0]).toBe(p2Changed);
      expect(stabilized.projects[1]).toBe(p1);
    });

    it('returns prev if nothing changed and order is same', () => {
      const p1 = { id: 'p1', slug: 'p1', name: 'Project 1', status: 'active', openTasks: 1, completedTasks: 0, isRunning: true, updatedAt: '2023-01-01', sprintsCount: 1, agentBindings: {}, settingsOverrides: {} };

      const prev = {
        selectedProjectId: 'p1',
        projects: [p1]
      };

      const next = {
        selectedProjectId: 'p1',
        projects: [{...p1}]
      };

      const stabilized = stabilizeProjectsResponse(prev as any, next as any);

      expect(stabilized).toBe(prev);
    });

    it('replaces changed projects', () => {
      const p1 = { id: 'p1', slug: 'p1', name: 'Project 1', status: 'active', openTasks: 1, completedTasks: 0, isRunning: true, updatedAt: '2023-01-01', sprintsCount: 1, agentBindings: {}, settingsOverrides: {} };
      const p2 = { id: 'p2', slug: 'p2', name: 'Project 2', status: 'idle', openTasks: 0, completedTasks: 0, isRunning: false, updatedAt: '2023-01-01', sprintsCount: 0, agentBindings: {}, settingsOverrides: {} };

      const prev = {
        selectedProjectId: 'p1',
        projects: [p1, p2]
      };

      const p2Changed = { ...p2, openTasks: 5 };
      const next = {
        selectedProjectId: 'p1',
        projects: [{...p1}, p2Changed]
      };

      const stabilized = stabilizeProjectsResponse(prev as any, next as any);

      expect(stabilized).not.toBe(prev);
      expect(stabilized.projects[0]).toBe(p1);
      expect(stabilized.projects[1]).toBe(p2Changed);
    });
  });

  describe('stabilizeProjectStatsSnapshot', () => {
    it('returns refreshed data for a cost-only aggregate change', () => {
      const prev = createSnapshot();
      const next = createSnapshot();
      next.generatedAt = '2026-07-14T10:01:00.000Z';
      next.usage = { ...next.usage, totalCostUsd: 0.041 };

      const stabilized = stabilizeProjectStatsSnapshot(prev, next)!;

      expect(isEqualProjectStatsSnapshot(prev, next)).toBe(false);
      expect(stabilized).not.toBe(prev);
      expect(stabilized.usage).toBe(next.usage);
      expect(stabilized.usage.totalCostUsd).toBe(0.041);
      expect(stabilized.buckets).toBe(prev.buckets);
      expect(stabilized.models).toBe(prev.models);
      expect(stabilized.costAnalytics).toBe(prev.costAnalytics);
    });

    it('returns refreshed canonical sprint cost analytics', () => {
      const prev = createSnapshot();
      const next = createSnapshot();
      next.costAnalytics!.sprints[0].usage.totalCostUsd = 0.05;

      const stabilized = stabilizeProjectStatsSnapshot(prev, next)!;

      expect(stabilized).not.toBe(prev);
      expect(stabilized.costAnalytics).not.toBe(prev.costAnalytics);
      expect(stabilized.costAnalytics!.sprints[0]).not.toBe(prev.costAnalytics!.sprints[0]);
      expect(stabilized.costAnalytics!.sprints[0].usage.totalCostUsd).toBe(0.05);
      expect(stabilized.sprints).toBe(prev.sprints);
    });

    it('returns refreshed model and purpose costs while retaining stable nested telemetry', () => {
      const prev = createSnapshot();
      const next = createSnapshot();
      next.models[0].usage.totalCostUsd = 0.04;
      next.purposes[0].usage.totalCostUsd = 0.04;

      const stabilized = stabilizeProjectStatsSnapshot(prev, next)!;

      expect(stabilized.models).not.toBe(prev.models);
      expect(stabilized.models[0].usage.totalCostUsd).toBe(0.04);
      expect(stabilized.models[0].statusCounts).toBe(prev.models[0].statusCounts);
      expect(stabilized.models[0].duration).toBe(prev.models[0].duration);
      expect(stabilized.purposes).not.toBe(prev.purposes);
      expect(stabilized.purposes[0].usage.totalCostUsd).toBe(0.04);
      expect(stabilized.tasks).toBe(prev.tasks);
    });

    it('returns refreshed cost chart data and preserves unchanged series references', () => {
      const prev = createSnapshot();
      const next = createSnapshot();
      next.chartSeries[0].data = [0.05];

      const stabilized = stabilizeProjectStatsSnapshot(prev, next)!;

      expect(stabilized.chartSeries).not.toBe(prev.chartSeries);
      expect(stabilized.chartSeries[0]).toBe(next.chartSeries[0]);
      expect(stabilized.chartSeries[0].data).toEqual([0.05]);
      expect(stabilized.chartSeries[1]).toBe(prev.chartSeries[1]);
    });

    it('propagates status and duration telemetry changes', () => {
      const prev = createSnapshot();
      const statusNext = createSnapshot();
      statusNext.statusCounts.failed = 1;

      const statusStabilized = stabilizeProjectStatsSnapshot(prev, statusNext)!;
      expect(statusStabilized).not.toBe(prev);
      expect(statusStabilized.statusCounts).toBe(statusNext.statusCounts);
      expect(statusStabilized.duration).toBe(prev.duration);

      const durationNext = createSnapshot();
      durationNext.duration.p95Ms = 2_000;
      const durationStabilized = stabilizeProjectStatsSnapshot(prev, durationNext)!;
      expect(durationStabilized).not.toBe(prev);
      expect(durationStabilized.duration).toBe(durationNext.duration);
    });

    it('reuses the previous snapshot and all references when only generatedAt changes', () => {
      const prev = createSnapshot();
      const next = createSnapshot();
      next.generatedAt = '2026-07-14T10:01:00.000Z';

      expect(isEqualProjectStatsSnapshot(prev, next)).toBe(true);
      expect(stabilizeProjectStatsSnapshot(prev, next)).toBe(prev);
    });

    it('preserves keyed entity references when an entity array is reordered', () => {
      const prev = createSnapshot();
      const next = createSnapshot();
      next.tasks = [next.tasks[1], next.tasks[0]];

      const stabilized = stabilizeProjectStatsSnapshot(prev, next)!;

      expect(stabilized).not.toBe(prev);
      expect(stabilized.tasks).not.toBe(prev.tasks);
      expect(stabilized.tasks[0]).toBe(prev.tasks[1]);
      expect(stabilized.tasks[1]).toBe(prev.tasks[0]);
    });

    it('keeps snapshots without optional cost analytics compatible', () => {
      const prev = createSnapshot();
      const next = createSnapshot();
      delete prev.costAnalytics;
      delete next.costAnalytics;

      expect(stabilizeProjectStatsSnapshot(prev, next)).toBe(prev);

      next.costAnalytics = { sprints: [] };
      expect(isEqualProjectStatsSnapshot(prev, next)).toBe(false);
    });
  });

  describe('isEqualUsageTotals', () => {
    it.each([
      'inputCostUsd',
      'outputCostUsd',
      'cachedInputCostUsd',
      'totalCostUsd',
    ] as const)('detects a %s-only change', (field) => {
      const prev = createUsage();
      const next = { ...prev, [field]: prev[field] + 0.01 };
      expect(isEqualUsageTotals(prev, next)).toBe(false);
    });

    it.each([
      'configuredPricingInvocationCount',
      'providerReportedCostInvocationCount',
      'unpricedInvocationCount',
      'providerReportedCostUsd',
    ] as const)('detects a cost coverage %s-only change', (field) => {
      const prev = createUsage();
      const next = {
        ...prev,
        costCoverage: {
          ...prev.costCoverage!,
          [field]: prev.costCoverage![field] + 1,
        },
      };
      expect(isEqualUsageTotals(prev, next)).toBe(false);
    });

    it('does not equate unknown cost coverage with proven full coverage', () => {
      const withCoverage = createUsage({
        costCoverage: {
          configuredPricingInvocationCount: 4,
          providerReportedCostInvocationCount: 0,
          unpricedInvocationCount: 0,
          providerReportedCostUsd: 0,
        },
      });
      const { costCoverage: _unknownCoverage, ...withoutCoverage } = withCoverage;

      expect(isEqualUsageTotals(withoutCoverage as ExecutionUsageTotals, withCoverage)).toBe(false);
      expect(isEqualUsageTotals(withoutCoverage as ExecutionUsageTotals, { ...withoutCoverage } as ExecutionUsageTotals)).toBe(true);
    });
  });
});
