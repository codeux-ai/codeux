import * as fs from "fs/promises";
import * as path from "path";
import type { Subtask } from "../../contracts/app-types.js";
import { SubtaskParser } from "./subtask-parser.js";

export class SubtaskFileRepository {
  /**
   * Loads a single subtask by its ID from the specified directory.
   */
  async loadSubtask(dir: string, taskId: string): Promise<Subtask> {
    const filePath = path.join(dir, `${taskId}.md`);
    const content = await fs.readFile(filePath, "utf-8");
    
    return SubtaskParser.parse(taskId, content);
  }

  /**
   * Loads all subtasks from the specified directory.
   */
  async loadSubtasks(dir: string): Promise<Subtask[]> {
    const files = await fs.readdir(dir);
    const subtasks: Subtask[] = [];

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const id = file.replace(".md", "");
      try {
        const subtask = await this.loadSubtask(dir, id);
        subtasks.push(subtask);
      } catch (err) {
        // Skip files that cannot be parsed as subtasks
        console.error(`Failed to load subtask ${id}:`, err);
      }
    }

    return subtasks;
  }

  /**
   * Atomically updates the 'merged: true/false' flag in the markdown file.
   */
  async setMerged(dir: string, taskId: string, merged: boolean): Promise<void> {
    const filePath = path.join(dir, `${taskId}.md`);
    const content = await fs.readFile(filePath, "utf-8");
    const subtask = SubtaskParser.parse(taskId, content);
    
    if (subtask.is_merged === merged) return;

    subtask.is_merged = merged;
    const updated = SubtaskParser.stringify(subtask);
    await fs.writeFile(filePath, updated, "utf-8");
  }
}
