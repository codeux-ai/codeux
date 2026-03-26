import { describe, expect, it } from "vitest";
import type { Subtask } from "../../../dashboard/src/types.js";
import type { Task } from "../../../dashboard/src/v2/types.js";
import { buildLiveSessionTasks } from "../../../dashboard/src/v2/lib/live-session-task-structure.js";

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    recordId: "task-record-1",
    id: "TASK-1",
    source: "Project 1",
    sprint: "Sprint 1",
    sprintId: "sprint-1",
    title: "Ship it",
    status: "in_progress",
    priority: "medium",
    executorType: "docker_cli",
    assignee: "Runner",
    time: "Active",
    createdAt: "2026-03-26T10:00:00.000Z",
    promptMarkdown: "Do the work",
    description: "",
    dependsOnTaskIds: [],
    isIndependent: true,
    isMerged: false,
    mergeIndicator: null,
    ...overrides,
  };
}

function createRuntimeTask(overrides: Partial<Subtask> = {}): Subtask {
  return {
    record_id: "task-record-1",
    project_id: "project-1",
    sprint_id: "sprint-1",
    id: "TASK-1",
    title: "Ship it",
    prompt: "Do the work",
    depends_on: [],
    status: "RUNNING",
    session_id: "session-1",
    provider: "gemini-cli",
    is_independent: true,
    is_merged: false,
    ...overrides,
  };
}

describe("live-session-task-structure", () => {
  it("uses stable project task structure when runtime tasks are empty", () => {
    const result = buildLiveSessionTasks([
      createTask(),
      createTask({ recordId: "task-record-2", id: "TASK-2", dependsOnTaskIds: ["task-record-1"], status: "pending" }),
    ], [], "project-1");

    expect(result).toHaveLength(2);
    expect(result[0]?.status).toBe("RUNNING");
    expect(result[1]?.status).toBe("PENDING");
    expect(result[1]?.depends_on).toEqual(["TASK-1"]);
  });

  it("overlays runtime task state onto the stable task structure", () => {
    const result = buildLiveSessionTasks([
      createTask({ status: "pending" }),
    ], [
      createRuntimeTask({ status: "FAILED", session_id: "session-2", worker_branch: "feature/task-1" }),
    ], "project-1");

    expect(result[0]?.status).toBe("FAILED");
    expect(result[0]?.session_id).toBe("session-2");
    expect(result[0]?.worker_branch).toBe("feature/task-1");
  });

  it("matches runtime tasks by task key when the record id is missing", () => {
    const result = buildLiveSessionTasks([
      createTask(),
    ], [
      createRuntimeTask({ record_id: undefined, status: "CODING_COMPLETED", id: "TASK-1" }),
    ], "project-1");

    expect(result[0]?.status).toBe("CODING_COMPLETED");
  });
});
