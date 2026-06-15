import { describe, it, expect } from "vitest";
import { normalizeQaReviewResult, normalizeFollowUpTask } from "../../../../src/domain/qa-review/qa-review-result-normalizer.js";

describe("qa-review-result-normalizer", () => {
  describe("normalizeQaReviewResult", () => {
    it("should parse a passing result", () => {
      const payload = {
        verdict: "pass",
        summary: "Looks good",
      };
      const result = normalizeQaReviewResult(JSON.stringify(payload));
      expect(result.verdict).toBe("pass");
      expect(result.summary).toBe("Looks good");
      expect(result.findings).toEqual([]);
      expect(result.fixInstructions).toBeNull();
      expect(result.targetTaskKey).toBeNull();
      expect(result.shouldHavePr).toBeNull();
      expect(result.followUpTasks).toEqual([]);
    });

    it("should parse changes requested with findings", () => {
      const payload = {
        verdict: "changes_requested",
        summary: "Needs fixing",
        findings: ["Bug in code", "Missing test"],
        fixInstructions: "Fix the bug",
      };
      const result = normalizeQaReviewResult(JSON.stringify(payload));
      expect(result.verdict).toBe("changes_requested");
      expect(result.summary).toBe("Needs fixing");
      expect(result.findings).toEqual(["Bug in code", "Missing test"]);
      expect(result.fixInstructions).toBe("Fix the bug");
    });

    it("should throw if verdict is missing or invalid", () => {
      const payload = { summary: "Summary" };
      expect(() => normalizeQaReviewResult(JSON.stringify(payload))).toThrowError("Missing or invalid 'verdict'");

      const payload2 = { verdict: "maybe", summary: "Summary" };
      expect(() => normalizeQaReviewResult(JSON.stringify(payload2))).toThrowError("Missing or invalid 'verdict'");
    });

    it("should throw if summary is missing or empty", () => {
      const payload = { verdict: "pass" };
      expect(() => normalizeQaReviewResult(JSON.stringify(payload))).toThrowError("Missing or invalid 'summary'");

      const payload2 = { verdict: "pass", summary: "  " };
      expect(() => normalizeQaReviewResult(JSON.stringify(payload2))).toThrowError("Missing or invalid 'summary'");
    });

    it("should normalize follow-up tasks", () => {
      const payload = {
        verdict: "changes_requested",
        summary: "Follow up needed",
        followUpTasks: [
          {
            title: "Task 1",
            promptMarkdown: "Do task 1",
            description: "Desc 1",
            dependsOnTaskKeys: ["task-a"],
            priority: "high"
          },
          {
            title: "Task 2",
            prompt: "Do task 2", // Fallback to prompt
            priority: "invalid" // Fallback to medium
          },
          {
            title: "Invalid task without prompt"
          }
        ]
      };
      const result = normalizeQaReviewResult(JSON.stringify(payload));
      expect(result.followUpTasks.length).toBe(2);
      expect(result.followUpTasks[0].title).toBe("Task 1");
      expect(result.followUpTasks[0].promptMarkdown).toBe("Do task 1");
      expect(result.followUpTasks[0].description).toBe("Desc 1");
      expect(result.followUpTasks[0].dependsOnTaskKeys).toEqual(["task-a"]);
      expect(result.followUpTasks[0].priority).toBe("high");

      expect(result.followUpTasks[1].title).toBe("Task 2");
      expect(result.followUpTasks[1].promptMarkdown).toBe("Do task 2");
      expect(result.followUpTasks[1].description).toBeNull();
      expect(result.followUpTasks[1].dependsOnTaskKeys).toEqual([]);
      expect(result.followUpTasks[1].priority).toBe("medium");
    });
  });

  describe("normalizeFollowUpTask", () => {
    it("should discard malformed input", () => {
      expect(normalizeFollowUpTask(null)).toBeNull();
      expect(normalizeFollowUpTask("string")).toBeNull();
      expect(normalizeFollowUpTask({ title: "No prompt" })).toBeNull();
      expect(normalizeFollowUpTask({ promptMarkdown: "No title" })).toBeNull();
    });
  });
});
