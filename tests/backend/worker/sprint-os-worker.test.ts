import { describe, expect, it, vi } from "vitest";
import { SprintOsWorker } from "../../../src/worker/sprint-os-worker.js";
import type { ListenAttentionItemEvent } from "../../../src/contracts/connection-chat-types.js";

const baseConfig = {
  connectionKey: "worker-1",
  displayName: "Worker 1",
  projectId: "project-1",
  projectIds: ["project-1"],
  activeProjectIds: [],
  dispatchPollIntervalMs: 100,
  sessionPollIntervalMs: 100,
  serverCommand: "node",
  serverArgs: ["dist/index.js"],
};

const openAttentionEvent: ListenAttentionItemEvent = {
  kind: "attention_item",
  item: {
    id: "attention-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    taskId: "task-1",
    sprintRunId: null,
    dispatchId: null,
    attentionType: "merge_required",
    severity: "high",
    ownerType: "worker",
    status: "open",
    assignedWorkerEndpointId: "worker-endpoint-1",
    title: "Merge required",
    summaryMarkdown: "Needs merge handling.",
    payload: { repoPath: "/repo/project-1" },
    openedAt: "2026-03-13T00:01:00.000Z",
    updatedAt: "2026-03-13T00:01:00.000Z",
  },
  project: {
    id: "project-1",
    name: "Project 1",
    repoPath: "/repo/project-1",
    defaultBranch: "main",
    featureBranch: "feature/test",
  },
  workingDirectoryHint: "cd /repo/project-1",
  contextDigest: {
    activeSprintId: "sprint-1",
    activeSprintName: "Sprint 1",
    activeSprintNumber: 1,
    unresolvedAttentionCount: 1,
    unresolvedAttentionTitles: ["Merge required"],
    recentEventTypes: [],
  },
  continuation: {
    nextTool: "listen",
    instruction: "Continue listening.",
  },
};

describe("SprintOsWorker", () => {
  it("claims open worker-owned attention items and tracks the project as active", async () => {
    const worker = new SprintOsWorker(baseConfig);
    const callJsonTool = vi.fn()
      .mockResolvedValueOnce({
        itemId: "attention-1",
        status: "claimed",
        assignedWorkerEndpointId: "worker-endpoint-1",
        claimedAt: "2026-03-13T00:02:00.000Z",
      })
      .mockResolvedValueOnce({
        itemId: "attention-1",
        status: "resolved",
        outcome: "needs_human_escalation",
        handoffAttentionItemId: "attention-2",
        threadId: "thread-1",
        threadMessageId: "message-1",
        resolvedAt: "2026-03-13T00:03:00.000Z",
      });
    (worker as any).callJsonTool = callJsonTool;

    await (worker as any).processAttentionItem({} as any, openAttentionEvent);

    expect(callJsonTool).toHaveBeenNthCalledWith(1, {} as any, "claim_attention_item", {
      connection_key: "worker-1",
      attention_item_id: "attention-1",
      claim_reason: "worker_listen_claimed",
    });
    expect(callJsonTool).toHaveBeenNthCalledWith(2, {} as any, "report_attention_outcome", {
      connection_key: "worker-1",
      attention_item_id: "attention-1",
      outcome: "needs_human_escalation",
      summary_markdown: expect.stringContaining("Recommended outcome: human escalation."),
    });
    expect((worker as any).resolveActiveProjectIds()).toBeUndefined();
  });

  it("does not try to re-claim already claimed attention items", async () => {
    const worker = new SprintOsWorker(baseConfig);
    const callJsonTool = vi.fn().mockResolvedValue({
      itemId: "attention-1",
      status: "resolved",
      outcome: "needs_human_escalation",
      handoffAttentionItemId: "attention-2",
      threadId: "thread-1",
      threadMessageId: "message-1",
      resolvedAt: "2026-03-13T00:03:00.000Z",
    });
    (worker as any).callJsonTool = callJsonTool;

    await (worker as any).processAttentionItem({} as any, {
      ...openAttentionEvent,
      item: {
        ...openAttentionEvent.item,
        status: "claimed",
      },
    });

    expect(callJsonTool).toHaveBeenCalledWith({} as any, "report_attention_outcome", {
      connection_key: "worker-1",
      attention_item_id: "attention-1",
      outcome: "needs_human_escalation",
      summary_markdown: expect.stringContaining("Current blocker:"),
    });
    expect((worker as any).resolveActiveProjectIds()).toBeUndefined();
  });

  it("holds merge_conflict attention items for worker-side handling after claim", async () => {
    const worker = new SprintOsWorker(baseConfig);
    const callJsonTool = vi.fn().mockResolvedValue({
      itemId: "attention-1",
      status: "claimed",
      assignedWorkerEndpointId: "worker-endpoint-1",
      claimedAt: "2026-03-13T00:02:00.000Z",
    });
    (worker as any).callJsonTool = callJsonTool;

    await (worker as any).processAttentionItem({} as any, {
      ...openAttentionEvent,
      item: {
        ...openAttentionEvent.item,
        attentionType: "merge_conflict",
        title: "Merge conflict",
      },
    });

    expect(callJsonTool).toHaveBeenCalledTimes(1);
    expect(callJsonTool).toHaveBeenCalledWith({} as any, "claim_attention_item", {
      connection_key: "worker-1",
      attention_item_id: "attention-1",
      claim_reason: "worker_listen_claimed",
    });
  });

  it("resolves terminal task state properly respecting failure precedence", () => {
    const worker = new SprintOsWorker(baseConfig);

    // Simulate FAILED state but with a PR URL present.
    const failedSession = {
      id: "session-1",
      name: "Session 1",
      state: "FAILED",
      provider: "jules" as const,
      prompt: "prompt",
      outputs: [{ pullRequest: { url: "http://github.com/pr/1" } }],
    };

    expect((worker as any).resolveTerminalTaskState(failedSession)).toBe("FAILED");
  });

  it("resolves terminal task state as COMPLETED when no failure state is present but a PR exists", () => {
    const worker = new SprintOsWorker(baseConfig);

    // Simulate PR URL present with no failure state.
    const completedSession = {
      id: "session-1",
      name: "Session 1",
      state: "IDLE", // not a failed state
      provider: "jules" as const,
      prompt: "prompt",
      outputs: [{ pullRequest: { url: "http://github.com/pr/1" } }],
    };

    expect((worker as any).resolveTerminalTaskState(completedSession)).toBe("COMPLETED");
  });

  it("resolves terminal task state as BLOCKED when state is action required", () => {
    const worker = new SprintOsWorker(baseConfig);

    const blockedSession = {
      id: "session-1",
      name: "Session 1",
      state: "AWAITING_USER_FEEDBACK",
      provider: "jules" as const,
      prompt: "prompt",
    };

    expect((worker as any).resolveTerminalTaskState(blockedSession)).toBe("BLOCKED");
  });
});
