import { describe, it, expect, vi } from "vitest";
import { planSessionActivityFetches } from "../../../../../src/domain/sprint/session-sync/activity-fetch-plan.js";
import { Subtask, JulesSession } from "../../../../../src/contracts/app-types.js";

import { buildTaskRunKey } from "../../../../../src/services/task-run-key.js";

describe("planSessionActivityFetches", () => {
  const mockContext: any = {
    repoPath: "test-repo",
    sprintNumber: 1,
    githubMode: "REMOTE",
  } as any;

  const mockDeps = {
    resolveSessionName: (session: JulesSession) => session.name || null,
    extractSessionId: (session: JulesSession) => session.id,
    logger: { warn: vi.fn() } as any,
  };

  const isForeignSessionMatch = vi.fn().mockReturnValue(false);

  it("should return empty array if no subtasks", () => {
    const result = planSessionActivityFetches([], new Map(), mockContext, mockDeps, isForeignSessionMatch);
    expect(result).toEqual([]);
  });

  it("should return empty array if no matching sessions", () => {
    const subtasks: Subtask[] = [{ id: "task1" } as Subtask];
    const result = planSessionActivityFetches(subtasks, new Map(), mockContext, mockDeps, isForeignSessionMatch);
    expect(result).toEqual([]);
  });

  it("should return unique session names for active matched sessions", () => {
    const subtasks: Subtask[] = [
      { id: "task1", record_id: "rec1" } as Subtask,
      { id: "task2", record_id: "rec2" } as Subtask,
      { id: "task3", record_id: "rec3" } as Subtask,
    ];

    const sessionMap = new Map<string, JulesSession>();

    const key1 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task1");
    sessionMap.set(key1, { id: "s1", name: "session1", state: "RUNNING" } as JulesSession);

    const key2 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task2");
    sessionMap.set(key2, { id: "s2", name: "session1", state: "RUNNING" } as JulesSession); // duplicate name

    const key3 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task3");
    sessionMap.set(key3, { id: "s3", name: "session2", state: "COMPLETED" } as JulesSession);

    const result = planSessionActivityFetches(subtasks, sessionMap, mockContext, mockDeps, isForeignSessionMatch);

    expect(result).toEqual(expect.arrayContaining(["session1", "session2"]));
    expect(result.length).toBe(2);
  });

  it("should ignore fully synced terminal sessions", () => {
    const subtasks: Subtask[] = [{ id: "task1", record_id: "rec1" } as Subtask];
    const sessionMap = new Map<string, JulesSession>();

    const key1 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task1");
    sessionMap.set(key1, { id: "s1", name: "session1", state: "COMPLETED" } as JulesSession);

    const isLocallyTerminal = vi.fn().mockImplementation((name, task) => {
        return name === "session1";
    });

    const result = planSessionActivityFetches(subtasks, sessionMap, mockContext, mockDeps, isForeignSessionMatch, isLocallyTerminal);

    expect(result).toEqual([]);
  });

  it("should include remotely terminal session if not fully synced locally", () => {
    const subtasks: Subtask[] = [{ id: "task1", record_id: "rec1" } as Subtask];
    const sessionMap = new Map<string, JulesSession>();

    const key1 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task1");
    sessionMap.set(key1, { id: "s1", name: "session1", state: "COMPLETED" } as JulesSession);

    const isLocallyTerminal = vi.fn().mockReturnValue(false);

    const result = planSessionActivityFetches(subtasks, sessionMap, mockContext, mockDeps, isForeignSessionMatch, isLocallyTerminal);

    expect(result).toEqual(["session1"]);
  });

  it("should include locally terminal session if not remotely terminal", () => {
    const subtasks: Subtask[] = [{ id: "task1", record_id: "rec1" } as Subtask];
    const sessionMap = new Map<string, JulesSession>();

    const key1 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task1");
    sessionMap.set(key1, { id: "s1", name: "session1", state: "RUNNING" } as JulesSession);

    const isLocallyTerminal = vi.fn().mockReturnValue(true);

    const result = planSessionActivityFetches(subtasks, sessionMap, mockContext, mockDeps, isForeignSessionMatch, isLocallyTerminal);

    expect(result).toEqual(["session1"]);
  });

  it("should skip foreign provider sessions", () => {
      const subtasks: Subtask[] = [{ id: "task1", record_id: "rec1" } as Subtask];
      const sessionMap = new Map<string, JulesSession>();

      const key1 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task1");
      sessionMap.set(key1, { id: "s1", name: "session1", state: "RUNNING" } as JulesSession);

      const localIsForeignSessionMatch = vi.fn().mockReturnValue(true);

      const result = planSessionActivityFetches(subtasks, sessionMap, mockContext, mockDeps, localIsForeignSessionMatch);

      expect(result).toEqual([]);
      expect(mockDeps.logger.warn).toHaveBeenCalledWith(
        "Skipping foreign provider session matched by task run key",
        expect.any(Object)
      );
  });
});
