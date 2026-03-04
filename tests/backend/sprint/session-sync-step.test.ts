import { describe, expect, it, vi } from "vitest";
import { runSessionSyncStep } from "../../../src/sprint/steps/session-sync-step.js";
import type { Subtask } from "../../../src/contracts/app-types.js";

describe("runSessionSyncStep", () => {
  it("matches sessions by repo/sprint/task run key to avoid task-id collisions", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-1",
        title: "Task One",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
    ];

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "newer-other-sprint",
            name: "sessions/newer-other-sprint",
            title: "Sprint 7: [run:my-repo/s7/task-1] [task-1] Task One",
            state: "RUNNING",
            prompt: "",
          },
          {
            id: "correct-sprint",
            name: "sessions/correct-sprint",
            title: "Sprint 6: [run:my-repo/s6/task-1] [task-1] Task One",
            state: "COMPLETED",
            prompt: "",
          },
        ],
      }),
      resolveSessionName: (session: { name?: string }) => session.name,
      extractSessionId: (session: { id?: string }) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
      isActionRequiredState: vi.fn().mockReturnValue(false),
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      },
    };

    const result = await runSessionSyncStep(
      subtasks,
      deps,
      true,
      {
        repoPath: "/tmp/my-repo",
        sprintNumber: 6,
      }
    );

    expect(result.subtasks[0].session_id).toBe("correct-sprint");
    expect(result.subtasks[0].status).toBe("COMPLETED");
  });

  it("picks the most recent session when multiple sessions exist for the same task", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-1",
        title: "Task One",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
    ];

    const repoPath = "/tmp/my-repo";
    const sprintNumber = 1;

    const deps = {
      listSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "old-session",
            name: "sessions/old-session",
            title: "Sprint 1: [run:my-repo/s1/task-1] [task-1] Task One",
            state: "FAILED",
            createTime: "2023-01-01T00:00:00Z",
          },
          {
            id: "new-session",
            name: "sessions/new-session",
            title: "Sprint 1: [run:my-repo/s1/task-1] [task-1] Task One",
            state: "COMPLETED",
            createTime: "2023-01-02T00:00:00Z",
          },
        ],
      }),
      resolveSessionName: (session: any) => session.name,
      extractSessionId: (session: any) => session.id,
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
      isActionRequiredState: vi.fn().mockReturnValue(false),
    };

    const result = await runSessionSyncStep(
      subtasks,
      deps as any,
      false,
      { repoPath, sprintNumber }
    );

    expect(result.subtasks[0].session_id).toBe("new-session");
    expect(result.subtasks[0].status).toBe("COMPLETED");
  });
});
