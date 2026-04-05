import { describe, expect, it } from "vitest";
import { formatSprintBranch, SprintBranchMetadata } from "../../../src/git/sprint-branch-scheme.js";

describe("formatSprintBranch", () => {
  describe("with number (backward compatibility)", () => {
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

  describe("with SprintBranchMetadata", () => {
    const mockMetadata: SprintBranchMetadata = {
      number: 100,
      slug: "SPR-100",
      name: "Q3 Optimization & Bugfixes",
      createdAt: new Date("2023-11-20T14:00:00Z"),
      tasksCount: 42,
    };

    it("formats using {sprint}", () => {
      expect(formatSprintBranch("feature/{sprint}-stuff", mockMetadata)).toBe("feature/SPR-100-stuff");
    });

    it("formats using {sprintNumber}", () => {
      expect(formatSprintBranch("sprint/{sprintNumber}", mockMetadata)).toBe("sprint/100");
    });

    it("formats using {sprintName}", () => {
      expect(formatSprintBranch("release/{sprintName}", mockMetadata)).toBe("release/q3-optimization-bugfixes");
    });

    it("formats using {date}", () => {
      expect(formatSprintBranch("sprint-{date}", mockMetadata)).toBe("sprint-23-11-20");
    });

    it("formats using {taskCount}", () => {
      expect(formatSprintBranch("sprint-with-{taskCount}-tasks", mockMetadata)).toBe("sprint-with-42-tasks");
    });

    it("formats using {n}", () => {
      expect(formatSprintBranch("s{n}", mockMetadata)).toBe("s100");
    });

    it("formats multiple placeholders", () => {
      const scheme = "sprints/{date}/{sprint}_{sprintName}_{taskCount}t";
      expect(formatSprintBranch(scheme, mockMetadata)).toBe("sprints/23-11-20/SPR-100_q3-optimization-bugfixes_42t");
    });

    describe("branch name sanitization", () => {
      const testCases = [
        { name: "My Awesome Sprint", expected: "my-awesome-sprint" },
        { name: "  spaces   everywhere  ", expected: "spaces-everywhere" },
        { name: "symbols!@#$%^&*()_+", expected: "symbols_" }, // note: _ is not kept, but - might be. Wait, the regex is [^a-z0-9\s-]
      ];

      it("handles spaces and symbols correctly", () => {
        const metadata = { ...mockMetadata, name: "  My Awesome! Sprint _- @2023  " };
        // "  My Awesome! Sprint _- @2023  "
        // toLowerCase: "  my awesome! sprint _- @2023  "
        // replace /[^a-z0-9\s-]/g: "  my awesome sprint - 2023  "
        // replace /\s+/g: "-my-awesome-sprint---2023-"
        // replace /-+/g: "-my-awesome-sprint-2023-"
        // replace /^-|-$/g: "my-awesome-sprint-2023"
        expect(formatSprintBranch("{sprintName}", metadata)).toBe("my-awesome-sprint-2023");
      });

      it("handles completely invalid name", () => {
        const metadata = { ...mockMetadata, name: "!@#$%^&*()" };
        expect(formatSprintBranch("{sprintName}", metadata)).toBe("");
      });
    });

    describe("date formatting", () => {
      it("handles string dates", () => {
        const metadata = { ...mockMetadata, createdAt: "2024-02-29T00:00:00Z" };
        expect(formatSprintBranch("{date}", metadata)).toBe("24-02-29");
      });

      it("handles invalid dates", () => {
        const metadata = { ...mockMetadata, createdAt: "not-a-date" };
        expect(formatSprintBranch("{date}", metadata)).toBe("00-00-00");
      });
    });
  });
});
