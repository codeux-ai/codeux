import { describe, it, expect } from "vitest";
import {
  buildInProgressText,
  buildFailedChecksText,
  buildAutoMergeSuccessText,
} from "../../../../../../src/domain/sprint/ci/feature-pr/ci-notification-builder.js";

describe("ci-notification-builder", () => {
  it("builds in-progress text", () => {
    const result = buildInProgressText("T1", 100, "url", "branch", "pending", "Wait Header");
    expect(result).toContain("⏳ **Wait Header:** Task `T1` stays in progress (PR #100, branch `branch`)");
    expect(result).toContain("CI Status: `PENDING`");
  });

  it("builds failed checks text", () => {
    const result = buildFailedChecksText("branch", ["lint", "test"], [], []);
    expect(result).toContain("Failed checks: lint, test");
    expect(result).toContain("Logs: `gh run list --branch branch --event pull_request --limit 5`");
  });

  it("builds auto-merge success text", () => {
    const result = buildAutoMergeSuccessText("T1", 100);
    expect(result).toBe("🤖 **Auto-Merged:** Task `T1` was merged automatically (PR #100).\n");

    const resultWithMode = buildAutoMergeSuccessText("T1", 100, "always");
    expect(resultWithMode).toBe("🤖 **Auto-Merged:** Task `T1` was merged automatically (PR #100, mode: always).\n");
  });
});
