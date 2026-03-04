import * as fs from "fs/promises";
import * as path from "path";
import type { Subtask } from "../../contracts/app-types.js";

const parseDependsOn = (content: string): string[] => {
  const lineMatch = content.match(/^\s*depends_on:\s*\[([^\]]*)\]\s*$/m);
  if (!lineMatch) return [];
  return lineMatch[1]
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => item.replace(/^["'](.+)["']$/, "$1").trim())
    .filter((item) => item.length > 0);
};

export class SubtaskFileRepository {
  /**
   * Loads a single subtask by its ID from the specified directory.
   */
  async loadSubtask(dir: string, taskId: string): Promise<Subtask> {
    const filePath = path.join(dir, `${taskId}.md`);
    const content = await fs.readFile(filePath, "utf-8");
    
    const titleMatch = content.match(/^\s*title:\s*(.*)\s*$/m);
    const independentMatch = content.match(/^\s*is_independent:\s*(true|false)\s*$/m);
    const mergedMatch = content.match(/^\s*merged:\s*(true|false)\s*$/m);
    const promptMatch = content.match(/^\s*prompt:\s*([\s\S]*)$/m);

    return {
      id: taskId,
      title: titleMatch ? titleMatch[1].trim() : taskId,
      prompt: promptMatch ? promptMatch[1].trim() : content,
      depends_on: parseDependsOn(content),
      is_independent: independentMatch ? independentMatch[1] === "true" : true,
      is_merged: mergedMatch ? mergedMatch[1] === "true" : false,
      status: "PENDING",
    };
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
   * If the flag doesn't exist, it is inserted above the 'prompt:' section.
   */
  async setMerged(dir: string, taskId: string, merged: boolean): Promise<void> {
    const filePath = path.join(dir, `${taskId}.md`);
    const content = await fs.readFile(filePath, "utf-8");
    const mergedValue = merged ? "true" : "false";
    
    let updated = content;
    const mergedRegex = /^\s*merged:\s*(true|false)\s*$/m;
    const promptRegex = /^\s*prompt:\s*/m;

    if (mergedRegex.test(content)) {
      updated = content.replace(mergedRegex, `merged: ${mergedValue}`);
    } else if (promptRegex.test(content)) {
      updated = content.replace(promptRegex, `merged: ${mergedValue}\nprompt:`);
    } else {
      updated = `${content.trimEnd()}\nmerged: ${mergedValue}\n`;
    }

    if (updated !== content) {
      await fs.writeFile(filePath, updated, "utf-8");
    }
  }
}
