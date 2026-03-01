import * as fs from "fs/promises";
import * as path from "path";
import type { Subtask } from "../contracts/app-types.js";

export class SubtaskRepository {
  async loadSubtasks(dir: string): Promise<Subtask[]> {
    const files = await fs.readdir(dir);
    const subtasks: Subtask[] = [];

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await fs.readFile(path.join(dir, file), "utf-8");
      const id = file.replace(".md", "");
      const titleMatch = content.match(/title:\s*(.*)/);
      const dependsMatch = content.match(/depends_on:\s*\[(.*)\]/);
      const independentMatch = content.match(/is_independent:\s*(true|false)/);
      const mergedMatch = content.match(/merged:\s*(true|false)/);
      const promptMatch = content.match(/prompt:\s*([\s\S]*)/);

      subtasks.push({
        id,
        title: titleMatch ? titleMatch[1].trim() : id,
        prompt: promptMatch ? promptMatch[1].trim() : content,
        depends_on: dependsMatch ? dependsMatch[1].split(",").map((s) => s.trim()).filter((s) => s) : [],
        is_independent: independentMatch ? independentMatch[1] === "true" : true,
        is_merged: mergedMatch ? mergedMatch[1] === "true" : false,
        status: "PENDING",
      });
    }

    return subtasks;
  }
}
