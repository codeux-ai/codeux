import type { Task, TaskPriority, TaskStatus, TaskExecutorType } from "../../../../types.js";

export const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  recordId: "rec_default",
  id: "TASK-DEFAULT",
  title: "Default Mock Task",
  description: "Description",
  priority: "medium" as TaskPriority,
  status: "pending" as TaskStatus,
  assignee: "Alice",
  source: "github",
  executorType: "jules" as TaskExecutorType,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  sprintId: "sprint_1",
  promptMarkdown: "",
  dependsOnTaskIds: [],
  isOptimistic: false,
  sourceUrl: "",
  pullRequest: null,
  ...overrides
} as unknown as Task);