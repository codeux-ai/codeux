import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { PlannedTaskDraft } from "../contracts/project-management-types.js";

export interface PersistPlannedTasksResult {
  createdTaskIds: string[];
  taskIdsByKey: Map<string, string>;
}

export function persistPlannedTasks(
  projectId: string,
  sprintId: string,
  tasks: readonly PlannedTaskDraft[],
  repository: ProjectManagementRepository,
  options: { defaultAgentPresetId?: string | null } = {},
): PersistPlannedTasksResult {
  const createdTaskIds: string[] = [];
  const taskIdsByKey = new Map<string, string>();

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index]!;

    if (taskIdsByKey.has(task.key)) {
      throw new Error(`Planning agent returned duplicate task key: "${task.key}". Task keys must be unique.`);
    }

    const dependsOnTaskIds: string[] = [];
    for (const dependencyKey of (task.dependsOn || [])) {
      const dependencyId = taskIdsByKey.get(dependencyKey);
      if (!dependencyId) {
        throw new Error(`Planning agent returned dependency "${dependencyKey}" before defining it.`);
      }
      dependsOnTaskIds.push(dependencyId);
    }

    const created = repository.createTask(projectId, {
      sprintId,
      taskKey: task.key,
      title: task.title,
      description: task.description,
      promptMarkdown: task.promptMarkdown,
      priority: task.priority || "medium",
      executorType: task.executorType || "auto",
      ...(task.agentPresetId || options.defaultAgentPresetId
        ? { agentPresetId: task.agentPresetId || options.defaultAgentPresetId }
        : {}),
      dependsOnTaskIds,
      sortOrder: index,
      status: "pending",
      isIndependent: dependsOnTaskIds.length === 0,
    });

    createdTaskIds.push(created.id);
    taskIdsByKey.set(task.key, created.id);
  }

  return { createdTaskIds, taskIdsByKey };
}
