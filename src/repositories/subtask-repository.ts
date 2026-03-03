import * as fs from "fs/promises";
import * as path from "path";
import type { Subtask } from "../contracts/app-types.js";

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

export class SubtaskRepository {
  async loadSubtasks(dir: string): Promise<Subtask[]> {
    const files = await fs.readdir(dir);
    const subtasks: Subtask[] = [];

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await fs.readFile(path.join(dir, file), "utf-8");
      const id = file.replace(".md", "");
      const titleMatch = content.match(/^\s*title:\s*(.*)\s*$/m);
      const independentMatch = content.match(/^\s*is_independent:\s*(true|false)\s*$/m);
      const mergedMatch = content.match(/^\s*merged:\s*(true|false)\s*$/m);
      const promptMatch = content.match(/^\s*prompt:\s*([\s\S]*)$/m);

      subtasks.push({
        id,
        title: titleMatch ? titleMatch[1].trim() : id,
        prompt: promptMatch ? promptMatch[1].trim() : content,
        depends_on: parseDependsOn(content),
        is_independent: independentMatch ? independentMatch[1] === "true" : true,
        is_merged: mergedMatch ? mergedMatch[1] === "true" : false,
        status: "PENDING",
      });
    }

    return subtasks;
  }
}
