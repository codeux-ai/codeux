import { describe, it, expect, vi, beforeEach } from "vitest";
import { FeaturePrGateService, CiGateContext } from "../../../../../src/domain/sprint/ci/feature-pr-gate.js";
import type { Subtask, GitTrackingStatus } from "../../../../../src/contracts/app-types.js";

describe("FeaturePrGateService", () => {
  let service: FeaturePrGateService;
  let context: CiGateContext;
  let subtasks: Subtask[];

  beforeEach(() => {
    vi.resetAllMocks();
    service = new FeaturePrGateService();
    
    subtasks = [
      {
        id: "T1",
        record_id: "task-record-1",
        title: "Task 1",
        prompt: "Prompt 1",
        depends_on: [],
        status: "COMPLETED",
        is_independent: true,
        worker_branch: "feat/T1",
        session_id: "session-123",
      }
    ];

    context = {
      automationLevel: "FULL",
      repoPath: "/repo",
      featureBranch: "feature/sprint1",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      ciIntelligence: {
        enabled: true,
        enableLivePrMonitoring: true,
        waitForCiBeforeMainMerge: true,
        resolveAllCommentsBeforeMainMerge: true,
        resolveMainMergeConflicts: false,
        waitForCiBeforeFeatureMerge: true,
        resolveAllCommentsBeforeFeatureMerge: true,
        resolveMergeConflicts: false,
        waitForJulesCiAutofix: true,
        julesCiAutofixMaxRetries: 3,
        featurePrAutoMergeMode: "OFF",
        mainBranchAutoMergeMode: "OFF",
      },
      githubMode: "REMOTE",
      gitStatus: {
        available: true,
        openPullRequests: [
          {
            number: 101,
            title: "PR 101",
            url: "https://github.com/repo/pull/101",
            state: "OPEN",
            isDraft: false,
            headRefName: "feat/T1",
            baseRefName: "feature/sprint1",
            checks: [
              { name: "build", status: "completed", conclusion: "success" }
            ],
            comments: 0,
            reviewDecision: "APPROVED",
          }
        ],
        ciRuns: [],
        mergedPullRequests: [],
      } as unknown as GitTrackingStatus,
      ciAutofixRetryCounts: new Map(),
      isJulesApiConfigured: vi.fn().mockReturnValue(true),
      sendSessionMessage: vi.fn().mockResolvedValue(undefined),
      autoMergeFeaturePr: vi.fn().mockResolvedValue({ ok: true }),
      persistMergedTask: vi.fn().mockResolvedValue(undefined),
      executionRepository: {
        getLatestTaskRun: vi.fn().mockReturnValue({ id: "run-1" }),
        appendTaskRunEvent: vi.fn(),
      } as any,
      sprintRunId: "sprint-run-1",
    };
  });

  it("updates task to MERGED when green and auto-merge is ON", async () => {
    context.ciIntelligence.featurePrAutoMergeMode = "WHEN_GREEN";
    context.autoMergeFeaturePr = vi.fn().mockResolvedValue({
      ok: true,
      merged: true,
      autoMergeScheduled: false,
    });

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].is_merged).toBe(true);
    expect(result.subtasks[0].merge_indicator).toBe("AUTOMERGE");
    expect(context.autoMergeFeaturePr).toHaveBeenCalledWith({ repoPath: "/repo", prNumber: 101 });
    expect(context.persistMergedTask).toHaveBeenCalledWith(expect.objectContaining({ id: "T1", is_merged: true }));
    expect(context.executionRepository?.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "ci_gate_status",
      "system",
      expect.objectContaining({ state: "automerge_succeeded", prNumber: 101 }),
      expect.any(Object),
    );
  });

  it("keeps task in RUNNING while GitHub has only armed auto-merge", async () => {
    context.ciIntelligence.featurePrAutoMergeMode = "WHEN_GREEN";
    context.autoMergeFeaturePr = vi.fn().mockResolvedValue({
      ok: true,
      merged: false,
      autoMergeScheduled: true,
      message: "Auto-merge is enabled and waiting for branch protection.",
    });

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(result.subtasks[0].is_merged).toBeFalsy();
    expect(result.subtasks[0].merge_indicator).toBe("CI");
    expect(result.reportText).toContain("Auto-Merge Armed");
    expect(context.executionRepository?.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "ci_gate_status",
      "system",
      expect.objectContaining({ state: "automerge_scheduled", prNumber: 101 }),
      expect.any(Object),
    );
  });

  it("keeps task awaiting merge and marks a merge conflict when auto-merge fails with a conflict", async () => {
    context.ciIntelligence.featurePrAutoMergeMode = "WHEN_GREEN";
    context.autoMergeFeaturePr = vi.fn().mockResolvedValue({
      ok: false,
      mergeConflict: true,
      message: "Merge conflict detected while merging PR.",
    });

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("CODING_COMPLETED");
    expect(result.subtasks[0].is_merged).toBeFalsy();
    expect(result.subtasks[0].merge_indicator).toBe("MERGE_CONFLICT");
    expect(result.reportText).toContain("Auto-Merge Failed");
    expect(context.executionRepository?.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "ci_gate_status",
      "system",
      expect.objectContaining({ state: "automerge_conflict", prNumber: 101 }),
      expect.any(Object),
    );
  });

  it("keeps task in RUNNING with CI indicator if checks are pending", async () => {
    context.gitStatus.openPullRequests[0].checks = [
      { name: "build", status: "in_progress", conclusion: null }
    ];

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(result.subtasks[0].merge_indicator).toBe("CI");
    expect(result.reportText).toContain("stays in progress");
    expect(result.reportText).toContain("CI Status: `PENDING`バランス".replace("バランス", ""));
    expect(context.executionRepository?.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "ci_gate_status",
      "system",
      expect.objectContaining({ state: "waiting_checks", prNumber: 101, hasPendingChecks: true }),
      expect.any(Object),
    );
  });

  it("does not auto-merge in always mode while CI waiting is enabled and checks are pending", async () => {
    context.ciIntelligence.featurePrAutoMergeMode = "ALWAYS";
    context.gitStatus.openPullRequests[0].checks = [
      { name: "build", status: "in_progress", conclusion: null }
    ];

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(result.subtasks[0].is_merged).toBeFalsy();
    expect(result.subtasks[0].merge_indicator).toBe("CI");
    expect(context.autoMergeFeaturePr).not.toHaveBeenCalled();
    expect(result.reportText).toContain("CI Status: `PENDING`");
  });

  it("triggers CI autofix when checks fail", async () => {
    context.gitStatus.openPullRequests[0].checks = [
      { name: "build", status: "completed", conclusion: "failure" }
    ];
    context.gitStatus.ciRuns = [
      {
        id: 1,
        name: "build",
        workflowName: "CI",
        status: "completed",
        conclusion: "failure",
        headBranch: "feat/T1",
        url: "https://github.com/repo/actions/runs/1",
      }
    ] as any;

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(context.sendSessionMessage).toHaveBeenCalled();
    expect(context.ciAutofixRetryCounts.get("session-123:101")).toBe(1);
    expect(result.reportText).toContain("Jules session notified to fix CI");
  });

  it("blocks task when autofix retries are exhausted", async () => {
    context.gitStatus.openPullRequests[0].checks = [
      { name: "build", status: "completed", conclusion: "failure" }
    ];
    context.ciAutofixRetryCounts.set("session-123:101", 3);

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("BLOCKED");
    expect(result.subtasks[0].intervention_owner).toBe("AGENT");
    expect(result.reportText).toContain("CI autofix retries exhausted");
    expect(context.executionRepository?.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "ci_gate_status",
      "system",
      expect.objectContaining({ state: "blocked", prNumber: 101, hasFailedChecks: true }),
      expect.any(Object),
    );
  });

  it("stays in RUNNING if no matching PR is found", async () => {
    context.gitStatus.openPullRequests = [];

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(result.subtasks[0].merge_indicator).toBe("CI");
    expect(result.reportText).toContain("no open feature PR could be matched");
    expect(context.executionRepository?.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "ci_gate_status",
      "system",
      expect.objectContaining({ state: "waiting_for_pr", featureBranch: "feature/sprint1" }),
      expect.any(Object),
    );
  });

  it("keeps completed no-output tasks completed when there is no PR evidence to merge", async () => {
    subtasks[0].worker_branch = undefined;
    subtasks[0].pr_url = undefined;
    context.gitStatus.openPullRequests = [];

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("COMPLETED");
    expect(result.subtasks[0].merge_indicator).toBeUndefined();
    expect(result.reportText).toBe("");
    expect(context.executionRepository?.appendTaskRunEvent).not.toHaveBeenCalled();
  });

  it("calls openCiFixAttention for non-Jules tasks with failed CI", async () => {
    subtasks[0].session_id = undefined;
    subtasks[0].provider = "gemini" as any;
    context.gitStatus.openPullRequests[0].checks = [
      { name: "build", status: "completed", conclusion: "failure" }
    ];
    context.openCiFixAttention = vi.fn();

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(context.openCiFixAttention).toHaveBeenCalledWith(
      expect.objectContaining({ id: "T1" }),
      expect.objectContaining({ prNumber: 101, branchName: "feat/T1" }),
    );
  });

  it("does not call openCiFixAttention for Jules-managed tasks", async () => {
    context.gitStatus.openPullRequests[0].checks = [
      { name: "build", status: "completed", conclusion: "failure" }
    ];
    context.openCiFixAttention = vi.fn();

    await service.evaluateCiGate(subtasks, context);

    expect(context.openCiFixAttention).not.toHaveBeenCalled();
    expect(context.sendSessionMessage).toHaveBeenCalled();
  });

  it("confirms the task as merged when the PR has already landed", async () => {
    context.gitStatus.openPullRequests = [];
    context.gitStatus.mergedPullRequests = [
      {
        number: 101,
        title: "PR 101",
        url: "https://github.com/repo/pull/101",
        headRefName: "feat/T1",
        baseRefName: "feature/sprint1",
        mergedAt: "2026-03-15T08:00:00.000Z",
        mergedBy: "octocat",
      },
    ] as any;

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("COMPLETED");
    expect(result.subtasks[0].is_merged).toBe(true);
    expect(result.subtasks[0].merge_indicator).toBe("MERGED");
    expect(context.persistMergedTask).toHaveBeenCalledWith(expect.objectContaining({ id: "T1", is_merged: true }));
    expect(result.reportText).toContain("Feature PR Merged");
  });
});
