import * as fs from "fs/promises";
import * as path from "path";
import { SubtaskFileRepository } from "../../../infrastructure/repositories/subtask-file-repository.js";
import { ProjectService } from "../../project/project-service.js";
import { SprintRepository } from "../../sprints/sprint-repository.js";
import { TaskRepository } from "../../../repositories/sprint-db/task-repository.js";

export class SprintImporter {
  constructor(
    private readonly subtaskRepo: SubtaskFileRepository,
    private readonly projectService: ProjectService,
    private readonly sprintRepo: SprintRepository,
    private readonly taskRepo: TaskRepository
  ) {}

  async importSprints(sourceId: string, normalizedBaseDir: string, sprintsDir: string): Promise<void> {
    let project = this.projectService.getProjectBySourceAndDir(sourceId, normalizedBaseDir);
    if (!project) {
      project = this.projectService.createProject(sourceId, normalizedBaseDir, "Imported Project");
    }

    const entries = await fs.readdir(sprintsDir, { withFileTypes: true });
    const sprintDirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith("sprint"))
      .map((e) => e.name)
      .sort();

    for (const dirName of sprintDirs) {
      const sprintNumberStr = dirName.match(/sprint(\d+)/)?.[1] || "0";
      const sprintNumber = parseInt(sprintNumberStr, 10);

      const sprint = await this.sprintRepo.create({
        projectId: project.id,
        name: `Sprint ${sprintNumber}`,
        goal: null,
        startDate: null,
        endDate: null,
      });

      const dirPath = path.join(sprintsDir, dirName);
      const subtasks = await this.subtaskRepo.loadSubtasks(dirPath);

      const idMap = new Map<string, string>();
      for (const st of subtasks) {
        idMap.set(st.id, `${sprint.id}-${st.id}`);
      }

      for (let i = 0; i < subtasks.length; i++) {
        const subtask = subtasks[i];
        const dbId = idMap.get(subtask.id)!;
        const mappedDeps = (subtask.depends_on || []).map((dep) => idMap.get(dep) || `${sprint.id}-${dep}`);

        this.taskRepo.createTask({
          id: dbId,
          sprintId: sprint.id,
          title: subtask.title,
          description: subtask.prompt,
          status: subtask.status || "PENDING",
          type: "SUBTASK",
          sortIndex: i,
          dependencies: mappedDeps,
          isMerged: subtask.is_merged,
        });
      }
    }
  }
}
