import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectPullRequestCiSupport } from "../../../../../../src/domain/sprint/ci/feature-pr/workflow-ci-detection.js";

const repoPaths: string[] = [];

describe("detectPullRequestCiSupport", () => {
  afterEach(async () => {
    await Promise.all(repoPaths.splice(0).map((repoPath) => rm(repoPath, { recursive: true, force: true })));
  });

  it("returns not_applicable when no workflow directory exists", async () => {
    const repoPath = await createTempRepo();

    await expect(detectPullRequestCiSupport(repoPath, "feature/sprint1")).resolves.toEqual({
      status: "not_applicable",
      reason: "no_workflow_directory",
    });
  });

  it("returns applicable when a pull_request workflow matches the base branch", async () => {
    const repoPath = await createTempRepo(`
name: CI

on:
  pull_request:
    branches: ["feature/**"]
`);

    await expect(detectPullRequestCiSupport(repoPath, "feature/sprint1")).resolves.toEqual({
      status: "applicable",
      reason: "matching_pr_workflow_found",
    });
  });

  it("returns not_applicable when pull_request workflows only target other base branches", async () => {
    const repoPath = await createTempRepo(`
name: CI

on:
  pull_request:
    branches:
      - main
`);

    await expect(detectPullRequestCiSupport(repoPath, "feature/sprint1")).resolves.toEqual({
      status: "not_applicable",
      reason: "no_matching_pull_request_branches",
    });
  });

  it("returns unknown when the repo path itself cannot be stat-ed", async () => {
    await expect(
      detectPullRequestCiSupport(path.join(os.tmpdir(), "definitely-not-here-xyz-123"), "main"),
    ).resolves.toEqual({ status: "unknown", reason: "workflow_directory_unreadable" });
  });

  it("returns not_applicable when the workflow directory has no yaml files", async () => {
    const repoPath = await createTempRepo();
    const workflowDir = path.join(repoPath, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(workflowDir, "README.md"), "not a workflow", "utf8");

    await expect(detectPullRequestCiSupport(repoPath, "main")).resolves.toEqual({
      status: "not_applicable",
      reason: "no_workflow_files",
    });
  });

  it("returns not_applicable when no pull_request triggers are present at all", async () => {
    const repoPath = await createTempRepo(`
on:
  push:
    branches: [main]
`);
    await expect(detectPullRequestCiSupport(repoPath, "main")).resolves.toEqual({
      status: "not_applicable",
      reason: "no_pull_request_triggers",
    });
  });

  it("matches an inline flow-sequence on value", async () => {
    const repoPath = await createTempRepo(`on: [push, pull_request]`);
    await expect(detectPullRequestCiSupport(repoPath, "anything")).resolves.toEqual({
      status: "applicable",
      reason: "matching_pr_workflow_found",
    });
  });

  it("does not match an inline flow-sequence without a pull_request event", async () => {
    const repoPath = await createTempRepo(`on: [push, workflow_dispatch]`);
    await expect(detectPullRequestCiSupport(repoPath, "anything")).resolves.toEqual({
      status: "not_applicable",
      reason: "no_pull_request_triggers",
    });
  });

  it("matches a bare scalar on: pull_request value", async () => {
    const repoPath = await createTempRepo(`on: pull_request`);
    await expect(detectPullRequestCiSupport(repoPath, "anything")).resolves.toMatchObject({
      status: "applicable",
    });
  });

  it("matches pull_request_target events", async () => {
    const repoPath = await createTempRepo(`
on:
  pull_request_target:
    branches: ["feature/**"]
`);
    await expect(detectPullRequestCiSupport(repoPath, "feature/x")).resolves.toMatchObject({
      status: "applicable",
    });
  });

  it("treats a pull_request trigger with no config block as applicable to every branch", async () => {
    const repoPath = await createTempRepo(`
on:
  pull_request:
  push:
    branches: [main]
`);
    await expect(detectPullRequestCiSupport(repoPath, "any-branch")).resolves.toMatchObject({
      status: "applicable",
    });
  });

  it("matches a list-style on block containing pull_request", async () => {
    const repoPath = await createTempRepo(`
on:
  - push
  - pull_request
`);
    await expect(detectPullRequestCiSupport(repoPath, "x")).resolves.toMatchObject({
      status: "applicable",
    });
  });

  it("honors an inline flow-mapping on value with matching branches", async () => {
    const repoPath = await createTempRepo(`on: { pull_request: { branches: [main, "release/*"] } }`);
    await expect(detectPullRequestCiSupport(repoPath, "release/1")).resolves.toMatchObject({
      status: "applicable",
    });
  });

  it("rejects an inline flow-mapping whose branches do not match", async () => {
    const repoPath = await createTempRepo(`on: { pull_request: { branches: [main] } }`);
    await expect(detectPullRequestCiSupport(repoPath, "feature/y")).resolves.toEqual({
      status: "not_applicable",
      reason: "no_matching_pull_request_branches",
    });
  });

  it("applies branches-ignore filters", async () => {
    const repoPath = await createTempRepo(`
on:
  pull_request:
    branches-ignore:
      - "release/**"
`);
    await expect(detectPullRequestCiSupport(repoPath, "release/9")).resolves.toEqual({
      status: "not_applicable",
      reason: "no_matching_pull_request_branches",
    });
    const repoPath2 = await createTempRepo(`
on:
  pull_request:
    branches-ignore:
      - "release/**"
`);
    await expect(detectPullRequestCiSupport(repoPath2, "feature/9")).resolves.toMatchObject({
      status: "applicable",
    });
  });

  it("supports negated branch patterns and ** / ? globs", async () => {
    const repoPath = await createTempRepo(`
on:
  pull_request:
    branches:
      - "feature/**"
      - "!feature/skip"
`);
    await expect(detectPullRequestCiSupport(repoPath, "feature/skip")).resolves.toMatchObject({
      status: "not_applicable",
    });
    const repoPath2 = await createTempRepo(`
on:
  pull_request:
    branches: ["releas?"]
`);
    await expect(detectPullRequestCiSupport(repoPath2, "release")).resolves.toMatchObject({
      status: "applicable",
    });
  });

  it("strips inline comments and respects quoting when locating the on key", async () => {
    const repoPath = await createTempRepo(`
# top comment
on:  # trigger config
  pull_request:
    branches: ["feature/*"]  # only feature branches
`);
    await expect(detectPullRequestCiSupport(repoPath, "feature/a")).resolves.toMatchObject({
      status: "applicable",
    });
  });

  it("treats a pull_request event with only a types filter as applicable", async () => {
    const repoPath = await createTempRepo(`
on:
  pull_request:
    types: [opened, synchronize]
`);
    await expect(detectPullRequestCiSupport(repoPath, "whatever")).resolves.toMatchObject({
      status: "applicable",
    });
  });

  it("returns applicable when any of several workflow files matches", async () => {
    const repoPath = await createTempRepo();
    const workflowDir = path.join(repoPath, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(workflowDir, "push.yml"), "on:\n  push:\n    branches: [main]\n", "utf8");
    await writeFile(path.join(workflowDir, "pr.yaml"), "on:\n  pull_request:\n    branches: ['**']\n", "utf8");

    await expect(detectPullRequestCiSupport(repoPath, "anything")).resolves.toMatchObject({
      status: "applicable",
    });
  });
});

async function createTempRepo(workflowContent?: string): Promise<string> {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "workflow-ci-detection-"));
  repoPaths.push(repoPath);
  if (!workflowContent) {
    return repoPath;
  }

  const workflowDir = path.join(repoPath, ".github", "workflows");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "ci.yml"), workflowContent, "utf8");
  return repoPath;
}
