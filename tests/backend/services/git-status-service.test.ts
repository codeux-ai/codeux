import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitStatusService } from "../../../src/services/git-status-service.js";

describe("GitStatusService", () => {

  it("adds warnings when API fetch fails for PRs, CI Runs, and Merged PRs", async () => {
    runner.mockImplementation(async (cmd: string, args: string[]) => {
      if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n" };
      if (args.includes("--show-toplevel")) return { ok: true, stdout: "/repo\n" };
      if (args.includes("--show-current")) return { ok: true, stdout: "main\n" };
      if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, stdout: "https://github.com/owner/repo.git\n" };
      if (cmd === "git" && args[0] === "remote") return { ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" };
      if (args.includes("--porcelain")) return { ok: true, stdout: "" };
      if (cmd === "gh" && args[0] === "--version") return { ok: true, stdout: "gh version 2.0.0\n" };
      if (cmd === "gh" && args[0] === "auth") return { ok: true, stdout: "logged in\n" };

      if (cmd === "gh" && args[0] === "pr" && args[1] === "list" && args[3] === "open") return { ok: false, stdout: "", stderr: "failed to fetch prs" };
      if (cmd === "gh" && args[0] === "run" && args[1] === "list") return { ok: false, stdout: "", stderr: "failed to fetch runs" };
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list" && args[3] === "merged") return { ok: false, stdout: "", stderr: "failed to fetch merged prs" };

      return { ok: true, stdout: "[]" };
    });

    const status = await service.getStatus("REMOTE", "token", undefined);
    expect(status.warnings).toContain("Failed to fetch open pull requests via gh CLI.");
    expect(status.warnings).toContain("Failed to fetch GitHub Actions runs via gh CLI.");
    expect(status.warnings).toContain("Failed to fetch recently merged pull requests via gh CLI.");
  });


  it("adds warning when no PRs target active feature branch in FEATURE_PR_CI scope", async () => {
    runner.mockImplementation(async (cmd: string, args: string[]) => {
      if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n" };
      if (args.includes("--show-toplevel")) return { ok: true, stdout: "/repo\n" };
      if (args.includes("--show-current")) return { ok: true, stdout: "main\n" };
      if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, stdout: "https://github.com/owner/repo.git\n" };
      if (cmd === "git" && args[0] === "remote") return { ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" };
      if (args.includes("--porcelain")) return { ok: true, stdout: "" };
      if (cmd === "gh" && args[0] === "--version") return { ok: true, stdout: "gh version 2.0.0\n" };
      if (cmd === "gh" && args[0] === "auth") return { ok: true, stdout: "logged in\n" };

      return { ok: true, stdout: "[]" };
    });

    const status = await service.getStatus("REMOTE", "token", { scope: "FEATURE_PR_CI", featureBranch: "feat" });
    expect(status.warnings).toContain("No open PRs are currently targeting the active feature branch.");
  });

  it("adds warning when no PRs target main in MAIN_MERGE_PR_CI scope", async () => {
    runner.mockImplementation(async (cmd: string, args: string[]) => {
      if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n" };
      if (args.includes("--show-toplevel")) return { ok: true, stdout: "/repo\n" };
      if (args.includes("--show-current")) return { ok: true, stdout: "main\n" };
      if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, stdout: "https://github.com/owner/repo.git\n" };
      if (cmd === "git" && args[0] === "remote") return { ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" };
      if (args.includes("--porcelain")) return { ok: true, stdout: "" };
      if (cmd === "gh" && args[0] === "--version") return { ok: true, stdout: "gh version 2.0.0\n" };
      if (cmd === "gh" && args[0] === "auth") return { ok: true, stdout: "logged in\n" };

      return { ok: true, stdout: "[]" };
    });

    const status = await service.getStatus("REMOTE", "token", { scope: "MAIN_MERGE_PR_CI", featureBranch: "feat", defaultBranch: "main" });
    expect(status.warnings).toContain("No open PR found for merging the feature branch into main.");
  });


  it("adds warning for DIRTY PR status", async () => {
    runner.mockImplementation(async (cmd: string, args: string[]) => {
      if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n" };
      if (args.includes("--show-toplevel")) return { ok: true, stdout: "/repo\n" };
      if (args.includes("--show-current")) return { ok: true, stdout: "main\n" };
      if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, stdout: "https://github.com/owner/repo.git\n" };
      if (cmd === "git" && args[0] === "remote") return { ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" };
      if (args.includes("--porcelain")) return { ok: true, stdout: "" };
      if (cmd === "gh" && args[0] === "--version") return { ok: true, stdout: "gh version 2.0.0\n" };
      if (cmd === "gh" && args[0] === "auth") return { ok: true, stdout: "logged in\n" };

      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return { ok: true, stdout: JSON.stringify([{ number: 1, title: "PR1", state: "OPEN", headRefName: "feat", baseRefName: "main", mergeStateStatus: "DIRTY" }]) };
      }
      return { ok: true, stdout: "[]" };
    });

    const status = await service.getStatus("REMOTE", "token", undefined);
    expect(status.warnings).toContain("One or more PRs have merge conflicts (DIRTY). If CI checks do not start on main, inspect merge conflicts.");
  });


  it("enriches failed run details correctly", async () => {
    runner.mockImplementation(async (cmd: string, args: string[]) => {
      if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n" };
      if (args.includes("--show-toplevel")) return { ok: true, stdout: "/repo\n" };
      if (args.includes("--show-current")) return { ok: true, stdout: "main\n" };
      if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, stdout: "https://github.com/owner/repo.git\n" };
      if (cmd === "git" && args[0] === "remote") return { ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" };
      if (args.includes("--porcelain")) return { ok: true, stdout: "" };
      if (cmd === "gh" && args[0] === "--version") return { ok: true, stdout: "gh version 2.0.0\n" };
      if (cmd === "gh" && args[0] === "auth") return { ok: true, stdout: "logged in\n" };

      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return { ok: true, stdout: JSON.stringify([{ number: 1, title: "PR1", state: "OPEN", headRefName: "feat", baseRefName: "main" }]) };
      }
      if (cmd === "gh" && args[0] === "run" && args[1] === "list") {
          return { ok: true, stdout: JSON.stringify([{ databaseId: 101, name: "run1", workflowName: "wf1", status: "completed", conclusion: "failure", event: "push", headBranch: "feat", url: "http://test", updatedAt: "2023-01-01T00:00:00Z" }]) };
      }

      if (cmd === "gh" && args[0] === "run" && args[1] === "view" && args[4] === "jobs") {
          return { ok: true, stdout: JSON.stringify({
            jobs: [
              { databaseId: 201, conclusion: "failure", name: "Job1", steps: [{ conclusion: "failure", name: "Step1" }] },
              { databaseId: 202, conclusion: "success", name: "Job2" },
              { conclusion: "failure", name: "Job3", id: 203 } // missing databaseId fallback to id
            ]
          })};
      }
      if (cmd === "gh" && args[0] === "run" && args[1] === "view" && args[5] === "--log-failed") {
          return { ok: true, stdout: "Error in Step1\n" };
      }

      return { ok: true, stdout: "[]" };
    });


    const status = await service.getStatus("REMOTE", "token", undefined);


    expect(status.mode).toBe("REMOTE");
    expect(status.ciRuns[0].conclusion).toBe("failure");
    expect(status.ciRuns[0].failedJobs?.length).toBe(2);
    expect(status.ciRuns[0].failedJobs?.[0].id).toBe(201);
    expect(status.ciRuns[0].failedJobs?.[0].failedSteps).toEqual(["Step1"]);
    expect(status.ciRuns[0].failedJobs?.[0].logExcerpt).toContain("Error in Step1");
  });

  it("handles failed run details edge cases (warnings and limit limits)", async () => {
    runner.mockImplementation(async (cmd: string, args: string[]) => {
      if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n" };
      if (args.includes("--show-toplevel")) return { ok: true, stdout: "/repo\n" };
      if (args.includes("--show-current")) return { ok: true, stdout: "main\n" };
      if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, stdout: "https://github.com/owner/repo.git\n" };
      if (cmd === "git" && args[0] === "remote") return { ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" };
      if (args.includes("--porcelain")) return { ok: true, stdout: "" };
      if (cmd === "gh" && args[0] === "--version") return { ok: true, stdout: "gh version 2.0.0\n" };
      if (cmd === "gh" && args[0] === "auth") return { ok: true, stdout: "logged in\n" };

      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return { ok: true, stdout: JSON.stringify([{ number: 1, title: "PR1", state: "OPEN", headRefName: "feat", baseRefName: "main" }]) };
      }
      if (cmd === "gh" && args[0] === "run" && args[1] === "list") {
          return { ok: true, stdout: JSON.stringify([{ databaseId: 101, name: "run1", workflowName: "wf1", status: "completed", conclusion: "failure", event: "push", headBranch: "feat", url: "http://test", updatedAt: "2023-01-01T00:00:00Z" }]) };
      }

      if (cmd === "gh" && args[0] === "run" && args[1] === "view" && args[4] === "jobs") {
          return { ok: false, stdout: "", stderr: "failed to fetch jobs" };
      }
      if (cmd === "gh" && args[0] === "run" && args[1] === "view" && args[5] === "--log-failed") {
          return { ok: false, stdout: "", stderr: "failed to fetch log" };
      }

      return { ok: true, stdout: "[]" };
    });


    const status = await service.getStatus("REMOTE", "token", undefined);

    expect(status.warnings).toContain("Failed to fetch failed jobs for run 101.");
  });

  it("handles empty failed log excerpt gracefully", async () => {
    runner.mockImplementation(async (cmd: string, args: string[]) => {
      if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n" };
      if (args.includes("--show-toplevel")) return { ok: true, stdout: "/repo\n" };
      if (args.includes("--show-current")) return { ok: true, stdout: "main\n" };
      if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, stdout: "https://github.com/owner/repo.git\n" };
      if (cmd === "git" && args[0] === "remote") return { ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" };
      if (args.includes("--porcelain")) return { ok: true, stdout: "" };
      if (cmd === "gh" && args[0] === "--version") return { ok: true, stdout: "gh version 2.0.0\n" };
      if (cmd === "gh" && args[0] === "auth") return { ok: true, stdout: "logged in\n" };

      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return { ok: true, stdout: JSON.stringify([{ number: 1, title: "PR1", state: "OPEN", headRefName: "feat", baseRefName: "main" }]) };
      }
      if (cmd === "gh" && args[0] === "run" && args[1] === "list") {
          return { ok: true, stdout: JSON.stringify([{ databaseId: 101, name: "run1", workflowName: "wf1", status: "completed", conclusion: "failure", event: "push", headBranch: "feat", url: "http://test", updatedAt: "2023-01-01T00:00:00Z" }]) };
      }

      if (cmd === "gh" && args[0] === "run" && args[1] === "view" && args[4] === "jobs") {
          return { ok: true, stdout: JSON.stringify({
            jobs: [
              { databaseId: 201, conclusion: "failure", name: "Job1", steps: [] }
            ]
          })};
      }
      if (cmd === "gh" && args[0] === "run" && args[1] === "view" && args[5] === "--log-failed") {
          return { ok: true, stdout: "   \n" };
      }

      return { ok: true, stdout: "[]" };
    });


    const status = await service.getStatus("REMOTE", "token", undefined);

    expect(status.ciRuns[0].failedJobs?.[0].logExcerpt).toBeNull();
  });

  let runner: any;
  let service: GitStatusService;

  beforeEach(() => {
    runner = vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "" });
    service = new GitStatusService("/repo", runner);
  });

  it("returns LOCAL status when mode is LOCAL", async () => {
    runner.mockImplementation(async (cmd: string, args: string[]) => {
      if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n" };
      if (args.includes("--show-toplevel")) return { ok: true, stdout: "/repo\n" };
      if (args.includes("--show-current")) return { ok: true, stdout: "main\n" };
      if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, stdout: "https://github.com/owner/repo.git\n" };
      if (cmd === "git" && args[0] === "remote") return { ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" };
      if (args.includes("--porcelain")) return { ok: true, stdout: "" };
      return { ok: true, stdout: "" };
    });

    const status = await service.getStatus("LOCAL");
    expect(status.mode).toBe("LOCAL");
    expect(status.available).toBe(true);
    expect(status.branch).toBe("main");
  });

  it("shares repo-level git plumbing across callers instead of spawning a batch per call", async () => {
    // The repo plumbing cache is bypassed under NODE_ENV=test; flip it on to assert the
    // consolidation that prevents per-sprint container spin-ups in production.
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    GitStatusService.invalidateCache();
    try {
      const calls: string[][] = [];
      const sharedRunner = vi.fn(async (cmd: string, args: string[]) => {
        calls.push([cmd, ...args]);
        if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n" };
        if (args.includes("--show-toplevel")) return { ok: true, stdout: "/shared-repo\n" };
        if (args.includes("--show-current")) return { ok: true, stdout: "main\n" };
        if (cmd === "git" && args[0] === "remote") return { ok: true, stdout: "origin\n" };
        if (args.includes("--porcelain")) return { ok: true, stdout: "" };
        return { ok: true, stdout: "[]" };
      });

      // Two callers (e.g. two sprints) on the same repo.
      const svcA = new GitStatusService("/shared-repo", sharedRunner as any);
      const svcB = new GitStatusService("/shared-repo", sharedRunner as any);
      await svcA.getStatus("LOCAL");
      await svcB.getStatus("LOCAL");

      const insideCalls = calls.filter((c) => c.includes("--is-inside-work-tree"));
      expect(insideCalls).toHaveLength(1);
    } finally {
      process.env.NODE_ENV = prevEnv;
      GitStatusService.invalidateCache();
    }
  });

  it("returns unavailable if not inside git worktree", async () => {
    runner.mockResolvedValue({ ok: false, stdout: "false\n", stderr: "not a git repo" });
    const status = await service.getStatus("REMOTE");
    expect(status.available).toBe(false);
    expect(status.warnings[0]).toContain("not a git repository");
  });

  it("uses token-backed API mode without requiring local gh", async () => {
    const apiFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/user")) {
        return new Response(JSON.stringify({ login: "codeux" }), { status: 200 });
      }
      if (url.includes("/pulls?state=open")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/actions/runs")) {
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }
      if (url.includes("/pulls?state=closed")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", apiFetch);
    runner.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "gh") return { ok: false, stdout: "", stderr: "spawn gh ENOENT" };
      if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n" };
      if (args.includes("--show-toplevel")) return { ok: true, stdout: "/repo\n" };
      if (args.includes("--show-current")) return { ok: true, stdout: "main\n" };
      if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, stdout: "https://github.com/owner/repo.git\n" };
      if (cmd === "git" && args[0] === "remote") return { ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" };
      if (args.includes("--porcelain")) return { ok: true, stdout: "" };
      return { ok: true, stdout: "" };
    });

    const apiService = new GitStatusService("/repo", runner, true);
    const status = await apiService.getStatus("REMOTE", { githubToken: "ghp_token" });

    expect(status.available).toBe(true);
    expect(runner).not.toHaveBeenCalledWith("gh", expect.any(Array), expect.any(Object));
    expect(status.warnings).not.toContain("GitHub CLI (gh) is not available. Remote mode cannot fetch PR/CI status.");
    vi.unstubAllGlobals();
  });

  it("handles REMOTE status with PRs and CI runs", async () => {
    runner.mockImplementation(async (cmd: string, args: string[]) => {
      if (args.includes("--is-inside-work-tree")) return { ok: true, stdout: "true\n" };
      if (args.includes("--show-toplevel")) return { ok: true, stdout: "/repo\n" };
      if (args.includes("--show-current")) return { ok: true, stdout: "main\n" };
      if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, stdout: "https://github.com/owner/repo.git\n" };
      if (cmd === "git" && args[0] === "remote") return { ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" };
      if (args.includes("--porcelain")) return { ok: true, stdout: "" };
      if (cmd === "gh" && args[0] === "--version") return { ok: true, stdout: "gh version 2.0.0\n" };
      if (cmd === "gh" && args[0] === "auth") return { ok: true, stdout: "logged in\n" };
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return { ok: true, stdout: JSON.stringify([{ number: 1, title: "PR1", state: "OPEN", headRefName: "feat", baseRefName: "main" }]) };
      }
      if (cmd === "gh" && args[0] === "run" && args[1] === "list") {
          return { ok: true, stdout: JSON.stringify([{ databaseId: 101, status: "completed", conclusion: "success", headBranch: "feat" }]) };
      }
      return { ok: true, stdout: "" };
    });

    const status = await service.getStatus("REMOTE", undefined, undefined);
    expect(status.mode).toBe("REMOTE");
    expect(status.available).toBe(true);
  });

  it("merges a pull request", async () => {
    runner.mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, code: 0, stdout: "https://github.com/owner/repo.git\n", stderr: "" };
      if (command === "git" && args[0] === "remote") return { ok: true, code: 0, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n", stderr: "" };
      if (command === "git" && args[0] === "remote") return { ok: true, code: 0, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n", stderr: "" };
      const fullCmd = `${command} ${args.join(" ")}`;
      const responses: Record<string, any> = {
        "gh pr merge 123 --merge --delete-branch": { ok: true, stdout: "merged", stderr: "" },
        "gh pr list --state open --limit 50 --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup": { ok: true, stdout: "[]" },
        "gh pr list --state merged --limit 100 --json number,title,url,headRefName,baseRefName,mergedAt,mergedBy": {
          ok: true,
          stdout: JSON.stringify([{ number: 123, title: "PR", url: "https://example/pr/123", headRefName: "feat", baseRefName: "feature", mergedAt: "2026-03-15T08:00:00.000Z", mergedBy: { login: "octocat" } }]),
        },
      };
      return responses[fullCmd] || { ok: true, stdout: "", stderr: "" };
    });
    const result = await service.mergePullRequest(123);
    expect(result.ok).toBe(true);
    expect(result.merged).toBe(true);
    expect(runner).toHaveBeenCalledWith(
      "gh",
      ["pr", "merge", "123", "--merge", "--delete-branch"],
      { cwd: "/repo", ghToken: undefined }
    );
  });

  it("treats an open PR after merge command as auto-merge armed, not merged", async () => {
    runner.mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, code: 0, stdout: "https://github.com/owner/repo.git\n", stderr: "" };
      if (command === "git" && args[0] === "remote") return { ok: true, code: 0, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n", stderr: "" };
      if (command === "git" && args[0] === "remote") return { ok: true, code: 0, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n", stderr: "" };
      const fullCmd = `${command} ${args.join(" ")}`;
      const responses: Record<string, any> = {
        "gh pr merge 123 --merge --delete-branch": { ok: true, stdout: "auto-merge enabled", stderr: "" },
        "gh pr list --state open --limit 50 --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup": {
          ok: true,
          stdout: JSON.stringify([{ number: 123, title: "PR", url: "https://example/pr/123", state: "OPEN", headRefName: "feat", baseRefName: "feature" }]),
        },
        "gh pr list --state merged --limit 100 --json number,title,url,headRefName,baseRefName,mergedAt,mergedBy": { ok: true, stdout: "[]" },
      };
      return responses[fullCmd] || { ok: true, stdout: "", stderr: "" };
    });

    const result = await service.mergePullRequest(123);

    expect(result).toMatchObject({
      ok: true,
      merged: false,
      autoMergeScheduled: true,
    });
  });

  it("returns error message if merge fails", async () => {
    runner.mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, code: 0, stdout: "https://github.com/owner/repo.git\n", stderr: "" };
      if (command === "git" && args[0] === "remote") return { ok: true, code: 0, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n", stderr: "" };
      return { ok: false, stdout: "", stderr: "conflict" };
    });
    const result = await service.mergePullRequest(123);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("conflict");
  });

  it("resolves an existing matching pull request without creating a new one", async () => {
    runner.mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, code: 0, stdout: "https://github.com/owner/repo.git\n", stderr: "" };
      if (command === "git" && args[0] === "remote") return { ok: true, code: 0, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n", stderr: "" };
      if (command === "git" && args[0] === "remote") return { ok: true, code: 0, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n", stderr: "" };
      const fullCmd = `${command} ${args.join(" ")}`;
      const responses: Record<string, any> = {
        "gh pr list --state open --base main --head feature/sprint1 --limit 1 --json number,url": {
          ok: true,
          stdout: JSON.stringify([{ number: 321, url: "https://example/pr/321" }]),
        },
      };
      return responses[fullCmd] || { ok: true, stdout: "", stderr: "" };
    });

    const result = await service.resolveOrCreatePullRequest({
      baseBranch: "main",
      headBranch: "feature/sprint1",
      title: "Sprint 1",
      body: "body",
    });

    expect(result).toEqual({
      created: false,
      prNumber: 321,
      prUrl: "https://example/pr/321",
    });
  });

  it("creates a new matching pull request when none exists", async () => {
    let lookupCount = 0;
    runner.mockImplementation(async (command, args) => {
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, code: 0, stdout: "https://github.com/owner/repo.git\n", stderr: "" };
      if (command === "git" && args[0] === "remote") return { ok: true, code: 0, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n", stderr: "" };
      if (command === "git" && args[0] === "remote") return { ok: true, code: 0, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n", stderr: "" };
      const fullCmd = `${command} ${args.join(" ")}`;
      if (fullCmd === "gh pr list --state open --base main --head feature/sprint1 --limit 1 --json number,url") {
        lookupCount += 1;
        return {
          ok: true,
          stdout: lookupCount === 1
            ? "[]"
            : JSON.stringify([{ number: 322, url: "https://example/pr/322" }]),
          stderr: "",
        };
      }
      if (fullCmd === "gh pr create --base main --head feature/sprint1 --title Sprint 1 --body body") {
        return { ok: true, stdout: "https://example/pr/322\n", stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    });

    const result = await service.resolveOrCreatePullRequest({
      baseBranch: "main",
      headBranch: "feature/sprint1",
      title: "Sprint 1",
      body: "body",
    });

    expect(result).toEqual({
      created: true,
      prNumber: 322,
      prUrl: "https://example/pr/322",
    });
  });

  it("memoizes getStatus within cache TTL window", async () => {
    let executionCount = 0;
    const service = new GitStatusService("/tmp/repo", async (command, args) => {
      const fullCmd = `${command} ${args.join(" ")}`;
      if (fullCmd.startsWith("git branch")) {
        executionCount++;
      }
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, code: 0, stdout: "https://github.com/owner/repo.git\n", stderr: "" };
      if (command === "git" && args[0] === "remote") return { ok: true, code: 0, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n", stderr: "" };

      const responses: Record<string, any> = {
        "git rev-parse --is-inside-work-tree": { ok: true, stdout: "true\n" },
        "git rev-parse --show-toplevel": { ok: true, stdout: "/tmp/repo\n" },
        "git branch --show-current": { ok: true, stdout: "main\n" },
        "git remote": { ok: true, stdout: "origin\n" },
        "git status --porcelain": { ok: true, stdout: "" },
        "gh --version": { ok: true, stdout: "gh version" },
        "gh auth status": { ok: true, stdout: "ok" },
        "gh pr list --state open --limit 50 --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup": { ok: true, stdout: "[]" },
        "gh run list --limit 50 --json databaseId,name,workflowName,status,conclusion,event,headBranch,url,updatedAt": { ok: true, stdout: "[]" },
        "gh pr list --state merged --limit 100 --json number,title,url,headRefName,baseRefName,mergedAt,mergedBy": { ok: true, stdout: "[]" },
      };
      return responses[fullCmd] || { ok: true, stdout: "" };
    });

    GitStatusService.invalidateCache();
    await service.getStatus("REMOTE", "ghp_token", undefined, 10000);
    await service.getStatus("REMOTE", "ghp_token", undefined, 10000);

    expect(executionCount).toBe(1);
  });

  it("invalidates cache on mergePullRequest", async () => {
    let executionCount = 0;
    const service = new GitStatusService("/tmp/repo", async (command, args) => {
      const fullCmd = `${command} ${args.join(" ")}`;
      if (fullCmd.startsWith("git branch")) {
        executionCount++;
      }
      if (command === "git" && args[0] === "remote" && args[1] === "get-url") return { ok: true, code: 0, stdout: "https://github.com/owner/repo.git\n", stderr: "" };
      if (command === "git" && args[0] === "remote") return { ok: true, code: 0, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n", stderr: "" };

      const responses: Record<string, any> = {
        "git rev-parse --is-inside-work-tree": { ok: true, stdout: "true\n" },
        "git rev-parse --show-toplevel": { ok: true, stdout: "/tmp/repo\n" },
        "git branch --show-current": { ok: true, stdout: "main\n" },
        "git remote": { ok: true, stdout: "origin\n" },
        "git status --porcelain": { ok: true, stdout: "" },
        "gh --version": { ok: true, stdout: "gh version" },
        "gh auth status": { ok: true, stdout: "ok" },
        "gh pr list --state open --limit 50 --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup": { ok: true, stdout: "[]" },
        "gh run list --limit 50 --json databaseId,name,workflowName,status,conclusion,event,headBranch,url,updatedAt": { ok: true, stdout: "[]" },
        "gh pr list --state merged --limit 100 --json number,title,url,headRefName,baseRefName,mergedAt,mergedBy": { ok: true, stdout: "[]" },
        "gh pr merge 1 --merge --delete-branch": { ok: true, stdout: "merged" }
      };
      return responses[fullCmd] || { ok: true, stdout: "" };
    });

    GitStatusService.invalidateCache();
    await service.getStatus("REMOTE", "ghp_token", undefined, 10000);
    await service.mergePullRequest(1, "ghp_token");
    await service.getStatus("REMOTE", "ghp_token", undefined, 10000);

    expect(executionCount).toBe(2);
  });
});
