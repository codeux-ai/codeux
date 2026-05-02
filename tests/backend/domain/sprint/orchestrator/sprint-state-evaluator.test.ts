import { describe, it, expect } from "vitest";
import { evaluateSprintRunState } from "../../../../../src/domain/sprint/orchestrator/sprint-state-evaluator.js";
import type { Subtask } from "../../../../../src/contracts/app-types.js";
import type { ProjectAttentionItemRecord } from "../../../../../src/contracts/project-attention-types.js";

function createDummySubtask(overrides: Partial<Subtask>): Subtask {
  return {
    id: "task-1",
    sprint_id: "sprint-1",
    title: "Task 1",
    status: "PENDING",
    created_at: "2023-01-01T00:00:00Z",
    updated_at: "2023-01-01T00:00:00Z",
    ...overrides,
  } as Subtask;
}

function createDummyAttentionItem(overrides: Partial<ProjectAttentionItemRecord>): ProjectAttentionItemRecord {
  return {
    id: "item-1",
    project_id: "project-1",
    attention_type: "merge_conflict",
    owner_type: "worker",
    status: "active",
    created_at: "2023-01-01T00:00:00Z",
    updated_at: "2023-01-01T00:00:00Z",
    ...overrides,
  } as ProjectAttentionItemRecord;
}

describe("evaluateSprintRunState", () => {
  it("allTerminal is true when all tasks are FAILED or settled", () => {
    const result = evaluateSprintRunState({
      subtasks: [
        createDummySubtask({ status: "FAILED" }),
        createDummySubtask({ status: "COMPLETED", is_merged: true, merge_indicator: "MERGED" }),
      ],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });

    expect(result.allTerminal).toBe(true);
    expect(result.allFinished).toBe(true);
  });

  it("allTerminal is false when some tasks are running", () => {
    const result = evaluateSprintRunState({
      subtasks: [
        createDummySubtask({ status: "FAILED" }),
        createDummySubtask({ status: "RUNNING" }),
      ],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });

    expect(result.allTerminal).toBe(false);
    expect(result.allFinished).toBe(false);
  });

  it("noMoreActionPossible is true when running, pending, quota and QA_PENDING tasks are all empty", () => {
    const result = evaluateSprintRunState({
      subtasks: [
        createDummySubtask({ status: "COMPLETED", is_merged: true, merge_indicator: "MERGED" }),
      ],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });

    expect(result.noMoreActionPossible).toBe(true);
  });

  it("noMoreActionPossible is false when running tasks exist", () => {
    const result = evaluateSprintRunState({
      subtasks: [
        createDummySubtask({ status: "RUNNING" }),
      ],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });

    expect(result.noMoreActionPossible).toBe(false);
  });

  it("needsManualMerge is true when manual merge tasks are present", () => {
    const manualTask = createDummySubtask({ status: "COMPLETED", merge_indicator: "MERGE_CONFLICT" });
    const result = evaluateSprintRunState({
      subtasks: [manualTask],
      manualMergeTasks: [manualTask],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });

    expect(result.needsManualMerge).toBe(true);
  });

  it("waitingOnWorkerAttention is true when worker escalations are present", () => {
    const escalatedTask = createDummySubtask({ status: "COMPLETED", merge_indicator: "MERGE_CONFLICT" });
    const result = evaluateSprintRunState({
      subtasks: [escalatedTask],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [escalatedTask],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });

    expect(result.waitingOnWorkerAttention).toBe(true);
  });

  it("waitingOnWorkerAttention is true when active worker attention items are present", () => {
    const result = evaluateSprintRunState({
      subtasks: [],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [
        createDummyAttentionItem({ ownerType: "worker", attentionType: "merge_conflict" } as any),
      ],
      sprintRunId: "run-1",
    });

    expect(result.waitingOnWorkerAttention).toBe(true);
  });

  it("allFinished is true when needsManualMerge is true and waitingOnWorkerAttention is false", () => {
    const manualTask = createDummySubtask({ status: "COMPLETED", merge_indicator: "MERGE_CONFLICT", worker_branch: "foo" });
    const result = evaluateSprintRunState({
      subtasks: [manualTask],
      manualMergeTasks: [manualTask],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });

    // Subtasks status is COMPLETED but not settled (missing merge evidence without worker_branch), so noMoreActionPossible=true, needsManualMerge=true
    expect(result.needsManualMerge).toBe(true);
    expect(result.waitingOnWorkerAttention).toBe(false);
    expect(result.allFinished).toBe(true);
  });

  it("allFinished is false when waitingOnWorkerAttention is true", () => {
    // If all tasks are terminal, allFinished will evaluate to true regardless of waitingOnWorkerAttention,
    // so we need to add a running/pending task, or make sure not all tasks are terminal.
    // In our logic, allTerminal is true if all tasks are settled or FAILED.
    // The manual task is COMPLETED with MERGE_CONFLICT, so it has no merge evidence and is_merged is false, wait, taskHasMergeEvidence checks worker_branch or pr_url.
    // If a task doesn't have worker_branch or pr_url, taskHasMergeEvidence is false.
    // isCompletedTaskSettled returns true if `isTaskCodeComplete && (isMergeSettled || !taskHasMergeEvidence)`
    // So if worker_branch is empty, it's considered settled.
    // Let's add worker_branch so taskHasMergeEvidence is true.
    const manualTask = createDummySubtask({ status: "COMPLETED", merge_indicator: "MERGE_CONFLICT", worker_branch: "foo" });
    const result = evaluateSprintRunState({
      subtasks: [manualTask],
      manualMergeTasks: [manualTask],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [
        createDummyAttentionItem({ ownerType: "worker", attentionType: "merge_conflict" } as any),
      ],
      sprintRunId: "run-1",
    });

    expect(result.needsManualMerge).toBe(true);
    expect(result.waitingOnWorkerAttention).toBe(true);
    expect(result.allFinished).toBe(false);
  });
});
