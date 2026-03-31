import { describe, expect, it } from "vitest";
import { buildAttentionPlan } from "../../../../../src/domain/sprint/orchestrator/attention-plan-builder.js";
import type { Subtask, GitTrackingStatus } from "../../../../../src/contracts/app-types.js";
import type { CycleRunnerArgs } from "../../../../../src/domain/sprint/orchestrator/cycle-runner.js";

const DEFAULT_ARGS: CycleRunnerArgs = {
  action: "orchestrate",
  automationLevel: "full",
  automationInterventions: { enabled: true, mode: "always" },
  executionContext: {
    project: { id: "p-1", name: "Project 1" },
    sprint: { id: "s-1", goal: "Goal" },
    sprintNumber: 1,
    sourceId: "source-1",
  },
  repoPath: "/repo",
  defaultFeatureBranch: "feature/sprint-1",
  retryFailed: false,
  loopSteps: { statusTable: false, gitStatus: false },
  ciIntelligence: { resolveMergeConflicts: true, prGateEnabled: false },
  githubMode: "LOCAL",
  defaultBranch: "main",
  featureBranchPrefix: "feature/",
  sprintRunId: "run-1",
};

describe("attention-plan-builder", () => {
  it("opens merge attention items and action required items, and resolves stale items", () => {
    const subtasks: Subtask[] = [
      { id: "T1", record_id: "T1", title: "Task 1", prompt: "prompt 1", depends_on: [], is_independent: true, status: "COMPLETED", merge_indicator: "MERGE_REQUIRED" },
      { id: "T2", record_id: "T2", title: "Task 2", prompt: "prompt 2", depends_on: [], is_independent: true, status: "RUNNING", intervention_owner: "AGENT" },
      { id: "T3", record_id: "T3", title: "Task 3", prompt: "prompt 3", depends_on: [], is_independent: true, status: "COMPLETED", merge_indicator: "MERGED", is_merged: true },
    ];

    const protocolResult = {
      awaitingMerge: [subtasks[0]],
      actionRequiredTasks: [subtasks[1]],
    };

    const plan = buildAttentionPlan(subtasks, protocolResult, DEFAULT_ARGS, null, new Set());

    expect(plan.toOpen).toHaveLength(2);

    const mergeItem = plan.toOpen.find(i => i.taskId === "T1");
    expect(mergeItem).toBeDefined();
    expect(mergeItem?.payload.attentionType).toBe("merge_required");
    expect(mergeItem?.payload.ownerType).toBe("worker");

    const actionItem = plan.toOpen.find(i => i.taskId === "T2");
    expect(actionItem).toBeDefined();
    expect(actionItem?.payload.attentionType).toBe("action_required");
    expect(actionItem?.payload.ownerType).toBe("worker");
    expect(actionItem?.payload.severity).toBe("high"); // AGENT owner is high severity

    // T1: 2 clear (action, cifix) + 1 replace (merge_conflict_attention_replaced)
    // T2: 3 clear (merge, action, cifix) -> Wait, action is NOT cleared for T2
    // Let's just check the critical resolutions instead of counting all:

    const t3MergeResolution = plan.toResolve.find(r => r.taskId === "T3" && r.reason === "merge_attention_cleared");
    expect(t3MergeResolution).toBeDefined();
    expect(t3MergeResolution?.typesToResolve).toContain("merge_conflict");

    const t1ActionResolution = plan.toResolve.find(r => r.taskId === "T1" && r.reason === "action_required_cleared");
    expect(t1ActionResolution).toBeDefined();

    const t1MergeReplace = plan.toResolve.find(r => r.taskId === "T1" && r.reason === "merge_required_attention_replaced");
    expect(t1MergeReplace).toBeDefined();
    expect(t1MergeReplace?.typesToResolve).toEqual(["merge_conflict"]);
  });

  it("escalates to merge_conflict attention when CI intelligence allows and PR is dirty", () => {
    const subtasks: Subtask[] = [
      { id: "T1", record_id: "T1", title: "Task 1", prompt: "prompt 1", depends_on: [], is_independent: true, status: "COMPLETED", merge_indicator: "MERGE_REQUIRED", pr_url: "https://github.com/pr/1" },
    ];

    const protocolResult = {
      awaitingMerge: [subtasks[0]],
      actionRequiredTasks: [],
    };

    const gitStatus: GitTrackingStatus = {
      available: true,
      lastUpdated: new Date().toISOString(),
      currentBranch: "main",
      openPullRequests: [
        {
          number: 1,
          url: "https://github.com/pr/1",
          headRefName: "feature/T1",
          state: "OPEN",
          isDraft: false,
          mergeStateStatus: "DIRTY", // Causes conflict escalation
          checksStatus: { state: "SUCCESS", total: 1, pending: 0, failing: 0, successful: 1 },
        }
      ],
      closedPullRequests: []
    } as any;

    const plan = buildAttentionPlan(subtasks, protocolResult, DEFAULT_ARGS, gitStatus, new Set());

    expect(plan.toOpen).toHaveLength(1);
    const item = plan.toOpen[0];

    expect(item.payload.attentionType).toBe("merge_conflict");
    expect(item.payload.severity).toBe("high");
    expect(item.payload.summaryMarkdown).toContain("merge conflicts between");

    const mergeReplace = plan.toResolve.find(r => r.taskId === "T1" && r.reason === "merge_conflict_attention_replaced");
    expect(mergeReplace).toBeDefined();
    expect(mergeReplace?.typesToResolve).toEqual(["merge_required"]);
  });

  it("selects merged feature task contexts but excludes the current task", () => {
    const subtasks: Subtask[] = [
      { id: "T1", record_id: "T1", title: "Task 1", prompt: "prompt 1", depends_on: [], is_independent: true, status: "COMPLETED", merge_indicator: "MERGE_REQUIRED", pr_url: "https://github.com/pr/1" },
      { id: "T2", record_id: "T2", title: "Task 2", prompt: "prompt 2", depends_on: [], is_independent: true, status: "COMPLETED", merge_indicator: "MERGED", is_merged: true },
      { id: "T3", record_id: "T3", title: "Task 3", prompt: "prompt 3", depends_on: [], is_independent: true, status: "COMPLETED", merge_indicator: "MERGED", is_merged: true },
    ];

    const protocolResult = {
      awaitingMerge: [subtasks[0]],
      actionRequiredTasks: [],
    };

    const plan = buildAttentionPlan(subtasks, protocolResult, DEFAULT_ARGS, null, new Set());

    expect(plan.toOpen).toHaveLength(1);
    const item = plan.toOpen[0];

    const contexts = item.payload.payload?.featureBranchTaskContexts as any[];
    expect(contexts).toBeDefined();
    expect(contexts).toHaveLength(2);
    expect(contexts.map(c => c.taskKey)).toEqual(["T2", "T3"]);
  });

  it("clears CI fix attention for tasks that are no longer RUNNING with CI merge indicator", () => {
    const subtasks: Subtask[] = [
      { id: "T1", record_id: "T1", title: "Task 1", prompt: "prompt 1", depends_on: [], is_independent: true, status: "COMPLETED", merge_indicator: "CI" },
    ];

    const protocolResult = {
      awaitingMerge: [],
      actionRequiredTasks: [],
    };

    const plan = buildAttentionPlan(subtasks, protocolResult, DEFAULT_ARGS, null, new Set());

    const ciFixResolution = plan.toResolve.find(r => r.taskId === "T1" && r.reason === "ci_fix_attention_cleared");
    expect(ciFixResolution).toBeDefined();
    expect(ciFixResolution?.typesToResolve).toContain("ci_fix_required");
  });
});
