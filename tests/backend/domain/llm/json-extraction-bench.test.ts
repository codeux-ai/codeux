import { describe, it, expect } from "vitest";
import { extractJsonFromText } from "../../../../src/domain/llm/json-extraction.js";

describe("json-extraction benchmark", () => {
  it("should extract JSON quickly from large text", () => {
    // Generate large text with many braces
    let text = "Here is a large text.\n";
    for (let i = 0; i < 5000; i++) {
      text += "{ this is not json } [ neither is this ] ";
      if (i % 100 === 0) text += "\n";
    }
    text += "\n```json\n{\"response\": {\"test\": 123, \"large\": true}}\n```\n";
    for (let i = 0; i < 5000; i++) {
      text += "{ more fake braces } ";
    }

    const start = performance.now();
    const result = extractJsonFromText(text);
    const end = performance.now();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ test: 123, large: true });
    }
    const elapsed = end - start;
    console.log(`Extraction took ${elapsed} ms`);
    expect(elapsed).toBeLessThan(10);
  });
});
