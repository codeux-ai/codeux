import { describe, expect, it, vi } from "vitest";
import { runLoadSubtasksStep } from "../../../../src/sprint/steps/load-subtasks-step.js";
import type { Subtask } from "../../../../src/contracts/app-types.js";

describe("runLoadSubtasksStep", () => {
  it("loads subtasks successfully via the provided loader function", async () => {
    const mockSubtasks: Subtask[] = [
      { id: "1", title: "Task 1", dependencies: [], description: "Test" },
    ];
    const mockLoader = vi.fn().mockResolvedValue(mockSubtasks);
    const subtasksDir = "/mock/dir";

    const result = await runLoadSubtasksStep(mockLoader, subtasksDir);

    expect(mockLoader).toHaveBeenCalledWith(subtasksDir);
    expect(result).toEqual(mockSubtasks);
  });
});
