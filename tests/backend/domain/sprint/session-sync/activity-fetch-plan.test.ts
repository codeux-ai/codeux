import { beforeEach, describe, it, expect, vi } from "vitest";
import { planSessionActivityFetches } from "../../../../../src/domain/sprint/session-sync/activity-fetch-plan.js";
import { Subtask, JulesSession } from "../../../../../src/contracts/app-types.js";
import { buildTaskRunKey } from "../../../../../src/services/task-run-key.js";

describe("planSessionActivityFetches", () => {
  const mockContext = {
    repoPath: "test-repo",
    sprintNumber: 1,
    githubMode: "REMOTE",
  } as const;

  const mockDeps = {
    logger: { warn: vi.fn() } as any,
  };
  const mockSessionMetadataLookup = {
    getForSession: (session: JulesSession) => ({
      sessionId: session.id || null,
      sessionName: session.name || null,
    }),
  };

  let isForeignSessionMatch = vi.fn().mockReturnValue(false);

  beforeEach(() => {
    mockDeps.logger.warn.mockClear();
    isForeignSessionMatch = vi.fn().mockReturnValue(false);
  });

  it("should return empty array if no subtasks", () => {
    const result = planSessionActivityFetches([], new Map(), mockContext, mockSessionMetadataLookup, mockDeps.logger, isForeignSessionMatch);
    expect(result).toEqual([]);
  });

  it("should return empty array if no matching sessions", () => {
    const subtasks: Subtask[] = [{ id: "task1" } as Subtask];
    const result = planSessionActivityFetches(subtasks, new Map(), mockContext, mockSessionMetadataLookup, mockDeps.logger, isForeignSessionMatch);
    expect(result).toEqual([]);
  });

  it("should return unique session names for active matched sessions with duplicate task-run keys", () => {
    const subtasks: Subtask[] = [
      { id: "task1", record_id: "rec1" } as Subtask,
      { id: "task1", record_id: "rec1-duplicate" } as Subtask,
      { id: "task2", record_id: "rec2" } as Subtask,
    ];

    const sessionMap = new Map<string, JulesSession>();

    const key1 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task1");
    sessionMap.set(key1, { id: "s1", name: "session1", state: "RUNNING" } as JulesSession);

    const key2 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task2");
    sessionMap.set(key2, { id: "s2", name: "session2", state: "COMPLETED" } as JulesSession);

    const result = planSessionActivityFetches(subtasks, sessionMap, mockContext, mockSessionMetadataLookup, mockDeps.logger, isForeignSessionMatch);

    expect(result).toEqual(expect.arrayContaining(["session1", "session2"]));
    expect(result.length).toBe(2);
  });

  it("should cache session metadata for repeated aliases in one planning call", () => {
    const subtasks: Subtask[] = [
      { id: "task1", record_id: "rec1" } as Subtask,
      { id: "task2", record_id: "rec2" } as Subtask,
    ];
    const sessionMap = new Map<string, JulesSession>();
    sessionMap.set(
      buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task1"),
      { id: "shared-session", name: "sessions/shared-session", state: "RUNNING" } as JulesSession,
    );
    sessionMap.set(
      buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task2"),
      { id: undefined, name: "sessions/shared-session", state: "RUNNING" } as JulesSession,
    );
    const getForSession = vi.fn((session: JulesSession) => ({
      sessionId: session.id || null,
      sessionName: session.name || null,
    }));

    const result = planSessionActivityFetches(
      subtasks,
      sessionMap,
      mockContext,
      { getForSession },
      mockDeps.logger,
      isForeignSessionMatch,
    );

    expect(result).toEqual(["sessions/shared-session"]);
    expect(getForSession).toHaveBeenCalledTimes(1);
  });

  it("should ignore fully synced terminal sessions", () => {
    const subtasks: Subtask[] = [{ id: "task1", record_id: "rec1" } as Subtask];
    const sessionMap = new Map<string, JulesSession>();

    const key1 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task1");
    sessionMap.set(key1, { id: "s1", name: "session1", state: "COMPLETED" } as JulesSession);

    const isLocallyTerminal = vi.fn().mockImplementation((name) => name === "session1");

    const result = planSessionActivityFetches(subtasks, sessionMap, mockContext, mockSessionMetadataLookup, mockDeps.logger, isForeignSessionMatch, isLocallyTerminal);

    expect(result).toEqual([]);
    expect(mockDeps.logger.warn).toHaveBeenCalledWith(
      "Skipping activity fetch for fully synchronized terminal session",
      expect.objectContaining({
        taskId: "rec1",
        sessionId: "s1",
        sessionName: "session1",
        sessionState: "COMPLETED",
      }),
    );
  });

  it("should include remotely terminal session if not fully synced locally", () => {
    const subtasks: Subtask[] = [{ id: "task1", record_id: "rec1" } as Subtask];
    const sessionMap = new Map<string, JulesSession>();

    const key1 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task1");
    sessionMap.set(key1, { id: "s1", name: "session1", state: "COMPLETED" } as JulesSession);

    const isLocallyTerminal = vi.fn().mockReturnValue(false);

    const result = planSessionActivityFetches(subtasks, sessionMap, mockContext, mockSessionMetadataLookup, mockDeps.logger, isForeignSessionMatch, isLocallyTerminal);

    expect(result).toEqual(["session1"]);
  });

  it("should include locally terminal session if not remotely terminal", () => {
    const subtasks: Subtask[] = [{ id: "task1", record_id: "rec1" } as Subtask];
    const sessionMap = new Map<string, JulesSession>();

    const key1 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task1");
    sessionMap.set(key1, { id: "s1", name: "session1", state: "RUNNING" } as JulesSession);

    const isLocallyTerminal = vi.fn().mockReturnValue(true);

    const result = planSessionActivityFetches(subtasks, sessionMap, mockContext, mockSessionMetadataLookup, mockDeps.logger, isForeignSessionMatch, isLocallyTerminal);

    expect(result).toEqual(["session1"]);
  });

  it("should treat cancelled remote sessions as terminal through the state mapper", () => {
    const subtasks: Subtask[] = [{ id: "task1", record_id: "rec1" } as Subtask];
    const sessionMap = new Map<string, JulesSession>();

    const key1 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task1");
    sessionMap.set(key1, { id: "s1", name: "session1", state: "CANCELLED" } as JulesSession);

    const result = planSessionActivityFetches(
      subtasks,
      sessionMap,
      mockContext,
      mockSessionMetadataLookup,
      mockDeps.logger,
      isForeignSessionMatch,
      vi.fn().mockReturnValue(true),
    );

    expect(result).toEqual([]);
    expect(mockDeps.logger.warn).toHaveBeenCalledWith(
      "Skipping activity fetch for fully synchronized terminal session",
      expect.objectContaining({ sessionState: "CANCELLED" }),
    );
  });

  it("should skip foreign provider sessions", () => {
    const subtasks: Subtask[] = [{ id: "task1", record_id: "rec1" } as Subtask];
    const sessionMap = new Map<string, JulesSession>();

    const key1 = buildTaskRunKey(mockContext.repoPath, mockContext.sprintNumber, "task1");
    sessionMap.set(key1, { id: "s1", name: "session1", state: "RUNNING" } as JulesSession);

    const localIsForeignSessionMatch = vi.fn().mockReturnValue(true);

    const result = planSessionActivityFetches(subtasks, sessionMap, mockContext, mockSessionMetadataLookup, mockDeps.logger, localIsForeignSessionMatch);

    expect(result).toEqual([]);
    expect(mockDeps.logger.warn).toHaveBeenCalledWith(
      "Skipping foreign provider session matched by task run key",
      expect.objectContaining({
        taskId: "rec1",
        sessionId: "s1",
        sessionName: "session1",
      }),
    );
  });
});
