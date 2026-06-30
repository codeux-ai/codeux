
import { describe, expect, it } from 'vitest';
import {
  stabilizeProjectsResponse,
  stabilizeProjectStatsSnapshot,
  isDeepEqual
} from '../../../../dashboard/src/v2/lib/resource-equality.js';

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
    it('preserves unchanged entity summaries when arrays are modified or reordered', () => {
      const task1 = { id: 't1', label: 'Task 1', secondaryLabel: '', status: 'done', purpose: 'feat', provider: 'local', lastActivityAt: '2023', usage: { invocationCount: 1 } };
      const task2 = { id: 't2', label: 'Task 2', secondaryLabel: '', status: 'todo', purpose: 'fix', provider: 'local', lastActivityAt: '2023', usage: { invocationCount: 0 } };

      const prev = {
        projectId: 'p1',
        window: '7d',
        query: '',
        usage: { invocationCount: 1 },
        git: null,
        activeSprint: null,
        buckets: [],
        sprints: [],
        tasks: [task1, task2],
        providers: [],
        purposes: [],
        tokenSources: []
      };

      const task2Changed = { ...task2, status: 'in_progress' };
      const task3 = { id: 't3', label: 'Task 3', secondaryLabel: '', status: 'todo', purpose: 'docs', provider: 'local', lastActivityAt: '2023', usage: { invocationCount: 0 } };

      const next = {
        projectId: 'p1',
        window: '7d',
        query: '',
        usage: { invocationCount: 1 }, // unchanged
        git: null,
        activeSprint: null,
        buckets: [],
        sprints: [],
        tasks: [{...task2Changed}, {...task3}, {...task1}], // task1 is same, task2 changed, task3 new, order changed
        providers: [],
        purposes: [],
        tokenSources: []
      };

      const stabilized = stabilizeProjectStatsSnapshot(prev as any, next as any)!;

      expect(stabilized).not.toBe(prev);
      expect(stabilized.usage).toBe(prev.usage); // Usage reference preserved

      expect(stabilized.tasks).not.toBe(prev.tasks);
      expect(stabilized.tasks[0]).not.toBe(task2); // Modified
      expect(stabilized.tasks[0].id).toBe('t2');
      expect(stabilized.tasks[1].id).toBe('t3'); // New
      expect(stabilized.tasks[2]).toBe(task1); // Unchanged, reference preserved!
    });
  });
});
