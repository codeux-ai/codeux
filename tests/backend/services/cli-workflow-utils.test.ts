import { describe, expect, it } from "vitest";

import {
  buildWorkerBranch,
  buildWorkerBranchPrefix,
} from "../../../src/services/cli-workflow-utils.js";

describe("cli workflow branch utilities", () => {
  it("keeps generated worker branches short enough for Git for Windows ref paths", () => {
    const featureBranch = "feature/sprintmockup-electron-10-task-dag-implementation";
    const taskId = "ci-dag-validation";

    const prefix = buildWorkerBranchPrefix(featureBranch, taskId, "mockup-cli");
    const branch = buildWorkerBranch(featureBranch, taskId, "mockup-cli");

    expect(prefix).toMatch(/^task\/[a-z0-9._-]+-[a-z0-9._-]+-mockup-cli-[a-f0-9]{8}-$/);
    expect(branch).toMatch(/^task\/[a-z0-9._-]+-[a-z0-9._-]+-mockup-cli-[a-f0-9]{8}-[a-z0-9]+$/);
    expect(branch.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThanOrEqual(64);
    expect(branch.length).toBeLessThanOrEqual(74);
  });

  it("uses a stable hash so truncated branch prefixes remain task-specific", () => {
    const featureBranch = "feature/very-long-sprint-name-that-would-otherwise-dominate-the-ref";
    const first = buildWorkerBranchPrefix(featureBranch, "ci-dag-validation", "mockup-cli");
    const second = buildWorkerBranchPrefix(featureBranch, "ci-dag-validation-extra", "mockup-cli");

    expect(first).not.toBe(second);
    expect(buildWorkerBranchPrefix(featureBranch, "ci-dag-validation", "mockup-cli")).toBe(first);
  });
});
