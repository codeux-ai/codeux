import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Subtask } from "../../../src/contracts/app-types.js";
import { TaskRerunService } from "../../../src/services/task-rerun-service.js";

describe("TaskRerunService", () => {
  const updateStatus = vi.fn();
  const startTask = vi.fn();
  const persistMergedFlag = vi.fn();
  let status: any;

  const service = new TaskRerunService({
    getStatus: () => status,
    updateStatus,
    startTask,
    resolveSessionName: (session) => session.name,
    extractSessionId: (session) => session.id,
    persistMergedFlag,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const task: Subtask = {
      id: "01-task",
      title: "Test task",
      prompt: "Do work",
      depends_on: [],
      is_independent: true,
      status: "FAILED",
      session_id: "old-session",
      session_name: "sessions/old-session",
      session_state: "FAILED",
      pr_url: "https://example.com/pr/12",
      worker_branch: "worker/task-1",
      is_merged: true,
      merge_indicator: "MERGED",
      activities: [{ id: "1", name: "a", createTime: "2025-01-01T00:00:00.000Z" }],
    };

    status = {
      sprint_number: 7,
      source_id: "source-123",
      repo_path: "/tmp/repo",
      feature_branch: "feature/sprint7-implementation",
      subtasks: [task],
      timestamp: null,
    };
  });

  it("resets task state and starts a fresh session", async () => {
    startTask.mockResolvedValue({
      id: "new-session",
      name: "sessions/new-session",
      prompt: "",
      provider: "claude-code",
    });

    const rerunTask = await service.rerunTask("01-task");

    expect(persistMergedFlag).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      sprintNumber: 7,
      taskId: "01-task",
      merged: false,
    });
    expect(startTask).toHaveBeenCalledWith({
      task: expect.objectContaining({
        id: "01-task",
        status: "PENDING",
        session_id: undefined,
        session_name: undefined,
        session_state: undefined,
        worker_branch: undefined,
        pr_url: undefined,
        is_merged: false,
        merge_indicator: undefined,
      }),
      sourceId: "source-123",
      featureBranch: "feature/sprint7-implementation",
      repoPath: "/tmp/repo",
      sprintNumber: 7,
    });
    expect(updateStatus).toHaveBeenCalledTimes(2);
    expect(updateStatus.mock.calls[0][0].subtasks[0].status).toBe("PENDING");
    expect(updateStatus.mock.calls[1][0].subtasks[0].status).toBe("RUNNING");
    expect(rerunTask.session_id).toBe("new-session");
    expect(rerunTask.session_name).toBe("sessions/new-session");
    expect(rerunTask.provider).toBe("claude-code");
  });

  it("marks the task failed when fresh session start fails", async () => {
    startTask.mockRejectedValue(new Error("provider unavailable"));

    await expect(service.rerunTask("01-task")).rejects.toThrow("provider unavailable");
    expect(updateStatus).toHaveBeenCalledTimes(2);
    expect(updateStatus.mock.calls[0][0].subtasks[0].status).toBe("PENDING");
    expect(updateStatus.mock.calls[1][0].subtasks[0].status).toBe("FAILED");
  });

  it("still reruns when merged-flag persistence fails", async () => {
    persistMergedFlag.mockRejectedValue(new Error("disk error"));
    startTask.mockResolvedValue({
      id: "new-session",
      name: "sessions/new-session",
      prompt: "",
      provider: "codex",
    });

    await expect(service.rerunTask("01-task")).resolves.toEqual(
      expect.objectContaining({
        status: "RUNNING",
        session_id: "new-session",
      })
    );
    expect(startTask).toHaveBeenCalledTimes(1);
  });

  it("rejects rerun when sprint context is incomplete", async () => {
    status.repo_path = undefined;

    await expect(service.rerunTask("01-task")).rejects.toThrow("sprint context is incomplete");
    expect(startTask).not.toHaveBeenCalled();
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
