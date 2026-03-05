import { describe, expect, it } from "vitest";
import { sanitizeSprintLoopSteps } from "../../../../../src/domain/settings/settings-sanitizers/sprint-loop-sanitizer.js";

describe("sanitizeSprintLoopSteps", () => {
  it("enforces interval bounds", () => {
    const result = sanitizeSprintLoopSteps({ sprintLoopSteps: { watchLoopIntervalSeconds: 0, watchLoopOutputIntervalSeconds: 10 } });
    expect(result.watchLoopIntervalSeconds).toBe(1); // Minimum is 1
    expect(result.watchLoopOutputIntervalSeconds).toBe(60); // Minimum is 60
  });
});
