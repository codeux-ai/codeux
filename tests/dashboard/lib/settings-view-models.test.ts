import { describe, expect, it } from "vitest";
import {
  getFieldSource,
  getFieldSourceLabel,
} from "../../../dashboard/src/v2/lib/settings-view-models.js";

describe("settings view model source helpers", () => {
  it("returns the direct field source when a leaf path is present", () => {
    expect(getFieldSource({
      "git.defaultBranch": "project",
      "git.githubMode": "system",
    }, "git.defaultBranch")).toBe("project");
  });

  it("falls back to section source when the exact path is not flattened separately", () => {
    expect(getFieldSource({
      skills: "project",
    }, "skills")).toBe("project");
  });

  it("formats project-scope source labels", () => {
    expect(getFieldSourceLabel("project", "project")).toBe("Project override");
    expect(getFieldSourceLabel("system", "project")).toBeNull();
    expect(getFieldSourceLabel("mixed", "project")).toBeNull();
  });

  it("formats sprint-scope source labels", () => {
    expect(getFieldSourceLabel("sprint", "sprint")).toBe("Sprint override");
    expect(getFieldSourceLabel("project", "sprint")).toBeNull();
    expect(getFieldSourceLabel("system", "sprint")).toBeNull();
  });
});
