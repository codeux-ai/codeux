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
        "git remote get-url origin": { ok: true, stdout: "https://github.com/owner/repo.git\n" },
        "git remote": { ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" },
        "git status --porcelain": { ok: true, stdout: "" },
        "gh --version": { ok: true, stdout: "gh version" },
        "gh auth status": { ok: true, stdout: "ok" },
        "gh pr list --state open --limit 50 --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup": {
          ok: true,
          stdout: JSON.stringify([{ number: 11, headRefName: "task/one", baseRefName: "feature/sprint1-implementation", comments: { totalCount: 2 }, statusCheckRollup: [] }]),
        },
        "gh run list --limit 50 --json databaseId,name,workflowName,status,conclusion,event,headBranch,headSha,url,updatedAt": {
          ok: true,
          stdout: JSON.stringify([{ databaseId: 101, headBranch: "feature/sprint1-implementation" }, { databaseId: 103, headBranch: "task/one" }]),
        },
        "gh pr list --state merged --limit 100 --json number,title,url,headRefName,baseRefName,mergedAt,mergedBy": { ok: true, stdout: "[]" },
      };
      if (!responses[key]) console.log("GLAB MISSING", key);
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

  it("tracks feature PR CI for GitLab repositories", async () => {
    const service = new GitStatusService("/tmp/gitlab-repo", async (command, args) => {
      const key = `${command} ${args.join(" ")}`;
      const responses: Record<string, any> = {
        "git rev-parse --is-inside-work-tree": { ok: true, stdout: "true\n" },
        "git rev-parse --show-toplevel": { ok: true, stdout: "/tmp/gitlab-repo\n" },
        "git branch --show-current": { ok: true, stdout: "feature/sprint1-implementation\n" },
        "git remote get-url origin": { ok: true, stdout: "https://gitlab.com/owner/repo.git\n" },
        "git remote": { ok: true, stdout: "origin\thttps://gitlab.com/owner/repo.git (fetch)\n" },
        "git status --porcelain": { ok: true, stdout: "" },
        "glab --version --hostname gitlab.com -R owner/repo": { ok: true, stdout: "glab version" },
        "glab auth status --hostname gitlab.com -R owner/repo": { ok: true, stdout: "ok" },
        "glab mr list --state opened --per-page 50 --output json --hostname gitlab.com -R owner/repo": {
          ok: true,
          stdout: JSON.stringify([{ iid: 11, title: "pr", web_url: "url", draft: false, source_branch: "task/one", target_branch: "feature/sprint1-implementation", user_notes_count: 2 }]),
        },
        "glab ci list --per-page 50 --output json --hostname gitlab.com -R owner/repo": {
          ok: true,
          stdout: JSON.stringify([{ id: 101, status: "success", source: "push", ref: "feature/sprint1-implementation", web_url: "url", updated_at: "date" }, { id: 103, status: "success", source: "push", ref: "task/one", web_url: "url", updated_at: "date" }]),
        },
        "glab mr list --state merged --per-page 100 --output json --hostname gitlab.com -R owner/repo": { ok: true, stdout: "[]" },
      };
      if (!responses[key]) console.log("GLAB MISSING 2:", key);
      return responses[key] || { ok: false };
    });

    const result = await service.getStatus("REMOTE", "fake_token", {
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
