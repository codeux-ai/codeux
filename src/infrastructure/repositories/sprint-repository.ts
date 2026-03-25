import * as fs from "fs/promises";
import * as path from "path";
import { getSprintSubtasksDir } from "../../shared/config/sprint-os-paths.js";
import { SubtaskParser } from "./subtask-parser.js";
import type { Subtask } from "../../contracts/app-types.js";

export class SprintRepository {
  /**
   * Initializes a sprint directory with a single task (T01.md).
   */
  async writeSingleTaskSprint(
    repoPath: string,
    sprintNumber: number,
    taskTitle: string,
    instructions: string
  ): Promise<void> {
    const subtasksDir = getSprintSubtasksDir(repoPath, sprintNumber);
    await fs.mkdir(subtasksDir, { recursive: true });

    const task: Subtask = {
      id: "T01",
      title: taskTitle,
      prompt: instructions,
      depends_on: [],
      is_independent: true,
      is_merged: false,
      status: "PENDING",
    };

    const taskContent = SubtaskParser.stringify(task);
    const filePath = path.join(subtasksDir, "T01.md");

    await fs.writeFile(filePath, taskContent, "utf-8");
  }
}
