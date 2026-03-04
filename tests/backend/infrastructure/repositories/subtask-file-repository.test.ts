import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { SubtaskFileRepository } from "../../../../src/infrastructure/repositories/subtask-file-repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "subtask-repo-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("SubtaskFileRepository", () => {
  it("loads a subtask correctly", async () => {
    const dir = await createTempDir();
    const content = [
      "title: Test Task",
      "depends_on: [task1, task2]",
      "is_independent: false",
      "merged: true",
      "prompt:",
      "Detailed prompt content",
    ].join("\n");
    await fs.writeFile(path.join(dir, "T01.md"), content);

    const repo = new SubtaskFileRepository();
    const subtask = await repo.loadSubtask(dir, "T01");

    expect(subtask.id).toBe("T01");
    expect(subtask.title).toBe("Test Task");
    expect(subtask.depends_on).toEqual(["task1", "task2"]);
    expect(subtask.is_independent).toBe(false);
    expect(subtask.is_merged).toBe(true);
    expect(subtask.prompt).toBe("Detailed prompt content");
  });

  it("loads all subtasks in a directory", async () => {
    const dir = await createTempDir();
    await fs.writeFile(path.join(dir, "T01.md"), "title: T1\nprompt: P1");
    await fs.writeFile(path.join(dir, "T02.md"), "title: T2\nprompt: P2");
    await fs.writeFile(path.join(dir, "README.txt"), "not a subtask");

    const repo = new SubtaskFileRepository();
    const subtasks = await repo.loadSubtasks(dir);

    expect(subtasks).toHaveLength(2);
    const ids = subtasks.map(s => s.id).sort();
    expect(ids).toEqual(["T01", "T02"]);
  });

  describe("setMerged", () => {
    it("updates existing merged flag", async () => {
      const dir = await createTempDir();
      const content = "title: Task\nmerged: false\nprompt:\nWork";
      await fs.writeFile(path.join(dir, "T01.md"), content);

      const repo = new SubtaskFileRepository();
      await repo.setMerged(dir, "T01", true);

      const updated = await fs.readFile(path.join(dir, "T01.md"), "utf-8");
      expect(updated).toContain("merged: true");
      expect(updated).not.toContain("merged: false");
    });

    it("inserts merged flag before prompt if missing", async () => {
      const dir = await createTempDir();
      const content = "title: Task\nprompt:\nWork";
      await fs.writeFile(path.join(dir, "T01.md"), content);

      const repo = new SubtaskFileRepository();
      await repo.setMerged(dir, "T01", true);

      const updated = await fs.readFile(path.join(dir, "T01.md"), "utf-8");
      expect(updated).toContain("merged: true\nprompt:");
    });

    it("appends merged flag if both missing", async () => {
      const dir = await createTempDir();
      const content = "title: Task";
      await fs.writeFile(path.join(dir, "T01.md"), content);

      const repo = new SubtaskFileRepository();
      await repo.setMerged(dir, "T01", true);

      const updated = await fs.readFile(path.join(dir, "T01.md"), "utf-8");
      expect(updated.trim()).toBe("title: Task\nmerged: true");
    });

    it("handles setting merged to false", async () => {
      const dir = await createTempDir();
      const content = "title: Task\nmerged: true\nprompt:\nWork";
      await fs.writeFile(path.join(dir, "T01.md"), content);

      const repo = new SubtaskFileRepository();
      await repo.setMerged(dir, "T01", false);

      const updated = await fs.readFile(path.join(dir, "T01.md"), "utf-8");
      expect(updated).toContain("merged: false");
      expect(updated).not.toContain("merged: true");
    });
  });
});
