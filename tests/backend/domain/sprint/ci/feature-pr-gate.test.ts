import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs/promises";
import { FeaturePrGateService, CiGateContext } from "../../../../../src/domain/sprint/ci/feature-pr-gate.js";
import type { Subtask, GitTrackingStatus } from "../../../../../src/contracts/app-types.js";

vi.mock("fs/promises");

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
      subtasksDir: "/repo/subtasks",
      featureBranch: "feature/sprint1",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      ciIntelligence: {
        enabled: true,
        enableLivePrMonitoring: true,
        waitForCiBeforeMainMerge: true,
        resolveAllCommentsBeforeMainMerge: true,
        waitForCiBeforeFeatureMerge: true,
        resolveAllCommentsBeforeFeatureMerge: true,
        waitForJulesCiAutofix: true,
        julesCiAutofixMaxRetries: 3,
        featurePrAutoMergeMode: "OFF",
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
      } as unknown as GitTrackingStatus,
      ciAutofixRetryCounts: new Map(),
      isJulesApiConfigured: vi.fn().mockReturnValue(true),
      sendSessionMessage: vi.fn().mockResolvedValue(undefined),
      autoMergeFeaturePr: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  it("updates task to MERGED when green and auto-merge is ON", async () => {
    context.ciIntelligence.featurePrAutoMergeMode = "WHEN_GREEN";
    vi.mocked(fs.readFile).mockResolvedValue("merged: false\nprompt: test");

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].is_merged).toBe(true);
    expect(result.subtasks[0].merge_indicator).toBe("AUTOMERGE");
    expect(context.autoMergeFeaturePr).toHaveBeenCalledWith({ repoPath: "/repo", prNumber: 101 });
    expect(fs.writeFile).toHaveBeenCalled();
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
  });

  it("stays in RUNNING if no matching PR is found", async () => {
    context.gitStatus.openPullRequests = [];

    const result = await service.evaluateCiGate(subtasks, context);

    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(result.subtasks[0].merge_indicator).toBe("CI");
    expect(result.reportText).toContain("no open feature PR could be matched");
  });
});
