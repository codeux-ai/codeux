import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { SubtaskFileRepository } from "../../../../src/infrastructure/repositories/subtask-file-repository.js";
import type { Logger } from "../../../../src/shared/logging/logger.js";

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

  it("preserves deterministic order even if read times vary", async () => {
    const dir = await createTempDir();

    await fs.writeFile(path.join(dir, "T01.md"), "title: T1\nprompt: P1");
    await fs.writeFile(path.join(dir, "T02.md"), "title: T2\nprompt: P2");
    await fs.writeFile(path.join(dir, "T03.md"), "title: T3\nprompt: P3");

    class TestRepo extends SubtaskFileRepository {
      async loadSubtask(dirParam: string, taskId: string) {
        let delay = 0;
        if (taskId === "T01") delay = 100;
        else if (taskId === "T02") delay = 10;
        else if (taskId === "T03") delay = 50;

        await new Promise(resolve => setTimeout(resolve, delay));
        return super.loadSubtask(dirParam, taskId);
      }
    }

    const repo = new TestRepo();

    const subtasks = await repo.loadSubtasks(dir);
    expect(subtasks).toHaveLength(3);
    expect(subtasks[0].id).toBe("T01");
    expect(subtasks[1].id).toBe("T02");
    expect(subtasks[2].id).toBe("T03");
  });

  it("logs parse warnings if logger is provided", async () => {
    const dir = await createTempDir();
    await fs.writeFile(path.join(dir, "T01.md"), "title: T1\nprompt: P1");
    await fs.writeFile(path.join(dir, "T02.md"), "title: T2\nprompt: P2");

    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };

    class TestRepo extends SubtaskFileRepository {
      async loadSubtask(dirParam: string, taskId: string) {
        if (taskId === "T02") {
          throw new Error("Simulated read error");
        }
        return super.loadSubtask(dirParam, taskId);
      }
    }

    const repo = new TestRepo(mockLogger);
    const subtasks = await repo.loadSubtasks(dir);

    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].id).toBe("T01");

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Failed to load subtask T02",
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it("ignores parse warnings if logger is NOT provided", async () => {
    const dir = await createTempDir();
    await fs.writeFile(path.join(dir, "T01.md"), "title: T1\nprompt: P1");
    await fs.writeFile(path.join(dir, "T02.md"), "title: T2\nprompt: P2");

    class TestRepo extends SubtaskFileRepository {
      async loadSubtask(dirParam: string, taskId: string) {
        if (taskId === "T02") {
          throw new Error("Simulated read error");
        }
        return super.loadSubtask(dirParam, taskId);
      }
    }

    const repo = new TestRepo();
    const subtasks = await repo.loadSubtasks(dir);

    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].id).toBe("T01");
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

    it("returns early if merged is already correct", async () => {
      const dir = await createTempDir();
      const content = "title: Task\nmerged: true\nprompt:\nWork";
      await fs.writeFile(path.join(dir, "T01.md"), content);

      const repo = new SubtaskFileRepository();
      // Use fs.stat to check modify time to verify it was skipped
      const before = await fs.stat(path.join(dir, "T01.md"));
      await new Promise(r => setTimeout(r, 10)); // wait a bit
      await repo.setMerged(dir, "T01", true);
      const after = await fs.stat(path.join(dir, "T01.md"));
      expect(after.mtimeMs).toBe(before.mtimeMs);
    });

    it("inserts merged flag before prompt if missing", async () => {
      const dir = await createTempDir();
      const content = "title: Task\nprompt:\nWork";
      await fs.writeFile(path.join(dir, "T01.md"), content);

      const repo = new SubtaskFileRepository();
      await repo.setMerged(dir, "T01", true);

      const updated = await fs.readFile(path.join(dir, "T01.md"), "utf-8");
      expect(updated).toContain("merged: true");
      expect(updated).toContain("prompt:\nWork");
    });

    it("appends merged flag if both missing", async () => {
      const dir = await createTempDir();
      const content = "title: Task";
      await fs.writeFile(path.join(dir, "T01.md"), content);

      const repo = new SubtaskFileRepository();
      await repo.setMerged(dir, "T01", true);

      const updated = await fs.readFile(path.join(dir, "T01.md"), "utf-8");
      expect(updated).toContain("merged: true");
      expect(updated).toContain("title: Task");
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
