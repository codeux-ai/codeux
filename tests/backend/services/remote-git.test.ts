import { describe, expect, it } from "vitest";
import { GitStatusService } from "../../../src/services/git-status-service.js";

describe("GitStatusService - Remote Git", () => {
  it("tracks feature PR CI when requested", async () => {
    const service = new GitStatusService("/tmp/repo", async (command, args) => {
      const key = `${command} ${args.join(" ")}`;
      const responses: Record<string, any> = {
        "git rev-parse --is-inside-work-tree": { ok: true, stdout: "true\n" },
        "git rev-parse --show-toplevel": { ok: true, stdout: "/tmp/repo\n" },
        "git branch --show-current": { ok: true, stdout: "feature/sprint1-implementation\n" },
        "git remote": { ok: true, stdout: "origin\n" },
        "git status --porcelain": { ok: true, stdout: "" },
        "gh --version": { ok: true, stdout: "gh version" },
        "gh auth status": { ok: true, stdout: "ok" },
        "gh pr list --state open --limit 50 --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup": {
          ok: true,
          stdout: JSON.stringify([{ number: 11, headRefName: "task/one", baseRefName: "feature/sprint1-implementation", comments: { totalCount: 2 }, statusCheckRollup: [] }]),
        },
        "gh run list --limit 50 --json databaseId,name,workflowName,status,conclusion,event,headBranch,url,updatedAt": {
          ok: true,
          stdout: JSON.stringify([{ databaseId: 101, headBranch: "feature/sprint1-implementation" }, { databaseId: 103, headBranch: "task/one" }]),
        },
        "gh pr list --state merged --limit 100 --json number,title,url,headRefName,baseRefName,mergedAt,mergedBy": { ok: true, stdout: "[]" },
      };
      return responses[key] || { ok: false };
    });

    const result = await service.getStatus("REMOTE", undefined, {
      scope: "FEATURE_PR_CI",
      featureBranch: "feature/sprint1-implementation",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
    });

    expect(result.tracking.scope).toBe("FEATURE_PR_CI");
    expect(result.openPullRequests).toHaveLength(1);
    expect(result.ciRuns).toHaveLength(2);
  });
});
