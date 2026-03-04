import { describe, expect, it } from "vitest";
import { GitStatusService } from "../../../src/services/git-status-service.js";

describe("GitStatusService - Core", () => {
  it("passes token to gh commands only", async () => {
    const contexts: Array<{ command: string; token?: string }> = [];
    const service = new GitStatusService("/tmp/repo", async (command, args, context) => {
      contexts.push({ command, token: context.ghToken });
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
      return responses[`${command} ${args.join(" ")}`] || { ok: false };
    });

    await service.getStatus("REMOTE", "ghp_token");
    expect(contexts.some((entry) => entry.command === "gh" && entry.token === "ghp_token")).toBe(true);
  });
});
