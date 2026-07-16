import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.join(process.cwd(), "src");

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return await listTypeScriptFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
  }))).flat();
}

describe("Git command routing guardrails", () => {
  it("routes production Git through the shared command boundary", async () => {
    const violations: string[] = [];
    for (const filePath of await listTypeScriptFiles(SOURCE_ROOT)) {
      const source = await readFile(filePath, "utf8");
      if (/\b(?:spawn|execFile|exec|spawnSync|execFileSync|execSync)\s*\(\s*["'`]git(?:["'`]|\s)/.test(source)) {
        violations.push(path.relative(process.cwd(), filePath));
      }
    }

    expect(violations, "Direct Git subprocesses bypass persistent project-helper routing").toEqual([]);
  });

  it("does not reintroduce the sprint-only helper ownership API", async () => {
    const violations: string[] = [];
    for (const filePath of await listTypeScriptFiles(SOURCE_ROOT)) {
      const source = await readFile(filePath, "utf8");
      if (source.includes("acquireProjectGitHelperForSprint")) {
        violations.push(path.relative(process.cwd(), filePath));
      }
    }

    expect(violations).toEqual([]);
  });
});
