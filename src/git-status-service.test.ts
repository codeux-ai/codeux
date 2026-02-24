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
        "gh pr list --state open --limit 20 --json number,title,url,state,isDraft,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup": { ok: true, stdout: "[]", stderr: "" },
        "gh run list --limit 20 --json databaseId,name,workflowName,status,conclusion,event,headBranch,url,updatedAt": { ok: true, stdout: "[]", stderr: "" },
        "gh pr list --state merged --limit 10 --json number,title,url,mergedAt,mergedBy": { ok: true, stdout: "[]", stderr: "" },
      };
      return responses[key] ?? { ok: false, stdout: "", stderr: "missing mock" };
    });

    await service.getStatus("REMOTE", "ghp_token");
    expect(contexts.some((entry) => entry.command === "gh" && entry.token === "ghp_token")).toBe(true);
  });
});
