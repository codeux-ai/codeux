import { describe, it, expect } from "vitest";
import { shouldClearTasksOnScopeChange } from "../../../dashboard/src/v2/hooks/project-resource-utils.js";
import { isSprintScopeEqual } from "../../../dashboard/src/v2/lib/sprint-scope.js";

describe("shouldClearTasksOnScopeChange", () => {
  it("should return true when projectId differs", () => {
    expect(shouldClearTasksOnScopeChange(
      { projectId: "p1", sprintId: "s1" },
      { projectId: "p2", sprintId: "s1" }
    )).toBe(true);
  });

  it("should return false when projectId is the same but sprintId differs", () => {
    expect(shouldClearTasksOnScopeChange(
      { projectId: "p1", sprintId: "s1" },
      { projectId: "p1", sprintId: "s2" }
    )).toBe(false);
  });

  it("should return false when scope is identical", () => {
    expect(shouldClearTasksOnScopeChange(
      { projectId: "p1", sprintId: "s1" },
      { projectId: "p1", sprintId: "s1" }
    )).toBe(false);
  });
});

describe("isSprintScopeEqual", () => {
  it("should return true for equal inputs", () => {
    expect(isSprintScopeEqual("p1", "s1", "p1", "s1")).toBe(true);
    expect(isSprintScopeEqual("p1", null, "p1", null)).toBe(true);
    expect(isSprintScopeEqual(null, undefined, null, undefined)).toBe(true);
  });

  it("should return false when projectId differs", () => {
    expect(isSprintScopeEqual("p1", "s1", "p2", "s1")).toBe(false);
  });

  it("should return false when sprintId differs", () => {
    expect(isSprintScopeEqual("p1", "s1", "p1", "s2")).toBe(false);
  });
});
