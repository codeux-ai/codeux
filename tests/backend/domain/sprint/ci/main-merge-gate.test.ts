import { describe, expect, it, vi } from "vitest";
import { MainMergeGateService, type MergeFeedbackContext } from "../../../../../src/domain/sprint/ci/main-merge-gate.js";
import { MergeConflictDebouncer } from "../../../../../src/domain/sprint/ci/merge-conflict-debouncer.js";
import type { GitTrackingStatus, CiIntelligenceSettings } from "../../../../../src/contracts/app-types.js";

describe("MainMergeGateService", () => {
  const defaultCiSettings: CiIntelligenceSettings = {
    enabled: true,
    enableLivePrMonitoring: true,
    resolveAllCommentsBeforeMainMerge: true,
    resolveMainMergeConflicts: false,
    resolveAllCommentsBeforeFeatureMerge: true,
    resolveMergeConflicts: false,
    waitForJulesCiAutofix: false,
    julesCiAutofixMaxRetries: 0,
    featurePrAutoMergeMode: "OFF",
    mainBranchAutoMergeMode: "WHEN_GREEN",
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

  it("treats an already merged main PR as settled", async () => {
    const context: MergeFeedbackContext = {
      ...defaultContext,
      gitStatus: {
        ...defaultContext.gitStatus!,
        mergedPullRequests: [
          {
            number: 101,
            title: "Sprint 1",
            url: "https://github.com/repo/pull/101",
            headRefName: "feature/sprint1",
            baseRefName: "main",
            mergedAt: "2026-04-01T00:00:00.000Z",
            mergedBy: "octocat",
          },
        ],
      },
    };

    const result = await MainMergeGateService.renderMergeFeedback(context);
    const structured = MainMergeGateService.evaluateMergeFeedback(context);

    expect(structured.state).toBe("merged");
    expect(result).toContain("already merged into `main`");
  });

  it("still reports missing main PR when CI wait is disabled but auto-merge mode is active", async () => {
    const result = await MainMergeGateService.renderMergeFeedback({
      ...defaultContext,
      ciIntelligence: {
        ...defaultCiSettings,
        mainBranchAutoMergeMode: "ALWAYS",
      },
    });
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
    const structured = MainMergeGateService.evaluateMergeFeedback(context);
    expect(result).toContain("Check Status: `FAILED`\n");
    expect(result).toContain("Failed checks: test");
    expect(result).toContain("Only approve merge into `main` after checks are green.");
    expect(structured).toMatchObject({
      state: "failed_checks",
      prNumber: 101,
      failedChecks: ["test"],
    });
  });

  it("reports merge conflicts before generic check state", async () => {
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
            mergeStateStatus: "DIRTY",
            reviewDecision: "APPROVED",
            comments: 0,
            checks: [
              { name: "test", status: "completed", conclusion: "success" },
            ],
          } as any,
        ],
      },
    };

    const structured = MainMergeGateService.evaluateMergeFeedback(context);
    expect(structured).toMatchObject({
      state: "merge_conflict",
      hasMergeConflict: true,
      mergeStateStatus: "DIRTY",
    });
    expect(structured.text).toContain("Check Status: `DIRTY`");
    expect(structured.text).toContain("Merge into `main` is blocked until the conflict is resolved.");
  });

  it("debounces a transient DIRTY state and only confirms the conflict once it persists", async () => {
    const context: MergeFeedbackContext = {
      ...defaultContext,
      mergeConflictDebouncer: new MergeConflictDebouncer(),
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
            mergeStateStatus: "DIRTY",
            reviewDecision: "APPROVED",
            comments: 0,
            checks: [{ name: "test", status: "completed", conclusion: "success" }],
          } as any,
        ],
      },
    };

    // First DIRTY reading: not yet a confirmed conflict — GitHub may still be
    // recomputing mergeability, so the gate must not pause the sprint.
    context.mergeConflictDebouncer!.beginCycle();
    const first = MainMergeGateService.evaluateMergeFeedback(context);
    expect(first.hasMergeConflict).toBe(false);
    expect(first.state).not.toBe("merge_conflict");

    // Still DIRTY on the next cycle: now it is a real conflict.
    context.mergeConflictDebouncer!.beginCycle();
    const second = MainMergeGateService.evaluateMergeFeedback(context);
    expect(second.hasMergeConflict).toBe(true);
    expect(second.state).toBe("merge_conflict");
  });

  it("clears a debounced DIRTY streak when the PR reports a mergeable state again", async () => {
    const debouncer = new MergeConflictDebouncer();
    const dirtyContext: MergeFeedbackContext = {
      ...defaultContext,
      mergeConflictDebouncer: debouncer,
      gitStatus: {
        ...defaultContext.gitStatus!,
        openPullRequests: [
          {
            number: 101, title: "Sprint 1", url: "https://github.com/repo/pull/101", state: "OPEN",
            isDraft: false, headRefName: "feature/sprint1", baseRefName: "main",
            mergeStateStatus: "DIRTY", reviewDecision: "APPROVED", comments: 0,
            checks: [{ name: "test", status: "completed", conclusion: "success" }],
          } as any,
        ],
      },
    };

    debouncer.beginCycle();
    expect(MainMergeGateService.evaluateMergeFeedback(dirtyContext).hasMergeConflict).toBe(false);

    // The transient DIRTY clears (UNKNOWN → recomputed) before it ever confirmed.
    const cleanContext: MergeFeedbackContext = {
      ...dirtyContext,
      gitStatus: {
        ...dirtyContext.gitStatus!,
        openPullRequests: [{ ...(dirtyContext.gitStatus!.openPullRequests[0] as any), mergeStateStatus: "UNKNOWN" }],
      },
    };
    debouncer.beginCycle();
    expect(MainMergeGateService.evaluateMergeFeedback(cleanContext).hasMergeConflict).toBe(false);

    // A later DIRTY starts a fresh streak — one reading is still not a conflict.
    debouncer.beginCycle();
    expect(MainMergeGateService.evaluateMergeFeedback(dirtyContext).hasMergeConflict).toBe(false);
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

  it("treats the main PR as ready when CI waiting is disabled", async () => {
    const context: MergeFeedbackContext = {
      ...defaultContext,
      ciIntelligence: {
        ...defaultCiSettings,
        resolveAllCommentsBeforeMainMerge: false,
        mainBranchAutoMergeMode: "ALWAYS",
      },
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
            comments: 2,
            checks: [],
          } as any,
        ],
      },
    };

    const structured = MainMergeGateService.evaluateMergeFeedback(context);
    expect(structured.state).toBe("ready_for_merge");
    expect(structured.hasPendingChecks).toBe(false);
    expect(structured.hasReviewBlockers).toBe(false);
    expect(structured.text).toContain("eligible to proceed without waiting for CI");
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

  describe("attemptMainAutoMerge", () => {
    const greenPrContext: MergeFeedbackContext = {
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

    it("does not auto-merge when mainBranchAutoMergeMode is OFF", async () => {
      const feedback = MainMergeGateService.evaluateMergeFeedback(greenPrContext);
      const autoMergePr = vi.fn();
      const result = await MainMergeGateService.attemptMainAutoMerge(feedback, {
        ...greenPrContext,
        ciIntelligence: { ...defaultCiSettings, mainBranchAutoMergeMode: "OFF" },
        autoMergeMainBranchPr: autoMergePr,
      });

      expect(autoMergePr).not.toHaveBeenCalled();
      expect(result.state).toBe("ready_for_merge");
    });

    it("auto-merges when WHEN_GREEN and state is ready_for_merge", async () => {
      const feedback = MainMergeGateService.evaluateMergeFeedback(greenPrContext);
      const autoMergePr = vi.fn().mockResolvedValue({ ok: true, merged: true });
      const result = await MainMergeGateService.attemptMainAutoMerge(feedback, {
        ...greenPrContext,
        ciIntelligence: { ...defaultCiSettings, mainBranchAutoMergeMode: "WHEN_GREEN" },
        autoMergeMainBranchPr: autoMergePr,
      });

      expect(autoMergePr).toHaveBeenCalledWith({ repoPath: "/repo", prNumber: 101 });
      expect(result.state).toBe("automerge_succeeded");
      expect(result.text).toContain("Auto-Merged");
    });

    it("does not auto-merge when WHEN_GREEN and checks are pending", async () => {
      const pendingContext: MergeFeedbackContext = {
        ...greenPrContext,
        gitStatus: {
          ...greenPrContext.gitStatus!,
          openPullRequests: [
            {
              ...greenPrContext.gitStatus!.openPullRequests[0],
              checks: [{ name: "test", status: "in_progress", conclusion: null }],
            } as any,
          ],
        },
      };
      const feedback = MainMergeGateService.evaluateMergeFeedback(pendingContext);
      const autoMergePr = vi.fn();
      const result = await MainMergeGateService.attemptMainAutoMerge(feedback, {
        ...pendingContext,
        ciIntelligence: { ...defaultCiSettings, mainBranchAutoMergeMode: "WHEN_GREEN" },
        autoMergeMainBranchPr: autoMergePr,
      });

      expect(autoMergePr).not.toHaveBeenCalled();
      expect(result.state).toBe("pending_checks");
    });

    it("auto-merges when ALWAYS and no review blockers, ignoring CI", async () => {
      const feedback = MainMergeGateService.evaluateMergeFeedback(greenPrContext);
      const autoMergePr = vi.fn().mockResolvedValue({ ok: true, merged: true });
      const result = await MainMergeGateService.attemptMainAutoMerge(feedback, {
        ...greenPrContext,
        ciIntelligence: { ...defaultCiSettings, mainBranchAutoMergeMode: "ALWAYS" },
        autoMergeMainBranchPr: autoMergePr,
      });

      expect(autoMergePr).toHaveBeenCalled();
      expect(result.state).toBe("automerge_succeeded");
    });

    it("auto-merges when ALWAYS even if checks are absent", async () => {
      const noChecksContext: MergeFeedbackContext = {
        ...greenPrContext,
        ciIntelligence: { ...defaultCiSettings, mainBranchAutoMergeMode: "ALWAYS" },
        gitStatus: {
          ...greenPrContext.gitStatus!,
          openPullRequests: [
            {
              ...greenPrContext.gitStatus!.openPullRequests[0],
              checks: [],
            } as any,
          ],
        },
      };
      const feedback = MainMergeGateService.evaluateMergeFeedback(noChecksContext);
      const autoMergePr = vi.fn().mockResolvedValue({ ok: true, merged: true });
      const result = await MainMergeGateService.attemptMainAutoMerge(feedback, {
        ...noChecksContext,
        ciIntelligence: { ...defaultCiSettings, mainBranchAutoMergeMode: "ALWAYS" },
        autoMergeMainBranchPr: autoMergePr,
      });

      expect(feedback.state).toBe("ready_for_merge");
      expect(autoMergePr).toHaveBeenCalledWith({ repoPath: "/repo", prNumber: 101 });
      expect(result.state).toBe("automerge_succeeded");
    });

    it("auto-merges when ALWAYS even if checks are pending", async () => {
      const pendingContext: MergeFeedbackContext = {
        ...greenPrContext,
        ciIntelligence: { ...defaultCiSettings, mainBranchAutoMergeMode: "ALWAYS" },
        gitStatus: {
          ...greenPrContext.gitStatus!,
          openPullRequests: [
            {
              ...greenPrContext.gitStatus!.openPullRequests[0],
              checks: [{ name: "test", status: "in_progress", conclusion: null }],
            } as any,
          ],
        },
      };
      const feedback = MainMergeGateService.evaluateMergeFeedback(pendingContext);
      const autoMergePr = vi.fn().mockResolvedValue({ ok: true, merged: true });
      const result = await MainMergeGateService.attemptMainAutoMerge(feedback, {
        ...pendingContext,
        ciIntelligence: { ...defaultCiSettings, mainBranchAutoMergeMode: "ALWAYS" },
        autoMergeMainBranchPr: autoMergePr,
      });

      expect(feedback.state).toBe("ready_for_merge");
      expect(autoMergePr).toHaveBeenCalledWith({ repoPath: "/repo", prNumber: 101 });
      expect(result.state).toBe("automerge_succeeded");
    });

    it("handles auto-merge failure gracefully", async () => {
      const feedback = MainMergeGateService.evaluateMergeFeedback(greenPrContext);
      const autoMergePr = vi.fn().mockResolvedValue({ ok: false, message: "branch protection" });
      const result = await MainMergeGateService.attemptMainAutoMerge(feedback, {
        ...greenPrContext,
        ciIntelligence: { ...defaultCiSettings, mainBranchAutoMergeMode: "WHEN_GREEN" },
        autoMergeMainBranchPr: autoMergePr,
      });

      expect(result.state).toBe("automerge_failed");
      expect(result.text).toContain("Auto-Merge Failed");
      expect(result.text).toContain("branch protection");
    });

    it("reports auto-merge scheduled state", async () => {
      const feedback = MainMergeGateService.evaluateMergeFeedback(greenPrContext);
      const autoMergePr = vi.fn().mockResolvedValue({ ok: true, autoMergeScheduled: true, message: "Waiting for branch protection." });
      const result = await MainMergeGateService.attemptMainAutoMerge(feedback, {
        ...greenPrContext,
        ciIntelligence: { ...defaultCiSettings, mainBranchAutoMergeMode: "WHEN_GREEN" },
        autoMergeMainBranchPr: autoMergePr,
      });

      expect(result.state).toBe("automerge_scheduled");
      expect(result.text).toContain("Auto-Merge Armed");
    });
  });
});
