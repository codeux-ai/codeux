import { describe, it, expect } from "vitest";
import { formatSprintDisplay } from "../../../dashboard/src/v2/lib/format-sprint.js";

describe("formatSprintDisplay", () => {
  it("formats sprint with both name and number", () => {
    expect(formatSprintDisplay({ name: "Some Feature", sprintNumber: 102 })).toBe("SPR-102: Some Feature");
  });

  it("formats sprint with name and number property", () => {
    expect(formatSprintDisplay({ name: "Some Feature", number: 102 })).toBe("SPR-102: Some Feature");
  });

  it("handles empty sprint", () => {
    expect(formatSprintDisplay(null)).toBe("All Sprints");
    expect(formatSprintDisplay(undefined)).toBe("All Sprints");
  });

  it("extracts number from name if missing", () => {
    expect(formatSprintDisplay({ name: "SPR-102: Some Feature" })).toBe("SPR-102: Some Feature");
    expect(formatSprintDisplay({ name: "SPR-102 Some Feature" })).toBe("SPR-102: Some Feature");
    expect(formatSprintDisplay({ name: "SPR-102-Some Feature" })).toBe("SPR-102: Some Feature");
    expect(formatSprintDisplay({ name: "spr-102: Some Feature" })).toBe("SPR-102: Some Feature");
  });

  it("strips out existing prefix correctly", () => {
    expect(formatSprintDisplay({ name: "SPR-102: Some Feature", sprintNumber: 102 })).toBe("SPR-102: Some Feature");
    expect(formatSprintDisplay({ name: "SPR-102 : Some Feature", sprintNumber: 102 })).toBe("SPR-102: Some Feature");
  });

  it("returns name if no number could be extracted", () => {
    expect(formatSprintDisplay({ name: "Some Feature" })).toBe("Some Feature");
  });

  it("returns Unnamed Sprint if only number is present", () => {
    expect(formatSprintDisplay({ sprintNumber: 102 })).toBe("SPR-102: Sprint 102");
  });

  it("returns Unnamed Sprint if only number property is present", () => {
    expect(formatSprintDisplay({ number: 102 })).toBe("SPR-102: Sprint 102");
  });

  it("formats using custom sprint key prefix", () => {
    expect(formatSprintDisplay({ name: "Some Feature", sprintNumber: 102 }, "TKT")).toBe("TKT-102: Some Feature");
  });

  it("extracts and strips custom prefix from name", () => {
    expect(formatSprintDisplay({ name: "TKT-102: Some Feature" }, "TKT")).toBe("TKT-102: Some Feature");
    expect(formatSprintDisplay({ name: "tkt-102-Some Feature" }, "TKT")).toBe("TKT-102: Some Feature");
  });
});
