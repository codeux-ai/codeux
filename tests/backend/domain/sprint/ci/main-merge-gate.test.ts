import { describe, expect, it } from "vitest";
import { MainMergeGateService, type MergeFeedbackContext } from "../../../../../src/domain/sprint/ci/main-merge-gate.js";
import type { GitTrackingStatus, CiIntelligenceSettings } from "../../../../../src/contracts/app-types.js";

describe("MainMergeGateService", () => {
  const defaultCiSettings: CiIntelligenceSettings = {
    enabled: true,
    enableLivePrMonitoring: true,
    waitForCiBeforeMainMerge: true,
    resolveAllCommentsBeforeMainMerge: true,
    waitForCiBeforeFeatureMerge: true,
    resolveAllCommentsBeforeFeatureMerge: true,
    waitForJulesCiAutofix: false,
    julesCiAutofixMaxRetries: 0,
    featurePrAutoMergeMode: "OFF",
  };

  const defaultContext: MergeFeedbackContext = {
    repoPath: "/repo",
    featureBranch: "feature/sprint1",
    defaultBranch: "main",
    featureBranchPrefix: "feature/",
    ciIntelligence: defaultCiSettings,
    githubMode: "REMOTE",
    gitStatus: {
      available: true,
      mode: "REMOTE",
      branch: "feature/sprint1",
      openPullRequests: [],
      ciRuns: [],
      mergedPullRequests: [],
      tracking: { scope: "MAIN_MERGE_PR_CI", label: "Main Merge CI", branch: "feature/sprint1" },
      warnings: [],
      lastUpdated: new Date().toISOString(),
      dirty: false,
      hasRemote: true,
      repositoryRoot: "/repo",
    } as GitTrackingStatus,
  };

  it("returns empty string if CI intelligence is disabled", async () => {
    const context = {
      ...defaultContext,
      ciIntelligence: { ...defaultCiSettings, enabled: false },
    };
    const result = await MainMergeGateService.renderMergeFeedback(context);
    expect(result).toBe("");
  });

  it("returns info message if no open PR is found", async () => {
    const result = await MainMergeGateService.renderMergeFeedback(defaultContext);
    expect(result).toContain("No open PR `feature/sprint1 -> main` found");
  });

  it("reports failed checks", async () => {
    const context: MergeFeedbackContext = {
      ...defaultContext,
      gitStatus: {
        ...defaultContext.gitStatus!,
        openPullRequests: [
          {
            number: 101,
            title: "Sprint 1",
            url: "https://github.com/repo/pull/101",
            state: "OPEN",
            isDraft: false,
            headRefName: "feature/sprint1",
            baseRefName: "main",
            reviewDecision: "REVIEW_REQUIRED",
            comments: 0,
            checks: [
              { name: "test", status: "completed", conclusion: "failure" },
              { name: "lint", status: "completed", conclusion: "success" },
            ],
          } as any,
        ],
      },
    };
    const result = await MainMergeGateService.renderMergeFeedback(context);
    expect(result).toContain("Check Status: `FAILED`\n");
    expect(result).toContain("Failed checks: test");
    expect(result).toContain("Only approve merge into `main` after checks are green.");
  });

  it("reports pending checks", async () => {
    const context: MergeFeedbackContext = {
      ...defaultContext,
      gitStatus: {
        ...defaultContext.gitStatus!,
        openPullRequests: [
          {
            number: 101,
            title: "Sprint 1",
            url: "https://github.com/repo/pull/101",
            state: "OPEN",
            isDraft: false,
            headRefName: "feature/sprint1",
            baseRefName: "main",
            reviewDecision: "REVIEW_REQUIRED",
            comments: 0,
            checks: [
              { name: "test", status: "in_progress", conclusion: null },
            ],
          } as any,
        ],
      },
    };
    const result = await MainMergeGateService.renderMergeFeedback(context);
    expect(result).toContain("Check Status: `PENDING`\n");
    expect(result).toContain("Only approve merge into `main` once all required checks are green.");
  });

  it("reports success when all checks are green", async () => {
    const context: MergeFeedbackContext = {
      ...defaultContext,
      gitStatus: {
        ...defaultContext.gitStatus!,
        openPullRequests: [
          {
            number: 101,
            title: "Sprint 1",
            url: "https://github.com/repo/pull/101",
            state: "OPEN",
            isDraft: false,
            headRefName: "feature/sprint1",
            baseRefName: "main",
            reviewDecision: "APPROVED",
            comments: 0,
            checks: [
              { name: "test", status: "completed", conclusion: "success" },
            ],
          } as any,
        ],
      },
    };
    const result = await MainMergeGateService.renderMergeFeedback(context);
    expect(result).toContain("Check Status: `SUCCESS`\n");
    expect(result).toContain("✅ Required checks are green. Main merge can be approved");
  });

  it("reports review blockers", async () => {
    const context: MergeFeedbackContext = {
      ...defaultContext,
      gitStatus: {
        ...defaultContext.gitStatus!,
        openPullRequests: [
          {
            number: 101,
            title: "Sprint 1",
            url: "https://github.com/repo/pull/101",
            state: "OPEN",
            isDraft: false,
            headRefName: "feature/sprint1",
            baseRefName: "main",
            reviewDecision: "CHANGES_REQUESTED",
            comments: 1,
            checks: [
              { name: "test", status: "completed", conclusion: "success" },
            ],
          } as any,
        ],
      },
    };
    const result = await MainMergeGateService.renderMergeFeedback(context);
    expect(result).toContain("reviewDecision=CHANGES_REQUESTED");
    expect(result).toContain("Merge into `main` is blocked until open reviews/comments are resolved.");
  });
});
