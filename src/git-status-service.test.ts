import { describe, expect, it } from "vitest";
import { GitStatusService } from "./git-status-service.js";

describe("GitStatusService", () => {
  it("returns unavailable when not a git repository", async () => {
    const service = new GitStatusService("/tmp/repo", async (command, args, _context) => {
      if (command === "git" && args.join(" ") === "rev-parse --is-inside-work-tree") {
        return { ok: false, stdout: "", stderr: "not a repo" };
      }
      return { ok: false, stdout: "", stderr: "unsupported" };
    });

    const result = await service.getStatus("LOCAL");
    expect(result.available).toBe(false);
    expect(result.tracking.scope).toBe("REPOSITORY");
    expect(result.warnings[0]).toContain("not a git repository");
  });

  it("returns local mode status without remote PR/CI data", async () => {
    const service = new GitStatusService("/tmp/repo", async (command, args, _context) => {
      const key = `${command} ${args.join(" ")}`;
      const responses: Record<string, { ok: boolean; stdout: string; stderr: string }> = {
        "git rev-parse --is-inside-work-tree": { ok: true, stdout: "true\n", stderr: "" },
        "git rev-parse --show-toplevel": { ok: true, stdout: "/tmp/repo\n", stderr: "" },
        "git branch --show-current": { ok: true, stdout: "main\n", stderr: "" },
        "git remote": { ok: true, stdout: "origin\n", stderr: "" },
        "git status --porcelain": { ok: true, stdout: "", stderr: "" },
      };
      return responses[key] ?? { ok: false, stdout: "", stderr: "missing mock" };
    });

    const result = await service.getStatus("LOCAL");
    expect(result.available).toBe(true);
    expect(result.mode).toBe("LOCAL");
    expect(result.openPullRequests).toHaveLength(0);
    expect(result.ciRuns).toHaveLength(0);
    expect(result.tracking.scope).toBe("REPOSITORY");
    expect(result.warnings[0]).toContain("Local mode");
  });

  it("returns warning when gh is missing in remote mode", async () => {
    const service = new GitStatusService("/tmp/repo", async (command, args, _context) => {
      const key = `${command} ${args.join(" ")}`;
      const responses: Record<string, { ok: boolean; stdout: string; stderr: string }> = {
        "git rev-parse --is-inside-work-tree": { ok: true, stdout: "true\n", stderr: "" },
        "git rev-parse --show-toplevel": { ok: true, stdout: "/tmp/repo\n", stderr: "" },
        "git branch --show-current": { ok: true, stdout: "main\n", stderr: "" },
        "git remote": { ok: true, stdout: "origin\n", stderr: "" },
        "git status --porcelain": { ok: true, stdout: "", stderr: "" },
        "gh --version": { ok: false, stdout: "", stderr: "gh missing" },
      };
      return responses[key] ?? { ok: false, stdout: "", stderr: "missing mock" };
    });

    const result = await service.getStatus("REMOTE");
    expect(result.available).toBe(false);
    expect(result.tracking.scope).toBe("REPOSITORY");
    expect(result.warnings[0]).toContain("GitHub CLI");
  });

  it("passes token to gh commands only", async () => {
    const contexts: Array<{ command: string; token?: string }> = [];
    const service = new GitStatusService("/tmp/repo", async (command, args, context) => {
      contexts.push({ command, token: context.ghToken });
      const key = `${command} ${args.join(" ")}`;
      const responses: Record<string, { ok: boolean; stdout: string; stderr: string }> = {
        "git rev-parse --is-inside-work-tree": { ok: true, stdout: "true\n", stderr: "" },
        "git rev-parse --show-toplevel": { ok: true, stdout: "/tmp/repo\n", stderr: "" },
        "git branch --show-current": { ok: true, stdout: "main\n", stderr: "" },
        "git remote": { ok: true, stdout: "origin\n", stderr: "" },
        "git status --porcelain": { ok: true, stdout: "", stderr: "" },
        "gh --version": { ok: true, stdout: "gh version", stderr: "" },
        "gh auth status": { ok: true, stdout: "ok", stderr: "" },
        "gh pr list --state open --limit 50 --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup": { ok: true, stdout: "[]", stderr: "" },
        "gh run list --limit 50 --json databaseId,name,workflowName,status,conclusion,event,headBranch,url,updatedAt": { ok: true, stdout: "[]", stderr: "" },
        "gh pr list --state merged --limit 100 --json number,title,url,headRefName,baseRefName,mergedAt,mergedBy": { ok: true, stdout: "[]", stderr: "" },
      };
      return responses[key] ?? { ok: false, stdout: "", stderr: "missing mock" };
    });

    await service.getStatus("REMOTE", "ghp_token");
    expect(contexts.some((entry) => entry.command === "gh" && entry.token === "ghp_token")).toBe(true);
  });

  it("tracks feature PR CI when requested", async () => {
    const service = new GitStatusService("/tmp/repo", async (command, args, _context) => {
      const key = `${command} ${args.join(" ")}`;
      const responses: Record<string, { ok: boolean; stdout: string; stderr: string }> = {
        "git rev-parse --is-inside-work-tree": { ok: true, stdout: "true\n", stderr: "" },
        "git rev-parse --show-toplevel": { ok: true, stdout: "/tmp/repo\n", stderr: "" },
        "git branch --show-current": { ok: true, stdout: "feature/sprint1-implementation\n", stderr: "" },
        "git remote": { ok: true, stdout: "origin\n", stderr: "" },
        "git status --porcelain": { ok: true, stdout: "", stderr: "" },
        "gh --version": { ok: true, stdout: "gh version", stderr: "" },
        "gh auth status": { ok: true, stdout: "ok", stderr: "" },
        "gh pr list --state open --limit 50 --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup": {
          ok: true,
          stdout: JSON.stringify([
            {
              number: 11,
              title: "task PR",
              url: "https://example/pr/11",
              state: "OPEN",
              isDraft: false,
              headRefName: "task/one",
              baseRefName: "feature/sprint1-implementation",
              mergeStateStatus: "CLEAN",
              reviewDecision: null,
              updatedAt: "2026-02-25T00:00:00Z",
              comments: { totalCount: 2 },
              statusCheckRollup: [],
            },
            {
              number: 12,
              title: "other",
              url: "https://example/pr/12",
              state: "OPEN",
              isDraft: false,
              headRefName: "other/head",
              baseRefName: "main",
              mergeStateStatus: "CLEAN",
              reviewDecision: null,
              updatedAt: "2026-02-25T00:00:00Z",
              comments: { totalCount: 0 },
              statusCheckRollup: [],
            },
          ]),
          stderr: "",
        },
        "gh run list --limit 50 --json databaseId,name,workflowName,status,conclusion,event,headBranch,url,updatedAt": {
          ok: true,
          stdout: JSON.stringify([
            {
              databaseId: 101,
              name: "ci",
              workflowName: "CI",
              status: "completed",
              conclusion: "success",
              event: "pull_request",
              headBranch: "feature/sprint1-implementation",
              url: "https://example/run/101",
              updatedAt: "2026-02-25T00:00:00Z",
            },
            {
              databaseId: 103,
              name: "ci",
              workflowName: "CI",
              status: "completed",
              conclusion: "success",
              event: "pull_request",
              headBranch: "task/one",
              url: "https://example/run/103",
              updatedAt: "2026-02-25T00:00:00Z",
            },
            {
              databaseId: 102,
              name: "ci",
              workflowName: "CI",
              status: "completed",
              conclusion: "success",
              event: "push",
              headBranch: "main",
              url: "https://example/run/102",
              updatedAt: "2026-02-25T00:00:00Z",
            },
          ]),
          stderr: "",
        },
        "gh pr list --state merged --limit 100 --json number,title,url,headRefName,baseRefName,mergedAt,mergedBy": { ok: true, stdout: "[]", stderr: "" },
      };
      return responses[key] ?? { ok: false, stdout: "", stderr: "missing mock" };
    });

    const result = await service.getStatus("REMOTE", undefined, {
      scope: "FEATURE_PR_CI",
      featureBranch: "feature/sprint1-implementation",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
    });

    expect(result.tracking.scope).toBe("FEATURE_PR_CI");
    expect(result.openPullRequests).toHaveLength(1);
    expect(result.openPullRequests[0].number).toBe(11);
    expect(result.ciRuns).toHaveLength(2);
    expect(result.ciRuns.map((run) => run.headBranch)).toEqual(["task/one", "feature/sprint1-implementation"]);
  });

  it("shows feature-targeting PR CI history even when feature branch itself has no runs", async () => {
    const service = new GitStatusService("/tmp/repo", async (command, args, _context) => {
      const key = `${command} ${args.join(" ")}`;
      const responses: Record<string, { ok: boolean; stdout: string; stderr: string }> = {
        "git rev-parse --is-inside-work-tree": { ok: true, stdout: "true\n", stderr: "" },
        "git rev-parse --show-toplevel": { ok: true, stdout: "/tmp/repo\n", stderr: "" },
        "git branch --show-current": { ok: true, stdout: "feature/sprint1-implementation\n", stderr: "" },
        "git remote": { ok: true, stdout: "origin\n", stderr: "" },
        "git status --porcelain": { ok: true, stdout: "", stderr: "" },
        "gh --version": { ok: true, stdout: "gh version", stderr: "" },
        "gh auth status": { ok: true, stdout: "ok", stderr: "" },
        "gh pr list --state open --limit 50 --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup": {
          ok: true,
          stdout: JSON.stringify([
            {
              number: 11,
              title: "task PR",
              url: "https://example/pr/11",
              state: "OPEN",
              isDraft: false,
              headRefName: "task/one",
              baseRefName: "feature/sprint1-implementation",
              mergeStateStatus: "CLEAN",
              reviewDecision: null,
              updatedAt: "2026-02-25T00:00:00Z",
              comments: 0,
              statusCheckRollup: [],
            },
          ]),
          stderr: "",
        },
        "gh run list --limit 50 --json databaseId,name,workflowName,status,conclusion,event,headBranch,url,updatedAt": {
          ok: true,
          stdout: JSON.stringify([
            {
              databaseId: 203,
              name: "ci",
              workflowName: "CI",
              status: "completed",
              conclusion: "failure",
              event: "pull_request",
              headBranch: "task/one",
              url: "https://example/run/203",
              updatedAt: "2026-02-26T00:00:00Z",
            },
            {
              databaseId: 202,
              name: "ci",
              workflowName: "CI",
              status: "completed",
              conclusion: "success",
              event: "pull_request",
              headBranch: "task/one",
              url: "https://example/run/202",
              updatedAt: "2026-02-25T00:00:00Z",
            },
          ]),
          stderr: "",
        },
        "gh pr list --state merged --limit 100 --json number,title,url,headRefName,baseRefName,mergedAt,mergedBy": { ok: true, stdout: "[]", stderr: "" },
      };
      return responses[key] ?? { ok: false, stdout: "", stderr: "missing mock" };
    });

    const result = await service.getStatus("REMOTE", undefined, {
      scope: "FEATURE_PR_CI",
      featureBranch: "feature/sprint1-implementation",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
    });

    expect(result.ciRuns).toHaveLength(2);
    expect(result.ciRuns[0].id).toBe(203);
    expect(result.ciRuns[1].id).toBe(202);
    expect(result.warnings.some((warning) => warning.includes("No CI runs found for active PRs"))).toBe(false);
  });

  it("parses numeric comment count from gh pr list payload", async () => {
    const service = new GitStatusService("/tmp/repo", async (command, args, _context) => {
      const key = `${command} ${args.join(" ")}`;
      const responses: Record<string, { ok: boolean; stdout: string; stderr: string }> = {
        "git rev-parse --is-inside-work-tree": { ok: true, stdout: "true\n", stderr: "" },
        "git rev-parse --show-toplevel": { ok: true, stdout: "/tmp/repo\n", stderr: "" },
        "git branch --show-current": { ok: true, stdout: "feature/sprint1-implementation\n", stderr: "" },
        "git remote": { ok: true, stdout: "origin\n", stderr: "" },
        "git status --porcelain": { ok: true, stdout: "", stderr: "" },
        "gh --version": { ok: true, stdout: "gh version", stderr: "" },
        "gh auth status": { ok: true, stdout: "ok", stderr: "" },
        "gh pr list --state open --limit 50 --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup": {
          ok: true,
          stdout: JSON.stringify([
            {
              number: 11,
              title: "task PR",
              url: "https://example/pr/11",
              state: "OPEN",
              isDraft: false,
              headRefName: "task/one",
              baseRefName: "feature/sprint1-implementation",
              mergeStateStatus: "CLEAN",
              reviewDecision: null,
              updatedAt: "2026-02-25T00:00:00Z",
              comments: 3,
              statusCheckRollup: [],
            },
          ]),
          stderr: "",
        },
        "gh run list --limit 50 --json databaseId,name,workflowName,status,conclusion,event,headBranch,url,updatedAt": { ok: true, stdout: "[]", stderr: "" },
        "gh pr list --state merged --limit 100 --json number,title,url,headRefName,baseRefName,mergedAt,mergedBy": { ok: true, stdout: "[]", stderr: "" },
      };
      return responses[key] ?? { ok: false, stdout: "", stderr: "missing mock" };
    });

    const result = await service.getStatus("REMOTE", undefined, {
      scope: "FEATURE_PR_CI",
      featureBranch: "feature/sprint1-implementation",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
    });

    expect(result.openPullRequests).toHaveLength(1);
    expect(result.openPullRequests[0].comments).toBe(3);
  });

  it("tracks main branch CI between feature merge windows", async () => {
    const service = new GitStatusService("/tmp/repo", async (command, args, _context) => {
      const key = `${command} ${args.join(" ")}`;
      const responses: Record<string, { ok: boolean; stdout: string; stderr: string }> = {
        "git rev-parse --is-inside-work-tree": { ok: true, stdout: "true\n", stderr: "" },
        "git rev-parse --show-toplevel": { ok: true, stdout: "/tmp/repo\n", stderr: "" },
        "git branch --show-current": { ok: true, stdout: "feature/sprint1-implementation\n", stderr: "" },
        "git remote": { ok: true, stdout: "origin\n", stderr: "" },
        "git status --porcelain": { ok: true, stdout: "", stderr: "" },
        "gh --version": { ok: true, stdout: "gh version", stderr: "" },
        "gh auth status": { ok: true, stdout: "ok", stderr: "" },
        "gh pr list --state open --limit 50 --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup": { ok: true, stdout: "[]", stderr: "" },
        "gh run list --limit 50 --json databaseId,name,workflowName,status,conclusion,event,headBranch,url,updatedAt": {
          ok: true,
          stdout: JSON.stringify([
            { databaseId: 1, name: "ci", workflowName: "CI", status: "in_progress", conclusion: null, event: "push", headBranch: "main", url: "u1", updatedAt: null },
            { databaseId: 2, name: "ci", workflowName: "CI", status: "completed", conclusion: "success", event: "push", headBranch: "dev", url: "u2", updatedAt: null },
          ]),
          stderr: "",
        },
        "gh pr list --state merged --limit 100 --json number,title,url,headRefName,baseRefName,mergedAt,mergedBy": { ok: true, stdout: "[]", stderr: "" },
      };
      return responses[key] ?? { ok: false, stdout: "", stderr: "missing mock" };
    });

    const result = await service.getStatus("REMOTE", undefined, {
      scope: "MAIN_BRANCH_CI",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
    });

    expect(result.tracking.scope).toBe("MAIN_BRANCH_CI");
    expect(result.ciRuns).toHaveLength(1);
    expect(result.ciRuns[0].headBranch).toBe("main");
  });
});
