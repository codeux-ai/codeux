import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { SessionTrackingRepository } from "./session-tracking-repository.js";

const tempDirs: string[] = [];

const createRepo = async (): Promise<SessionTrackingRepository> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jules-session-tracking-"));
  tempDirs.push(dir);
  return new SessionTrackingRepository(path.join(dir, "session-tracking.db"));
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SessionTrackingRepository", () => {
  it("recovers interrupted running cli sessions and leaves other sessions untouched", async () => {
    const repo = await createRepo();

    repo.createSession({
      id: "cli-gemini-running",
      provider: "gemini",
      state: "RUNNING",
      prompt: "prompt",
      title: "Sprint 1: [01] test",
    });
    repo.createSession({
      id: "cli-codex-completed",
      provider: "codex",
      state: "COMPLETED",
      prompt: "prompt",
      title: "Sprint 1: [02] test",
    });
    repo.createSession({
      id: "jules-running",
      provider: "jules",
      state: "RUNNING",
      prompt: "prompt",
      title: "Sprint 1: [03] test",
    });

    const recovery = repo.recoverInterruptedCliSessions();

    expect(recovery.recoveredCount).toBe(1);
    expect(recovery.sessionIds).toContain("cli-gemini-running");
    expect(repo.getSession("cli-gemini-running")?.state).toBe("FAILED");
    expect(repo.getSession("cli-codex-completed")?.state).toBe("COMPLETED");
    expect(repo.getSession("jules-running")?.state).toBe("RUNNING");

    const activities = repo.listAllActivities("cli-gemini-running");
    expect(
      activities.some((activity) =>
        String(activity.description).includes("Recovered interrupted MCP process")
      )
    ).toBe(true);
  });

  it("is idempotent when recovery is run multiple times", async () => {
    const repo = await createRepo();
    repo.createSession({
      id: "cli-codex-running",
      provider: "codex",
      state: "RUNNING",
      prompt: "prompt",
      title: "Sprint 1: [04] test",
    });

    const first = repo.recoverInterruptedCliSessions();
    const second = repo.recoverInterruptedCliSessions();

    expect(first.recoveredCount).toBe(1);
    expect(second.recoveredCount).toBe(0);
    expect(repo.getSession("cli-codex-running")?.state).toBe("FAILED");
  });

  it("finds latest failed cli session for task resume target", async () => {
    const repo = await createRepo();

    repo.createSession({
      id: "cli-gemini-old",
      provider: "gemini",
      state: "FAILED",
      prompt: "prompt",
      title: "Sprint 1: [task-1] test",
      taskId: "task-1",
      featureBranch: "feature/sprint1",
      workerBranch: "task/feature-sprint1-task-1-gemini-old",
      repoPath: "/tmp/repo-a",
    });

    repo.createSession({
      id: "cli-gemini-new",
      provider: "gemini",
      state: "FAILED",
      prompt: "prompt",
      title: "Sprint 1: [task-1] test",
      taskId: "task-1",
      featureBranch: "feature/sprint1",
      workerBranch: "task/feature-sprint1-task-1-gemini-new",
      repoPath: "/tmp/repo-a",
    });

    repo.createSession({
      id: "cli-gemini-other-repo",
      provider: "gemini",
      state: "FAILED",
      prompt: "prompt",
      title: "Sprint 1: [task-1] test",
      taskId: "task-1",
      featureBranch: "feature/sprint1",
      workerBranch: "task/feature-sprint1-task-1-gemini-other",
      repoPath: "/tmp/repo-b",
    });

    const target = repo.findLatestFailedCliSessionForTask({
      provider: "gemini",
      taskId: "task-1",
      featureBranch: "feature/sprint1",
      repoPath: "/tmp/repo-a",
    });

    expect(target).toEqual({
      sessionId: "cli-gemini-new",
      workerBranch: "task/feature-sprint1-task-1-gemini-new",
    });
  });
});
