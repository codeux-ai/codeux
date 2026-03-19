import { describe, expect, it } from "vitest";
import { getBoatRaceHeightPx, getBoatRaceTaskKey } from "../../../dashboard/src/v2/lib/boat-race.js";

describe("boat race task identity", () => {
  it("prefers the persisted task record id so repeated task keys do not reuse old boat state", () => {
    expect(
      getBoatRaceTaskKey({
        id: "T01",
        record_id: "task-record-1",
        project_id: "project-1",
        sprint_id: "sprint-1",
      }),
    ).toBe("task-record-1");
  });

  it("falls back to project and sprint scope when no record id is available", () => {
    expect(
      getBoatRaceTaskKey({
        id: "T01",
        project_id: "project-1",
        sprint_id: "sprint-101",
      }),
    ).toBe("project-1:sprint-101:T01");
  });

  it("uses a fixed 800px race height regardless of fleet size", () => {
    expect(getBoatRaceHeightPx(0)).toBe(800);
    expect(getBoatRaceHeightPx(10)).toBe(800);
    expect(getBoatRaceHeightPx(11)).toBe(800);
    expect(getBoatRaceHeightPx(25)).toBe(800);
  });
});
