import { describe, it, expect, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SprintOrchestrator } from "./sprint-orchestrator.js";
import type { Subtask } from "./types.js";

const buildDeps = () => {
  const listSessions = vi.fn();
  const loadSubtasks = vi.fn<() => Promise<Subtask[]>>();
  const getGuideContent = vi.fn().mockResolvedValue("guide");

  const deps = {
    julesApi: { listSessions } as any,
    settings: { maxFailures: 5 },
    dashboardPort: 4444,
    completedSprints: new Set<number>(),
    getConsecutiveFailures: () => 0,
    setConsecutiveFailures: vi.fn(),
    isActionRequiredState: (state?: string) => state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED",
    resolveSessionName: (s: any) => s.name,
    extractSessionId: (s: any) => s.id,
    fetchRecentActivities: vi.fn().mockResolvedValue([]),
    loadSubtasks,
    startJulesTask: vi.fn(),
    getGuideContent,
    updateLastStatus: vi.fn(),
  };

  return { deps, listSessions, loadSubtasks, getGuideContent };
};

describe("SprintOrchestrator", () => {
  it("returns branch configuration blocker for plan when feature branch is missing", async () => {
    const { deps } = buildDeps();
    const orchestrator = new SprintOrchestrator(deps as any);

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: "/definitely/missing-repo",
      source_id: "sources/123",
      action: "plan",
      wait: false,
    });

    expect(result.content[0].text).toContain("Branch Configuration Missing");
    expect(result.content[0].text).toContain("feature/sprint1-implementation");
  });

  it("marks actionable session states as blocked and emits instructions", async () => {
    const { deps, listSessions, loadSubtasks } = buildDeps();
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-test-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    loadSubtasks.mockResolvedValue([
      {
        id: "01-task",
        title: "Test task",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
      },
    ]);

    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "abc123",
          name: "sessions/abc123",
          title: "Sprint 1: [01-task] Test task",
          state: "AWAITING_USER_FEEDBACK",
          prompt: "x",
        },
      ],
    });

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    const text = result.content[0].text as string;
    expect(text).toContain("JULES ACTION REQUIRED");
    expect(text).toContain("AWAITING_USER_FEEDBACK");
    expect(text).toContain("`BLOCKED`");

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
});
