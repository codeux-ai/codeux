import { describe, it, expect } from "vitest";
import { areSprintCollectionsEqual, resolveSelectedSprint } from "../../../dashboard/src/v2/lib/sprint-scope.js";
import type { SprintCollectionResponse, Sprint } from "../../../dashboard/src/v2/types.js";

describe("areSprintCollectionsEqual", () => {
  it("returns true for identical references and content", () => {
    const prev: SprintCollectionResponse = {
      selectedSprintId: "sprint-1",
      sprints: [
        { id: "sprint-1", projectId: "p1", name: "S1", status: "running" } as any
      ]
    };
    expect(areSprintCollectionsEqual(prev, prev)).toBe(true);
  });

  it("returns false if selectedSprintId differs", () => {
    const prev: SprintCollectionResponse = {
      selectedSprintId: "sprint-1",
      sprints: []
    };
    const next: SprintCollectionResponse = {
      selectedSprintId: "sprint-2",
      sprints: []
    };
    expect(areSprintCollectionsEqual(prev, next)).toBe(false);
  });

  it("returns false if sprints arrays differ in content", () => {
    const prev: SprintCollectionResponse = {
      selectedSprintId: "sprint-1",
      sprints: [
        { id: "sprint-1", projectId: "p1", name: "S1", status: "idle" } as any
      ]
    };
    const next: SprintCollectionResponse = {
      selectedSprintId: "sprint-1",
      sprints: [
        { id: "sprint-1", projectId: "p1", name: "S1", status: "running" } as any
      ]
    };
    expect(areSprintCollectionsEqual(prev, next)).toBe(false);
  });
});

describe("resolveSelectedSprint", () => {
  it("returns null if selectedSprintId is null", () => {
    expect(resolveSelectedSprint([], null)).toBeNull();
  });

  it("returns null if sprint is not found", () => {
    const sprints: Sprint[] = [
      { id: "sprint-2", projectId: "p1", name: "S2", status: "idle" } as any
    ];
    expect(resolveSelectedSprint(sprints, "sprint-1")).toBeNull();
  });

  it("returns the sprint if found", () => {
    const targetSprint = { id: "sprint-1", projectId: "p1", name: "S1", status: "running" } as any;
    const sprints: Sprint[] = [
      { id: "sprint-2", projectId: "p1", name: "S2", status: "idle" } as any,
      targetSprint
    ];
    expect(resolveSelectedSprint(sprints, "sprint-1")).toBe(targetSprint);
  });
});
