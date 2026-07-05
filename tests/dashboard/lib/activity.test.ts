import { describe, expect, it } from "vitest";
import {
  findLatestContainerBuildProgressFromEvents,
  getActivityText,
  getContainerBuildProgress,
} from "../../../dashboard/src/lib/activity.js";

describe("getActivityText", () => {
  it("prefers agent message", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", agentMessaged: { agentMessage: "hello" } })).toBe("hello");
  });

  it("handles user message", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", userMessaged: { userMessage: "hello" } })).toBe("hello");
  });

  it("handles progress updates", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", progressUpdated: { title: "Compiling" } })).toBe("Compiling");
  });

  it("prefers structured container build progress copy", () => {
    expect(getActivityText({
      id: "1",
      name: "a",
      createTime: "now",
      containerBuildProgress: {
        kind: "build_step",
        imageTag: "code-ux-setup-cache-node:abc",
        baseImage: "node:24-bookworm",
        message: "Docker setup image build: RUN pnpm install",
        progressPercent: 42,
        stepText: "RUN pnpm install",
      },
      progressUpdated: { title: "Compiling" },
    })).toBe("Docker setup image build: RUN pnpm install");
  });

  it("handles progress updates fallback", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", progressUpdated: { description: "Compiling" } })).toBe("Compiling");
  });

  it("handles plan generated", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", planGenerated: { plan: { steps: [{ title: "step 1" }] } } })).toBe("Plan generated: step 1");
  });

  it("handles plan generated without title", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", planGenerated: { plan: { steps: [{ }] } } })).toBe("Plan generated");
  });

  it("handles plan approved", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", planApproved: { planId: "123" } })).toBe("Plan approved (123)");
  });

  it("handles session failed", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", sessionFailed: { reason: "error" } })).toBe("Session failed: error");
  });

  it("handles session completed", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", sessionCompleted: {} })).toBe("Session completed");
  });

  it("handles description", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now", description: "desc" })).toBe("desc");
  });

  it("falls back for unknown shapes", () => {
    expect(getActivityText({ id: "1", name: "a", createTime: "now" })).toBe("System activity...");
  });

  it("returns fallback if undefined", () => {
    expect(getActivityText(undefined)).toBe("System activity...");
  });

  it("normalizes bounded container build progress from runtime events", () => {
    const progress = findLatestContainerBuildProgressFromEvents([{
      id: "evt-1",
      scopeType: "task_run",
      taskRunId: "run-1",
      sprintRunId: "sprint-run-1",
      dispatchId: "dispatch-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintName: "Sprint",
      sprintNumber: 1,
      sprintRunStatus: "running",
      taskId: "task-1",
      taskKey: "T-1",
      taskTitle: "Task",
      taskRunState: "RUNNING",
      eventType: "setup_image_build_progress",
      originator: "system",
      sourceEventKey: null,
      provider: "codex",
      sessionId: "session-1",
      sessionName: null,
      workerBranch: null,
      prUrl: null,
      connectionId: null,
      connectionDisplayName: null,
      connectionRole: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      payload: {
        kind: "build_step",
        imageTag: "code-ux-setup-cache-node:abc",
        baseImage: "node:24-bookworm",
        message: "Docker setup image build: RUN pnpm install",
        progressPercent: 141,
      },
    }]);

    expect(progress).toEqual(expect.objectContaining({
      kind: "build_step",
      progressPercent: 100,
      imageTag: "code-ux-setup-cache-node:abc",
    }));
  });

  it("rejects unrelated progress-like objects", () => {
    expect(getContainerBuildProgress({
      kind: "provider_progress",
      imageTag: "node",
      baseImage: "node",
      message: "Running provider",
      progressPercent: 50,
    })).toBeNull();
  });
});
