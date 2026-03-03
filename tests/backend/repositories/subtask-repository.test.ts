import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { SubtaskRepository } from "../../../src/repositories/subtask-repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SubtaskRepository", () => {
  it("parses quoted depends_on ids as normalized task ids", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jules-subtasks-"));
    tempDirs.push(dir);

    await fs.writeFile(
      path.join(dir, "task-3.md"),
      [
        'title: "Task 3"',
        'depends_on: ["task-1", "task-2"]',
        "is_independent: true",
        "merged: false",
        "prompt:",
        "Do the work",
        "",
      ].join("\n"),
      "utf-8"
    );

    const repo = new SubtaskRepository();
    const subtasks = await repo.loadSubtasks(dir);

    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].depends_on).toEqual(["task-1", "task-2"]);
  });
});
