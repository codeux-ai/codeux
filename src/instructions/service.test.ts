import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { InstructionService } from "./service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("InstructionService", () => {
  it("loads templates from .jules-subagents/instructions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "instruction-service-"));
    tempDirs.push(root);

    const templatePath = path.join(root, ".jules-subagents", "instructions", "sprint-main-loop", "guards", "branch-missing.md");
    await fs.mkdir(path.dirname(templatePath), { recursive: true });
    await fs.writeFile(templatePath, "Custom {{feature_branch}}", "utf-8");

    const service = new InstructionService(root);
    const rendered = await service.render("branchMissing", { feature_branch: "feature/s42" }, root);
    expect(rendered).toBe("Custom feature/s42");
  });

  it("falls back to built-in template when file is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "instruction-service-"));
    tempDirs.push(root);

    const service = new InstructionService(root);
    const rendered = await service.render("planningMissing", { subtasks_dir: "/tmp/missing" }, root);
    expect(rendered).toContain("Sprint Planning Missing");
    expect(rendered).toContain("/tmp/missing");
  });
});
