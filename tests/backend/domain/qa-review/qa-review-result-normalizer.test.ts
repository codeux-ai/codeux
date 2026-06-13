import { describe, expect, it } from "vitest";
import { normalizeQaReviewResult } from "../../../../src/domain/qa-review/qa-review-result-normalizer.js";

describe("QaReviewResultNormalizer", () => {
  it("successfully normalizes a valid QA review result", () => {
    const json = {
      verdict: "pass",
      summary: "Everything looks great.",
      findings: ["Finding 1", "Finding 2"],
      fixInstructions: null,
      targetTaskKey: null,
      shouldHavePr: true,
      followUpTasks: [],
    };
    const bodyMarkdown = ` \`\`\`json\n${JSON.stringify(json)}\n\`\`\` `;

    const result = normalizeQaReviewResult(bodyMarkdown);

    expect(result.verdict).toBe("pass");
    expect(result.summary).toBe("Everything looks great.");
    expect(result.findings).toEqual(["Finding 1", "Finding 2"]);
    expect(result.fixInstructions).toBeNull();
    expect(result.targetTaskKey).toBeNull();
    expect(result.shouldHavePr).toBe(true);
    expect(result.followUpTasks).toEqual([]);
    expect(result.raw).toEqual(json);
  });

  it("normalizes a result with follow-up tasks", () => {
    const json = {
      verdict: "changes_requested",
      summary: "Needs some work.",
      findings: ["Found a bug."],
      fixInstructions: "Fix the bug.",
      targetTaskKey: "T1",
      followUpTasks: [
        {
          title: "Follow up task",
          promptMarkdown: "Do this next.",
          description: "A description.",
          dependsOnTaskKeys: ["T1"],
          priority: "high",
        },
      ],
    };
    const bodyMarkdown = JSON.stringify(json);

    const result = normalizeQaReviewResult(bodyMarkdown);

    expect(result.verdict).toBe("changes_requested");
    expect(result.followUpTasks).toHaveLength(1);
    expect(result.followUpTasks[0]).toEqual({
      title: "Follow up task",
      promptMarkdown: "Do this next.",
      description: "A description.",
      dependsOnTaskKeys: ["T1"],
      priority: "high",
    });
  });

  it("coerces findings to strings and filters empty values", () => {
    const json = {
      verdict: "pass",
      summary: "Ok",
      findings: ["Valid", "", null, 123, { object: true }],
    };
    const result = normalizeQaReviewResult(JSON.stringify(json));
    expect(result.findings).toEqual(["Valid", "123", "[object Object]"]);
  });

  it("defaults invalid follow-up priority to medium", () => {
    const json = {
      verdict: "pass",
      summary: "Ok",
      followUpTasks: [
        {
          title: "Task",
          promptMarkdown: "Prompt",
          priority: "invalid",
        },
      ],
    };
    const result = normalizeQaReviewResult(JSON.stringify(json));
    expect(result.followUpTasks[0].priority).toBe("medium");
  });

  it("handles follow-up tasks with 'prompt' instead of 'promptMarkdown'", () => {
    const json = {
      verdict: "pass",
      summary: "Ok",
      followUpTasks: [
        {
          title: "Task",
          prompt: "Use this prompt",
        },
      ],
    };
    const result = normalizeQaReviewResult(JSON.stringify(json));
    expect(result.followUpTasks[0].promptMarkdown).toBe("Use this prompt");
  });

  it("throws for invalid JSON", () => {
    expect(() => normalizeQaReviewResult("not json")).toThrow(/Invalid JSON format/);
  });

  it("throws for missing verdict", () => {
    const json = { summary: "Missing verdict" };
    expect(() => normalizeQaReviewResult(JSON.stringify(json))).toThrow(/Missing or invalid 'verdict'/);
  });

  it("throws for invalid verdict", () => {
    const json = { verdict: "invalid", summary: "Invalid verdict" };
    expect(() => normalizeQaReviewResult(JSON.stringify(json))).toThrow(/Missing or invalid 'verdict'/);
  });

  it("throws for missing summary", () => {
    const json = { verdict: "pass" };
    expect(() => normalizeQaReviewResult(JSON.stringify(json))).toThrow(/Missing or invalid 'summary'/);
  });

  it("throws for empty summary", () => {
    const json = { verdict: "pass", summary: "   " };
    expect(() => normalizeQaReviewResult(JSON.stringify(json))).toThrow(/Missing or invalid 'summary'/);
  });

  it("skips invalid follow-up tasks", () => {
    const json = {
      verdict: "pass",
      summary: "Ok",
      followUpTasks: [
        { title: "Missing prompt" },
        { promptMarkdown: "Missing title" },
        null,
        "not an object",
      ],
    };
    const result = normalizeQaReviewResult(JSON.stringify(json));
    expect(result.followUpTasks).toHaveLength(0);
  });
});
