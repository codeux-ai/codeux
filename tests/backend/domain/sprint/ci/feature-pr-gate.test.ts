import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FeaturePrGateService, CiGateContext } from "../../../../../src/domain/sprint/ci/feature-pr-gate.js";
import * as prMatcher from "../../../../../src/domain/sprint/ci/feature-pr/pr-matcher.js";
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
        resolveAllCommentsBeforeMainMerge: true,
        resolveMainMergeConflicts: false,
        resolveAllCommentsBeforeFeatureMerge: true,
        resolveMergeConflicts: false,
        waitForJulesCiAutofix: true,
        julesCiAutofixMaxRetries: 3,
        featurePrAutoMergeMode: "WHEN_GREEN",
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
      logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      } as any,
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

  it("marks task as completed with PR_ONLY indicator when featurePrAutoMergeMode is CREATE_PR", async () => {
    // Override the autoMergeMode
    context.ciIntelligence.featurePrAutoMergeMode = "CREATE_PR" as any;

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("COMPLETED");
    expect(result.subtasks[0].merge_indicator).toBe("PR_ONLY");
    expect(context.autoMergeFeaturePr).not.toHaveBeenCalled();
    expect(result.reportText).toContain("PR Created (no merge)");
    expect(context.executionRepository?.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "ci_gate_status",
      "system",
      expect.objectContaining({ state: "pr_created_no_merge", prNumber: 101 }),
      expect.any(Object),
    );
  });

  it("blocks merge readiness while task QA has not cleared", async () => {
    context.ciIntelligence.featurePrAutoMergeMode = "WHEN_GREEN";
    context.evaluateTaskQaGate = vi.fn().mockReturnValue({
      mergeAllowed: false,
      reason: "pending_review",
      summary: "QA review is still running.",
      latestRun: null,
      runsUsed: 0,
      maxRuns: 2,
    });

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("CODING_COMPLETED");
    expect(result.subtasks[0].merge_indicator).toBe("QA_PENDING");
    expect(result.reportText).toContain("QA Gate");
    expect(context.autoMergeFeaturePr).not.toHaveBeenCalled();
    expect(context.executionRepository?.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "ci_gate_status",
      "system",
      expect.objectContaining({ state: "qa_blocked", reason: "pending_review" }),
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

  it("marks the task as a merge conflict before waiting on CI when the PR is DIRTY", async () => {
    context.gitStatus.openPullRequests[0].mergeStateStatus = "DIRTY";
    context.gitStatus.openPullRequests[0].checks = [];

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("CODING_COMPLETED");
    expect(result.subtasks[0].merge_indicator).toBe("MERGE_CONFLICT");
    expect(result.reportText).toContain("Feature PR Merge Conflict");
    expect(context.autoMergeFeaturePr).not.toHaveBeenCalled();
    expect(context.executionRepository?.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "ci_gate_status",
      "system",
      expect.objectContaining({ state: "merge_conflict", prNumber: 101, mergeStateStatus: "DIRTY" }),
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

  it("skips CI waiting when no PR-triggered workflow matches the feature branch", async () => {
    const repoPath = await createTempRepoWithWorkflow(`
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
    `);
    context.repoPath = repoPath;
    context.gitStatus.openPullRequests[0].checks = [];
    context.autoMergeFeaturePr = undefined;

    try {
      const result = await service.evaluateCiGate(subtasks, context);

      expect(result.subtasks[0].status).toBe("CODING_COMPLETED");
      expect(result.subtasks[0].merge_indicator).toBeUndefined();
      expect(result.reportText).toContain("Feature PR Ready");
      expect(result.reportText).toContain("CI wait skipped for base `feature/sprint1`");
      expect(result.reportText).toContain("no PR-triggered workflow matches this base branch");
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it("auto-merges in always mode even while checks are pending", async () => {
    context.ciIntelligence.featurePrAutoMergeMode = "ALWAYS";
    context.gitStatus.openPullRequests[0].checks = [
      { name: "build", status: "in_progress", conclusion: null }
    ];

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("COMPLETED");
    expect(result.subtasks[0].is_merged).toBe(true);
    expect(result.subtasks[0].merge_indicator).toBe("AUTOMERGE");
    expect(context.autoMergeFeaturePr).toHaveBeenCalledWith({ repoPath: "/repo", prNumber: 101 });
    expect(result.reportText).toContain("Auto-Merged");
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

  it("normalizes pre-processing state before PR/CI processing", async () => {
    subtasks[0].status = "CODING_COMPLETED";
    subtasks[0].is_merged = true;
    subtasks[0].merge_indicator = "CI" as any;
    subtasks[0].intervention_owner = "AGENT";
    subtasks[0].intervention_hint = "pending";
    context.ciIntelligence.enabled = false;

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("COMPLETED");
    expect(result.subtasks[0].merge_indicator).toBe("MERGED");
    expect(result.subtasks[0].intervention_owner).toBeUndefined();
    expect(result.subtasks[0].intervention_hint).toBeUndefined();
  });

  it("preserves MERGE_CONFLICT during pre-processing when merge evidence exists", async () => {
    subtasks[0].status = "COMPLETED";
    subtasks[0].merge_indicator = "MERGE_CONFLICT";
    context.ciIntelligence.enabled = false;

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("CODING_COMPLETED");
    expect(result.subtasks[0].merge_indicator).toBe("MERGE_CONFLICT");
  });

  it("calls openCiFixAttention for non-Jules tasks with failed CI", async () => {
    subtasks[0].session_id = undefined;
    subtasks[0].provider = "gemini" as any;
    context.gitStatus.openPullRequests[0].checks = [
      { name: "build", status: "completed", conclusion: "failure" }
    ];
    context.openCiFixAttentionItems = vi.fn();

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(context.openCiFixAttentionItems).toHaveBeenCalledWith([
      {
        task: expect.objectContaining({ id: "T1" }),
        payload: expect.objectContaining({ prNumber: 101, branchName: "feat/T1" })
      }
    ]);
  });

  it("waits for an already active worker CI fix attempt instead of consuming another retry", async () => {
    subtasks[0].session_id = undefined;
    subtasks[0].provider = "gemini" as any;
    context.gitStatus.openPullRequests[0].checks = [
      { name: "build", status: "completed", conclusion: "failure" }
    ];
    context.ciAutofixRetryCounts.set("T1:101", 1);
    context.openCiFixAttentionItems = vi.fn();
    context.hasActiveWorkerCiFixAttempt = vi.fn().mockReturnValue(true);

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(context.openCiFixAttentionItems).not.toHaveBeenCalled();
    expect(context.ciAutofixRetryCounts.get("T1:101")).toBe(1);
    expect(result.reportText).toContain("Worker CI fix already running");
  });

  it("does not block a task at the retry limit while the current worker CI fix attempt is still active", async () => {
    subtasks[0].session_id = undefined;
    subtasks[0].provider = "gemini" as any;
    context.gitStatus.openPullRequests[0].checks = [
      { name: "build", status: "completed", conclusion: "failure" }
    ];
    context.ciAutofixRetryCounts.set("T1:101", 3);
    context.openCiFixAttentionItems = vi.fn();
    context.hasActiveWorkerCiFixAttempt = vi.fn().mockReturnValue(true);

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(result.subtasks[0].intervention_owner).toBeUndefined();
    expect(context.openCiFixAttentionItems).not.toHaveBeenCalled();
    expect(result.reportText).toContain("Worker CI fix already running");
  });

  it("does not call openCiFixAttention for Jules-managed tasks", async () => {
    context.gitStatus.openPullRequests[0].checks = [
      { name: "build", status: "completed", conclusion: "failure" }
    ];
    context.openCiFixAttentionItems = vi.fn();

    await service.evaluateCiGate(subtasks, context);

    expect(context.openCiFixAttentionItems).not.toHaveBeenCalled();
    expect(context.sendSessionMessage).toHaveBeenCalled();
  });

  it("routes task-processing failures through structured logging instead of console.error", async () => {
    const error = new Error("Mocked processing error");
    vi.spyOn(prMatcher, "matchPrForTask").mockImplementation(() => {
      throw error;
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await service.evaluateCiGate(subtasks, context);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(context.logger?.error).toHaveBeenCalledWith(
      `Error processing task ${subtasks[0].id}:`,
      { error }
    );
    // When the gate errors out processing a completed task, it normally puts it into CODING_COMPLETED if it has merge evidence
    expect(result.subtasks[0].status).toBe("CODING_COMPLETED");

    consoleErrorSpy.mockRestore();
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

async function createTempRepoWithWorkflow(workflowContent: string): Promise<string> {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "feature-pr-gate-"));
  const workflowDir = path.join(repoPath, ".github", "workflows");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "ci.yml"), workflowContent, "utf8");
  return repoPath;
}
