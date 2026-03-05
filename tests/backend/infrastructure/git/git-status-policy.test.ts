import { describe, expect, it } from "vitest";
import {
  isFailedConclusion,
  normalizeBranch,
  buildTrackingTarget,
  filterOpenPrs,
  filterCiRuns,
  sortCiRunsNewestFirst,
  isRunFailed,
  trimLogExcerpt,
  filterMergedPrs,
} from "../../../../src/infrastructure/git/git-status-policy.js";
import { GitTrackingRequest, GitPullRequestStatus, GitCiRunStatus, GitMergeStatus } from "../../../../src/contracts/app-types.js";

describe("git-status-policy", () => {
  it("isFailedConclusion", () => {
    expect(isFailedConclusion("failure")).toBe(true);
    expect(isFailedConclusion("success")).toBe(false);
    expect(isFailedConclusion("neutral")).toBe(false);
    expect(isFailedConclusion("skipped")).toBe(false);
    expect(isFailedConclusion(null)).toBe(false);
    expect(isFailedConclusion("")).toBe(false);
  });

  it("normalizeBranch", () => {
    expect(normalizeBranch(" branch ")).toBe("branch");
    expect(normalizeBranch("")).toBeNull();
    expect(normalizeBranch(null)).toBeNull();
    expect(normalizeBranch(undefined)).toBeNull();
  });

  describe("buildTrackingTarget", () => {
    it("handles no request", () => {
      const res = buildTrackingTarget();
      expect(res.scope).toBe("REPOSITORY");
      expect(res.label).toBe("Repository-wide");
      expect(res.branch).toBeNull();
    });

    it("handles FEATURE_PR_CI", () => {
      const req: GitTrackingRequest = { scope: "FEATURE_PR_CI", featureBranch: "feat" };
      const res = buildTrackingTarget(req);
      expect(res.scope).toBe("FEATURE_PR_CI");
      expect(res.label).toBe("Feature PR CI (feat)");
      expect(res.branch).toBe("feat");
    });

    it("handles MAIN_MERGE_PR_CI", () => {
      const req: GitTrackingRequest = { scope: "MAIN_MERGE_PR_CI", featureBranch: "feat", defaultBranch: "main" };
      const res = buildTrackingTarget(req);
      expect(res.scope).toBe("MAIN_MERGE_PR_CI");
      expect(res.label).toBe("Main Merge PR CI (feat -> main)");
      expect(res.branch).toBe("main");
    });

    it("handles MAIN_BRANCH_CI", () => {
      const req: GitTrackingRequest = { scope: "MAIN_BRANCH_CI", defaultBranch: "main" };
      const res = buildTrackingTarget(req);
      expect(res.scope).toBe("MAIN_BRANCH_CI");
      expect(res.label).toBe("Main Branch CI (main)");
      expect(res.branch).toBe("main");
    });

    it("handles unknown", () => {
      const req = { scope: "UNKNOWN" } as any;
      const res = buildTrackingTarget(req);
      expect(res.scope).toBe("REPOSITORY");
    });
  });

  describe("filterOpenPrs", () => {
    const prs: GitPullRequestStatus[] = [
      { number: 1, baseRefName: "main", headRefName: "feat", title: "a", url: "", state: "", isDraft: false, mergeStateStatus: null, reviewDecision: null, updatedAt: null, comments: 0, checks: [] },
      { number: 2, baseRefName: "feat", headRefName: "worker", title: "b", url: "", state: "", isDraft: false, mergeStateStatus: null, reviewDecision: null, updatedAt: null, comments: 0, checks: [] },
    ];

    it("returns all if no tracking", () => {
      expect(filterOpenPrs(prs)).toEqual(prs);
    });

    it("filters FEATURE_PR_CI", () => {
      const res = filterOpenPrs(prs, { scope: "FEATURE_PR_CI", featureBranch: "feat" });
      expect(res).toHaveLength(1);
      expect(res[0].number).toBe(2);
    });

    it("filters MAIN_MERGE_PR_CI", () => {
      const res = filterOpenPrs(prs, { scope: "MAIN_MERGE_PR_CI", featureBranch: "feat", defaultBranch: "main" });
      expect(res).toHaveLength(1);
      expect(res[0].number).toBe(1);
    });

    it("returns all MAIN_MERGE_PR_CI if missing branches", () => {
      const res = filterOpenPrs(prs, { scope: "MAIN_MERGE_PR_CI" });
      expect(res).toEqual(prs);
    });

    it("filters MAIN_BRANCH_CI", () => {
      const res = filterOpenPrs(prs, { scope: "MAIN_BRANCH_CI", defaultBranch: "main" });
      expect(res).toHaveLength(1);
      expect(res[0].number).toBe(1);
    });

    it("returns all if unknown", () => {
      const res = filterOpenPrs(prs, { scope: "UNKNOWN" } as any);
      expect(res).toEqual(prs);
    });
  });

  describe("filterCiRuns", () => {
    const runs: GitCiRunStatus[] = [
      { id: 1, name: "1", status: "completed", conclusion: "success", headBranch: "main", event: "push", workflowName: "w1", url: "url1", updatedAt: "now" },
      { id: 2, name: "2", status: "completed", conclusion: "success", headBranch: "feat", event: "push", workflowName: "w2", url: "url2", updatedAt: "now" },
      { id: 3, name: "3", status: "completed", conclusion: "success", headBranch: "worker", event: "push", workflowName: "w3", url: "url3", updatedAt: "now" },
    ];

    it("returns all if no tracking", () => {
      expect(filterCiRuns(runs, [])).toEqual(runs);
    });

    it("filters MAIN_BRANCH_CI", () => {
      const res = filterCiRuns(runs, [], { scope: "MAIN_BRANCH_CI", defaultBranch: "main" });
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe(1);
    });

    it("filters FEATURE_PR_CI", () => {
      const prs: GitPullRequestStatus[] = [
        { number: 1, baseRefName: "feat", headRefName: "worker", title: "a", url: "", state: "", isDraft: false, mergeStateStatus: null, reviewDecision: null, updatedAt: null, comments: 0, checks: [] }
      ];
      const res = filterCiRuns(runs, prs, { scope: "FEATURE_PR_CI", featureBranch: "feat" });
      expect(res).toHaveLength(2); // feat + worker
      expect(res.map(r => r.id)).toEqual([2, 3]);
    });

    it("filters FEATURE_PR_CI returns empty if no heads", () => {
      const res = filterCiRuns(runs, [], { scope: "FEATURE_PR_CI" });
      expect(res).toHaveLength(0);
    });

    it("filters MAIN_MERGE_PR_CI", () => {
      const prs: GitPullRequestStatus[] = [
        { number: 1, baseRefName: "main", headRefName: "feat", title: "a", url: "", state: "", isDraft: false, mergeStateStatus: null, reviewDecision: null, updatedAt: null, comments: 0, checks: [] }
      ];
      const res = filterCiRuns(runs, prs, { scope: "MAIN_MERGE_PR_CI", featureBranch: "feat", defaultBranch: "main" });
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe(2);
    });

    it("filters MAIN_MERGE_PR_CI returns empty if no heads", () => {
      const res = filterCiRuns(runs, [], { scope: "MAIN_MERGE_PR_CI", featureBranch: "feat", defaultBranch: "main" });
      expect(res).toHaveLength(0);
    });

    it("returns all if unknown", () => {
      const res = filterCiRuns(runs, [], { scope: "UNKNOWN" } as any);
      expect(res).toEqual(runs);
    });
  });

  it("sortCiRunsNewestFirst", () => {
    const runs: GitCiRunStatus[] = [
      { id: 1, name: "1", status: "c", conclusion: "s", headBranch: "a", event: "a", workflowName: "a", url: "a", updatedAt: "2023-01-01T00:00:00Z" },
      { id: 2, name: "2", status: "c", conclusion: "s", headBranch: "a", event: "a", workflowName: "a", url: "a", updatedAt: "2023-01-02T00:00:00Z" },
      { id: 3, name: "3", status: "c", conclusion: "s", headBranch: "a", event: "a", workflowName: "a", url: "a", updatedAt: "2023-01-02T00:00:00Z" }, // same time, larger id
    ];
    const sorted = sortCiRunsNewestFirst(runs);
    expect(sorted[0].id).toBe(3);
    expect(sorted[1].id).toBe(2);
    expect(sorted[2].id).toBe(1);
  });

  it("isRunFailed", () => {
    expect(isRunFailed({ status: "in_progress", conclusion: null } as any)).toBe(false);
    expect(isRunFailed({ status: "completed", conclusion: "success" } as any)).toBe(false);
    expect(isRunFailed({ status: "completed", conclusion: "failure" } as any)).toBe(true);
  });

  it("trimLogExcerpt", () => {
    const short = "hello";
    expect(trimLogExcerpt(short)).toBe(short);
    const long = "A".repeat(2001);
    const trimmed = trimLogExcerpt(long);
    expect(trimmed.startsWith("...")).toBe(true);
    expect(trimmed.length).toBe(2003);
  });

  describe("filterMergedPrs", () => {
    const prs: GitMergeStatus[] = [
      { number: 1, baseRefName: "main", title: "a", url: "a", headRefName: "a", mergedAt: "now", mergedBy: "a" },
      { number: 2, baseRefName: "feat", title: "a", url: "a", headRefName: "a", mergedAt: "now", mergedBy: "a" },
      { number: 3, baseRefName: "other", title: "a", url: "a", headRefName: "a", mergedAt: "now", mergedBy: "a" },
      { number: 4, baseRefName: "prefix-123", title: "a", url: "a", headRefName: "a", mergedAt: "now", mergedBy: "a" },
      { number: 5, baseRefName: null, title: "a", url: "a", headRefName: "a", mergedAt: "now", mergedBy: "a" }
    ];

    it("returns all if no tracking", () => {
      expect(filterMergedPrs(prs)).toEqual(prs);
    });

    it("returns all if no branches specified", () => {
      expect(filterMergedPrs(prs, { scope: "REPOSITORY" })).toEqual(prs);
    });

    it("filters by defaultBranch", () => {
      const res = filterMergedPrs(prs, { scope: "REPOSITORY", defaultBranch: "main" });
      expect(res.map(p => p.number)).toEqual([1]);
    });

    it("filters by featureBranch", () => {
      const res = filterMergedPrs(prs, { scope: "REPOSITORY", featureBranch: "feat" });
      expect(res.map(p => p.number)).toEqual([2]);
    });

    it("filters by featureBranchPrefix", () => {
      const res = filterMergedPrs(prs, { scope: "REPOSITORY", featureBranchPrefix: "prefix-" });
      expect(res.map(p => p.number)).toEqual([4]);
    });
  });
});
