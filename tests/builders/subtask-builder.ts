import type { Subtask, SubtaskStatus, ProviderId } from "../../src/contracts/app-types.js";

export function buildMockSubtask(overrides: Partial<Subtask> = {}): Subtask {
  return {
    id: "task-01",
    title: "Default Task Title",
    prompt: "Default prompt content",
    depends_on: [],
    is_independent: true,
    status: "PENDING",
    ...overrides,
  };
}
