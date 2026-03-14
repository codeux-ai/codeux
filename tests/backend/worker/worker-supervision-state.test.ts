import { describe, expect, it } from "vitest";
import { WorkerSupervisionState } from "../../../src/worker/worker-supervision-state.js";
import type { ListenAssignmentChangedEvent, ListenAttentionItemEvent } from "../../../src/contracts/connection-chat-types.js";

const assignmentChangedEvent: ListenAssignmentChangedEvent = {
  kind: "assignment_changed",
  assignment: {
    assignmentId: "assignment-1",
    workerEndpointId: "worker-endpoint-1",
    assignmentRole: "primary",
    status: "active",
    assignedAt: "2026-03-13T00:00:00.000Z",
    updatedAt: "2026-03-13T00:00:00.000Z",
    releasedAt: null,
    releaseReason: null,
    primaryAssignedWorkerEndpointId: "worker-endpoint-1",
    overflowAssignedWorkerEndpointIds: [],
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
    unresolvedAttentionCount: 0,
    unresolvedAttentionTitles: [],
    recentEventTypes: [],
  },
  continuation: {
    nextTool: "listen",
    instruction: "Continue listening.",
  },
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
  project: assignmentChangedEvent.project,
  workingDirectoryHint: assignmentChangedEvent.workingDirectoryHint,
  contextDigest: {
    ...assignmentChangedEvent.contextDigest,
    unresolvedAttentionCount: 1,
    unresolvedAttentionTitles: ["Merge required"],
  },
  continuation: {
    nextTool: "listen",
    instruction: "Continue listening.",
  },
};

describe("WorkerSupervisionState", () => {
  it("tracks assignment activity and attention items per project", () => {
    const state = new WorkerSupervisionState(["project-seed"]);

    state.noteAssignmentChanged(assignmentChangedEvent);
    state.noteAttentionItem(openAttentionEvent);

    expect(state.getActiveProjectIds()).toEqual(["project-1"]);
    expect(state.listProjectSnapshots()).toEqual([
      expect.objectContaining({
        projectId: "project-1",
        assignmentRole: "primary",
        assignmentStatus: "active",
        activeAttentionItemIds: ["attention-1"],
      }),
    ]);
  });

  it("falls back to configured active projects when no tracked project is active", () => {
    const state = new WorkerSupervisionState(["project-seed"]);

    state.noteAttentionItem(openAttentionEvent);
    state.markAttentionItemResolved("project-1", "attention-1");

    expect(state.getActiveProjectIds()).toEqual(["project-seed"]);
    expect(state.listProjectSnapshots()).toEqual([]);
  });
});
