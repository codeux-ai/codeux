import { describe, expect, it } from "vitest";
import {
  stabilizeProjectsResponse,
  stabilizeProjectStatsSnapshot,
  type ProjectsResponse,
  type Source,
} from "../../../dashboard/src/v2/lib/resource-equality.js";
import type { ProjectExecutionStatsSnapshot, ExecutionUsageTotals } from "../../../src/contracts/app-types.js";

describe("resource-equality reference stability", () => {
  describe("stabilizeProjectsResponse", () => {
    it("retains references for unchanged projects even if reordered", () => {
      const p1: Source = { id: "p1", name: "Project 1", slug: "p1", status: "active", openTasks: 0, completedTasks: 0, isRunning: false, updatedAt: "2026-06-13T10:00:00Z", sprintsCount: 1, agentBindings: {}, settingsOverrides: {} } as any;
      const p2: Source = { id: "p2", name: "Project 2", slug: "p2", status: "active", openTasks: 0, completedTasks: 0, isRunning: false, updatedAt: "2026-06-13T10:00:00Z", sprintsCount: 1, agentBindings: {}, settingsOverrides: {} } as any;

      const prev: ProjectsResponse = {
        projects: [p1, p2],
        selectedProjectId: "p1",
      };

      // Reordered and new objects but semantically identical
      const p1Next = { ...p1 };
      const p2Next = { ...p2 };
      const next: ProjectsResponse = {
        projects: [p2Next, p1Next],
        selectedProjectId: "p1",
      };

      const stabilized = stabilizeProjectsResponse(prev, next);

      expect(stabilized.projects[0]).toBe(p2); // Reference from prev
      expect(stabilized.projects[1]).toBe(p1); // Reference from prev
      expect(stabilized).not.toBe(next); // New container because order changed
      expect(stabilized.projects).not.toBe(next.projects);
    });

    it("replaces reference for changed project", () => {
      const p1: Source = { id: "p1", name: "Project 1", slug: "p1", status: "active", openTasks: 0, completedTasks: 0, isRunning: false, updatedAt: "2026-06-13T10:00:00Z", sprintsCount: 1, agentBindings: {}, settingsOverrides: {} } as any;
      const prev: ProjectsResponse = {
        projects: [p1],
        selectedProjectId: "p1",
      };

      const p1Next = { ...p1, name: "Project 1 Updated" };
      const next: ProjectsResponse = {
        projects: [p1Next],
        selectedProjectId: "p1",
      };

      const stabilized = stabilizeProjectsResponse(prev, next);

      expect(stabilized.projects[0]).toBe(p1Next);
      expect(stabilized.projects[0]).not.toBe(p1);
    });
  });

  describe("stabilizeProjectStatsSnapshot", () => {
    it("stabilizes nested entities using Map lookup", () => {
      const usage: ExecutionUsageTotals = { invocationCount: 10 } as any;
      const sprint1 = { id: "s1", label: "Sprint 1", usage: { ...usage } } as any;
      const prev: ProjectExecutionStatsSnapshot = {
        projectId: "p1",
        usage: { ...usage },
        sprints: [sprint1],
        tasks: [],
        providers: [],
        purposes: [],
        tokenSources: [],
        buckets: [],
      } as any;

      const usageNext = { ...usage, invocationCount: 11 }; // Main usage changed
      const next: ProjectExecutionStatsSnapshot = {
        ...prev,
        usage: usageNext,
        sprints: [{ ...sprint1 }], // Sprint semantically identical but new object
      } as any;

      const stabilized = stabilizeProjectStatsSnapshot(prev, next);

      expect(stabilized).not.toBe(prev);
      expect(stabilized!.usage).toBe(usageNext);
      expect(stabilized!.sprints![0]).toBe(sprint1); // Retained reference
    });
  });
});
