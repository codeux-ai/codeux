import type { TaskExecutorType, TaskPriority, PlannedTaskDraft, PlannedSprintPayload } from "../contracts/project-management-types.js";

export interface PlanningPayloadValidatorOptions {
  allowedAgentPresetIds?: string[];
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

  public validate(payload: unknown, options: PlanningPayloadValidatorOptions = {}): PlannedSprintPayload {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Planning payload must be an object.");
    }

    if ("subtasks" in payload) {
      throw new Error("Planning payload uses legacy 'subtasks' field. Must use 'tasks'.");
    }

    const payloadObj = payload as Record<string, unknown>;
    const rawTasks = payloadObj.tasks;
    if (!Array.isArray(rawTasks)) {
      throw new Error("Planning payload 'tasks' must be an array.");
    }

    const goal = String(payloadObj.goal || "");
    const tasks: PlannedTaskDraft[] = [];
    const seenKeys = new Set<string>();
    let expectedTaskNumber = 1;

    for (let i = 0; i < rawTasks.length; i++) {
      const rawTask = rawTasks[i];
      if (!rawTask || typeof rawTask !== "object") {
        throw new Error(`Task at index ${i} is not an object.`);
      }

      const normalizedTask = this.normalizeTask(rawTask, i, options);

      if (!normalizedTask.key) {
        throw new Error(`Task at index ${i} is missing a key.`);
      }

      const expectedKey = `T${expectedTaskNumber.toString().padStart(2, "0")}`;
      if (normalizedTask.key !== expectedKey) {
        throw new Error(`Task at index ${i} has invalid key "${normalizedTask.key}". Expected "${expectedKey}" in strict DAG order.`);
      }
      expectedTaskNumber++;

      if (seenKeys.has(normalizedTask.key)) {
        throw new Error(`Duplicate task key: ${normalizedTask.key}`);
      }
      seenKeys.add(normalizedTask.key);

      // Validate dependsOn references only previously defined tasks (DAG order) and no duplicates
      if (normalizedTask.dependsOn) {
        const seenDeps = new Set<string>();
        for (const depKey of normalizedTask.dependsOn) {
          if (seenDeps.has(depKey)) {
            throw new Error(`Task "${normalizedTask.key}" has duplicate dependency "${depKey}".`);
          }
          seenDeps.add(depKey);

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

  private normalizeTask(raw: unknown, index: number, options: PlanningPayloadValidatorOptions): PlannedTaskDraft {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Task at index ${index} is not an object.`);
    }

    const rawObj = raw as Record<string, unknown>;

    const legacyAliases = ["id", "name", "prompt", "instructions", "depends_on", "dependencies"];
    for (const alias of legacyAliases) {
      if (alias in rawObj) {
        throw new Error(`Task at index ${index} uses legacy field '${alias}'.`);
      }
    }

    if (typeof rawObj.key !== "string") {
      throw new Error(`Task at index ${index} must have a 'key' of type string.`);
    }

    const taskKey = rawObj.key;

    if (typeof rawObj.title !== "string") {
      throw new Error(`Task "${taskKey}" must have a 'title' of type string.`);
    }

    if (typeof rawObj.description !== "string") {
      throw new Error(`Task "${taskKey}" must have a 'description' of type string.`);
    }

    if (typeof rawObj.promptMarkdown !== "string") {
      throw new Error(`Task "${taskKey}" must have a 'promptMarkdown' of type string.`);
    }
    
    let priority = rawObj.priority;
    if (priority) {
      const normalizedPriority = String(priority).toLowerCase();
      if (PlanningPayloadValidator.VALID_PRIORITIES.includes(normalizedPriority as TaskPriority)) {
        priority = normalizedPriority;
      } else {
        throw new Error(`Task "${taskKey}" has invalid priority "${priority}".`);
      }
    } else {
      priority = "medium";
    }

    let executorType = rawObj.executorType;
    if (executorType) {
      let normalizedExecutor = String(executorType).toLowerCase();
      // Handle legacy/alternate names
      if (normalizedExecutor === "mcp_worker" || normalizedExecutor === "worker") {
        normalizedExecutor = "auto";
      }
      
      if (PlanningPayloadValidator.VALID_EXECUTORS.includes(normalizedExecutor as TaskExecutorType)) {
        executorType = normalizedExecutor;
      } else {
        throw new Error(`Task "${taskKey}" has invalid executorType "${executorType}".`);
      }
    } else {
      executorType = "auto";
    }

    const dependsOnRaw = rawObj.dependsOn;
    if (dependsOnRaw !== undefined) {
      if (!Array.isArray(dependsOnRaw)) {
        throw new Error(`Task "${taskKey}" 'dependsOn' must be an array of strings.`);
      }
      for (const k of dependsOnRaw) {
        if (typeof k !== "string") {
          throw new Error(`Task "${taskKey}" 'dependsOn' must be an array of strings. Found non-string dependency.`);
        }
      }
    }

    const dependsOn = (dependsOnRaw as string[]) || [];
    const agentPresetId = typeof rawObj.agentPresetId === "string" && rawObj.agentPresetId.trim().length > 0
      ? rawObj.agentPresetId.trim()
      : null;
    if (agentPresetId && options.allowedAgentPresetIds && !options.allowedAgentPresetIds.includes(agentPresetId)) {
      throw new Error(`Task "${taskKey}" agentPresetId "${agentPresetId}" is not in the allowed coding-agent roster.`);
    }

    return {
      key: rawObj.key as string,
      title: rawObj.title as string,
      description: rawObj.description as string,
      promptMarkdown: rawObj.promptMarkdown as string,
      priority: priority as TaskPriority,
      executorType: executorType as TaskExecutorType,
      agentPresetId,
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
