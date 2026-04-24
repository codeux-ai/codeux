import type { TaskExecutorType, TaskPriority } from "../contracts/project-management-types.js";

export interface PlannedTaskDraft {
  key: string;
  title: string;
  description: string;
  promptMarkdown: string;
  priority?: TaskPriority;
  executorType?: TaskExecutorType;
  dependsOn?: string[];
}

export interface PlannedSprintPayload {
  goal: string;
  tasks: PlannedTaskDraft[];
}

export class PlanningPayloadValidator {
  private static readonly REQUIRED_PROMPT_SECTIONS = [
    "## Objective",
    "## Scope",
    "## Implementation Requirements",
    "## Constraints",
    "## Verification"
  ];

  private static readonly VALID_PRIORITIES: TaskPriority[] = ["critical", "high", "medium", "low"];
  private static readonly VALID_EXECUTORS: TaskExecutorType[] = ["auto", "docker_cli", "jules"];

  public validate(payload: any): PlannedSprintPayload {
    if (!payload || typeof payload !== "object") {
      throw new Error("Planning payload must be an object.");
    }

    // Support legacy 'subtasks' alias for 'tasks'
    const rawTasks = payload.tasks || payload.subtasks || [];
    if (!Array.isArray(rawTasks)) {
      throw new Error("Planning payload 'tasks' must be an array.");
    }

    const goal = String(payload.goal || "");
    const tasks: PlannedTaskDraft[] = [];
    const seenKeys = new Set<string>();

    for (let i = 0; i < rawTasks.length; i++) {
      const rawTask = rawTasks[i];
      if (!rawTask || typeof rawTask !== "object") {
        throw new Error(`Task at index ${i} is not an object.`);
      }

      const normalizedTask = this.normalizeTask(rawTask, i);

      if (!normalizedTask.key) {
        throw new Error(`Task at index ${i} is missing a key.`);
      }

      if (seenKeys.has(normalizedTask.key)) {
        throw new Error(`Duplicate task key: ${normalizedTask.key}`);
      }
      seenKeys.add(normalizedTask.key);

      // Validate dependsOn references only previously defined tasks (DAG order)
      if (normalizedTask.dependsOn) {
        for (const depKey of normalizedTask.dependsOn) {
          if (!seenKeys.has(depKey)) {
            throw new Error(`Task "${normalizedTask.key}" depends on "${depKey}" which is missing or defined later. Forward references are not allowed.`);
          }
        }
      }

      this.validatePromptMarkdown(normalizedTask.key, normalizedTask.promptMarkdown);
      
      tasks.push(normalizedTask);
    }

    return { goal, tasks };
  }

  private normalizeTask(raw: any, index: number): PlannedTaskDraft {
    // Support legacy aliases: id, name for key
    const key = String(raw.key || raw.id || raw.name || `T${String(index + 1).padStart(2, "0")}`);
    
    // Support name for title
    const title = String(raw.title || raw.name || `Task ${index + 1}`);
    
    const description = String(raw.description || title);
    
    // Support prompt, instructions for promptMarkdown
    const promptMarkdown = String(raw.promptMarkdown || raw.prompt || raw.instructions || "");
    
    let priority = raw.priority;
    if (priority) {
      const normalizedPriority = String(priority).toLowerCase();
      if (PlanningPayloadValidator.VALID_PRIORITIES.includes(normalizedPriority as TaskPriority)) {
        priority = normalizedPriority;
      } else {
        priority = "medium";
      }
    } else {
      priority = "medium";
    }

    let executorType = raw.executorType;
    if (executorType) {
      let normalizedExecutor = String(executorType).toLowerCase();
      // Handle legacy/alternate names
      if (normalizedExecutor === "mcp_worker" || normalizedExecutor === "worker") {
        normalizedExecutor = "auto";
      }
      
      if (PlanningPayloadValidator.VALID_EXECUTORS.includes(normalizedExecutor as TaskExecutorType)) {
        executorType = normalizedExecutor;
      } else {
        executorType = "auto";
      }
    } else {
      executorType = "auto";
    }

    // Support depends_on, dependencies for dependsOn
    const dependsOnRaw = raw.dependsOn || raw.depends_on || raw.dependencies || [];
    const dependsOn: string[] = [];
    if (Array.isArray(dependsOnRaw)) {
      for (const k of dependsOnRaw) {
        dependsOn.push(String(k));
      }
    } else if (typeof dependsOnRaw === "string") {
      dependsOn.push(dependsOnRaw);
    }

    return {
      key,
      title,
      description,
      promptMarkdown,
      priority: priority as TaskPriority,
      executorType: executorType as TaskExecutorType,
      dependsOn
    };
  }

  private validatePromptMarkdown(key: string, markdown: string): void {
    if (!markdown) {
      throw new Error(`Task "${key}" has no promptMarkdown.`);
    }

    let lastIndex = -1;
    for (const section of PlanningPayloadValidator.REQUIRED_PROMPT_SECTIONS) {
      const index = markdown.indexOf(section);
      if (index === -1) {
        throw new Error(`Task "${key}" promptMarkdown is missing required section: "${section}"`);
      }
      if (index < lastIndex) {
        throw new Error(`Task "${key}" promptMarkdown sections are out of order. Expected "${section}" after previous sections.`);
      }
      lastIndex = index;
    }
  }
}
