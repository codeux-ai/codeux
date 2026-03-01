import { describe, expect, it } from "vitest";
import { formatSprintBranch } from "./sprint-branch-scheme.js";

describe("formatSprintBranch", () => {
  it("formats using {sprint}", () => {
    expect(formatSprintBranch("feature/sprint{sprint}-implementation", 59)).toBe("feature/sprint59-implementation");
  });

  it("formats using {n}", () => {
    expect(formatSprintBranch("feature/s{n}", 12)).toBe("feature/s12");
  });

  it("falls back to default scheme", () => {
    expect(formatSprintBranch("", 3)).toBe("feature/sprint3-implementation");
  });
});
