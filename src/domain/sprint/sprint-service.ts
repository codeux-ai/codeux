import { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import { SprintRepository } from "../../infrastructure/repositories/sprint-repository.js";
import type { SprintRecord } from "../../contracts/project-management-types.js";

export class SprintService {
  constructor(
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly sprintRepository: SprintRepository,
  ) {}

  async createSingleTaskSprint(
    projectId: string,
    sprintId: string,
    goal: string,
    instructions: string,
    repoPath: string,
  ): Promise<SprintRecord> {
    const project = this.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const sprint = this.projectManagementRepository.getSprint(sprintId);
    if (!sprint || sprint.projectId !== projectId) {
      throw new Error(`Sprint not found in project: ${sprintId}`);
    }

    if (typeof sprint.number !== "number" || Number.isNaN(sprint.number)) {
      throw new Error(`Sprint ${sprint.id} has no number configured.`);
    }

    // Write T01.md
    await this.sprintRepository.writeSingleTaskSprint(
      repoPath,
      sprint.number,
      "Complete sprint goal",
      instructions
    );

    // Update sprint state
    const updatedSprint = this.projectManagementRepository.updateSprint(sprintId, {
      goal,
      status: "running"
    });

    if (!updatedSprint) {
      throw new Error(`Failed to update sprint: ${sprintId}`);
    }

    // Replace any existing tasks in DB
    this.projectManagementRepository.deleteTasksBySprint(sprintId);

    this.projectManagementRepository.createTask(projectId, {
      sprintId,
      taskKey: "T01",
      title: "Complete sprint goal",
      promptMarkdown: instructions,
      description: "Auto-generated single task sprint",
      status: "pending",
      priority: "medium",
      executorType: "auto",
      dependsOnTaskIds: [],
      isIndependent: true,
      isMerged: false,
    });

    return updatedSprint;
  }
}
