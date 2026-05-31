import { describe, expect, it } from "vitest";
import { formatSprintBranch, type SprintBranchMetadata } from "../../../../src/domain/sprint/branch-name-generator.js";
import { type BranchNameMetadata } from "../../../../src/domain/settings/branch-name-tokens.js";

describe("branch-name-generator", () => {
  describe("Legacy SprintBranchMetadata", () => {
    const mockMetadata: SprintBranchMetadata = {
      number: 100,
      slug: "SPR-100",
      name: "Q3 Optimization & Bugfixes",
      createdAt: new Date("2023-11-20T14:00:00Z"),
      tasksCount: 42,
    };

    it("formats using {sprint_id} (canonical for slug)", () => {
      expect(formatSprintBranch("feature/{sprint_id}", mockMetadata)).toBe("feature/SPR-100");
    });

    it("formats using {sprint_number} (canonical for number)", () => {
      expect(formatSprintBranch("sprint/{sprint_number}", mockMetadata)).toBe("sprint/100");
    });

    it("formats using {sprint_name} (canonical for name)", () => {
      expect(formatSprintBranch("release/{sprint_name}", mockMetadata)).toBe("release/q3-optimization-bugfixes");
    });

    it("formats using legacy aliases {sprint}, {n}, {sprintNumber}, {sprintName}", () => {
      expect(formatSprintBranch("{sprint}", mockMetadata)).toBe("SPR-100");
      expect(formatSprintBranch("{n}", mockMetadata)).toBe("100");
      expect(formatSprintBranch("{sprintNumber}", mockMetadata)).toBe("100");
      expect(formatSprintBranch("{sprintName}", mockMetadata)).toBe("q3-optimization-bugfixes");
    });

    it("formats using {sprint_key_prefix} derived from slug", () => {
      expect(formatSprintBranch("{sprint_key_prefix}", mockMetadata)).toBe("SPR");
    });

    it("handles legacy {date} and {taskCount}", () => {
      expect(formatSprintBranch("{date}", mockMetadata)).toBe("23-11-20");
      expect(formatSprintBranch("{taskCount}", mockMetadata)).toBe("42");
    });
  });

  describe("Canonical BranchNameMetadata", () => {
    const mockMetadata: BranchNameMetadata = {
      sprint_key_prefix: "PROJ",
      sprint_number: 1,
      sprint_name: "Initial Setup",
      sprint_id: "PROJ-1",
      planning_agent: "plan-agent-123",
      agent_routing: "routing-456",
      worker_agent: "worker-789",
    };

    it("formats all 7 canonical tokens", () => {
      const scheme = "{sprint_key_prefix}/{sprint_number}/{sprint_name}/{sprint_id}/{planning_agent}/{agent_routing}/{worker_agent}";
      const expected = "PROJ/1/initial-setup/PROJ-1/plan-agent-123/routing-456/worker-789";
      expect(formatSprintBranch(scheme, mockMetadata)).toBe(expected);
    });

    it("sanitizes {sprint_name} via alias if it was intended", () => {
       // In the new metadata, we assume values are already "clean" or we should sanitize them?
       // The requirement says "Preserve existing branch-name delimiter behavior and sanitization rules."
       // Existing rule sanitized {sprintName}.
       expect(formatSprintBranch("{sprintName}", mockMetadata)).toBe("initial-setup");
    });
  });
});
