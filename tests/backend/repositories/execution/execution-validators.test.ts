import { describe, expect, it, beforeEach } from "vitest";
import {
  requireProject,
  requireSprint,
  requireTask,
  requireConnection,
  requireSprintRun,
  requireSprintRunScoped,
  requireTaskDispatch,
  requireTaskRun,
  requireProviderInvocationUsage,
  requireLease
} from "../../../../src/repositories/execution/execution-validators.js";
import { DatabaseAdapter } from "../../../../src/repositories/db/database-adapter.js";
import type {
  ExecutionLeaseRecord,
  ProviderInvocationUsageRecord,
  SprintRunRecord,
  TaskDispatchRecord,
  TaskRunRecord
} from "../../../../src/contracts/execution-types.js";

// Mock DatabaseAdapter
class MockDatabaseAdapter {
  constructor(private results: Record<string, any>) {}
  prepare(sql: string) {
    return {
      get: (...args: any[]) => this.results[sql.trim()] || this.results["default"],
      all: (...args: any[]) => [],
      run: (...args: any[]) => ({ changes: 1, lastInsertRowid: 1 })
    };
  }
}

describe("execution-validators", () => {
  describe("requireProject", () => {
    it("throws if project not found", () => {
      const db = new MockDatabaseAdapter({ "default": undefined }) as unknown as DatabaseAdapter;
      expect(() => requireProject(db, "proj-1")).toThrow("Project not found: proj-1");
    });
    it("returns void if project found", () => {
      const db = new MockDatabaseAdapter({ "default": { id: "proj-1" } }) as unknown as DatabaseAdapter;
      expect(() => requireProject(db, "proj-1")).not.toThrow();
    });
  });

  describe("requireSprint", () => {
    it("throws if sprint not found", () => {
      const db = new MockDatabaseAdapter({ "default": undefined }) as unknown as DatabaseAdapter;
      expect(() => requireSprint(db, "sprint-1")).toThrow("Sprint not found: sprint-1");
    });
    it("throws if sprint does not belong to project", () => {
      const db = new MockDatabaseAdapter({ "default": { id: "sprint-1", project_id: "other-proj" } }) as unknown as DatabaseAdapter;
      expect(() => requireSprint(db, "sprint-1", "proj-1")).toThrow("Sprint sprint-1 does not belong to project proj-1");
    });
    it("returns void if sprint found and belongs to project", () => {
      const db = new MockDatabaseAdapter({ "default": { id: "sprint-1", project_id: "proj-1" } }) as unknown as DatabaseAdapter;
      expect(() => requireSprint(db, "sprint-1", "proj-1")).not.toThrow();
    });
  });

  describe("requireTask", () => {
    it("throws if task not found", () => {
      const db = new MockDatabaseAdapter({ "default": undefined }) as unknown as DatabaseAdapter;
      expect(() => requireTask(db, "task-1")).toThrow("Task not found: task-1");
    });
    it("throws if task does not belong to project", () => {
      const db = new MockDatabaseAdapter({ "default": { id: "task-1", project_id: "other-proj", sprint_id: "sprint-1" } }) as unknown as DatabaseAdapter;
      expect(() => requireTask(db, "task-1", "proj-1")).toThrow("Task task-1 does not belong to project proj-1");
    });
    it("throws if task does not belong to sprint", () => {
      const db = new MockDatabaseAdapter({ "default": { id: "task-1", project_id: "proj-1", sprint_id: "other-sprint" } }) as unknown as DatabaseAdapter;
      expect(() => requireTask(db, "task-1", "proj-1", "sprint-1")).toThrow("Task task-1 does not belong to sprint sprint-1");
    });
    it("returns void if task found and matches project/sprint", () => {
      const db = new MockDatabaseAdapter({ "default": { id: "task-1", project_id: "proj-1", sprint_id: "sprint-1" } }) as unknown as DatabaseAdapter;
      expect(() => requireTask(db, "task-1", "proj-1", "sprint-1")).not.toThrow();
    });
  });

  describe("requireConnection", () => {
    it("throws if connection not found", () => {
      const db = new MockDatabaseAdapter({ "default": undefined }) as unknown as DatabaseAdapter;
      expect(() => requireConnection(db, "conn-1")).toThrow("Connection not found: conn-1");
    });
    it("returns void if connection found", () => {
      const db = new MockDatabaseAdapter({ "default": { id: "conn-1" } }) as unknown as DatabaseAdapter;
      expect(() => requireConnection(db, "conn-1")).not.toThrow();
    });
  });

  describe("requireSprintRun", () => {
    it("throws if sprint run not found", () => {
      expect(() => requireSprintRun(() => null, "run-1")).toThrow("Sprint run not found: run-1");
    });
    it("returns sprint run if found", () => {
      const run = { id: "run-1" } as SprintRunRecord;
      expect(requireSprintRun(() => run, "run-1")).toBe(run);
    });
  });

  describe("requireSprintRunScoped", () => {
    it("throws if sprint run does not belong to project/sprint", () => {
      const run = { id: "run-1", projectId: "other-proj", sprintId: "sprint-1" } as SprintRunRecord;
      expect(() => requireSprintRunScoped(() => run, "run-1", "proj-1", "sprint-1"))
        .toThrow("Sprint run run-1 does not belong to proj-1/sprint-1");
    });
    it("returns void if sprint run belongs to project/sprint", () => {
      const run = { id: "run-1", projectId: "proj-1", sprintId: "sprint-1" } as SprintRunRecord;
      expect(() => requireSprintRunScoped(() => run, "run-1", "proj-1", "sprint-1")).not.toThrow();
    });
  });

  describe("requireTaskDispatch", () => {
    it("throws if task dispatch not found", () => {
      expect(() => requireTaskDispatch(() => null, "disp-1")).toThrow("Task dispatch not found: disp-1");
    });
    it("returns task dispatch if found", () => {
      const dispatch = { id: "disp-1" } as TaskDispatchRecord;
      expect(requireTaskDispatch(() => dispatch, "disp-1")).toBe(dispatch);
    });
  });

  describe("requireTaskRun", () => {
    it("throws if task run not found", () => {
      expect(() => requireTaskRun(() => null, "tr-1")).toThrow("Task run not found: tr-1");
    });
    it("returns task run if found", () => {
      const taskRun = { id: "tr-1" } as TaskRunRecord;
      expect(requireTaskRun(() => taskRun, "tr-1")).toBe(taskRun);
    });
  });

  describe("requireProviderInvocationUsage", () => {
    it("throws if invocation not found", () => {
      expect(() => requireProviderInvocationUsage(() => null, "inv-1")).toThrow("Provider invocation not found: inv-1");
    });
    it("returns invocation if found", () => {
      const inv = { id: "inv-1" } as ProviderInvocationUsageRecord;
      expect(requireProviderInvocationUsage(() => inv, "inv-1")).toBe(inv);
    });
  });

  describe("requireLease", () => {
    it("throws if lease not found", () => {
      expect(() => requireLease(() => null, "sprint", "sprint-1")).toThrow("Execution lease not found: sprint:sprint-1");
    });
    it("returns lease if found", () => {
      const lease = { id: "lease-1" } as ExecutionLeaseRecord;
      expect(requireLease(() => lease, "sprint", "sprint-1")).toBe(lease);
    });
  });
});
