import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prepareBranchForOrchestration } from "../../../../src/sprint/steps/branch-preflight-step.js";

const execFileAsync = promisify(execFile);

const runGit = async (cwd: string, ...args: string[]): Promise<string> => {
  const result = await execFileAsync("git", args, { cwd });
  return result.stdout.trim();
};

describe("prepareBranchForOrchestration default-branch refresh", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-branch-refresh-"));
    repoPath = path.join(root, "repo");
    await fs.mkdir(repoPath);
    await runGit(repoPath, "init", "-b", "main");
    await runGit(repoPath, "config", "user.email", "tests@codeux.local");
    await runGit(repoPath, "config", "user.name", "Code UX Tests");
    await fs.writeFile(path.join(repoPath, "README.md"), "initial\n", "utf8");
    await runGit(repoPath, "add", "README.md");
    await runGit(repoPath, "commit", "-m", "initial");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("fast-forwards an unchanged local sprint branch to the latest default commit", async () => {
    await runGit(repoPath, "branch", "feature/sprint-one", "main");
    const originalBaseSha = await runGit(repoPath, "rev-parse", "feature/sprint-one");
    await fs.writeFile(path.join(repoPath, "README.md"), "default advanced\n", "utf8");
    await runGit(repoPath, "commit", "-am", "advance default");
    const defaultSha = await runGit(repoPath, "rev-parse", "main");

    const result = await prepareBranchForOrchestration(
      repoPath,
      "feature/sprint-one",
      "main",
      {
        localOnly: true,
        fastForwardFromDefault: true,
        expectedFeatureCommitSha: originalBaseSha,
      },
    );

    expect(result.defaultBranchSync).toBe("advanced");
    expect(result.baseCommitSha).toBe(defaultSha);
    expect(await runGit(repoPath, "rev-parse", "feature/sprint-one")).toBe(defaultSha);
  });

  it("preserves a sprint branch that contains feature-only commits", async () => {
    await runGit(repoPath, "branch", "feature/sprint-one", "main");
    await runGit(repoPath, "switch", "feature/sprint-one");
    await fs.writeFile(path.join(repoPath, "feature.txt"), "feature work\n", "utf8");
    await runGit(repoPath, "add", "feature.txt");
    await runGit(repoPath, "commit", "-m", "feature work");
    const featureSha = await runGit(repoPath, "rev-parse", "feature/sprint-one");
    await runGit(repoPath, "switch", "main");
    await fs.writeFile(path.join(repoPath, "README.md"), "default advanced\n", "utf8");
    await runGit(repoPath, "commit", "-am", "advance default");

    const result = await prepareBranchForOrchestration(
      repoPath,
      "feature/sprint-one",
      "main",
      { localOnly: true, fastForwardFromDefault: true },
    );

    expect(result.defaultBranchSync).toBe("preserved_feature_changes");
    expect(result.baseCommitSha).toBeNull();
    expect(await runGit(repoPath, "rev-parse", "feature/sprint-one")).toBe(featureSha);
  });

  it("preserves a changed feature tip that has since become an ancestor of default", async () => {
    await runGit(repoPath, "branch", "feature/sprint-one", "main");
    const originalBaseSha = await runGit(repoPath, "rev-parse", "feature/sprint-one");
    await runGit(repoPath, "switch", "feature/sprint-one");
    await fs.writeFile(path.join(repoPath, "feature.txt"), "feature work\n", "utf8");
    await runGit(repoPath, "add", "feature.txt");
    await runGit(repoPath, "commit", "-m", "feature work");
    const changedFeatureSha = await runGit(repoPath, "rev-parse", "feature/sprint-one");

    await runGit(repoPath, "switch", "main");
    await runGit(repoPath, "merge", "--ff-only", "feature/sprint-one");
    await fs.writeFile(path.join(repoPath, "README.md"), "default advanced after feature\n", "utf8");
    await runGit(repoPath, "commit", "-am", "advance default after feature");
    expect(await runGit(repoPath, "merge-base", "--is-ancestor", "feature/sprint-one", "main"))
      .toBe("");

    const result = await prepareBranchForOrchestration(
      repoPath,
      "feature/sprint-one",
      "main",
      {
        localOnly: true,
        fastForwardFromDefault: true,
        expectedFeatureCommitSha: originalBaseSha,
      },
    );

    expect(result.defaultBranchSync).toBe("preserved_feature_changes");
    expect(result.baseCommitSha).toBeNull();
    expect(await runGit(repoPath, "rev-parse", "feature/sprint-one")).toBe(changedFeatureSha);
  });

  it("does not refresh an existing branch when the caller omits the explicit option", async () => {
    await runGit(repoPath, "branch", "feature/sprint-one", "main");
    const featureSha = await runGit(repoPath, "rev-parse", "feature/sprint-one");
    await fs.writeFile(path.join(repoPath, "README.md"), "default advanced\n", "utf8");
    await runGit(repoPath, "commit", "-am", "advance default");

    const result = await prepareBranchForOrchestration(
      repoPath,
      "feature/sprint-one",
      "main",
      { localOnly: true },
    );

    expect(result.defaultBranchSync).toBeUndefined();
    expect(await runGit(repoPath, "rev-parse", "feature/sprint-one")).toBe(featureSha);
  });

  it("fast-forwards and publishes an unchanged remote sprint branch", async () => {
    const bareOrigin = path.join(root, "origin.git");
    await fs.mkdir(bareOrigin);
    await runGit(bareOrigin, "init", "--bare");
    await runGit(repoPath, "remote", "add", "origin", bareOrigin);
    await runGit(repoPath, "push", "-u", "origin", "main");
    await runGit(repoPath, "branch", "feature/remote-sprint", "main");
    const originalBaseSha = await runGit(repoPath, "rev-parse", "feature/remote-sprint");
    await runGit(repoPath, "push", "-u", "origin", "feature/remote-sprint");
    await fs.writeFile(path.join(repoPath, "README.md"), "remote default advanced\n", "utf8");
    await runGit(repoPath, "commit", "-am", "advance remote default");
    await runGit(repoPath, "push", "origin", "main");
    const defaultSha = await runGit(repoPath, "rev-parse", "main");

    const result = await prepareBranchForOrchestration(
      repoPath,
      "feature/remote-sprint",
      "main",
      {
        fastForwardFromDefault: true,
        expectedFeatureCommitSha: originalBaseSha,
      },
    );

    expect(result.defaultBranchSync).toBe("advanced");
    expect(result.existsRemote).toBe(true);
    expect(await runGit(repoPath, "rev-parse", "origin/feature/remote-sprint")).toBe(defaultSha);
    expect(await runGit(root, `--git-dir=${bareOrigin}`, "rev-parse", "refs/heads/feature/remote-sprint")).toBe(defaultSha);
  });
});
