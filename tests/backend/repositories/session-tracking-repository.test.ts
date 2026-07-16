import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { SessionTrackingRepository } from "../../../src/repositories/session-tracking-repository.js";

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
  it("returns worker branch outputs for local CLI sessions before a PR exists", async () => {
    const repo = await createRepo();

    repo.createSession({
      id: "cli-codex-running",
      provider: "codex",
      state: "RUNNING",
      prompt: "prompt",
      title: "Sprint 1: [01] test",
      workerBranch: "task/feature-t01-codex",
    });

    expect(repo.getSession("cli-codex-running")?.outputs).toEqual([
      { pullRequest: { url: undefined, workerBranch: "task/feature-t01-codex" } },
    ]);
    expect(repo.getSession("cli-codex-running")?.prompt).toBe("");
  });

  it("stores prompts only for Jules because CLI invocation messages are already durable", async () => {
    const repo = await createRepo();
    const oversizedPrompt = "wide-dag-context".repeat(100_000);

    repo.createSession({ id: "cli-large", provider: "codex", prompt: oversizedPrompt });
    repo.createSession({ id: "jules-large", provider: "jules", prompt: oversizedPrompt });

    expect(repo.getSession("cli-large")?.prompt).toBe("");
    expect(repo.getSession("jules-large")?.prompt).toBe(oversizedPrompt);
  });

  it("removes legacy local CLI prompt copies once when opening an upgraded database", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-session-prompt-migration-"));
    tempDirs.push(dir);
    const databasePath = path.join(dir, "session-tracking.db");
    const initial = new SessionTrackingRepository(databasePath);
    initial.createSession({ id: "legacy-cli", provider: "codex" });
    initial.createSession({ id: "legacy-jules", provider: "jules", prompt: "hosted prompt" });
    initial.getDatabase().prepare("UPDATE provider_sessions SET prompt = ? WHERE id = ?")
      .run("legacy duplicated prompt", "legacy-cli");
    initial.getDatabase().exec("PRAGMA user_version = 0");
    initial.close();

    const upgraded = new SessionTrackingRepository(databasePath);

    expect(upgraded.getSession("legacy-cli")?.prompt).toBe("");
    expect(upgraded.getSession("legacy-jules")?.prompt).toBe("hosted prompt");
    const version = upgraded.getDatabase().prepare("PRAGMA user_version").get() as { user_version: number };
    expect(version.user_version).toBe(1);
    upgraded.close();
  });

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
      id: "cli-opencode-running",
      provider: "opencode",
      state: "RUNNING",
      prompt: "prompt",
      title: "Sprint 1: [01b] test",
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

    expect(recovery.recoveredCount).toBe(2);
    expect(recovery.sessionIds).toContain("cli-gemini-running");
    expect(recovery.sessionIds).toContain("cli-opencode-running");
    expect(repo.getSession("cli-gemini-running")?.state).toBe("CANCELLED");
    expect(repo.getSession("cli-opencode-running")?.state).toBe("CANCELLED");
    expect(repo.getSession("cli-codex-completed")?.state).toBe("COMPLETED");
    expect(repo.getSession("jules-running")?.state).toBe("RUNNING");

    const activities = repo.listAllActivities("cli-gemini-running");
    expect(
      activities.some((activity) =>
        String(activity.description).includes("Recovered interrupted Code UX process")
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
    expect(repo.getSession("cli-codex-running")?.state).toBe("CANCELLED");
  });

  it("tracks and recovers virtual repair sessions without a cli id prefix", async () => {
    const repo = await createRepo();
    repo.createSession({
      id: "virtual-cifix-codex-repair-1",
      provider: "codex",
      state: "RUNNING",
      prompt: "repair CI",
      title: "CI repair",
      workerBranch: "fix/ci",
      repoPath: "/tmp/repo-repair",
    });

    expect(repo.listTrackedCliSessions()).toEqual([
      expect.objectContaining({ id: "virtual-cifix-codex-repair-1", state: "RUNNING" }),
    ]);
    expect(repo.findLatestCliSessionForBranch({
      repoPath: "/tmp/repo-repair",
      workerBranch: "fix/ci",
      providers: ["codex"],
    })).toEqual(expect.objectContaining({ sessionId: "virtual-cifix-codex-repair-1" }));

    expect(repo.recoverInterruptedCliSessions().sessionIds).toEqual(["virtual-cifix-codex-repair-1"]);
    expect(repo.getSession("virtual-cifix-codex-repair-1")?.state).toBe("CANCELLED");
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

    await new Promise(resolve => setTimeout(resolve, 10));

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

  it("finds latest cancelled cli session for task resume target", async () => {
    const repo = await createRepo();

    repo.createSession({
      id: "cli-gemini-cancelled",
      provider: "gemini",
      state: "CANCELLED",
      prompt: "prompt",
      title: "Sprint 1: [task-1] test",
      taskId: "task-1",
      featureBranch: "feature/sprint1",
      workerBranch: "task/feature-sprint1-task-1-gemini-cancelled",
      repoPath: "/tmp/repo-a",
    });

    const target = repo.findLatestResumableCliSessionForTask({
      provider: "gemini",
      taskId: "task-1",
      featureBranch: "feature/sprint1",
      repoPath: "/tmp/repo-a",
    });

    expect(target).toEqual({
      sessionId: "cli-gemini-cancelled",
      workerBranch: "task/feature-sprint1-task-1-gemini-cancelled",
    });
  });

  it("tracks cancelled mockup CLI sessions so startup pruning preserves resumable workspaces", async () => {
    const repo = await createRepo();

    repo.createSession({
      id: "cli-mockup-cli-cancelled",
      provider: "mockup-cli",
      state: "CANCELLED",
      prompt: "prompt",
      title: "Sprint 1: [task-1] test",
      taskId: "task-1",
      featureBranch: "feature/sprint1",
      workerBranch: "task/feature-sprint1-task-1-mockup-cli-cancelled",
      repoPath: "/tmp/repo-a",
    });

    expect(repo.listTrackedCliSessions()).toEqual([
      expect.objectContaining({
        id: "cli-mockup-cli-cancelled",
        provider: "mockup-cli",
        state: "CANCELLED",
      }),
    ]);
    expect(repo.findLatestResumableCliSessionForTask({
      provider: "mockup-cli",
      taskId: "task-1",
      featureBranch: "feature/sprint1",
      repoPath: "/tmp/repo-a",
    })).toEqual({
      sessionId: "cli-mockup-cli-cancelled",
      workerBranch: "task/feature-sprint1-task-1-mockup-cli-cancelled",
    });
  });

  it("tracks completed mockup CLI sessions so finished workspaces survive restarts", async () => {
    const repo = await createRepo();

    repo.createSession({
      id: "cli-mockup-cli-completed",
      provider: "mockup-cli",
      state: "COMPLETED",
      prompt: "prompt",
      title: "Sprint 1: [task-1] test",
      taskId: "task-1",
      featureBranch: "feature/sprint1",
      workerBranch: "task/feature-sprint1-task-1-mockup-cli-completed",
      repoPath: "/tmp/repo-a",
    });

    expect(repo.listTrackedCliSessions()).toEqual([
      expect.objectContaining({
        id: "cli-mockup-cli-completed",
        provider: "mockup-cli",
        state: "COMPLETED",
      }),
    ]);
  });

  it("finds latest failed cli session using container path /workspace fallback and POSIX path normalization", async () => {
    const repo = await createRepo();

    repo.createSession({
      id: "cli-gemini-container",
      provider: "gemini",
      state: "FAILED",
      prompt: "prompt",
      title: "Sprint 1: [task-2] test",
      taskId: "task-2",
      featureBranch: "feature/sprint1",
      workerBranch: "task/feature-sprint1-task-2-gemini",
      repoPath: "/workspace",
    });

    const target = repo.findLatestFailedCliSessionForTask({
      provider: "gemini",
      taskId: "task-2",
      featureBranch: "feature/sprint1",
      repoPath: "C:\\Users\\pierr\\project",
    });

    expect(target).toEqual({
      sessionId: "cli-gemini-container",
      workerBranch: "task/feature-sprint1-task-2-gemini",
    });

    repo.createSession({
      id: "cli-gemini-branch-container",
      provider: "gemini",
      state: "COMPLETED",
      prompt: "prompt",
      title: "Sprint 1: [task-3] test",
      taskId: "task-3",
      featureBranch: "feature/sprint1",
      workerBranch: "task/feature-sprint1-task-3-gemini",
      repoPath: "/workspace",
    });

    const targetBranch = repo.findLatestCliSessionForBranch({
      repoPath: "C:\\Users\\pierr\\project",
      workerBranch: "task/feature-sprint1-task-3-gemini",
      providers: ["gemini"],
    });

    expect(targetBranch).toEqual({
      sessionId: "cli-gemini-branch-container",
      workerBranch: "task/feature-sprint1-task-3-gemini",
      state: "COMPLETED",
    });
  });

  it("updates an existing session", async () => {
    const repo = await createRepo();
    repo.createSession({ id: "s1", provider: "jules", state: "RUNNING" });
    
    const updated = repo.updateSession("s1", { state: "COMPLETED", prUrl: "https://github.com/pr/1" });
    
    expect(updated?.state).toBe("COMPLETED");
    expect(updated?.outputs?.[0]?.pullRequest?.url).toBe("https://github.com/pr/1");
  });

  it("appends and lists activities", async () => {
    const repo = await createRepo();
    repo.createSession({ id: "s1", provider: "jules" });
    
    repo.appendActivity("s1", { description: "act 1", payload: { x: 1 } });
    repo.appendActivity("s1", { description: "act 2" });
    
    const activities = repo.listAllActivities("s1");
    expect(activities).toHaveLength(2);
    // In some runs the timestamps might identical, let us be safer
    expect(activities.some(a => a.description === "act 1")).toBe(true);
    expect(activities.some(a => (a as any).x === 1)).toBe(true);
    
    const paged = repo.listActivities({ session_id: "s1", page_size: 1 });
    expect(paged.activities).toHaveLength(1);
    expect(paged.nextPageToken).toBe("1");
  });

  it("batch-inserts activities in order and no-ops on an empty batch", async () => {
    const repo = await createRepo();
    repo.createSession({ id: "s1", provider: "jules" });

    repo.appendActivities("s1", []);
    expect(repo.listAllActivities("s1")).toHaveLength(0);

    repo.appendActivities("s1", [
      { description: "first", createTime: "2026-06-03T11:00:00.000Z" },
      { description: "second", createTime: "2026-06-03T11:00:01.000Z", originator: "agent" },
    ]);

    const activities = repo.listAllActivities("s1");
    expect(activities.map((a) => a.description)).toEqual(["first", "second"]);
    expect(activities[1].originator).toBe("agent");
  });

  it("lists sessions", async () => {
    const repo = await createRepo();
    repo.createSession({ id: "s1", provider: "jules", title: "T1", prompt: "large prompt" });
    repo.createSession({ id: "s2", provider: "gemini", title: "T2" });
    
    const list = repo.listSessions(10);
    expect(list.sessions).toHaveLength(2);
    expect(list.sessions.map(s => s.id)).toContain("s1");
    expect(list.sessions.map(s => s.id)).toContain("s2");
    expect(list.sessions.find(s => s.id === "s1")?.prompt).toBe("large prompt");

    const syncProjection = repo.listSessions(10, { includePrompt: false });
    expect(syncProjection.sessions.find(s => s.id === "s1")?.prompt).toBe("");
    expect(syncProjection.sessions.find(s => s.id === "s1")?.title).toBe("T1");
  });

  it("fetches recent activities", async () => {
    const repo = await createRepo();
    repo.createSession({ id: "s1", provider: "jules" });
    repo.appendActivity("s1", { description: "1", createTime: "2026-06-03T11:00:00.000Z" });
    repo.appendActivity("s1", { description: "2", createTime: "2026-06-03T11:00:01.000Z" });
    repo.appendActivity("s1", { description: "3", createTime: "2026-06-03T11:00:02.000Z" });
    
    const recent = repo.fetchRecentActivities("s1", 2);
    expect(recent).toHaveLength(2);
    expect(recent[0].description).toBe("2");
    expect(recent[1].description).toBe("3");
  });
});
