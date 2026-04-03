import type {
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
  SprintRecord,
} from "../contracts/project-management-types.js";
import { SubtaskParser } from "../infrastructure/repositories/subtask-parser.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { normalizeImportedTaskStatus, toMergeIndicator } from "./subtask-state-mapper.js";

export class SprintMarkdownService {
  constructor(private readonly projectRepository: ProjectManagementRepository) {}

  importSprint(projectId: string, input: SprintMarkdownImportInput): SprintRecord {
    const sprintMeta = parseSprintMarkdown(input.sprintMarkdown);
    const sprint = this.projectRepository.createSprint(projectId, {
      name: sprintMeta.name,
      goal: sprintMeta.goal,
      number: sprintMeta.number,
      status: sprintMeta.status,
      startDate: sprintMeta.startDate,
      endDate: sprintMeta.endDate,
      featureBranch: sprintMeta.featureBranch,
    });

    const importedTaskIdBySourceKey = new Map<string, string>();
    for (let index = 0; index < input.tasks.length; index += 1) {
      const taskInput = input.tasks[index];
      const taskKey = taskInput.taskKey || `IMPORT-${String(index + 1).padStart(2, "0")}`;
      const parsed = SubtaskParser.parse(taskKey, taskInput.markdown);
      const createdTask = this.projectRepository.createTask(projectId, {
        sprintId: sprint.id,
        taskKey,
        title: parsed.title,
        promptMarkdown: parsed.prompt,
        description: "",
        status: normalizeImportedTaskStatus(parsed.status),
        priority: "medium",
        dependsOnTaskIds: [],
        isIndependent: parsed.is_independent,
        isMerged: parsed.is_merged,
        mergeIndicator: parsed.merge_indicator || null,
      });
      importedTaskIdBySourceKey.set(taskKey, createdTask.id);
    }

    const createdTasks = this.projectRepository.listTasks(projectId, sprint.id);
    for (let index = 0; index < input.tasks.length; index += 1) {
      const taskInput = input.tasks[index];
      const sourceTaskKey = taskInput.taskKey || createdTasks[index]?.taskKey;
      const parsed = SubtaskParser.parse(sourceTaskKey || `task-${index + 1}`, taskInput.markdown);
      const createdTask = createdTasks[index];
      if (!createdTask) {
        continue;
      }
      const dependsOnTaskIds = parsed.depends_on
        .map((dependencyKey) => importedTaskIdBySourceKey.get(dependencyKey))
        .filter((dependencyId): dependencyId is string => typeof dependencyId === "string");

      if (dependsOnTaskIds.length > 0) {
        this.projectRepository.updateTask(createdTask.id, { dependsOnTaskIds });
      }
    }

    return this.projectRepository.getSprint(sprint.id) || sprint;
  }

  exportSprint(projectId: string, sprintId: string): SprintMarkdownExportBundle {
    const sprint = this.projectRepository.getSprint(sprintId);
    if (!sprint || sprint.projectId !== projectId) {
      throw new Error(`Sprint not found: ${sprintId}`);
    }

    const tasks = this.projectRepository.listTasks(projectId, sprintId);

    return {
      sprint: {
        fileName: `sprint-${sprint.number || sprint.slug}.md`,
        markdown: serializeSprintMarkdown(sprint),
      },
      tasks: tasks.map((task) => ({
        fileName: `${task.taskKey}.md`,
        markdown: SubtaskParser.stringify({
          id: task.taskKey,
          title: task.title,
          prompt: task.promptMarkdown,
          depends_on: task.dependsOnTaskIds
            .map((dependencyId) => tasks.find((candidate) => candidate.id === dependencyId)?.taskKey)
            .filter((dependencyKey): dependencyKey is string => typeof dependencyKey === "string"),
          is_independent: task.isIndependent,
          is_merged: task.isMerged,
          merge_indicator: toMergeIndicator(task.mergeIndicator),
          status: "PENDING",
        }),
      })),
    };
  }
}

interface ParsedSprintMarkdown {
  name: string;
  number?: number;
  status?: SprintRecord["status"];
  startDate?: string | null;
  endDate?: string | null;
  featureBranch?: string | null;
  goal?: string;
}

function parseSprintMarkdown(markdown: string): ParsedSprintMarkdown {
  const lines = markdown.split(/\r?\n/);
  const metadata: Record<string, string> = {};
  let goalStart = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const goalMatch = line.match(/^\s*goal:\s*(.*)$/i);
    if (goalMatch) {
      goalStart = index;
      metadata.goal = goalMatch[1].trim();
      break;
    }

    const metaMatch = line.match(/^\s*([a-z_]+)\s*:\s*(.*)$/i);
    if (metaMatch) {
      metadata[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
    }
  }

  if (goalStart !== -1) {
    metadata.goal = [metadata.goal || "", ...lines.slice(goalStart + 1)].join("\n").trim();
  } else if (!metadata.goal) {
    metadata.goal = markdown.trim();
  }

  return {
    name: metadata.name || metadata.title || "Imported Sprint",
    number: metadata.number ? Number(metadata.number) : undefined,
    status: normalizeSprintStatus(metadata.status),
    startDate: metadata.start_date || null,
    endDate: metadata.end_date || null,
    featureBranch: metadata.feature_branch || null,
    goal: metadata.goal || "",
  };
}

function serializeSprintMarkdown(sprint: SprintRecord): string {
  const lines = [
    `name: ${sprint.name}`,
    `number: ${sprint.number ?? ""}`.trimEnd(),
    `status: ${sprint.status}`,
  ];

  if (sprint.startDate) {
    lines.push(`start_date: ${sprint.startDate}`);
  }
  if (sprint.endDate) {
    lines.push(`end_date: ${sprint.endDate}`);
  }
  if (sprint.featureBranch) {
    lines.push(`feature_branch: ${sprint.featureBranch}`);
  }
  lines.push("goal:");
  lines.push(sprint.goal || "");

  return lines.join("\n");
}

function normalizeSprintStatus(value: string | undefined): SprintRecord["status"] | undefined {
  if (
    value === "running"
    || value === "paused"
    || value === "completed"
    || value === "failed"
    || value === "cancelled"
    || value === "idle"
  ) {
    return value;
  }
  return undefined;
}
