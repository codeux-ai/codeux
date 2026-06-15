import { describe, it, expect } from "vitest";
import { getEncoding } from "js-tiktoken";
import {
  estimateJulesUsage,
  extractAddedDiffLines,
  JULES_SYSTEM_PROMPT_TOKENS,
  JULES_CONTEXT_TOKEN_CAP,
  JULES_TOKENS_PER_ADDED_LINE,
} from "../../../src/domain/jules/jules-usage-estimator.js";
import type { JulesActivity } from "../../../src/contracts/app-types.js";

// Deterministic word-count tokenizer for clean assertions.
const wordCount = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

describe("extractAddedDiffLines", () => {
  it("keeps only added lines and drops the +++ header", () => {
    const patch = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1 +1,2 @@",
      " context line",
      "-removed line",
      "+const a = 1;",
      "+const b = 2;",
    ].join("\n");
    expect(extractAddedDiffLines(patch)).toBe("const a = 1;\nconst b = 2;");
  });
});

describe("estimateJulesUsage", () => {
  it("bills an agent turn as input=context, output=generated", () => {
    const activities: JulesActivity[] = [
      { id: "1", name: "1", createTime: "2026-06-01T00:00:00Z", agentMessaged: { agentMessage: "hi there" } },
    ];
    const result = estimateJulesUsage({ prompt: "hello world", activities, countTokens: wordCount });

    const seed = JULES_SYSTEM_PROMPT_TOKENS + wordCount("hello world"); // 800 + 2
    expect(result.inputTokens).toBe(seed); // model read the whole context
    expect(result.outputTokens).toBe(wordCount("hi there")); // 2
    expect(result.totalTokens).toBe(seed + 2);
    expect(result.toolCallCount).toBe(0);
  });

  it("grows context from user messages before the next agent turn", () => {
    const activities: JulesActivity[] = [
      { id: "1", name: "1", createTime: "2026-06-01T00:00:00Z", userMessaged: { userMessage: "more input here" } },
      { id: "2", name: "2", createTime: "2026-06-01T00:00:01Z", agentMessaged: { agentMessage: "ok done" } },
    ];
    const result = estimateJulesUsage({ prompt: "hi", activities, countTokens: wordCount });

    // context = 800 + 1 (prompt) + 3 (user msg) = 804; agent turn reads all of it.
    expect(result.inputTokens).toBe(JULES_SYSTEM_PROMPT_TOKENS + 1 + 3);
    expect(result.outputTokens).toBe(wordCount("ok done"));
  });

  it("counts only added diff lines as output and records a tool call", () => {
    const patch = "diff --git a/f b/f\n+++ b/f\n+const a = 1;\n-old line";
    const activities: JulesActivity[] = [
      {
        id: "1",
        name: "1",
        createTime: "2026-06-01T00:00:00Z",
        artifacts: [{ changeSet: { gitPatch: { unidiffPatch: patch, suggestedCommitMessage: "feat: x" } } }],
      },
    ];
    const result = estimateJulesUsage({ prompt: "", activities, countTokens: wordCount });

    const addedTokens = wordCount("const a = 1;"); // 4
    const commitTokens = wordCount("feat: x"); // 2
    expect(result.outputTokens).toBe(addedTokens + commitTokens);
    expect(result.toolCallCount).toBe(1);
    // No agent turn occurred, so the diff is output-only (no input billed).
    expect(result.inputTokens).toBe(0);
  });

  it("falls back to git insertions when no diff artifact is present", () => {
    const result = estimateJulesUsage({
      prompt: "",
      activities: [],
      gitMetrics: { insertions: 10, deletions: 5, filesChanged: 2 },
      countTokens: wordCount,
    });
    expect(result.outputTokens).toBe(10 * JULES_TOKENS_PER_ADDED_LINE);
    expect(result.toolCallCount).toBe(1);
  });

  it("does not double-count: a large diff lands in output, not as raw byte tokens", () => {
    // A realistic complaint: the whole patch (incl. context/headers) was counted.
    // Only the single added line should reach output.
    const patch = [
      "diff --git a/big.ts b/big.ts",
      "+++ b/big.ts",
      ...Array.from({ length: 500 }, (_, i) => ` unchanged context ${i}`),
      "+added one line",
    ].join("\n");
    const activities: JulesActivity[] = [
      { id: "1", name: "1", createTime: "2026-06-01T00:00:00Z", artifacts: [{ changeSet: { gitPatch: { unidiffPatch: patch } } }] },
    ];
    const result = estimateJulesUsage({ prompt: "", activities, countTokens: wordCount });
    expect(result.outputTokens).toBe(wordCount("added one line")); // 3, not ~1500
  });

  it("caps the running context so long sessions stay bounded", () => {
    const huge = "word ".repeat(50_000); // 50k tokens by word count
    const activities: JulesActivity[] = [
      { id: "1", name: "1", createTime: "2026-06-01T00:00:00Z", userMessaged: { userMessage: huge } },
      { id: "2", name: "2", createTime: "2026-06-01T00:00:01Z", userMessaged: { userMessage: huge } },
      { id: "3", name: "3", createTime: "2026-06-01T00:00:02Z", userMessaged: { userMessage: huge } },
      { id: "4", name: "4", createTime: "2026-06-01T00:00:03Z", userMessaged: { userMessage: huge } },
      { id: "5", name: "5", createTime: "2026-06-01T00:00:04Z", userMessaged: { userMessage: huge } },
      { id: "6", name: "6", createTime: "2026-06-01T00:00:05Z", agentMessaged: { agentMessage: "done" } },
    ];
    const result = estimateJulesUsage({ prompt: "", activities, countTokens: wordCount });
    // 5 * 50k = 250k of context would exceed the cap; the billed input is clamped.
    expect(result.inputTokens).toBeLessThanOrEqual(JULES_CONTEXT_TOKEN_CAP);
  });

  it("works with the real cl100k tokenizer and is input-heavy for agentic runs", () => {
    const encoder = getEncoding("cl100k_base");
    const countTokens = (text: string) => (text ? encoder.encode(text).length : 0);
    const activities: JulesActivity[] = Array.from({ length: 8 }, (_, i) => ({
      id: `${i}`,
      name: `${i}`,
      createTime: `2026-06-01T00:00:0${i}Z`,
      agentMessaged: { agentMessage: `Working on step ${i} of the task and reporting progress.` },
    }));
    const result = estimateJulesUsage({ prompt: "Implement the feature.", activities, countTokens });
    expect(result.inputTokens).toBeGreaterThan(result.outputTokens);
    expect(result.totalTokens).toBe(result.inputTokens + result.outputTokens);
  });
});
