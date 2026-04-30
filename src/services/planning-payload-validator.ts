import type { TaskExecutorType, TaskPriority, PlannedTaskDraft, PlannedSprintPayload } from "../contracts/project-management-types.js";

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

    if ("subtasks" in payload) {
      throw new Error("Planning payload uses legacy 'subtasks' field. Must use 'tasks'.");
    }

    const rawTasks = payload.tasks;
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
          if (depKey === normalizedTask.key) {
            throw new Error(`Task "${normalizedTask.key}" cannot depend on itself.`);
          }
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
    const legacyAliases = ["id", "name", "prompt", "instructions", "depends_on", "dependencies"];
    for (const alias of legacyAliases) {
      if (alias in raw) {
        throw new Error(`Task at index ${index} uses legacy field '${alias}'.`);
      }
    }

    if (typeof raw.key !== "string") {
      throw new Error(`Task at index ${index} must have a 'key' of type string.`);
    }

    if (typeof raw.title !== "string") {
      throw new Error(`Task "${raw.key}" must have a 'title' of type string.`);
    }

    if (typeof raw.description !== "string") {
      throw new Error(`Task "${raw.key}" must have a 'description' of type string.`);
    }

    if (typeof raw.promptMarkdown !== "string") {
      throw new Error(`Task "${raw.key}" must have a 'promptMarkdown' of type string.`);
    }
    
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

    const dependsOnRaw = raw.dependsOn;
    if (dependsOnRaw !== undefined) {
      if (!Array.isArray(dependsOnRaw)) {
        throw new Error(`Task "${raw.key}" 'dependsOn' must be an array of strings.`);
      }
      for (const k of dependsOnRaw) {
        if (typeof k !== "string") {
          throw new Error(`Task "${raw.key}" 'dependsOn' must be an array of strings. Found non-string dependency.`);
        }
      }
    }

    const dependsOn = dependsOnRaw || [];

    return {
      key: raw.key,
      title: raw.title,
      description: raw.description,
      promptMarkdown: raw.promptMarkdown,
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
