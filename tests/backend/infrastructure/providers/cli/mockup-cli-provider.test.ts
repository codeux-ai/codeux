import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runMockupCliProvider } from "../../../../../src/infrastructure/providers/cli/mockup-cli-provider.js";

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mockup-cli-qa-"));
  temporaryDirectories.push(directory);
  return directory;
}

function qaPrompt(taskKey: string, directives: string[]): string {
  return [
    "## QUALITY ASSURANCE AGENT INSTRUCTIONS",
    "Inspect the deterministic mockup workspace.",
    "",
    "## REVIEW MODE",
    "Trigger: task_completion",
    "",
    "## CURRENT TASK UNDER REVIEW",
    `Task key: ${taskKey}`,
    "Prompt:",
    ...directives,
    "",
    "## REQUIRED OUTPUT",
    "Return JSON only.",
    '  "verdict": "pass" | "changes_requested",',
  ].join("\n");
}

describe("mockup-cli QA reviews", () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  });

  it("passes only after the required file is visible in the review workspace", async () => {
    const workspace = await createWorkspace();
    await fs.mkdir(path.join(workspace, "src", "qa"), { recursive: true });
    await fs.writeFile(path.join(workspace, "src", "qa", "review.js"), "export const review = 'visible';\n");

    const result = await runMockupCliProvider({
      prompt: qaPrompt("qa-visible", ["mockup-qa:require-file src/qa/review.js :: visible"]),
      cwd: workspace,
      model: "default",
      sessionId: "qa-visible",
      env: process.env,
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "pass", findings: [] });
  });

  it("reads the review branch from Git metadata without invoking a host Git executable", async () => {
    const workspace = await createWorkspace();
    await fs.mkdir(path.join(workspace, ".git"), { recursive: true });
    await fs.writeFile(path.join(workspace, ".git", "HEAD"), "ref: refs/heads/feature/container-only\n");

    const result = await runMockupCliProvider({
      prompt: qaPrompt("qa-container-only", []),
      cwd: workspace,
      model: "default",
      sessionId: "qa-container-only",
      env: { ...process.env, PATH: "" },
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.stdout)).toMatchObject({
      verdict: "pass",
      summary: "Mockup QA verified required files on branch feature/container-only.",
    });
  });

  it("uses the stable HEAD sentinel for detached review worktrees", async () => {
    const workspace = await createWorkspace();
    await fs.mkdir(path.join(workspace, ".git"), { recursive: true });
    await fs.writeFile(path.join(workspace, ".git", "HEAD"), `${"a".repeat(40)}\n`);

    const result = await runMockupCliProvider({
      prompt: qaPrompt("qa-detached", []),
      cwd: workspace,
      model: "default",
      sessionId: "qa-detached",
      env: { ...process.env, PATH: "" },
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.stdout)).toMatchObject({
      verdict: "pass",
      summary: "Mockup QA verified required files on branch HEAD.",
    });
  });

  it("declines missing requirements with deterministic follow-up instructions", async () => {
    const workspace = await createWorkspace();

    const result = await runMockupCliProvider({
      prompt: qaPrompt("qa-follow-up", [
        "mockup-qa:require-file src/qa/final.js :: follow-up-visible",
        "mockup-qa:fix-write src/qa/final.js :: export const final = 'follow-up-visible';",
      ]),
      cwd: workspace,
      model: "default",
      sessionId: "qa-follow-up",
      env: process.env,
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.stdout)).toMatchObject({
      verdict: "changes_requested",
      targetTaskKey: "qa-follow-up",
      fixInstructions: "mockup-cli:write src/qa/final.js :: export const final = 'follow-up-visible';",
    });
  });

  it("accepts QA prompts larger than the Windows command-line limit", async () => {
    const workspace = await createWorkspace();
    await fs.mkdir(path.join(workspace, "src", "qa"), { recursive: true });
    await fs.writeFile(path.join(workspace, "src", "qa", "large-prompt.js"), "export const visible = 'yes';\n");

    const result = await runMockupCliProvider({
      prompt: `${qaPrompt("qa-large-prompt", ["mockup-qa:require-file src/qa/large-prompt.js :: visible"])}\n${"context ".repeat(10_000)}`,
      cwd: workspace,
      model: "default",
      sessionId: "qa-large-prompt",
      env: process.env,
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "pass" });
  });
});
