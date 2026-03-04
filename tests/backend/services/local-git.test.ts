import { describe, expect, it } from "vitest";
import { GitStatusService } from "../../../src/services/git-status-service.js";

describe("GitStatusService - Local Git", () => {
  it("returns unavailable when not a git repository", async () => {
    const service = new GitStatusService("/tmp/repo", async (command, args) => {
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
    const service = new GitStatusService("/tmp/repo", async (command, args) => {
      const responses: Record<string, any> = {
        "git rev-parse --is-inside-work-tree": { ok: true, stdout: "true\n" },
        "git rev-parse --show-toplevel": { ok: true, stdout: "/tmp/repo\n" },
        "git branch --show-current": { ok: true, stdout: "main\n" },
        "git remote": { ok: true, stdout: "origin\n" },
        "git status --porcelain": { ok: true, stdout: "" },
      };
      return responses[`${command} ${args.join(" ")}`] || { ok: false };
    });

    const result = await service.getStatus("LOCAL");
    expect(result.available).toBe(true);
    expect(result.mode).toBe("LOCAL");
    expect(result.openPullRequests).toHaveLength(0);
    expect(result.warnings[0]).toContain("Local mode");
  });
});
