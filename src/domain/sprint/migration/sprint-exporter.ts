import * as fs from "fs/promises";
import * as path from "path";
import { SprintRepository } from "../../sprints/sprint-repository.js";
import { TaskRepository } from "../../../repositories/sprint-db/task-repository.js";
import { SprintDatabase } from "../../../repositories/sprint-db/bootstrap.js";
import { SubtaskParser } from "../../../infrastructure/repositories/subtask-parser.js";
import { Subtask } from "../../../contracts/app-types.js";

export class SprintExporter {
  constructor(
    private readonly sprintRepo: SprintRepository,
    private readonly taskRepo: TaskRepository,
    private readonly db: SprintDatabase
  ) {}

  async exportSprint(sprintId: string, outputDir: string): Promise<void> {
    const sprint = await this.sprintRepo.getById(sprintId);
    if (!sprint) {
      throw new Error(`Sprint ${sprintId} not found`);
    }

    const tasks = this.taskRepo.listTasks(sprintId);
    if (!tasks || tasks.length === 0) {
      return;
    }

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // For each task, construct a Subtask object and serialize it using SubtaskParser
    for (const task of tasks) {
      // Find dependencies for this task using raw query
      const depsStmt = this.db.db.prepare("SELECT depends_on_task_id FROM pm_dependencies WHERE task_id = ?");
      const depRows = depsStmt.all(task.id) as { depends_on_task_id: string }[];

      // Clean dependency IDs to match the subtask file naming convention (strip sprint prefix if present)
      // Assuming original ID format was sprintId-taskId, we want just taskId
      const depends_on = depRows.map(row => {
        const depId = row.depends_on_task_id;
        if (depId.startsWith(`${sprintId}-`)) {
          return depId.substring(sprintId.length + 1);
        }
        return depId;
      });

      // Same for task ID
      const localTaskId = task.id.startsWith(`${sprintId}-`) ? task.id.substring(sprintId.length + 1) : task.id;

      const subtask: Subtask = {
        id: localTaskId,
        title: task.title,
        prompt: task.description || "",
        depends_on: depends_on,
        is_independent: depends_on.length === 0, // Fallback guess
        is_merged: task.is_merged === 1,
        status: task.status as any,
      };

      const markdown = SubtaskParser.stringify(subtask);
      const filePath = path.join(outputDir, `${localTaskId}.md`);
      await fs.writeFile(filePath, markdown, "utf-8");
    }
  }
}
