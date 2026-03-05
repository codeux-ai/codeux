import { describe, it, expect, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SprintOrchestrator } from "../../../src/sprint/sprint-orchestrator.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { buildTaskRunTag } from "../../../src/services/task-run-key.js";
import { buildDeps } from "./sprint-orchestrator.setup.js";

describe("SprintOrchestrator automation blocks", () => {
  it("marks actionable session states as blocked and emits instructions", async () => {
    const { deps, listSessions, subtaskRepository } = buildDeps();
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-test-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    subtaskRepository.loadSubtasks.mockResolvedValue([
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
          title: `Sprint 1: ${buildTaskRunTag(path.basename(path.resolve(tmpRoot)), "1", "01-task")} [01-task] Test task`,
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
    expect(text).toContain("HUMAN INTERVENTION NEEDED");
    expect(text).toContain("AWAITING_USER_FEEDBACK");
    expect(text).toContain("`BLOCKED`");

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("auto-answers clarification in FULL automation mode", async () => {
    const { deps, listSessions, subtaskRepository } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      automationLevel: "FULL",
    });
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-full-auto-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    subtaskRepository.loadSubtasks.mockResolvedValue([
      { id: "01-task", title: "Test task", prompt: "Do it", depends_on: [], is_independent: true },
    ]);
    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "abc123",
          name: "sessions/abc123",
          title: `Sprint 1: ${buildTaskRunTag(path.basename(path.resolve(tmpRoot)), "1", "01-task")} [01-task] Test task`,
          state: "AWAITING_USER_FEEDBACK",
          provider: "jules",
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
    expect(text).toContain("Auto-Answered Clarification");
    expect(deps.sendSessionMessage).toHaveBeenCalledWith(
      "abc123",
      expect.stringContaining("Proceed with the safest implementation path")
    );

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("routes blocked tasks to agent intervention when auto-intervention fails", async () => {
    const { deps, listSessions, subtaskRepository } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      automationLevel: "FULL",
    });
    deps.sendSessionMessage = vi.fn().mockRejectedValue(new Error("temporary Jules API error"));
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-agent-intervention-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    subtaskRepository.loadSubtasks.mockResolvedValue([
      { id: "01-task", title: "Test task", prompt: "Do it", depends_on: [], is_independent: true },
    ]);
    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "abc123",
          name: "sessions/abc123",
          title: `Sprint 1: ${buildTaskRunTag(path.basename(path.resolve(tmpRoot)), "1", "01-task")} [01-task] Test task`,
          state: "AWAITING_USER_FEEDBACK",
          provider: "jules",
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
    expect(text).toContain("AGENT INTERVENTION NEEDED");
    expect(text).toContain("Auto-Intervention Failed");

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
});
